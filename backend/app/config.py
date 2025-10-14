from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Mapping

from dotenv import load_dotenv

logger = logging.getLogger("chatkit.settings")


@dataclass(frozen=True)
class Settings:
    """Paramètres de configuration centralisés pour le backend.

    Attributes:
        allowed_origins: Liste d'origines autorisées pour le CORS.
        openai_api_key: Jeton API OpenAI utilisé pour contacter ChatKit.
        chatkit_workflow_id: Identifiant du workflow hébergé (optionnel).
        chatkit_api_base: URL de base de l'API OpenAI/ChatKit.
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
    database_url: str
    auth_secret_key: str
    access_token_expire_minutes: int
    admin_email: str | None
    admin_password: str | None
    database_connect_retries: int
    database_connect_delay: float

    @staticmethod
    def _parse_allowed_origins(raw_value: str | None) -> list[str]:
        if not raw_value:
            return ["*"]
        parts = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
        return parts or ["*"]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Settings":
        def require(name: str, *, message: str | None = None) -> str:
            value = env.get(name)
            if value:
                return value
            error = message or f"{name} environment variable is required"
            if name == "OPENAI_API_KEY":
                logger.error(
                    "OPENAI_API_KEY manquante : %s", error
                )
            else:
                logger.error(
                    "Variable d'environnement manquante (%s) : %s", name, error
                )
            raise RuntimeError(error)

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
            database_url=require(
                "DATABASE_URL",
                message="DATABASE_URL environment variable is required for PostgreSQL access",
            ),
            auth_secret_key=require(
                "AUTH_SECRET_KEY",
                message="AUTH_SECRET_KEY environment variable is required for authentication tokens",
            ),
            access_token_expire_minutes=int(env.get("ACCESS_TOKEN_EXPIRE_MINUTES", "120")),
            admin_email=env.get("ADMIN_EMAIL"),
            admin_password=env.get("ADMIN_PASSWORD"),
            database_connect_retries=int(env.get("DATABASE_CONNECT_RETRIES", "10")),
            database_connect_delay=float(env.get("DATABASE_CONNECT_DELAY", "1.0")),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_dotenv()
    return Settings.from_env(os.environ)
