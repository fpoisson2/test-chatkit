from __future__ import annotations

import copy
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from threading import RLock
from typing import Any

from dotenv import load_dotenv

logger = logging.getLogger("chatkit.settings")


DEFAULT_THREAD_TITLE_PROMPT = (
    "Propose un titre court et descriptif en français pour un nouveau fil de "
    "discussion. Utilise au maximum 6 mots."
)
DEFAULT_THREAD_TITLE_MODEL = "gpt-5-nano"


DEFAULT_SIP_BIND_HOST = "0.0.0.0"
DEFAULT_SIP_BIND_PORT = 0
DEFAULT_SIP_MEDIA_PORT = 40000

DEFAULT_LTI_PRIVATE_KEY_FILENAME = "tool-private-key.pem"
DEFAULT_LTI_PUBLIC_KEY_FILENAME = "tool-public-key.pem"

ADMIN_MODEL_API_KEY_ENV = "APP_SETTINGS_MODEL_API_KEY"

_RUNTIME_SETTINGS_OVERRIDES: dict[str, Any] | None = None
_RUNTIME_SETTINGS_LOCK = RLock()


@dataclass(frozen=True)
class ModelProviderConfig:
    """Profil de connexion pour un fournisseur de modèles."""

    provider: str
    api_base: str | None
    api_key: str | None
    is_default: bool = False
    id: str | None = None


@dataclass(frozen=True)
class WorkflowDefaults:
    """Configuration par défaut pour le workflow ChatKit."""

    default_end_message: str
    default_workflow_slug: str
    default_workflow_display_name: str
    supported_agent_keys: frozenset[str]
    expected_state_slugs: frozenset[str]
    default_agent_slugs: frozenset[str]
    default_workflow_graph: Mapping[str, Any]

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> WorkflowDefaults:
        try:
            default_end_message = str(payload["default_end_message"])
            default_workflow_slug = str(payload["default_workflow_slug"])
            default_workflow_display_name = str(
                payload["default_workflow_display_name"]
            )
            supported_agent_keys_raw = payload.get("supported_agent_keys", [])
            expected_state_slugs_raw = payload.get("expected_state_slugs", [])
            default_agent_slugs_raw = payload.get("default_agent_slugs", [])
            default_workflow_graph_raw = payload["default_workflow_graph"]
        except KeyError as exc:  # pragma: no cover - erreur de configuration
            raise RuntimeError(
                f"Clé manquante dans la configuration workflow : {exc.args[0]}"
            ) from exc

        if not isinstance(default_workflow_graph_raw, Mapping):
            raise RuntimeError(
                "default_workflow_graph doit être un objet JSON (mapping)"
            )

        def _as_frozenset(values: Any, *, label: str) -> frozenset[str]:
            if values is None:
                return frozenset()
            if isinstance(values, list | tuple | set | frozenset):
                return frozenset(str(item) for item in values)
            raise RuntimeError(f"{label} doit être une liste de chaînes")

        return cls(
            default_end_message=default_end_message,
            default_workflow_slug=default_workflow_slug,
            default_workflow_display_name=default_workflow_display_name,
            supported_agent_keys=_as_frozenset(
                supported_agent_keys_raw, label="supported_agent_keys"
            ),
            expected_state_slugs=_as_frozenset(
                expected_state_slugs_raw, label="expected_state_slugs"
            ),
            default_agent_slugs=_as_frozenset(
                default_agent_slugs_raw, label="default_agent_slugs"
            ),
            default_workflow_graph=dict(default_workflow_graph_raw),
        )

    def clone_workflow_graph(self) -> dict[str, Any]:
        """Retourne une copie profonde du graphe par défaut."""

        return copy.deepcopy(self.default_workflow_graph)


@dataclass(frozen=True)
class Settings:
    """Paramètres de configuration centralisés pour le backend.

    Attributes:
        allowed_origins: Liste d'origines autorisées pour le CORS.
        model_provider: Fournisseur de modèles configuré ("openai", "litellm", ...).
        model_api_base: URL de base utilisée pour contacter l'API du fournisseur.
        model_api_key_env: Nom de la variable d'environnement contenant la clé API.
        model_api_key: Valeur de la clé API active pour le fournisseur choisi.
        openai_api_key: Jeton API OpenAI (présent uniquement si défini dans l'env).
        model_providers: Profils de connexion disponibles (incluant les clés chiffrées
            côté administration) permettant d'activer plusieurs fournisseurs.
        chatkit_workflow_id: Identifiant du workflow hébergé (optionnel).
        sip_bind_host: Hôte d'écoute du serveur SIP (0.0.0.0 par défaut).
        sip_bind_port: Port d'écoute du serveur SIP (0 pour laisser l'OS choisir).
        sip_username: Identifiant d'authentification SIP (optionnel).
        sip_password: Mot de passe d'authentification SIP (optionnel).
        sip_trunk_uri: URI du trunk SIP (ex: "sip:alice@example.org").
        sip_registrar: Hôte ou URI du registrar SIP (ex: "pbx.local").
        sip_media_port: Port RTP local annoncé dans les réponses SIP (configurable,
            40000 par défaut).
        telephony_default_workflow_slug: Slug du workflow par défaut pour la
            téléphonie (optionnel).
        telephony_default_workflow_id: Identifiant du workflow par défaut pour
            la téléphonie (optionnel).
        backend_public_base_url: URL publique du backend utilisée pour
            construire les liens absolus.
        backend_public_base_url_from_env: Indique si l'URL publique provient
            explicitement de l'environnement.
        chatkit_realtime_model: Modèle Realtime par défaut pour les sessions vocales.
        chatkit_realtime_instructions: Instructions transmises aux sessions Realtime.
        chatkit_realtime_voice: Voix utilisée pour la synthèse Realtime.
        chatkit_realtime_model_provider_id: ID du fournisseur de modèle pour Realtime.
        chatkit_realtime_model_provider_slug: Slug du fournisseur de modèle pour
            Realtime.
        database_url: Chaîne de connexion SQLAlchemy.
        auth_secret_key: Clé secrète pour signer les JWT d'authentification.
        access_token_expire_minutes: Durée de vie des tokens d'accès.
        admin_email: Email administrateur initial (optionnel).
        admin_password: Mot de passe administrateur initial (optionnel).
        database_connect_retries: Nombre de tentatives de connexion à la base.
        database_connect_delay: Délai entre deux tentatives (en secondes).
        agent_image_token_ttl_seconds: Durée de validité (en secondes) des
            liens d'images générées.
        workflow_defaults: Configuration par défaut du workflow (chargée
            depuis un fichier JSON).
        docs_seed_documents: Définitions de documents à ingérer automatiquement
            lors du démarrage du serveur.
        thread_title_prompt: Prompt utilisé pour générer automatiquement les titres
            de fil.
        thread_title_model: Modèle utilisé pour générer automatiquement les titres
            de fil.
        lti_tool_client_id: Identifiant client de l'outil enregistré auprès de la
            plateforme LTI.
        lti_tool_key_set_url: URL publique exposant le JWKS du tool.
        lti_tool_audience: Audience attendue lors de l'émission des réponses
            deep-link.
        lti_tool_private_key: Clé privée PEM utilisée pour signer les réponses et
            les JWKS.
        lti_tool_key_id: Identifiant (kid) de la clé LTI, si disponible.
    """

    allowed_origins: list[str]
    model_provider: str
    model_api_base: str
    model_api_key_env: str
    model_api_key: str
    openai_api_key: str | None
    model_providers: tuple[ModelProviderConfig, ...]
    chatkit_workflow_id: str | None
    chatkit_realtime_model: str
    chatkit_realtime_instructions: str
    chatkit_realtime_voice: str
    chatkit_realtime_model_provider_id: str
    chatkit_realtime_model_provider_slug: str
    backend_public_base_url: str
    backend_public_base_url_from_env: bool
    sip_bind_host: str | None
    sip_bind_port: int | None
    sip_username: str | None
    sip_password: str | None
    sip_trunk_uri: str | None
    sip_registrar: str | None
    sip_media_port: int
    sip_contact_host: str | None
    sip_contact_port: int | None
    sip_contact_transport: str | None
    telephony_default_workflow_slug: str | None
    telephony_default_workflow_id: int | None
    database_url: str
    auth_secret_key: str
    access_token_expire_minutes: int
    admin_email: str | None
    admin_password: str | None
    database_connect_retries: int
    database_connect_delay: float
    agent_image_token_ttl_seconds: int
    workflow_defaults: WorkflowDefaults
    docs_seed_documents: tuple[dict[str, Any], ...]
    thread_title_prompt: str
    thread_title_model: str
    lti_tool_client_id: str | None
    lti_tool_key_set_url: str | None
    lti_tool_audience: str | None
    lti_tool_private_key: str | None
    lti_tool_key_id: str | None
    lti_tool_private_key_path: str | None
    lti_tool_public_key_path: str | None

    @property
    def chatkit_api_base(self) -> str:
        """Alias conservé pour compatibilité rétroactive."""

        return self.model_api_base

    @staticmethod
    def _load_workflow_defaults(path_value: str | None) -> WorkflowDefaults:
        if path_value:
            candidate_path = Path(path_value).expanduser()
        else:
            candidate_path = (
                Path(__file__).resolve().parent / "workflows" / "defaults.json"
            )

        try:
            raw_payload = json.loads(candidate_path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:  # pragma: no cover - configuration manquante
            raise RuntimeError(
                f"Impossible de charger la configuration workflow : {candidate_path}"
            ) from exc
        except json.JSONDecodeError as exc:  # pragma: no cover - JSON invalide
            raise RuntimeError(
                f"JSON invalide pour la configuration workflow : {candidate_path}"
            ) from exc

        if not isinstance(raw_payload, Mapping):
            raise RuntimeError(
                "Le fichier de configuration workflow doit contenir un objet JSON."
            )

        return WorkflowDefaults.from_mapping(raw_payload)

    @staticmethod
    def _load_docs_seed(path_value: str | None) -> tuple[dict[str, Any], ...]:
        if path_value is not None:
            stripped = path_value.strip()
            if not stripped:
                return ()
            candidate_path = Path(stripped).expanduser()
            try:
                raw_payload = json.loads(candidate_path.read_text(encoding="utf-8"))
            except FileNotFoundError as exc:
                raise RuntimeError(
                    "Impossible de charger les documents de seed : "
                    f"{candidate_path}"
                ) from exc
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    "JSON invalide pour la configuration de seed documentation : "
                    f"{candidate_path}"
                ) from exc
        else:
            candidate_path = (
                Path(__file__).resolve().parent
                / "docs"
                / "seed"
                / "workflow_builder.json"
            )
            if not candidate_path.exists():
                logger.debug(
                    "Aucun fichier de seed documentation trouvé : %s", candidate_path
                )
                return ()
            try:
                raw_payload = json.loads(candidate_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:  # pragma: no cover - JSON invalide
                raise RuntimeError(
                    "JSON invalide pour la configuration de seed documentation : "
                    f"{candidate_path}"
                ) from exc

        if isinstance(raw_payload, Mapping):
            documents = [dict(raw_payload)]
        elif isinstance(raw_payload, list):
            documents = []
            for item in raw_payload:
                if not isinstance(item, Mapping):
                    raise RuntimeError(
                        "Chaque document de seed doit être un objet JSON."
                    )
                documents.append(dict(item))
        else:
            raise RuntimeError(
                "Le fichier de seed documentation doit contenir un objet ou une liste."
            )

        sanitized: list[dict[str, Any]] = []
        for document in documents:
            sanitized.append(json.loads(json.dumps(document, ensure_ascii=False)))
        return tuple(sanitized)

    @staticmethod
    def _parse_allowed_origins(raw_value: str | None) -> list[str]:
        if not raw_value:
            return ["*"]
        parts = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
        return parts or ["*"]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        def require(name: str, *, message: str | None = None) -> str:
            value = env.get(name)
            if value is not None:
                stripped = value.strip()
                if stripped:
                    return stripped
            error = message or f"{name} environment variable is required"
            if name == "OPENAI_API_KEY":
                logger.error("OPENAI_API_KEY manquante : %s", error)
            else:
                logger.error(
                    "Variable d'environnement manquante (%s) : %s", name, error
                )
            raise RuntimeError(error)

        def get_stripped(name: str) -> str | None:
            value = env.get(name)
            if value is None:
                return None
            stripped = value.strip()
            return stripped or None

        model_provider = (get_stripped("MODEL_PROVIDER") or "openai").lower()

        explicit_model_api_base = get_stripped("MODEL_API_BASE")
        if explicit_model_api_base:
            model_api_base = explicit_model_api_base.rstrip("/")
        elif model_provider == "openai":
            default_base = get_stripped("CHATKIT_API_BASE") or "https://api.openai.com"
            model_api_base = default_base.rstrip("/")
        elif model_provider == "litellm":
            litellm_base = get_stripped("LITELLM_API_BASE")
            if not litellm_base:
                raise RuntimeError(
                    "LITELLM_API_BASE environment variable is required "
                    "when MODEL_PROVIDER=litellm"
                )
            model_api_base = litellm_base.rstrip("/")
        else:
            raise RuntimeError(
                "MODEL_API_BASE environment variable is required when MODEL_PROVIDER="
                f"={model_provider}"
            )

        if not model_api_base:
            raise RuntimeError(
                "Invalid MODEL_API_BASE configuration: the resolved URL cannot be empty"
            )

        explicit_model_api_key_env = get_stripped("MODEL_API_KEY_ENV")
        if explicit_model_api_key_env:
            model_api_key_env = explicit_model_api_key_env
        elif model_provider == "openai":
            model_api_key_env = "OPENAI_API_KEY"
        elif model_provider == "litellm":
            model_api_key_env = "LITELLM_API_KEY"
        else:
            raise RuntimeError(
                "MODEL_API_KEY_ENV environment variable is required when "
                f"MODEL_PROVIDER={model_provider}"
            )

        key_value = get_stripped(model_api_key_env)
        if key_value is None:
            if model_provider == "openai" and model_api_key_env == "OPENAI_API_KEY":
                model_api_key = require("OPENAI_API_KEY")
            else:
                model_api_key = require(
                    model_api_key_env,
                    message=(
                        f"{model_api_key_env} environment variable is required when "
                        f"MODEL_PROVIDER={model_provider}"
                    ),
                )
        else:
            model_api_key = key_value

        openai_api_key_value = get_stripped("OPENAI_API_KEY")
        if model_provider == "openai" and model_api_key_env == "OPENAI_API_KEY":
            openai_api_key_value = model_api_key

        raw_backend_public_base_url = env.get("BACKEND_PUBLIC_BASE_URL")
        sanitized_public_base_url = (
            raw_backend_public_base_url.strip()
            if raw_backend_public_base_url is not None
            else None
        )
        backend_public_base_url = (
            sanitized_public_base_url or "http://localhost:8000"
        ).rstrip("/")

        def _optional_int(name: str) -> int | None:
            value = get_stripped(name)
            if value is None:
                return None
            try:
                return int(value)
            except ValueError as exc:
                raise RuntimeError(
                    f"{name} environment variable must be an integer if provided"
                ) from exc

        sip_bind_port_value = _optional_int("SIP_BIND_PORT")

        sip_username_value = get_stripped("SIP_USERNAME")
        sip_password_value = get_stripped("SIP_PASSWORD")

        contact_transport_value = get_stripped("SIP_CONTACT_TRANSPORT")
        if contact_transport_value is None:
            contact_transport_value = get_stripped("SIP_TRANSPORT")

        sip_trunk_uri_value = get_stripped("SIP_TRUNK_URI")
        sip_registrar_value = get_stripped("SIP_REGISTRAR")
        if not sip_trunk_uri_value and sip_registrar_value:
            registrar_trimmed = sip_registrar_value.strip()
            registrar_lower = registrar_trimmed.lower()
            if registrar_lower.startswith("sip:") or registrar_lower.startswith(
                "sips:"
            ):
                sip_trunk_uri_value = registrar_trimmed
            elif sip_username_value:
                sip_trunk_uri_value = f"sip:{sip_username_value}@{registrar_trimmed}"

        lti_keys_dir_override = get_stripped("CHATKIT_LTI_KEYS_DIR")
        if lti_keys_dir_override:
            default_lti_keys_dir = Path(lti_keys_dir_override).expanduser()
        else:
            default_lti_keys_dir = Path.home() / ".chatkit" / "lti"

        private_key_path_value = get_stripped("LTI_TOOL_PRIVATE_KEY_PATH")
        if private_key_path_value:
            resolved_private_key_path = Path(private_key_path_value).expanduser()
        else:
            resolved_private_key_path = (
                default_lti_keys_dir / DEFAULT_LTI_PRIVATE_KEY_FILENAME
            )

        public_key_path_value = get_stripped("LTI_TOOL_PUBLIC_KEY_PATH")
        if public_key_path_value:
            resolved_public_key_path = Path(public_key_path_value).expanduser()
        else:
            resolved_public_key_path = (
                default_lti_keys_dir / DEFAULT_LTI_PUBLIC_KEY_FILENAME
            )

        return cls(
            allowed_origins=cls._parse_allowed_origins(env.get("ALLOWED_ORIGINS")),
            model_provider=model_provider,
            model_api_base=model_api_base,
            model_api_key_env=model_api_key_env,
            model_api_key=model_api_key,
            openai_api_key=openai_api_key_value,
            model_providers=(
                ModelProviderConfig(
                    provider=model_provider,
                    api_base=model_api_base,
                    api_key=model_api_key,
                    is_default=True,
                ),
            ),
            chatkit_workflow_id=env.get("CHATKIT_WORKFLOW_ID"),
            chatkit_realtime_model=env.get(
                "CHATKIT_REALTIME_MODEL",
                "gpt-realtime",
            ),
            chatkit_realtime_instructions=env.get(
                "CHATKIT_REALTIME_INSTRUCTIONS",
                "Assistant vocal ChatKit",
            ),
            chatkit_realtime_voice=env.get(
                "CHATKIT_REALTIME_VOICE",
                "verse",
            ),
            chatkit_realtime_model_provider_id=env.get(
                "CHATKIT_REALTIME_MODEL_PROVIDER_ID",
                "",
            ),
            chatkit_realtime_model_provider_slug=env.get(
                "CHATKIT_REALTIME_MODEL_PROVIDER_SLUG",
                "",
            ),
            backend_public_base_url=backend_public_base_url,
            backend_public_base_url_from_env=bool(sanitized_public_base_url),
            sip_bind_host=get_stripped("SIP_BIND_HOST") or DEFAULT_SIP_BIND_HOST,
            sip_bind_port=(
                sip_bind_port_value
                if sip_bind_port_value is not None
                else DEFAULT_SIP_BIND_PORT
            ),
            sip_username=sip_username_value,
            sip_password=sip_password_value,
            sip_trunk_uri=sip_trunk_uri_value,
            sip_registrar=sip_registrar_value,
            sip_media_port=_optional_int("SIP_MEDIA_PORT") or DEFAULT_SIP_MEDIA_PORT,
            sip_contact_host=get_stripped("SIP_CONTACT_HOST"),
            sip_contact_port=_optional_int("SIP_CONTACT_PORT"),
            sip_contact_transport=contact_transport_value,
            telephony_default_workflow_slug=get_stripped(
                "TELEPHONY_DEFAULT_WORKFLOW_SLUG"
            ),
            telephony_default_workflow_id=_optional_int(
                "TELEPHONY_DEFAULT_WORKFLOW_ID"
            ),
            database_url=require(
                "DATABASE_URL",
                message=(
                    "DATABASE_URL environment variable is required for "
                    "PostgreSQL access"
                ),
            ),
            auth_secret_key=require(
                "AUTH_SECRET_KEY",
                message=(
                    "AUTH_SECRET_KEY environment variable is required for "
                    "authentication tokens"
                ),
            ),
            access_token_expire_minutes=int(
                env.get("ACCESS_TOKEN_EXPIRE_MINUTES", "120")
            ),
            admin_email=env.get("ADMIN_EMAIL"),
            admin_password=env.get("ADMIN_PASSWORD"),
            database_connect_retries=int(env.get("DATABASE_CONNECT_RETRIES", "10")),
            database_connect_delay=float(env.get("DATABASE_CONNECT_DELAY", "1.0")),
            agent_image_token_ttl_seconds=int(
                env.get("AGENT_IMAGE_TOKEN_TTL_SECONDS", "3600")
            ),
            workflow_defaults=cls._load_workflow_defaults(
                env.get("WORKFLOW_DEFAULTS_PATH")
            ),
            docs_seed_documents=cls._load_docs_seed(env.get("DOCS_SEED_PATH")),
            thread_title_prompt=(
                get_stripped("CHATKIT_THREAD_TITLE_PROMPT")
                or DEFAULT_THREAD_TITLE_PROMPT
            ),
            thread_title_model=(
                get_stripped("CHATKIT_THREAD_TITLE_MODEL")
                or DEFAULT_THREAD_TITLE_MODEL
            ),
            lti_tool_client_id=get_stripped("LTI_TOOL_CLIENT_ID"),
            lti_tool_key_set_url=get_stripped("LTI_TOOL_KEY_SET_URL"),
            lti_tool_audience=get_stripped("LTI_TOOL_AUDIENCE"),
            lti_tool_private_key=get_stripped("LTI_TOOL_PRIVATE_KEY"),
            lti_tool_key_id=get_stripped("LTI_TOOL_KEY_ID"),
            lti_tool_private_key_path=str(resolved_private_key_path),
            lti_tool_public_key_path=str(resolved_public_key_path),
        )


def _get_runtime_overrides() -> dict[str, Any] | None:
    with _RUNTIME_SETTINGS_LOCK:
        if _RUNTIME_SETTINGS_OVERRIDES is None:
            return None
        return dict(_RUNTIME_SETTINGS_OVERRIDES)


def _apply_runtime_overrides(
    base: Settings, overrides: Mapping[str, Any]
) -> Settings:
    if not overrides:
        return base
    allowed_keys = set(Settings.__dataclass_fields__.keys())
    sanitized = {key: value for key, value in overrides.items() if key in allowed_keys}
    if not sanitized:
        return base
    updated = replace(base, **sanitized)
    if (
        "model_api_key" in sanitized
        and "openai_api_key" not in sanitized
        and updated.model_provider == "openai"
        and updated.model_api_key_env == "OPENAI_API_KEY"
    ):
        updated = replace(updated, openai_api_key=sanitized["model_api_key"])
    return updated


def set_runtime_settings_overrides(overrides: Mapping[str, Any] | None) -> None:
    global _RUNTIME_SETTINGS_OVERRIDES
    with _RUNTIME_SETTINGS_LOCK:
        if overrides:
            _RUNTIME_SETTINGS_OVERRIDES = dict(overrides)
        else:
            _RUNTIME_SETTINGS_OVERRIDES = None
        get_settings.cache_clear()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_dotenv()
    base_settings = Settings.from_env(os.environ)
    overrides = _get_runtime_overrides()
    if overrides:
        base_settings = _apply_runtime_overrides(base_settings, overrides)
    return base_settings


class SettingsProxy:
    def __getattr__(self, item: str) -> Any:
        return getattr(get_settings(), item)

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return repr(get_settings())


settings_proxy = SettingsProxy()
