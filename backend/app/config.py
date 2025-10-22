from __future__ import annotations

import copy
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

logger = logging.getLogger("chatkit.settings")


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
        openai_api_key: Jeton API OpenAI utilisé pour contacter ChatKit.
        chatkit_workflow_id: Identifiant du workflow hébergé (optionnel).
        chatkit_api_base: URL de base de l'API OpenAI/ChatKit.
        backend_public_base_url: URL publique du backend utilisée pour
            construire les liens absolus.
        backend_public_base_url_from_env: Indique si l'URL publique provient
            explicitement de l'environnement.
        chatkit_agent_model: Modèle utilisé pour les agents classiques.
        chatkit_agent_instructions: Instructions de l'agent historique.
        chatkit_realtime_model: Modèle Realtime par défaut pour les sessions vocales.
        chatkit_realtime_instructions: Instructions transmises aux sessions Realtime.
        chatkit_realtime_voice: Voix utilisée pour la synthèse Realtime.
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
    """

    allowed_origins: list[str]
    openai_api_key: str
    chatkit_workflow_id: str | None
    chatkit_api_base: str
    chatkit_agent_model: str
    chatkit_agent_instructions: str
    chatkit_realtime_model: str
    chatkit_realtime_instructions: str
    chatkit_realtime_voice: str
    backend_public_base_url: str
    backend_public_base_url_from_env: bool
    database_url: str
    auth_secret_key: str
    access_token_expire_minutes: int
    admin_email: str | None
    admin_password: str | None
    database_connect_retries: int
    database_connect_delay: float
    agent_image_token_ttl_seconds: int
    workflow_defaults: WorkflowDefaults

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
    def _parse_allowed_origins(raw_value: str | None) -> list[str]:
        if not raw_value:
            return ["*"]
        parts = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
        return parts or ["*"]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        def require(name: str, *, message: str | None = None) -> str:
            value = env.get(name)
            if value:
                return value
            error = message or f"{name} environment variable is required"
            if name == "OPENAI_API_KEY":
                logger.error("OPENAI_API_KEY manquante : %s", error)
            else:
                logger.error(
                    "Variable d'environnement manquante (%s) : %s", name, error
                )
            raise RuntimeError(error)

        raw_backend_public_base_url = env.get("BACKEND_PUBLIC_BASE_URL")
        sanitized_public_base_url = (
            raw_backend_public_base_url.strip()
            if raw_backend_public_base_url is not None
            else None
        )
        backend_public_base_url = (
            sanitized_public_base_url or "http://localhost:8000"
        ).rstrip("/")

        return cls(
            allowed_origins=cls._parse_allowed_origins(env.get("ALLOWED_ORIGINS")),
            openai_api_key=require("OPENAI_API_KEY"),
            chatkit_workflow_id=env.get("CHATKIT_WORKFLOW_ID"),
            chatkit_api_base=env.get("CHATKIT_API_BASE", "https://api.openai.com"),
            chatkit_agent_model=env.get(
                "CHATKIT_AGENT_MODEL",
                "gpt-5",
            ),
            chatkit_agent_instructions=env.get(
                "CHATKIT_AGENT_INSTRUCTIONS",
                "Assistant conversationnel",
            ),
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
            backend_public_base_url=backend_public_base_url,
            backend_public_base_url_from_env=bool(sanitized_public_base_url),
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
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_dotenv()
    return Settings.from_env(os.environ)
