"""Adaptateur PJSUA pour la téléphonie SIP/RTP.

Ce module fournit une interface Python async pour PJSIP (via pjsua2),
permettant de gérer:
- Enregistrement SIP (REGISTER)
- Appels entrants (INVITE entrant)
- Appels sortants (INVITE sortant)
- Média RTP/RTCP avec support de codecs audio

PJSUA gère nativement le SIP et le RTP, ce qui simplifie grandement
l'implémentation par rapport à une solution séparée.
"""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
import queue
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .call_diagnostics import CallDiagnostics
from .callbacks import PJSUAAccount, PJSUACall
from .config import (
    jitter_buffer_settings,
    logging_settings,
    media_feature_settings,
    rtp_settings,
    session_timer_settings,
    transport_settings,
)
from .media import AudioMediaPort
from .pjsua_config import ensure_environment_overrides
from .pjsua_errors import _is_session_terminated_error
from .pjsua_lib import PJSUA_AVAILABLE, logger, pj


@dataclass
class PJSUAConfig:
    """Configuration pour un compte SIP PJSUA."""

    # Identité SIP
    sip_uri: str  # Ex: sip:user@domain.com
    registrar_uri: str  # Ex: sip:domain.com

    # Authentification
    username: str
    password: str

    # Transport
    transport: str = "UDP"  # UDP, TCP, TLS
    port: int = 5060

    # Paramètres d'enregistrement
    register: bool = True
    register_timeout: int = 300  # secondes

    # Paramètres audio
    local_host: str = "0.0.0.0"


@dataclass
class CallInfo:
    """Informations sur un appel PJSUA."""

    call_id: int
    remote_uri: str
    state: str
    state_text: str
    local_contact: str
    remote_contact: str
    has_media: bool = False


class PJSUAAdapter:
    """Adaptateur principal pour PJSUA."""

    def __init__(self):
        ensure_environment_overrides(logger=logger)
        if not PJSUA_AVAILABLE:
            raise RuntimeError(
                "pjsua2 n'est pas disponible. Installez-le avec: pip install pjsua2"
            )

        self._ep: pj.Endpoint | None = None
        self._transport: pj.TransportConfig | None = None
        self._account: PJSUAAccount | None = None
        self._active_calls: dict[int, PJSUACall] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._running = False
        self._audio_port_pool: list[AudioMediaPort] = []

        # Callbacks
        self._incoming_call_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None
        self._call_state_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None
        self._media_active_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None

        # Warning throttling pour éviter le spam de logs
        self._send_audio_warning_count = 0  # Compteur de warnings supprimés
        self._send_audio_last_warning = 0.0  # Timestamp du dernier warning loggé

    async def initialize(
        self,
        config: PJSUAConfig | None = None,
        *,
        port: int = 5060,
        nomadic_mode: bool = False
    ) -> None:
        """Initialise l'endpoint PJSUA et optionnellement crée le compte SIP.

        Args:
            config: Configuration SIP (optionnelle). Si None, seul l'endpoint est créé.
            port: Port UDP pour le transport SIP (utilisé si config est None)
            nomadic_mode: True = mode nomade (ICE activé), False = mode passerelle (ICE désactivé)
        """
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        self._loop = asyncio.get_running_loop()

        # Créer l'endpoint PJSUA
        self._ep = pj.Endpoint()
        self._ep.libCreate()

        # CRITICAL FIX: Force RTP ports using PJSUA core API (C layer)
        # The Python ep_cfg.medConfig binding is broken - PJSUA ignores it
        # We need to call pjsua_media_config_default() and pjsua_reconfigure_media()
        try:
            # Try to import and use the C-level pjsua API if available
            # This is the ONLY way to force ports on buggy PJSUA2 Python versions

            # Check if pjsua module (C API) is available
            try:
                import pjsua  # Low-level C API (different from pjsua2)

                logger.info("🔧 API PJSUA (C) disponible - tentative de configuration directe...")

                # Use pjsua C API to set media config
                if hasattr(pjsua, 'media_config_default'):
                    med_cfg = pjsua.media_config_default()
                    med_cfg.port = 10000
                    med_cfg.max_port = 20000

                    # Apply the config
                    if hasattr(pjsua, 'reconfigure_media'):
                        pjsua.reconfigure_media(med_cfg)
                        logger.info("✅ Ports RTP forcés via pjsua.reconfigure_media(): 10000-20000")
                    else:
                        logger.warning("⚠️ pjsua.reconfigure_media() non disponible")
                else:
                    logger.warning("⚠️ pjsua.media_config_default() non disponible")

            except ImportError:
                logger.info("ℹ️ Module pjsua (C API) non disponible, utilisation de pjsua2 uniquement")

        except Exception as e:
            logger.warning("⚠️ Impossible d'accéder à l'API PJSUA C: %s", e)

        ep_cfg = pj.EpConfig()
        log_cfg = logging_settings()
        ep_cfg.logConfig.level = log_cfg.level
        ep_cfg.logConfig.consoleLevel = log_cfg.console_level

        ua_cfg = ep_cfg.uaConfig
        timer_cfg = session_timer_settings()
        ua_cfg.mainThreadOnly = timer_cfg.main_thread_only
        ua_cfg.natTypeInSdp = timer_cfg.nat_type_in_sdp

        try:
            ua_cfg.timerUse = timer_cfg.timer_use
            ua_cfg.timerMinSE = timer_cfg.timer_min_se
            ua_cfg.timerSessExpires = timer_cfg.timer_sess_expires
            logger.info(
                "🔧 SIP Session Timers: FORCED mode, minSE=%ds, expires=%ds",
                timer_cfg.timer_min_se,
                timer_cfg.timer_sess_expires,
            )
        except AttributeError:
            logger.warning("⚠️ SIP Session Timers not available in this PJSUA2 version")

        media_cfg = ep_cfg.medConfig
        jitter_cfg = jitter_buffer_settings()
        media_cfg.jb_init = jitter_cfg.jb_init
        media_cfg.jb_min_pre = jitter_cfg.jb_min_pre
        media_cfg.jb_max_pre = jitter_cfg.jb_max_pre
        media_cfg.jb_max = jitter_cfg.jb_max
        media_cfg.snd_auto_close_time = jitter_cfg.snd_auto_close_time

        rtp_cfg = rtp_settings()
        media_cfg.rtp_port = rtp_cfg.start_port
        media_cfg.rtp_port_range = rtp_cfg.port_range

        try:
            if hasattr(media_cfg, "rtpStart"):
                media_cfg.rtpStart = rtp_cfg.start_port
                logger.debug("Tentative: media_cfg.rtpStart = %d", rtp_cfg.start_port)
        except Exception as error:  # pragma: no cover - defensive logging
            logger.debug("Failed to set media_cfg.rtpStart: %s", error)

        try:
            if hasattr(media_cfg, "portRange"):
                media_cfg.portRange = rtp_cfg.port_range
                logger.debug("Tentative: media_cfg.portRange = %d", rtp_cfg.port_range)
        except Exception as error:  # pragma: no cover - defensive logging
            logger.debug("Failed to set media_cfg.portRange: %s", error)

        logger.info(
            "📋 Attributs medConfig disponibles: %s",
            [attr for attr in dir(media_cfg) if not attr.startswith("_") and "port" in attr.lower()],
        )

        feature_cfg = media_feature_settings(nomadic_mode=nomadic_mode)
        media_cfg.enable_ice = feature_cfg.enable_ice
        media_cfg.enable_rtcp_mux = feature_cfg.enable_rtcp_mux
        media_cfg.no_vad = feature_cfg.no_vad

        if feature_cfg.ice_no_host_cands is not None:
            try:
                media_cfg.ice_no_host_cands = feature_cfg.ice_no_host_cands
                logger.info("🔧 ICE host candidates: DISABLED (faster media setup)")
            except AttributeError:
                logger.debug("ice_no_host_cands not available")

        if feature_cfg.ec_tail_len is not None:
            try:
                media_cfg.ecTailLen = feature_cfg.ec_tail_len
                logger.info("🔧 Echo canceller: DISABLED (ecTailLen=0, bridge mode)")
            except AttributeError:
                logger.debug("ecTailLen not available")

        if feature_cfg.srtp_opt is not None:
            try:
                media_cfg.srtpOpt = feature_cfg.srtp_opt
                logger.info("🔧 SRTP: OPTIONAL (no negotiation delay)")
            except AttributeError:
                logger.debug("srtpOpt not available")

        logger.info(
            "📊 Jitter buffer configuré: init=%dms, min_pre=%dms, max_pre=%dms, max=%dms, auto_close=%d",
            media_cfg.jb_init * 20,
            media_cfg.jb_min_pre * 20,
            media_cfg.jb_max_pre * 20,
            media_cfg.jb_max * 20,
            media_cfg.snd_auto_close_time,
        )
        logger.info(
            "🔧 RTP configuré: port=%d, range=%d (ports %d-%d)",
            media_cfg.rtp_port,
            media_cfg.rtp_port_range,
            media_cfg.rtp_port,
            media_cfg.rtp_port + media_cfg.rtp_port_range,
        )
        logger.info(
            "🔧 Optimisations audio: mode=%s, ICE=%s, RTCP_mux=%s, VAD=%s",
            "nomade" if feature_cfg.enable_ice else "passerelle",
            "enabled" if media_cfg.enable_ice else "disabled",
            "enabled" if media_cfg.enable_rtcp_mux else "disabled",
            "disabled" if media_cfg.no_vad else "enabled",
        )

        # Initialiser l'endpoint
        self._ep.libInit(ep_cfg)

        # Configure null audio device (no hardware required)
        # This is essential for Docker environments without sound cards
        self._ep.audDevManager().setNullDev()
        logger.info("PJSUA configured to use null audio device (no hardware)")

        # Créer le transport UDP
        transport_cfg = pj.TransportConfig()
        transport_values = transport_settings(
            port=config.port if config is not None else port
        )
        transport_cfg.port = transport_values.port
        self._transport = self._ep.transportCreate(pj.PJSIP_TRANSPORT_UDP, transport_cfg)

        # Démarrer l'endpoint
        self._ep.libStart()

        logger.info(
            "PJSUA endpoint démarré sur UDP:%d",
            transport_values.port,
        )

        # CRITICAL DIAGNOSTIC: Verify actual RTP ports being used after libStart()
        # If PJSUA ignores our config, this will show the real ports
        try:
            # Re-read the media config to see what PJSUA actually configured
            actual_cfg = self._ep.libGetConfig()
            actual_rtp_port = actual_cfg.medConfig.rtp_port
            actual_rtp_range = actual_cfg.medConfig.rtp_port_range

            logger.info(
                "✅ DIAGNOSTIC: PJSUA ports RTP RÉELS après libStart(): start=%d, range=%d (ports %d-%d)",
                actual_rtp_port,
                actual_rtp_range,
                actual_rtp_port,
                actual_rtp_port + actual_rtp_range,
            )

            # CRITICAL: Warn if PJSUA ignored our configuration
            if actual_rtp_port != 10000:
                logger.error(
                    "🚨 PJSUA A IGNORÉ NOTRE CONFIG! Nous avons demandé rtp_port=10000 mais PJSUA utilise %d",
                    actual_rtp_port
                )
                logger.error(
                    "🚨 Ceci est un BUG de PJSUA2 ou une incompatibilité de version!"
                )
        except Exception as e:
            logger.warning("Impossible de lire la config PJSUA réelle: %s", e)

        # Créer le compte SIP si configuré
        if config is not None and config.register:
            await self._create_account(config)

        self._running = True

    async def _create_account(self, config: PJSUAConfig) -> None:
        """Crée et enregistre un compte SIP."""
        if not self._ep:
            raise RuntimeError("Endpoint PJSUA non initialisé")

        # Configuration du compte
        acc_cfg = pj.AccountConfig()
        acc_cfg.idUri = config.sip_uri
        acc_cfg.regConfig.registrarUri = config.registrar_uri

        # Authentification
        cred = pj.AuthCredInfo()
        cred.scheme = "digest"
        cred.realm = "*"
        cred.username = config.username
        cred.dataType = 0  # plain text password
        cred.data = config.password
        acc_cfg.sipConfig.authCreds.append(cred)

        # Créer le compte
        self._account = PJSUAAccount(self)
        self._account.create(acc_cfg)

        logger.info(
            "Compte SIP créé: %s",
            config.sip_uri,
        )

    async def load_account_from_db(self, session: Any) -> bool:
        """Charge le compte SIP par défaut depuis la base de données.

        Args:
            session: Session SQLAlchemy pour accéder à la BD

        Returns:
            True si un compte a été chargé, False sinon
        """
        from sqlalchemy import select  # noqa: I001
        from ..models import SipAccount

        # Récupérer le compte SIP par défaut et actif
        account = session.scalar(
            select(SipAccount)
            .where(
                SipAccount.is_active.is_(True),
                SipAccount.is_default.is_(True),
            )
            .order_by(SipAccount.id.asc())
        )

        if not account:
            # Sinon, prendre le premier compte actif
            account = session.scalar(
                select(SipAccount)
                .where(SipAccount.is_active.is_(True))
                .order_by(SipAccount.id.asc())
            )

        if not account:
            logger.warning("Aucun compte SIP actif trouvé dans la base de données")
            return False

        logger.info(
            "Chargement du compte SIP: %s (ID: %d)",
            account.label,
            account.id,
        )

        # Construire la configuration PJSUA
        config = PJSUAConfig(
            sip_uri=account.trunk_uri,
            registrar_uri=account.trunk_uri,  # Utiliser trunk_uri comme registrar
            username=account.username or "",
            password=account.password or "",
            port=account.contact_port or 5060,
            transport="UDP",  # TODO: supporter TCP/TLS
            register=True,
        )

        # Créer le compte
        await self._create_account(config)

        return True

    async def shutdown(self) -> None:
        """Arrête proprement PJSUA."""
        self._running = False

        # Terminer tous les appels actifs avec nettoyage complet
        call_ids = list(self._active_calls.keys())
        logger.info("Arrêt de %d appel(s) actif(s)", len(call_ids))

        for call_id in call_ids:
            try:
                # Utiliser cleanup_call pour un nettoyage complet
                await self.cleanup_call(call_id)
            except Exception as e:
                logger.exception("Erreur lors du nettoyage de l'appel %s: %s", call_id, e)

        self._drain_audio_port_pool()

        # Détruire le compte
        if self._account:
            try:
                self._account.shutdown()
            except Exception as e:
                logger.exception("Erreur lors de la fermeture du compte: %s", e)

        # Détruire l'endpoint
        if self._ep:
            try:
                self._ep.libDestroy()
            except Exception as e:
                logger.exception("Erreur lors de la destruction de l'endpoint: %s", e)

        logger.info("PJSUA arrêté")

    def set_incoming_call_callback(
        self, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Définit le callback pour les appels entrants."""
        self._incoming_call_callback = callback

    def set_call_state_callback(
        self, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Définit le callback pour les changements d'état d'appel."""
        self._call_state_callback = callback

    def set_media_active_callback(
        self, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Définit le callback pour l'activation du média."""
        self._media_active_callback = callback

    async def _on_reg_state(self, is_active: bool) -> None:
        """Callback interne pour les changements d'état d'enregistrement."""
        logger.info("État enregistrement SIP: %s", "actif" if is_active else "inactif")

    async def _on_incoming_call(self, call: PJSUACall, call_info: Any) -> None:
        """Callback interne pour les appels entrants."""
        # Sécurité: vérifier qu'on n'écrase pas un appel actif
        # Cela ne devrait jamais arriver si le cleanup est correct
        if call_info.id in self._active_calls:
            existing_call = self._active_calls[call_info.id]
            if existing_call != call:
                logger.error(
                    "⚠️ SÉCURITÉ: call_id=%d existe déjà dans _active_calls! "
                    "Possible réutilisation d'ID sans cleanup complet. "
                    "Forçage du cleanup de l'ancien appel...",
                    call_info.id,
                )

                # CRITIQUE: Nettoyer complètement l'ancien appel AVANT de le remplacer
                try:
                    # Forcer le cleanup immédiat sans délai
                    old_call = existing_call

                    # Marquer comme terminé
                    old_call._terminated = True
                    old_call.diagnostics.mark_terminated()
                    old_call._closed = True
                    old_call.diagnostics.mark_closed()
                    old_call._cleanup_done = True

                    # Arrêter l'audio bridge
                    if hasattr(old_call, '_audio_bridge') and old_call._audio_bridge:
                        old_call._audio_bridge.stop()
                        old_call._audio_bridge = None

                    # Nettoyer le port audio
                    if old_call._audio_port:
                        port = old_call._audio_port
                        old_call._audio_port = None
                        try:
                            old_call._disconnect_conference_bridge(call_info.id)
                        except Exception as e:
                            logger.debug("Failed to disconnect conference bridge for call %d: %s", call_info.id, e)
                        self.release_audio_port(port)

                    # Hangup si nécessaire
                    try:
                        await self.hangup_call(old_call)
                    except Exception as e:
                        logger.debug("Failed to hangup old call: %s", e)

                    # Détruire l'objet
                    del old_call

                    logger.warning("✅ Ancien appel call_id=%d nettoyé et détruit", call_info.id)

                except Exception as cleanup_err:
                    logger.error("⚠️ Erreur cleanup forcé ancien appel: %s", cleanup_err)

        self._active_calls[call_info.id] = call

        if self._incoming_call_callback:
            await self._incoming_call_callback(call, call_info)

    async def _on_call_state(self, call: PJSUACall, call_info: Any) -> None:
        """Callback interne pour les changements d'état d'appel.

        Note: Ce callback est appelé quand PJSUA signale un changement d'état.
        Pour DISCONNECTED, on fait un nettoyage immédiat sans délai car PJSUA
        a déjà terminé son propre nettoyage interne.
        """
        # Nettoyer les appels terminés
        if call_info.state == pj.PJSIP_INV_STATE_DISCONNECTED:
            # CRITIQUE: Marquer terminated=True IMMÉDIATEMENT pour empêcher tout hangup/getInfo ultérieur
            # Doit être fait AVANT le check _cleanup_done pour garantir le flag même si cleanup skip
            call._terminated = True
            call.diagnostics.mark_terminated()

            # Protection idempotente: éviter les doubles nettoyages
            if call._cleanup_done:
                logger.debug("Nettoyage déjà effectué pour call_id=%s, ignoré", call_info.id)
                return

            call._cleanup_done = True
            logger.info("📞 Appel DISCONNECTED détecté - nettoyage immédiat (call_id=%s)", call_info.id)

            self._active_calls.pop(call_info.id, None)

            # SÉQUENCE DE NETTOYAGE CORRECTE (ordre critique pour éviter race condition) :
            #
            # 1. DÉSACTIVER LE PORT EN PREMIER (ferme la porte à PJSUA)
            # 2. Arrêter le voice bridge
            # 3. Vidage actif des queues
            # 4. Disconnect conference bridge
            # 5. Remettre le port dans le pool

            port = call._audio_port if call._audio_port else None
            audio_bridge = call._audio_bridge if hasattr(call, '_audio_bridge') else None

            # ÉTAPE 1: DÉSACTIVER LE PORT IMMÉDIATEMENT (CRITIQUE!)
            # Cela empêche la "trame orpheline" d'arriver
            if port:
                try:
                    port.disable()
                    logger.info("✅ [1/5] Port audio désactivé IMMÉDIATEMENT (call_id=%s)", call_info.id)
                except Exception as e:
                    logger.error("Erreur lors de la désactivation du port (call_id=%s): %s", call_info.id, e)

            # ÉTAPE 2: ARRÊTER LE VOICE BRIDGE
            # Maintenant que le port est muet, on peut arrêter la logique applicative
            if audio_bridge:
                try:
                    logger.info("🛑 [2/5] Arrêt de l'audio bridge (call_id=%s)", call_info.id)
                    audio_bridge.stop()
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue arrêt audio bridge (call_id=%s, déjà terminé): %s", call_info.id, e)
                    else:
                        logger.warning("Erreur arrêt audio bridge (call_id=%s): %s", call_info.id, e)
                finally:
                    call._audio_bridge = None

            # ÉTAPE 3: VIDAGE ACTIF DES QUEUES
            # Vider tout ce qui a pu arriver AVANT l'appel à disable()
            if port:
                try:
                    cleared_incoming = 0
                    try:
                        while True:
                            port._incoming_audio_queue.get_nowait()
                            cleared_incoming += 1
                    except queue.Empty:
                        pass

                    cleared_outgoing = 0
                    try:
                        while True:
                            port._outgoing_audio_queue.get_nowait()
                            cleared_outgoing += 1
                    except queue.Empty:
                        pass

                    if cleared_incoming > 0 or cleared_outgoing > 0:
                        logger.info(
                            "🗑️ [3/5] Queues audio vidées: %d frames entrantes, %d sortantes (call_id=%s)",
                            cleared_incoming, cleared_outgoing, call_info.id
                        )
                except Exception as e:
                    logger.warning("Erreur vidage queues (call_id=%s): %s", call_info.id, e)

            # ÉTAPE 4: DISCONNECT CONFERENCE BRIDGE
            if port:
                call._audio_port = None
                try:
                    call._disconnect_conference_bridge(call_info.id)
                    logger.info("✅ [4/5] Conference bridge déconnecté (call_id=%s)", call_info.id)
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue disconnect conference (call_id=%s, déjà terminé): %s", call_info.id, e)
                    else:
                        logger.warning("Erreur disconnect conference (call_id=%s): %s", call_info.id, e)

            # ÉTAPE 5: REMETTRE LE PORT (MAINTENANT PROPRE) DANS LE POOL
            if port:
                try:
                    self.release_audio_port(port)
                    logger.info("✅ [5/5] Port audio remis dans le pool (call_id=%s)", call_info.id)
                except Exception as e:
                    logger.warning("Erreur release port (call_id=%s): %s", call_info.id, e)

            # ÉTAPE 6: CASSER TOUTES LES RÉFÉRENCES CIRCULAIRES DANS LE CALL
            # CRITICAL FIX: Explicitly break all circular references to allow GC
            # This is essential even though we set to None above, because Call object
            # may still be referenced in PJSUA callbacks or event handlers
            try:
                call._audio_port = None
                call._audio_bridge = None
                call._audio_media = None
                call._frame_requested_event = None
                call._conference_connected = False
                call._call_slot_id = None
                call._custom_port_slot_id = None
                logger.debug("✅ [6/6] Références circulaires cassées dans Call (call_id=%s)", call_info.id)
            except Exception as e:
                logger.warning("Erreur cassage références circulaires (call_id=%s): %s", call_info.id, e)

            # ÉTAPE 7: FORCE CLEANUP OF ALL PJSUA INTERNAL STATE
            # CRITICAL FIX: Force PJSUA to cleanup any ghost calls in its internal structures
            # This eliminates "semi-existence zombie" call dialogs that block rapid re-calls
            try:
                # hangupAllCalls() ensures PJSUA internal state is fully cleared
                # Even if we already cleaned up our Python objects, PJSUA C++ layer may
                # still have SIP transaction state that needs explicit cleanup
                self._ep.hangupAllCalls()
                logger.debug("✅ [7/7] PJSUA hangupAllCalls() forcé (call_id=%s)", call_info.id)
            except Exception as e:
                # This is safe to fail - call is already disconnected
                logger.debug("hangupAllCalls() failed (expected if no active calls): %s", e)

        if self._call_state_callback:
            await self._call_state_callback(call, call_info)

    async def _on_media_active(self, call: PJSUACall, media_info: Any) -> None:
        """Callback interne pour l'activation du média."""
        if self._media_active_callback:
            await self._media_active_callback(call, media_info)

    async def answer_call(self, call: PJSUACall, code: int = 200) -> None:
        """Répond à un appel entrant."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        # Préparer les paramètres de réponse
        prm = pj.CallOpParam()
        prm.statusCode = code

        # Répondre à l'appel
        call.answer(prm)
        logger.info("Réponse envoyée à l'appel (code=%d)", code)

    async def hangup_call(self, call: PJSUACall) -> None:
        """Termine un appel de manière idempotente.

        Vérifie le flag _terminated avant de tenter hangup().
        Cela évite les appels inutiles à hangup() sur des sessions déjà terminées.
        """
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        # Protection: vérifier si l'appel est déjà terminé AVANT tout appel PJSUA
        if call._terminated or call._closed:
            logger.debug("hangup_call skipped: already terminated=%s or closed=%s", call._terminated, call._closed)
            return

        try:
            prm = pj.CallOpParam()
            call.hangup(prm)
            logger.info("Appel terminé via hangup()")
        except Exception as e:
            # PJSIP_ESESSIONTERMINATED (171140) signifie "déjà terminé" - c'est ok
            error_str = str(e).lower()
            if "already terminated" in error_str or "esessionterminated" in error_str or "171140" in str(e):
                logger.debug("Appel déjà terminé (171140), traité comme succès")
            else:
                # Autre erreur réelle
                raise

    async def cleanup_call(self, call_id: int) -> None:
        """Nettoie proprement une session d'appel PJSUA.

        Attend un délai avant de nettoyer pour laisser PJSUA terminer proprement,
        puis nettoie les ressources audio et raccroche l'appel si nécessaire.

        Args:
            call_id: ID de l'appel à nettoyer
        """
        try:
            # Attendre un peu avant de nettoyer pour laisser PJSUA terminer
            await asyncio.sleep(0.5)

            # Récupérer l'appel depuis active_calls
            call = self._active_calls.get(call_id)
            if not call:
                logger.debug("Appel %s déjà nettoyé ou introuvable", call_id)
                return

            # Protection idempotente: éviter les doubles nettoyages (race avec DISCONNECTED callback)
            if call._closed or call._cleanup_done:
                logger.debug(
                    "Nettoyage déjà effectué pour call_id=%s (closed=%s, cleanup_done=%s), ignoré",
                    call_id,
                    call._closed,
                    call._cleanup_done,
                )
                return

            # Marquer l'appel comme fermé IMMÉDIATEMENT pour empêcher tout accès concurrent
            call._closed = True
            call.diagnostics.mark_closed()
            call._cleanup_done = True
            logger.info("🧹 Début nettoyage appel (call_id=%s, terminated=%s)", call_id, call._terminated)

            # Arrêter l'audio bridge d'abord (si attaché dynamiquement à l'appel)
            if hasattr(call, '_audio_bridge') and call._audio_bridge:
                try:
                    logger.info("🛑 Arrêt de l'audio bridge (call_id=%s)", call_id)
                    call._audio_bridge.stop()
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue arrêt audio bridge (call_id=%s, déjà terminé): %s", call_id, e)
                    else:
                        logger.warning("Erreur arrêt audio bridge (call_id=%s): %s", call_id, e)
                finally:
                    call._audio_bridge = None

            # Désactiver le port audio
            if call._audio_port:
                port = call._audio_port
                call._audio_port = None
                try:
                    call._disconnect_conference_bridge(call_id)
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue désactivation port audio (call_id=%s, déjà terminé): %s", call_id, e)
                    else:
                        logger.warning("Erreur désactivation port audio (call_id=%s): %s", call_id, e)
                finally:
                    self.release_audio_port(port)
                    logger.info("🛑 Désactivation du port audio (call_id=%s)", call_id)

            # Vérifier l'état avant de hangup
            if call and self._is_call_valid(call):
                try:
                    logger.info("📞 Hangup de l'appel (call_id=%s)", call_id)
                    await self.hangup_call(call)
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue hangup (call_id=%s, déjà terminé): %s", call_id, e)
                    else:
                        logger.warning("Erreur hangup (call_id=%s): %s", call_id, e)

            # Retirer de active_calls
            self._active_calls.pop(call_id, None)

            # CRITIQUE: Destruction explicite de l'objet Call pour libérer les ressources PJSUA
            # Sans cela, PJSUA peut garder des références internes et ne pas libérer les ports RTP
            try:
                # Marquer l'objet comme invalide
                call._terminated = True
                call.diagnostics.mark_terminated()
                call._closed = True
                call.diagnostics.mark_closed()

                # CRITICAL FIX: Break all circular references before deleting
                # Call may still be referenced elsewhere (e.g., in callbacks)
                # Explicitly clear all attributes to allow garbage collection
                call._audio_port = None
                call._audio_bridge = None
                call._audio_media = None
                call._frame_requested_event = None
                # Adapter reference is needed for PJSUA operations, keep it

                # Forcer la destruction de l'objet Call
                # Note: Python garbage collectera l'objet, mais on s'assure qu'il n'y a plus de refs
                del call
                logger.info("✅ Nettoyage terminé + Call object détruit + références circulaires cassées (call_id=%s)", call_id)
            except Exception as del_err:
                logger.warning("⚠️ Erreur destruction Call object (call_id=%s): %s", call_id, del_err)

        except Exception as e:
            # DEBUG si erreur post-mortem 171140, WARNING sinon
            if _is_session_terminated_error(e):
                logger.debug("Erreur attendue cleanup (call_id=%s, déjà terminé): %s", call_id, e)
            else:
                logger.warning("Erreur cleanup (call_id=%s): %s", call_id, e)

    def _is_call_valid(self, call: PJSUACall) -> bool:
        """Vérifie si un appel est toujours valide et peut être raccroché.

        Utilise les flags _terminated/_closed au lieu de getInfo() pour éviter
        les appels PJSUA post-mortem qui génèrent des erreurs 171140.

        Args:
            call: L'appel PJSUA à vérifier

        Returns:
            True si l'appel est valide et peut être raccroché, False sinon
        """
        if not PJSUA_AVAILABLE or not call:
            return False

        # Vérifier les flags d'état au lieu d'appeler getInfo()
        # Cela évite les erreurs ESESSIONTERMINATED (171140) post-mortem
        return not (call._terminated or call._closed)

    async def make_call(self, dest_uri: str) -> PJSUACall:
        """Initie un appel sortant."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        if not self._account:
            raise RuntimeError("Aucun compte SIP configuré")

        # Créer un nouvel appel avec diagnostics runtime
        diagnostics = CallDiagnostics(call_id="pjsua-outgoing")
        call = PJSUACall(self, diagnostics=diagnostics)

        # Préparer les paramètres d'appel
        prm = pj.CallOpParam()
        prm.opt.audioCount = 1
        prm.opt.videoCount = 0

        # Passer l'appel
        call.makeCall(dest_uri, prm)

        # Récupérer l'info de l'appel pour obtenir l'ID
        ci = call.getInfo()
        call.diagnostics.call_id = str(ci.id)

        # Sécurité: vérifier qu'on n'écrase pas un appel actif
        # Cela ne devrait jamais arriver si le cleanup est correct
        if ci.id in self._active_calls:
            existing_call = self._active_calls[ci.id]
            if existing_call != call:
                logger.error(
                    "⚠️ SÉCURITÉ: call_id=%d existe déjà dans _active_calls! "
                    "Possible réutilisation d'ID sans cleanup complet. "
                    "Ancien appel sera remplacé.",
                    ci.id,
                )

        self._active_calls[ci.id] = call

        logger.info("Appel sortant initié vers %s", dest_uri)
        return call

    def get_call_info(self, call: PJSUACall) -> CallInfo:
        """Récupère les informations d'un appel."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        ci = call.getInfo()
        return CallInfo(
            call_id=ci.id,
            remote_uri=ci.remoteUri,
            state=str(ci.state),
            state_text=ci.stateText,
            local_contact=ci.localContact,
            remote_contact=ci.remoteContact,
            has_media=bool(ci.media),
        )

    # ===== Méthodes Audio =====

    def send_audio_to_call(self, call: PJSUACall, audio_data: bytes) -> None:
        """Envoie de l'audio vers un appel (PCM 8kHz, 16-bit, mono)."""
        if call._audio_port:
            call._audio_port.send_audio(audio_data)
        else:
            # Throttling: log seulement toutes les 2 secondes max
            import time
            now = time.monotonic()
            if now - self._send_audio_last_warning >= 2.0:
                if self._send_audio_warning_count > 0:
                    logger.warning(
                        "Tentative d'envoi audio sur un appel sans port audio (%d suppressed)",
                        self._send_audio_warning_count
                    )
                    self._send_audio_warning_count = 0
                else:
                    logger.warning("Tentative d'envoi audio sur un appel sans port audio")
                self._send_audio_last_warning = now
            else:
                self._send_audio_warning_count += 1

    async def receive_audio_from_call(self, call: PJSUACall) -> bytes | None:
        """Récupère l'audio reçu d'un appel (PCM 8kHz, 16-bit, mono)."""
        if call._audio_port:
            return await call._audio_port.get_audio()
        return None

    def clear_call_audio_queue(self, call: PJSUACall) -> int:
        """Vide la queue audio sortante d'un appel (utilisé lors d'interruptions).

        Returns:
            Nombre de frames vidées
        """
        if call._audio_port:
            return call._audio_port.clear_outgoing_audio_queue()
        return 0

    def clear_call_incoming_audio_queue(self, call: PJSUACall) -> int:
        """Vide la queue audio entrante d'un appel (utilisé pour supprimer le silence initial).

        Returns:
            Nombre de frames vidées
        """
        if call._audio_port:
            return call._audio_port.clear_incoming_audio_queue()
        return 0

    def acquire_audio_port(
        self,
        frame_requested_event: asyncio.Event | None,
        *,
        call_id: int | None = None,
        audio_bridge: Any | None = None,
    ) -> AudioMediaPort:
        """Retourne un port audio prêt pour un nouvel appel.

        COOLDOWN: Force recreate après N réutilisations pour casser tout état latent.
        Si MAX_REUSE_COUNT = 0, réutilisation illimitée sans jamais détruire le port.
        """
        # Port reuse is now SAFE thanks to active drain in prepare_for_pool()
        # Active drain eliminates race condition with residual PJSUA jitter buffer frames
        # CRITICAL FIX: Reduce reuse count to prevent state accumulation and conference slot leaks
        # After investigation, ports and conference bridges accumulate state that causes slowdown
        MAX_REUSE_COUNT = 5  # Recreate every 5 uses to prevent resource leaks (reduced from 20)

        diagnostics: CallDiagnostics | None = None
        if call_id is not None:
            call_obj = self._active_calls.get(call_id)
            if call_obj is not None:
                diagnostics = getattr(call_obj, "diagnostics", None)

        if self._audio_port_pool:
            port = self._audio_port_pool.pop()

            # SAFETY CHECK: Verify port is clean (should never fail with active drain)
            incoming_size = port._incoming_audio_queue.qsize()
            outgoing_size = port._outgoing_audio_queue.qsize()

            if incoming_size > 0 or outgoing_size > 0:
                logger.error(
                    "⚠️ SAFETY: Port from pool is DIRTY! incoming=%d, outgoing=%d "
                    "(active drain should have prevented this - possible bug!)",
                    incoming_size, outgoing_size
                )
                # Force clean before use
                try:
                    while True:
                        port._incoming_audio_queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    while True:
                        port._outgoing_audio_queue.get_nowait()
                except queue.Empty:
                    pass
                logger.info("🗑️ Emergency cleanup: queues forcibly drained")

            # Vérifier le compteur de réutilisation (0 = illimité)
            if MAX_REUSE_COUNT > 0 and port._reuse_count >= MAX_REUSE_COUNT:
                logger.info(
                    "🔄 Port atteint %d réutilisations - destruction et recréation (call_id=%s)",
                    port._reuse_count, call_id
                )
                try:
                    port.deactivate(destroy_port=True)
                except Exception as exc:
                    logger.debug("Erreur destruction port (cooldown): %s", exc)

                # Créer un nouveau port après cooldown
                logger.info(
                    "🔧 Création d'un nouvel AudioMediaPort après cooldown (call_id=%s)",
                    call_id
                )
                new_port = AudioMediaPort(
                    self,
                    frame_requested_event,
                    audio_bridge,
                    diagnostics=diagnostics,
                )

                if diagnostics is not None:
                    diagnostics.record_port_reuse(0, recreated=True)

                return new_port

            # Réutiliser le port existant
            port._reuse_count += 1
            logger.info(
                "♻️ Réutilisation d'un AudioMediaPort depuis le pool (reuse #%d, call_id=%s)",
                port._reuse_count, call_id
            )
            port.prepare_for_new_call(
                frame_requested_event,
                audio_bridge,
                diagnostics=diagnostics,
            )

            if diagnostics is not None:
                diagnostics.record_port_reuse(port._reuse_count, recreated=False)

            return port

        logger.info(
            "🔧 Création d'un nouvel AudioMediaPort (call_id=%s)",
            call_id
        )
        new_port = AudioMediaPort(
            self,
            frame_requested_event,
            audio_bridge,
            diagnostics=diagnostics,
        )

        if diagnostics is not None:
            diagnostics.record_port_reuse(0, recreated=False)

        return new_port

    def release_audio_port(
        self, port: AudioMediaPort, *, destroy: bool = False
    ) -> None:
        """Remet le port dans le pool ou le détruit définitivement.

        CRITICAL FIX: Limite la taille du pool pour éviter l'accumulation infinie.
        """
        # CRITICAL FIX: Limit pool size to prevent unbounded growth
        # If we have concurrent calls that create many ports, we don't want to keep them all forever
        MAX_POOL_SIZE = 3  # Keep max 3 ports in pool (enough for typical concurrent call scenarios)

        try:
            if destroy:
                port.deactivate(destroy_port=True)
            else:
                port.prepare_for_pool()
        except Exception as exc:  # pragma: no cover - nettoyage défensif
            logger.debug("Erreur lors du recyclage du port audio: %s", exc)
            destroy = True

        if not destroy:
            # Check pool size limit before adding
            if len(self._audio_port_pool) >= MAX_POOL_SIZE:
                logger.debug(
                    "🗑️ Pool audio plein (%d ports), destruction du port au lieu de pooling",
                    len(self._audio_port_pool)
                )
                try:
                    port.deactivate(destroy_port=True)
                except Exception as exc:
                    logger.debug("Erreur destruction port: %s", exc)
            else:
                self._audio_port_pool.append(port)
                logger.debug(
                    "♻️ Port ajouté au pool (taille actuelle: %d/%d)",
                    len(self._audio_port_pool),
                    MAX_POOL_SIZE
                )

    def _drain_audio_port_pool(self) -> None:
        """Détruit tous les ports présents dans le pool (arrêt complet)."""

        while self._audio_port_pool:
            port = self._audio_port_pool.pop()
            try:
                port.deactivate(destroy_port=True)
            except Exception as exc:  # pragma: no cover - nettoyage défensif
                logger.debug("Erreur destruction port audio du pool: %s", exc)

    def set_audio_callback(
        self, callback: Callable[[bytes], Awaitable[None]]
    ) -> None:
        """Définit un callback appelé quand de l'audio est reçu."""
        self._audio_callback = callback

    async def _on_audio_received(self, audio_data: bytes) -> None:
        """Callback interne appelé quand de l'audio est reçu."""
        if hasattr(self, '_audio_callback') and self._audio_callback:
            try:
                await self._audio_callback(audio_data)
            except Exception as e:
                logger.exception("Erreur dans audio callback: %s", e)


# Instance globale
_pjsua_adapter: PJSUAAdapter | None = None


def get_pjsua_adapter() -> PJSUAAdapter:
    """Retourne l'instance globale de l'adaptateur PJSUA."""
    global _pjsua_adapter
    if _pjsua_adapter is None:
        _pjsua_adapter = PJSUAAdapter()
    return _pjsua_adapter


__all__ = [
    "AudioMediaPort",
    "CallInfo",
    "PJSUAAccount",
    "PJSUACall",
    "PJSUAAdapter",
    "PJSUAConfig",
    "get_pjsua_adapter",
]
