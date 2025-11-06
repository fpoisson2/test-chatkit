from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI
from sqlalchemy import select

from ..admin_settings import (
    apply_runtime_model_overrides,
    get_thread_title_prompt_override,
)
from ..config import settings_proxy
from ..database import (
    SessionLocal,
    engine,
    ensure_database_extensions,
    ensure_vector_indexes,
    wait_for_database,
)
from ..database.ad_hoc_migrations import run_ad_hoc_migrations
from ..docs import DocumentationService
from ..model_providers import configure_model_provider
from ..models import (
    AppSettings,
    Base,
    User,
)
from ..security import hash_password
from ..telephony.invite_runtime import InviteRuntime
from ..telephony.multi_sip_manager import MultiSIPRegistrationManager
from ..telephony.registration import SIPRegistrationManager
from ..telephony.sip_server import resolve_workflow_for_phone_number
from ..telephony.voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks

# PJSUA imports
try:
    from ..telephony.pjsua_adapter import PJSUA_AVAILABLE, PJSUAAdapter
    from ..telephony.pjsua_audio_bridge import create_pjsua_audio_bridge
except ImportError:
    PJSUA_AVAILABLE = False
    PJSUAAdapter = None  # type: ignore
    create_pjsua_audio_bridge = None  # type: ignore
from ..vector_store import (
    WORKFLOW_VECTOR_STORE_DESCRIPTION,
    WORKFLOW_VECTOR_STORE_METADATA,
    WORKFLOW_VECTOR_STORE_SLUG,
    WORKFLOW_VECTOR_STORE_TITLE,
    JsonVectorStoreService,
)
from ..workflows.service import WorkflowService

logger = logging.getLogger("chatkit.server")

# Configuration: utiliser PJSUA au lieu d'aiosip pour SIP/RTP
# TODO: Déplacer vers settings une fois la migration terminée
USE_PJSUA = PJSUA_AVAILABLE  # Utiliser PJSUA si disponible

for noisy_logger in (
    "aiosip",
    "aiosip.protocol",
    "aiosip.application",
    # La librairie `websockets` est très verbeuse en DEBUG et noie nos journaux.
    # On force un niveau plus élevé tant qu'aucune configuration spécifique
    # n'a été appliquée par l'utilisateur.
    "websockets.client",
    "websockets.asyncio.client",
    # Le client MCP génère des logs DEBUG très verbeux avec les payloads complets
    # des événements SSE et des messages serveur. On réduit le niveau de log.
    "mcp.client.sse",
):
    logger_instance = logging.getLogger(noisy_logger)
    if logger_instance.level == logging.NOTSET:
        logger_instance.setLevel(logging.INFO)
settings = settings_proxy


InviteHandlerFactory = Callable[
    [MultiSIPRegistrationManager | SIPRegistrationManager],
    Any,
]


def _build_invite_handler(
    manager: MultiSIPRegistrationManager | SIPRegistrationManager,
):
    runtime = InviteRuntime(manager)
    return runtime.build_handler()


def _ensure_protected_vector_store() -> None:
    """Crée le vector store réservé aux workflows s'il est absent."""

    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        existing = service.get_store(WORKFLOW_VECTOR_STORE_SLUG)
        if existing is not None:
            session.rollback()
            return

        logger.info(
            "Création du vector store protégé %s pour les workflows",
            WORKFLOW_VECTOR_STORE_SLUG,
        )
        service.ensure_store_exists(
            WORKFLOW_VECTOR_STORE_SLUG,
            title=WORKFLOW_VECTOR_STORE_TITLE,
            description=WORKFLOW_VECTOR_STORE_DESCRIPTION,
            metadata=dict(WORKFLOW_VECTOR_STORE_METADATA),
        )
        session.commit()


def _build_pjsua_incoming_call_handler(app: FastAPI) -> Any:
    """Construit le handler pour les appels entrants PJSUA."""

    # ===== SYSTÈME DE DISPATCH CENTRALISÉ POUR APPELS MULTIPLES =====
    # Dictionnaire pour stocker les callbacks media_active par call PJSUA
    # Clé: id(call) pour identifier chaque objet call de manière unique
    _media_active_callbacks: dict[int, Any] = {}

    # Callback global dispatch pour media_active
    # (appelé UNE SEULE FOIS pour tous les appels)
    async def _global_media_active_dispatch(active_call: Any, media_info: Any) -> None:
        """Dispatche les événements media_active vers le callback du bon appel."""
        call_key = id(active_call)
        callback = _media_active_callbacks.get(call_key)
        if callback:
            try:
                await callback(active_call, media_info)
            except Exception as e:
                logger.exception(
                    "Erreur dans callback media_active (call_key=%s): %s",
                    call_key,
                    e,
                )

    # Enregistrer le callback global UNE SEULE FOIS
    pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
    pjsua_adapter.set_media_active_callback(_global_media_active_dispatch)
    logger.info("✅ Système de dispatch centralisé configuré pour media_active")
    # COMME LE TEST: Pas de callback call_state - nettoyage fait dans les tâches
    # ===== FIN DU SYSTÈME DE DISPATCH =====

    async def _handle_pjsua_incoming_call(call: Any, call_info: Any) -> None:
        """Gère un appel entrant PJSUA - VERSION SIMPLIFIÉE COMME LE TEST."""
        call_id = call_info.id  # PJSUA call ID
        logger.info("📞 ===== APPEL ENTRANT =====")
        logger.info("📞 De: %s", call_info.remoteUri)
        logger.info("📞 Call ID: %s", call_id)

        from ..telephony.pjsua_audio_bridge import create_pjsua_audio_bridge

        pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
        chatkit_call_id = str(uuid.uuid4())

        # Extraire le numéro appelant
        import re
        remote_uri = call_info.remoteUri if hasattr(call_info, 'remoteUri') else ""
        incoming_number = None
        match = re.search(r"sip:([^@>;]+)@", remote_uri, re.IGNORECASE)
        if match:
            incoming_number = match.group(1)
            logger.info("Numéro entrant: %s", incoming_number)

        try:
            # Résoudre le workflow pour obtenir instructions/tools
            with SessionLocal() as db_session:
                workflow_service = WorkflowService(db_session)
                try:
                    context = resolve_workflow_for_phone_number(
                        workflow_service,
                        phone_number=incoming_number or "",
                        session=db_session,
                        sip_account_id=None,
                    )
                    voice_model = context.voice_model
                    voice_instructions = context.voice_instructions
                    voice_name = context.voice_voice
                    voice_tools = context.voice_tools or []
                    ring_timeout_seconds = context.ring_timeout_seconds
                    logger.info(
                        "✅ Workflow résolu: model=%s, tools=%d, ring=%ds",
                        voice_model,
                        len(voice_tools),
                        ring_timeout_seconds,
                    )
                except Exception as exc:
                    logger.warning(
                        "Erreur workflow (call_id=%s): %s - utilisation "
                        "valeurs par défaut",
                        call_id,
                        exc,
                    )
                    # Valeurs par défaut si pas de workflow
                    voice_model = "gpt-4o-realtime-preview"
                    voice_instructions = (
                        "Vous êtes un assistant vocal. Répondez brièvement."
                    )
                    voice_name = "alloy"
                    voice_tools = []
                    ring_timeout_seconds = 0

            # Créer l'audio bridge (RAPIDE - juste la config)
            logger.info("🎵 Création du bridge audio...")
            media_active = asyncio.Event()

            (
                rtp_stream,
                send_to_peer,
                clear_queue,
                first_packet_event,
                pjsua_ready_event,
                audio_bridge,
            ) = await create_pjsua_audio_bridge(call, media_active)

            # Imports pour la tâche async
            from agents.realtime.agent import RealtimeAgent
            from agents.realtime.runner import RealtimeRunner

            from ..realtime_runner import (
                _cleanup_mcp_servers,
                _connect_mcp_servers,
                _normalize_realtime_tools_payload,
            )

            # Définir la tâche async qui contient TOUTES les opérations bloquantes
            async def run_voice_bridge():
                """Voice bridge avec sonnerie et init agent dans la tâche async."""
                mcp_servers = []
                try:
                    # 1. ENVOYER 180 RINGING (dans la tâche async,
                    #    ne bloque pas le callback)
                    logger.info("📞 Envoi 180 Ringing (call_id=%s)", chatkit_call_id)
                    await pjsua_adapter.answer_call(call, code=180)

                    # 2. PENDANT LA SONNERIE: Initialiser l'agent et les serveurs MCP
                    logger.info("⏰ Initialisation agent pendant la sonnerie...")

                    # Normaliser tools pour extraire configs MCP
                    mcp_server_configs = []
                    normalized_tools = _normalize_realtime_tools_payload(
                        voice_tools, mcp_server_configs=mcp_server_configs
                    )

                    # Connecter serveurs MCP PENDANT la sonnerie
                    if mcp_server_configs:
                        logger.info(
                            "Connexion %d serveurs MCP pendant sonnerie...",
                            len(mcp_server_configs),
                        )
                        mcp_servers = await _connect_mcp_servers(mcp_server_configs)
                        logger.info("✅ Serveurs MCP connectés")

                    # Créer l'agent PENDANT la sonnerie
                    agent = RealtimeAgent(
                        name=f"call-{call_id}",
                        instructions=voice_instructions,
                        mcp_servers=mcp_servers,
                    )
                    runner = RealtimeRunner(agent)
                    logger.info("✅ Agent créé pendant sonnerie")

                    # 3. PRÉPARER LE VOICE BRIDGE (hooks, config)
                    api_key = os.getenv("OPENAI_API_KEY")

                    # Hooks (DOIVENT être async)
                    async def close_dialog_hook() -> None:
                        try:
                            await pjsua_adapter.hangup_call(call)
                        except Exception as e:
                            if "already terminated" not in str(e).lower():
                                logger.warning("Erreur: %s", e)

                    async def clear_voice_state_hook() -> None:
                        pass

                    async def resume_workflow_hook(
                        transcripts: list[dict[str, str]],
                    ) -> None:
                        logger.info("Session terminée")

                    hooks = VoiceBridgeHooks(
                        close_dialog=close_dialog_hook,
                        clear_voice_state=clear_voice_state_hook,
                        resume_workflow=resume_workflow_hook,
                    )

                    voice_bridge = TelephonyVoiceBridge(hooks=hooks, input_codec="pcm")

                    # 4. LANCER LA SESSION SDK EN PARALLÈLE
                    #    (connexion pendant la sonnerie)
                    logger.info(
                        "🔌 Démarrage connexion session SDK pendant la sonnerie..."
                    )
                    voice_bridge_task = asyncio.create_task(
                        voice_bridge.run(
                            runner=runner,
                            client_secret=api_key,
                            model=voice_model,
                            instructions=voice_instructions,
                            voice=voice_name,
                            rtp_stream=rtp_stream,
                            send_to_peer=send_to_peer,
                            audio_bridge=audio_bridge,
                            tools=normalized_tools,
                            speak_first=True,
                            clear_audio_queue=clear_queue,
                            pjsua_ready_to_consume=pjsua_ready_event,
                        )
                    )

                    # 5. SONNERIE - PENDANT CE TEMPS la session SDK se connecte à OpenAI
                    if ring_timeout_seconds > 0:
                        logger.info(
                            "⏰ Sonnerie de %ds (session SDK se connecte "
                            "en parallèle)...",
                            ring_timeout_seconds,
                        )
                        await asyncio.sleep(ring_timeout_seconds)

                    # 6. RÉPONDRE 200 OK
                    logger.info("📞 Réponse 200 OK (call_id=%s)", chatkit_call_id)
                    await pjsua_adapter.answer_call(call, code=200)

                    # 7. ACTIVER LE MÉDIA
                    #    (déclenche pjsua_ready_event → response.create)
                    media_active.set()
                    await asyncio.sleep(1)

                    # 8. ATTENDRE que le voice bridge se termine
                    logger.info("⏳ Attente du voice bridge...")
                    stats = await voice_bridge_task

                    logger.info("✅ Terminé: %s", stats)

                except Exception as e:
                    logger.exception(
                        "❌ Erreur dans VoiceBridge (call_id=%s): %s",
                        chatkit_call_id,
                        e,
                    )
                finally:
                    # Nettoyage
                    try:
                        audio_bridge.stop()
                    except Exception as e:
                        logger.warning("Erreur: %s", e)

                    try:
                        await pjsua_adapter.hangup_call(call)
                    except Exception as e:
                        if "already terminated" not in str(e).lower():
                            logger.warning("Erreur: %s", e)

                    # Nettoyer serveurs MCP
                    if mcp_servers:
                        try:
                            await _cleanup_mcp_servers(mcp_servers)
                        except Exception as e:
                            logger.warning("Erreur cleanup MCP: %s", e)

            # COMME LE TEST: Démarrer le voice bridge SANS ATTENDRE
            # Le callback retourne immédiatement, permettant les appels multiples
            logger.info("🎵 Démarrage du voice bridge (async)...")
            asyncio.create_task(run_voice_bridge())

        except Exception as e:
            logger.error("❌ Erreur lors du traitement de l'appel: %s", e)

    return _handle_pjsua_incoming_call


def configure_sip_layer(
    app: FastAPI,
    *,
    invite_handler_factory: InviteHandlerFactory = _build_invite_handler,
) -> tuple[str | None, int | None]:
    """Configure les composants SIP et retourne les paramètres de contact."""

    sip_contact_host = settings.sip_contact_host
    sip_contact_port = (
        settings.sip_contact_port
        if settings.sip_contact_port is not None
        else settings.sip_bind_port
    )

    # Choisir entre PJSUA ou aiosip selon la configuration
    if USE_PJSUA:
        logger.info("Utilisation de PJSUA pour la téléphonie SIP")
        # Créer l'adaptateur PJSUA (sera initialisé au démarrage)
        pjsua_adapter = PJSUAAdapter()
        app.state.pjsua_adapter = pjsua_adapter
        app.state.sip_registration = None
        # Pas de MultiSIPRegistrationManager avec PJSUA
    else:
        logger.info("Utilisation d'aiosip pour la téléphonie SIP (legacy)")
        # Utiliser le gestionnaire multi-SIP pour supporter plusieurs comptes
        sip_registration_manager = MultiSIPRegistrationManager(
            session_factory=SessionLocal,
            settings=settings,
            contact_host=sip_contact_host,
            contact_port=sip_contact_port,
            contact_transport=settings.sip_contact_transport,
            bind_host=settings.sip_bind_host,
        )
        sip_registration_manager.set_invite_handler(
            invite_handler_factory(sip_registration_manager)
        )
        app.state.sip_registration = sip_registration_manager
        app.state.pjsua_adapter = None

    return sip_contact_host, sip_contact_port


def register_database_startup(app: FastAPI) -> None:
    """Enregistre l'événement de démarrage lié à la base de données."""

    @app.on_event("startup")
    def _on_startup() -> None:
        wait_for_database()
        ensure_database_extensions()
        run_ad_hoc_migrations()
        Base.metadata.create_all(bind=engine)
        ensure_vector_indexes()
        with SessionLocal() as session:
            override = get_thread_title_prompt_override(session)
            runtime_settings = apply_runtime_model_overrides(override)
        configure_model_provider(runtime_settings)
        _ensure_protected_vector_store()
        if settings.admin_email and settings.admin_password:
            normalized_email = settings.admin_email.lower()
            with SessionLocal() as session:
                existing = session.scalar(
                    select(User).where(User.email == normalized_email)
                )
                if not existing:
                    logger.info("Creating initial admin user %s", normalized_email)
                    user = User(
                        email=normalized_email,
                        password_hash=hash_password(settings.admin_password),
                        is_admin=True,
                    )
                    session.add(user)
                    session.commit()
        if settings.docs_seed_documents:
            with SessionLocal() as session:
                service = DocumentationService(session)
                for seed in settings.docs_seed_documents:
                    slug = str(seed.get("slug") or "").strip()
                    if not slug:
                        logger.warning(
                            "Entrée de seed documentation ignorée : slug manquant"
                        )
                        continue
                    if service.get_document(slug) is not None:
                        continue
                    metadata = {
                        key: value
                        for key, value in seed.items()
                        if key
                        not in {
                            "slug",
                            "title",
                            "summary",
                            "language",
                            "content_markdown",
                        }
                    }
                    try:
                        service.create_document(
                            slug,
                            title=seed.get("title"),
                            summary=seed.get("summary"),
                            language=seed.get("language"),
                            content_markdown=seed.get("content_markdown"),
                            metadata=metadata,
                        )
                        session.commit()
                        logger.info(
                            "Document de documentation initial importé : %s", slug
                        )
                    except Exception as exc:  # pragma: no cover - dépend externe
                        session.rollback()
                        logger.warning(
                            "Impossible d'ingérer le document de seed %s : %s",
                            slug,
                            exc,
                        )


def register_telephony_events(
    app: FastAPI,
    *,
    sip_contact_host: str | None,
    sip_contact_port: int | None,
    invite_handler_factory: InviteHandlerFactory = _build_invite_handler,
) -> None:
    """Enregistre les événements de démarrage/arrêt liés à la téléphonie."""

    @app.on_event("startup")
    async def _start_sip_registration() -> None:
        if USE_PJSUA:
            # Démarrer PJSUA
            pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
            try:
                # Initialiser l'endpoint PJSUA
                port = settings.sip_bind_port or 5060
                await pjsua_adapter.initialize(port=port)
                logger.info("PJSUA endpoint initialisé sur port %d", port)

                # Charger le compte SIP depuis la BD
                with SessionLocal() as session:
                    account_loaded = await pjsua_adapter.load_account_from_db(session)
                    if account_loaded:
                        logger.info("Compte SIP chargé depuis la BD pour PJSUA")
                    else:
                        logger.warning(
                            "Aucun compte SIP actif trouvé - PJSUA en mode sans compte"
                        )

                # Initialiser le gestionnaire d'appels sortants avec PJSUA
                from ..telephony.outbound_call_manager import get_outbound_call_manager

                get_outbound_call_manager(pjsua_adapter=pjsua_adapter)
                logger.info("OutboundCallManager initialisé avec PJSUA")

                # Configurer le callback pour les appels entrants
                incoming_call_handler = _build_pjsua_incoming_call_handler(app)
                pjsua_adapter.set_incoming_call_callback(incoming_call_handler)
                logger.info("Callback appels entrants PJSUA configuré")

                logger.info("PJSUA prêt pour les appels SIP")
            except Exception as e:
                logger.exception("Erreur lors du démarrage de PJSUA: %s", e)
        else:
            # Démarrer aiosip (legacy)
            manager: MultiSIPRegistrationManager = app.state.sip_registration
            with SessionLocal() as session:
                # Charger tous les comptes SIP actifs depuis la BD
                await manager.load_accounts_from_db(session)

                # Si aucun compte SIP n'est configuré, essayer les anciens paramètres
                if not manager.has_accounts():
                    logger.info(
                        "Aucun compte SIP trouvé en BD, tentative de chargement depuis "
                        "AppSettings"
                    )
                    # Fallback : créer un gestionnaire unique avec les
                    # anciens paramètres
                    stored_settings = session.scalar(select(AppSettings).limit(1))
                    if stored_settings and stored_settings.sip_trunk_uri:
                        from ..telephony.registration import SIPRegistrationConfig

                        # Créer un compte SIP temporaire depuis AppSettings
                        fallback_config = SIPRegistrationConfig(
                            uri=stored_settings.sip_trunk_uri,
                            username=stored_settings.sip_trunk_username or "",
                            password=stored_settings.sip_trunk_password or "",
                            contact_host=(
                                stored_settings.sip_contact_host
                                or sip_contact_host
                                or "127.0.0.1"
                            ),
                            contact_port=(
                                stored_settings.sip_contact_port
                                or sip_contact_port
                                or 5060
                            ),
                            transport=stored_settings.sip_contact_transport,
                            bind_host=settings.sip_bind_host,
                        )

                        # Créer un gestionnaire temporaire
                        fallback_manager = SIPRegistrationManager(
                            session_factory=SessionLocal,
                            settings=settings,
                            contact_host=sip_contact_host,
                            contact_port=sip_contact_port,
                            contact_transport=settings.sip_contact_transport,
                            bind_host=settings.sip_bind_host,
                            invite_handler=invite_handler_factory(manager),
                        )
                        fallback_manager.apply_config(fallback_config)
                        # Stocker temporairement le gestionnaire fallback
                        manager._managers[0] = fallback_manager
                        logger.info("Compte SIP de fallback créé depuis AppSettings")

            await manager.start()

    @app.on_event("shutdown")
    async def _stop_sip_registration() -> None:
        if USE_PJSUA:
            # Arrêter PJSUA
            pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
            try:
                await pjsua_adapter.shutdown()
                logger.info("PJSUA arrêté proprement")
            except Exception as exc:
                logger.exception("Erreur lors de l'arrêt de PJSUA", exc_info=exc)
        else:
            # Arrêter aiosip (legacy)
            manager: MultiSIPRegistrationManager = app.state.sip_registration
            try:
                await manager.stop()
            except Exception as exc:  # pragma: no cover - network dependent
                logger.exception(
                    "Arrêt du gestionnaire d'enregistrement SIP échoué",
                    exc_info=exc,
                )


def register_startup_events(app: FastAPI) -> None:
    """Configure les événements de démarrage pour l'application FastAPI."""

    sip_contact_host, sip_contact_port = configure_sip_layer(app)
    register_database_startup(app)
    register_telephony_events(
        app,
        sip_contact_host=sip_contact_host,
        sip_contact_port=sip_contact_port,
    )
