from __future__ import annotations

import asyncio
import datetime
import logging
import os
import uuid
from typing import Any

from fastapi import FastAPI
from sqlalchemy import String, inspect, select, text
from sqlalchemy.sql import bindparam


from .admin_settings import (
    apply_runtime_model_overrides,
    get_thread_title_prompt_override,
)
from .config import DEFAULT_THREAD_TITLE_MODEL, settings_proxy
from .database import (
    SessionLocal,
    engine,
    ensure_database_extensions,
    ensure_vector_indexes,
    wait_for_database,
)
from .docs import DocumentationService
from .model_providers import configure_model_provider
from .models import (
    EMBEDDING_DIMENSION,
    AppSettings,
    AvailableModel,
    Base,
    WorkflowAppearance,
    McpServer,
    SipAccount,
    TelephonyRoute,
    User,
    VoiceSettings,
    Workflow,
)
from .security import hash_password
from .telephony.multi_sip_manager import MultiSIPRegistrationManager
from .telephony.registration import SIPRegistrationManager
from .telephony.sip_server import resolve_workflow_for_phone_number
from .telephony.voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks
from .telephony.invite_runtime import InviteRuntime
# PJSUA imports
try:
    from .telephony.pjsua_adapter import PJSUAAdapter, PJSUA_AVAILABLE
    from .telephony.pjsua_audio_bridge import create_pjsua_audio_bridge
except ImportError:
    PJSUA_AVAILABLE = False
    PJSUAAdapter = None  # type: ignore
    create_pjsua_audio_bridge = None  # type: ignore
from .vector_store import (
    WORKFLOW_VECTOR_STORE_DESCRIPTION,
    WORKFLOW_VECTOR_STORE_METADATA,
    WORKFLOW_VECTOR_STORE_SLUG,
    WORKFLOW_VECTOR_STORE_TITLE,
    JsonVectorStoreService,
)
from .workflows.service import WorkflowService

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


def _build_invite_handler(
    manager: MultiSIPRegistrationManager | SIPRegistrationManager,
):
    runtime = InviteRuntime(manager)
    return runtime.build_handler()


def _run_ad_hoc_migrations() -> None:
    """Apply les évolutions mineures du schéma sans Alembic."""

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        if "available_models" not in table_names:
            logger.info("Création de la table available_models manquante")
            AvailableModel.__table__.create(bind=connection)
            table_names.add("available_models")
        else:
            available_models_columns = {
                column["name"]
                for column in inspect(connection).get_columns("available_models")
            }
            if "provider_id" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "provider_id"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN provider_id "
                        "VARCHAR(128)"
                    )
                )
            if "provider_slug" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "provider_slug"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN provider_slug "
                        "VARCHAR(64)"
                    )
                )
            if "supports_previous_response_id" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "supports_previous_response_id"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN "
                        "supports_previous_response_id BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
            if "supports_reasoning_summary" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "supports_reasoning_summary"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN "
                        "supports_reasoning_summary BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
            if "store" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "store"
                )
                connection.execute(
                    text("ALTER TABLE available_models ADD COLUMN store BOOLEAN")
                )

        if "voice_settings" not in table_names:
            logger.info("Création de la table voice_settings manquante")
            VoiceSettings.__table__.create(bind=connection)
            table_names.add("voice_settings")

        if "workflow_appearances" not in table_names:
            logger.info("Création de la table workflow_appearances manquante")
            WorkflowAppearance.__table__.create(bind=connection)
            table_names.add("workflow_appearances")

        if "hosted_workflows" in table_names:
            hosted_columns = {
                column["name"]
                for column in inspect(connection).get_columns("hosted_workflows")
            }
            if "remote_workflow_id" not in hosted_columns:
                logger.info(
                    "Migration du schéma hosted_workflows : ajout de la colonne "
                    "remote_workflow_id",
                )
                connection.execute(
                    text(
                        "ALTER TABLE hosted_workflows ADD COLUMN "
                        "remote_workflow_id VARCHAR(128)"
                    )
                )
                connection.execute(
                    text(
                        "UPDATE hosted_workflows SET remote_workflow_id = slug "
                        "WHERE remote_workflow_id IS NULL"
                    )
                )

        if "voice_settings" in table_names:
            voice_settings_columns = {
                column["name"]
                for column in inspect(connection).get_columns("voice_settings")
            }
            if "provider_id" not in voice_settings_columns:
                logger.info(
                    "Migration du schéma voice_settings : ajout de la colonne "
                    "provider_id",
                )
                connection.execute(
                    text(
                        "ALTER TABLE voice_settings ADD COLUMN provider_id "
                        "VARCHAR(128)"
                    )
                )
            if "provider_slug" not in voice_settings_columns:
                logger.info(
                    "Migration du schéma voice_settings : ajout de la colonne "
                    "provider_slug",
                )
                connection.execute(
                    text(
                        "ALTER TABLE voice_settings ADD COLUMN provider_slug "
                        "VARCHAR(64)"
                    )
                )

        if "app_settings" not in table_names:
            logger.info("Création de la table app_settings manquante")
            AppSettings.__table__.create(bind=connection)
            table_names.add("app_settings")

        # Migration pour les comptes SIP multiples
        if "sip_accounts" not in table_names:
            logger.info("Création de la table sip_accounts pour les comptes SIP multiples")
            SipAccount.__table__.create(bind=connection)
            table_names.add("sip_accounts")

        if "mcp_servers" not in table_names:
            logger.info("Création de la table mcp_servers manquante")
            McpServer.__table__.create(bind=connection)
            table_names.add("mcp_servers")
        else:
            mcp_columns = {
                column["name"]
                for column in inspect(connection).get_columns("mcp_servers")
            }
            dialect_name = connection.dialect.name
            json_type = "JSONB" if dialect_name == "postgresql" else "JSON"
            timestamp_type = (
                "TIMESTAMP WITH TIME ZONE"
                if dialect_name == "postgresql"
                else "TIMESTAMP"
            )

            def _add_mcp_column(name: str, definition: str) -> None:
                if name in mcp_columns:
                    return
                logger.info(
                    "Migration du schéma mcp_servers : ajout de la colonne %s",
                    name,
                )
                connection.execute(
                    text(f"ALTER TABLE mcp_servers ADD COLUMN {name} {definition}")
                )
                mcp_columns.add(name)

            _add_mcp_column("transport", "VARCHAR(32)")
            _add_mcp_column("is_active", "BOOLEAN NOT NULL DEFAULT TRUE")
            _add_mcp_column("authorization_encrypted", "TEXT")
            _add_mcp_column("authorization_hint", "VARCHAR(128)")
            _add_mcp_column("access_token_encrypted", "TEXT")
            _add_mcp_column("access_token_hint", "VARCHAR(128)")
            _add_mcp_column("refresh_token_encrypted", "TEXT")
            _add_mcp_column("refresh_token_hint", "VARCHAR(128)")
            _add_mcp_column("oauth_client_id", "VARCHAR(255)")
            _add_mcp_column("oauth_client_secret_encrypted", "TEXT")
            _add_mcp_column("oauth_client_secret_hint", "VARCHAR(128)")
            _add_mcp_column("oauth_scope", "TEXT")
            _add_mcp_column("oauth_authorization_endpoint", "TEXT")
            _add_mcp_column("oauth_token_endpoint", "TEXT")
            _add_mcp_column("oauth_redirect_uri", "TEXT")
            _add_mcp_column("oauth_metadata", json_type)
            _add_mcp_column("tools_cache", json_type)
            _add_mcp_column(
                "tools_cache_updated_at", f"{timestamp_type}"
            )
            _add_mcp_column(
                "created_at",
                f"{timestamp_type} NOT NULL DEFAULT CURRENT_TIMESTAMP",
            )
            _add_mcp_column(
                "updated_at",
                f"{timestamp_type} NOT NULL DEFAULT CURRENT_TIMESTAMP",
            )

        # Ajouter la colonne sip_account_id dans workflow_definitions
        if "workflow_definitions" in table_names:
            workflow_definitions_columns = {
                column["name"]
                for column in inspect(connection).get_columns("workflow_definitions")
            }
            if "sip_account_id" not in workflow_definitions_columns:
                logger.info(
                    "Migration du schéma workflow_definitions : ajout de la colonne "
                    "sip_account_id"
                )
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN sip_account_id "
                        "INTEGER REFERENCES sip_accounts(id) ON DELETE SET NULL"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS idx_workflow_definitions_sip_account "
                        "ON workflow_definitions(sip_account_id)"
                    )
                )

        # Migration automatique des paramètres SIP globaux vers un compte SIP
        if "sip_accounts" in table_names and "app_settings" in table_names:
            # Vérifier s'il n'y a pas déjà de comptes SIP
            existing_accounts_count = connection.execute(
                text("SELECT COUNT(*) FROM sip_accounts")
            ).scalar()

            if existing_accounts_count == 0:
                # Récupérer les paramètres globaux
                app_settings_row = connection.execute(
                    text(
                        "SELECT sip_trunk_uri, sip_trunk_username, sip_trunk_password, "
                        "sip_contact_host, sip_contact_port, sip_contact_transport "
                        "FROM app_settings LIMIT 1"
                    )
                ).first()

                if app_settings_row and app_settings_row[0]:  # sip_trunk_uri existe
                    trunk_uri_raw = app_settings_row[0]
                    username = app_settings_row[1]
                    password = app_settings_row[2]
                    contact_host = app_settings_row[3]
                    contact_port = app_settings_row[4]
                    contact_transport = app_settings_row[5] or "udp"

                    # Construire un URI SIP valide
                    trunk_uri = trunk_uri_raw.strip()
                    if not trunk_uri.lower().startswith(("sip:", "sips:")):
                        # Format legacy: probablement juste l'host
                        if username:
                            trunk_uri = f"sip:{username}@{trunk_uri}"
                        else:
                            trunk_uri = f"sip:chatkit@{trunk_uri}"

                    logger.info(
                        "Migration automatique des paramètres SIP globaux vers un compte SIP"
                    )

                    # Créer le compte SIP
                    connection.execute(
                        text(
                            "INSERT INTO sip_accounts "
                            "(label, trunk_uri, username, password, contact_host, contact_port, "
                            "contact_transport, is_default, is_active, created_at, updated_at) "
                            "VALUES (:label, :trunk_uri, :username, :password, :contact_host, "
                            ":contact_port, :contact_transport, :is_default, :is_active, "
                            ":created_at, :updated_at)"
                        ),
                        {
                            "label": "Compte migré (legacy)",
                            "trunk_uri": trunk_uri,
                            "username": username,
                            "password": password,
                            "contact_host": contact_host,
                            "contact_port": contact_port,
                            "contact_transport": contact_transport,
                            "is_default": True,
                            "is_active": True,
                            "created_at": datetime.datetime.now(datetime.UTC),
                            "updated_at": datetime.datetime.now(datetime.UTC),
                        },
                    )

                    # Nettoyer les paramètres globaux
                    connection.execute(
                        text(
                            "UPDATE app_settings SET "
                            "sip_trunk_uri = NULL, "
                            "sip_trunk_username = NULL, "
                            "sip_trunk_password = NULL, "
                            "sip_contact_host = NULL, "
                            "sip_contact_port = NULL, "
                            "sip_contact_transport = NULL"
                        )
                    )

                    logger.info(
                        "Migration SIP terminée : ancien système désactivé, "
                        "nouveau compte SIP créé"
                    )

        if "app_settings" in table_names:
            app_settings_columns = {
                column["name"]
                for column in inspect(connection).get_columns("app_settings")
            }
            if "thread_title_model" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "thread_title_model",
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN thread_title_model "
                        "VARCHAR(128)"
                    )
                )
                default_model_param = bindparam(
                    "default_model", type_=String(128), literal_execute=True
                )
                connection.execute(
                    text(
                        "UPDATE app_settings SET thread_title_model = :default_model"
                    ).bindparams(default_model_param),
                    {"default_model": DEFAULT_THREAD_TITLE_MODEL},
                )
                dialect = connection.dialect.name
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE app_settings ALTER COLUMN thread_title_model "
                            "SET DEFAULT :default_model"
                        ).bindparams(default_model_param),
                        {"default_model": DEFAULT_THREAD_TITLE_MODEL},
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE app_settings ALTER COLUMN thread_title_model "
                            "SET NOT NULL"
                        )
                    )
            if "sip_trunk_uri" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_trunk_uri"
                )
                connection.execute(
                    text("ALTER TABLE app_settings ADD COLUMN sip_trunk_uri TEXT")
                )
            if "sip_trunk_username" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_trunk_username"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_trunk_username "
                        "VARCHAR(128)"
                    )
                )
            if "sip_trunk_password" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_trunk_password"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_trunk_password "
                        "VARCHAR(256)"
                    )
                )
            if "sip_contact_host" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_contact_host"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_contact_host "
                        "VARCHAR(255)"
                    )
                )
            if "sip_contact_port" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_contact_port"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_contact_port INTEGER"
                    )
                )
            if "sip_contact_transport" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_contact_transport"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_contact_transport "
                        "VARCHAR(16)"
                    )
                )
            if "model_provider" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_provider"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_provider "
                        "VARCHAR(64)"
                    )
                )
            if "model_api_base" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_api_base"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_api_base TEXT"
                    )
                )
            if "model_api_key_encrypted" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_api_key_encrypted"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_api_key_encrypted "
                        "TEXT"
                    )
                )
            if "model_api_key_hint" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_api_key_hint"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_api_key_hint "
                        "VARCHAR(128)"
                    )
                )
            if "model_provider_configs" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_provider_configs"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_provider_configs "
                        "TEXT"
                    )
                )
            if "appearance_color_scheme" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_color_scheme"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_color_scheme "
                        "VARCHAR(16)"
                    )
                )
            if "appearance_accent_color" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_accent_color"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_accent_color "
                        "VARCHAR(32)"
                    )
                )
            if "appearance_use_custom_surface" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_use_custom_surface"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_use_custom_surface "
                        "BOOLEAN"
                    )
                )
            if "appearance_surface_hue" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_surface_hue"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_surface_hue "
                        "FLOAT"
                    )
                )
            if "appearance_surface_tint" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_surface_tint"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_surface_tint "
                        "FLOAT"
                    )
                )
            if "appearance_surface_shade" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_surface_shade"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_surface_shade "
                        "FLOAT"
                    )
                )
            if "appearance_heading_font" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_heading_font"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_heading_font "
                        "VARCHAR(128)"
                    )
                )
            if "appearance_body_font" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_body_font"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_body_font "
                        "VARCHAR(128)"
                    )
                )
            if "appearance_start_greeting" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_start_greeting"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_start_greeting "
                        "TEXT"
                    )
                )
            if "appearance_start_prompt" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_start_prompt"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_start_prompt "
                        "TEXT"
                    )
                )
            if "appearance_input_placeholder" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_input_placeholder"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_input_placeholder "
                        "TEXT"
                    )
                )
            if "appearance_disclaimer" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_disclaimer"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_disclaimer "
                        "TEXT"
                    )
                )

        if "telephony_routes" not in table_names:
            logger.info("Création de la table telephony_routes manquante")
            TelephonyRoute.__table__.create(bind=connection)
            table_names.add("telephony_routes")

        # Migration de la dimension des vecteurs dans json_chunks
        if "json_chunks" in table_names:
            dialect = connection.dialect.name
            if dialect == "postgresql":
                # Vérifier la dimension actuelle de la colonne embedding
                # en interrogeant directement le type
                result = connection.execute(
                    text(
                        "SELECT format_type(atttypid, atttypmod) "
                        "FROM pg_attribute "
                        "JOIN pg_class ON pg_attribute.attrelid = pg_class.oid "
                        "WHERE pg_class.relname = 'json_chunks' "
                        "AND pg_attribute.attname = 'embedding'"
                    )
                ).scalar()

                # result est de la forme 'vector(1536)'
                # ou None si la colonne n'existe pas
                current_dimension = None
                if result is not None:
                    # Extraire la dimension du format 'vector(1536)'
                    import re
                    
                    match = re.match(r"vector\((\d+)\)", result)
                    if match:
                        current_dimension = int(match.group(1))

                if (
                    current_dimension is not None
                    and current_dimension != EMBEDDING_DIMENSION
                ):
                    logger.info(
                        "Migration de la dimension des vecteurs : %d -> %d dimensions. "
                        "Suppression des données vectorielles existantes.",
                        current_dimension,
                        EMBEDDING_DIMENSION,
                    )
                    # Supprimer l'index vectoriel s'il existe
                    connection.execute(
                        text("DROP INDEX IF EXISTS ix_json_chunks_embedding")
                    )
                    # Supprimer toutes les données de la table json_chunks
                    # car les embeddings existants ne sont plus compatibles
                    connection.execute(text("TRUNCATE TABLE json_chunks CASCADE"))
                    connection.execute(text("TRUNCATE TABLE json_documents CASCADE"))
                    # Recréer la colonne avec la nouvelle dimension
                    connection.execute(
                        text("ALTER TABLE json_chunks DROP COLUMN embedding")
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE json_chunks "
                            f"ADD COLUMN embedding vector({EMBEDDING_DIMENSION}) "
                            "NOT NULL"
                        )
                    )

        if "workflows" in table_names:
            workflow_columns = {
                column["name"]
                for column in inspect(connection).get_columns("workflows")
            }
            if "is_chatkit_default" not in workflow_columns:
                dialect = connection.dialect.name
                logger.info(
                    "Migration du schéma des workflows : ajout de la colonne "
                    "is_chatkit_default"
                )
                connection.execute(
                    text(
                        "ALTER TABLE workflows "
                        "ADD COLUMN is_chatkit_default BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )
                connection.execute(
                    text(
                        "UPDATE workflows SET is_chatkit_default = TRUE "
                        "WHERE slug = :slug"
                    ),
                    {"slug": "workflow-par-defaut"},
                )
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflows ALTER COLUMN "
                            "is_chatkit_default SET DEFAULT FALSE"
                        )
                    )

        if "workflow_steps" in table_names:
            dialect = connection.dialect.name

            def _refresh_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns("workflow_steps")
                }

            columns = _refresh_columns()

            def _get_column(name: str) -> dict[str, Any] | None:
                for column in inspect(connection).get_columns("workflow_steps"):
                    if column["name"] == name:
                        return column
                return None

            if "slug" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN slug VARCHAR(128)"
                    )
                )
                if dialect == "postgresql":
                    connection.execute(
                        text("UPDATE workflow_steps SET slug = CONCAT('step_', id)")
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_steps ALTER COLUMN slug "
                            "SET NOT NULL"
                        )
                    )
                else:
                    connection.execute(
                        text("UPDATE workflow_steps SET slug = 'step_' || id")
                    )
                columns = _refresh_columns()

            if "kind" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'agent'"
                    )
                )
                columns = _refresh_columns()

            if "display_name" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN display_name VARCHAR(128)"
                    )
                )
                columns = _refresh_columns()

            agent_key_column = _get_column("agent_key")
            if agent_key_column is None:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN agent_key VARCHAR(128)"
                    )
                )
                agent_key_column = _get_column("agent_key")
            if agent_key_column is not None and not agent_key_column.get(
                "nullable", True
            ):
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_steps ALTER COLUMN agent_key "
                            "DROP NOT NULL"
                        )
                    )
                    agent_key_column = _get_column("agent_key")
                else:
                    logger.warning(
                        "Impossible de rendre la colonne agent_key nullable pour le "
                        "dialecte %s",
                        dialect,
                    )
            columns = _refresh_columns()

            if "position" not in columns:
                if "order" in columns:
                    connection.execute(
                        text("ALTER TABLE workflow_steps ADD COLUMN position INTEGER")
                    )
                    connection.execute(
                        text('UPDATE workflow_steps SET position = "order"')
                    )
                    if dialect == "postgresql":
                        connection.execute(
                            text(
                                "ALTER TABLE workflow_steps ALTER COLUMN position "
                                "SET NOT NULL"
                            )
                        )
                else:
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_steps ADD COLUMN position INTEGER "
                            "NOT NULL DEFAULT 0"
                        )
                    )
                columns = _refresh_columns()

            if "is_enabled" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps ADD COLUMN is_enabled BOOLEAN "
                        "NOT NULL DEFAULT TRUE"
                    )
                )
                columns = _refresh_columns()

            json_type = "JSONB" if dialect == "postgresql" else "TEXT"
            json_default = "'{}'::jsonb" if dialect == "postgresql" else "'{}'"

            if "parameters" not in columns:
                connection.execute(
                    text(
                        f"ALTER TABLE workflow_steps ADD COLUMN parameters {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )
                columns = _refresh_columns()

            metadata_column = "metadata"
            if metadata_column not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        f"ADD COLUMN {metadata_column} {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )
                columns = _refresh_columns()

            inspector = inspect(connection)
            uniques = {
                constraint["name"]
                for constraint in inspector.get_unique_constraints("workflow_steps")
            }
            if "workflow_steps_definition_slug" not in uniques:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD CONSTRAINT workflow_steps_definition_slug "
                        "UNIQUE(definition_id, slug)"
                    )
                )

        if "workflow_transitions" in table_names:
            dialect = connection.dialect.name
            json_type = "JSONB" if dialect == "postgresql" else "TEXT"
            json_default = "'{}'::jsonb" if dialect == "postgresql" else "'{}'"

            def _refresh_transition_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns(
                        "workflow_transitions"
                    )
                }

            columns = _refresh_transition_columns()

            if "condition" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_transitions "
                        "ADD COLUMN condition VARCHAR(64)"
                    )
                )
                columns = _refresh_transition_columns()

            metadata_column = "metadata"
            if metadata_column not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_transitions "
                        f"ADD COLUMN {metadata_column} {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )

        if "workflow_definitions" in table_names:
            dialect = connection.dialect.name

            def _refresh_definition_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns(
                        "workflow_definitions"
                    )
                }

            definition_columns = _refresh_definition_columns()

            if "workflow_id" not in definition_columns:
                logger.info(
                    "Migration du schéma des workflows : ajout de la colonne "
                    "workflow_id et rétro-portage des données"
                )

                if "workflows" not in table_names:
                    logger.info("Création de la table workflows manquante")
                    Workflow.__table__.create(bind=connection)
                    table_names.add("workflows")

                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        "ADD COLUMN workflow_id INTEGER"
                    )
                )
                definition_columns = _refresh_definition_columns()

                timestamp = datetime.datetime.now(datetime.UTC)
                default_slug = "workflow-par-defaut"
                default_display_name = "Workflow par défaut"

                workflow_row = connection.execute(
                    text("SELECT id FROM workflows WHERE slug = :slug"),
                    {"slug": default_slug},
                ).first()

                if workflow_row is None:
                    connection.execute(
                        Workflow.__table__.insert(),
                        {
                            "slug": default_slug,
                            "display_name": default_display_name,
                            "description": None,
                            "active_version_id": None,
                            "created_at": timestamp,
                            "updated_at": timestamp,
                        },
                    )
                    workflow_row = connection.execute(
                        text("SELECT id FROM workflows WHERE slug = :slug"),
                        {"slug": default_slug},
                    ).first()

                if workflow_row is None:
                    raise RuntimeError(
                        "Impossible de créer le workflow par défaut pour la migration"
                    )

                workflow_id = workflow_row.id

                connection.execute(
                    text("UPDATE workflow_definitions SET workflow_id = :workflow_id"),
                    {"workflow_id": workflow_id},
                )

                active_definition = connection.execute(
                    text(
                        "SELECT id FROM workflow_definitions "
                        "WHERE is_active IS TRUE "
                        "ORDER BY updated_at DESC LIMIT 1"
                    )
                ).first()

                if active_definition is None:
                    active_definition = connection.execute(
                        text(
                            "SELECT id FROM workflow_definitions "
                            "ORDER BY updated_at DESC LIMIT 1"
                        )
                    ).first()

                if active_definition is not None:
                    connection.execute(
                        text(
                            "UPDATE workflows SET active_version_id = :definition_id "
                            "WHERE id = :workflow_id"
                        ),
                        {
                            "definition_id": active_definition.id,
                            "workflow_id": workflow_id,
                        },
                    )

                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions ALTER COLUMN "
                            "workflow_id SET NOT NULL"
                        )
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions "
                            "ADD CONSTRAINT workflow_definitions_workflow_id_fkey "
                            "FOREIGN KEY (workflow_id) REFERENCES workflows (id) "
                            "ON DELETE CASCADE"
                        )
                    )
                    connection.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS "
                            "ix_workflow_definitions_workflow_id "
                            "ON workflow_definitions (workflow_id)"
                        )
                    )
                else:
                    logger.warning(
                        "La contrainte NOT NULL/FOREIGN KEY sur "
                        "workflow_definitions.workflow_id n'a pas pu être ajoutée "
                        "pour le dialecte %s",
                        dialect,
                    )

            definition_columns = _refresh_definition_columns()

            if "name" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN name VARCHAR(128)"
                    )
                )
                definition_columns = _refresh_definition_columns()

            if "version" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        "ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
                    )
                )
                definition_columns = _refresh_definition_columns()

            if "is_active" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        "ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
                definition_columns = _refresh_definition_columns()

            datetime_type = "TIMESTAMPTZ" if dialect == "postgresql" else "DATETIME"
            current_ts = "CURRENT_TIMESTAMP"

            if "created_at" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        f"ADD COLUMN created_at {datetime_type} NOT NULL DEFAULT "
                        f"{current_ts}"
                    )
                )
                definition_columns = _refresh_definition_columns()

            if "updated_at" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        f"ADD COLUMN updated_at {datetime_type} NOT NULL DEFAULT "
                        f"{current_ts}"
                    )
                )

            inspector = inspect(connection)
            unique_constraints = {
                constraint["name"]
                for constraint in inspector.get_unique_constraints(
                    "workflow_definitions"
                )
            }
            indexes = {
                index["name"]
                for index in inspector.get_indexes("workflow_definitions")
                if index.get("name")
            }

            if "workflow_definitions_name_key" in unique_constraints:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions DROP CONSTRAINT "
                        "workflow_definitions_name_key"
                    )
                )
                unique_constraints.discard("workflow_definitions_name_key")
            elif "workflow_definitions_name_key" in indexes:
                connection.execute(
                    text("DROP INDEX IF EXISTS workflow_definitions_name_key")
                )
                indexes.discard("workflow_definitions_name_key")

            if dialect == "postgresql":
                if "workflow_definitions_workflow_version" not in unique_constraints:
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions "
                            "ADD CONSTRAINT workflow_definitions_workflow_version "
                            "UNIQUE (workflow_id, version)"
                        )
                    )
                if "workflow_definitions_workflow_name" not in unique_constraints:
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions "
                            "ADD CONSTRAINT workflow_definitions_workflow_name "
                            "UNIQUE (workflow_id, name)"
                        )
                    )
            else:
                if "workflow_definitions_workflow_version" not in indexes:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS "
                            "workflow_definitions_workflow_version "
                            "ON workflow_definitions (workflow_id, version)"
                        )
                    )
                if "workflow_definitions_workflow_name" not in indexes:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS "
                            "workflow_definitions_workflow_name "
                            "ON workflow_definitions (workflow_id, name)"
                        )
                    )

        # Migration de workflow_viewports pour la séparation mobile/desktop
        if "workflow_viewports" in table_names:
            dialect = connection.dialect.name

            def _refresh_viewport_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns("workflow_viewports")
                }

            viewport_columns = _refresh_viewport_columns()

            if "device_type" not in viewport_columns:
                logger.info(
                    "Migration du schéma des workflow_viewports : ajout de la colonne "
                    "device_type pour la séparation mobile/desktop"
                )
                # Ajouter la colonne device_type avec valeur par défaut 'desktop'
                connection.execute(
                    text(
                        "ALTER TABLE workflow_viewports "
                        "ADD COLUMN device_type VARCHAR(16) NOT NULL DEFAULT 'desktop'"
                    )
                )
                viewport_columns = _refresh_viewport_columns()

                # Supprimer l'ancienne contrainte unique
                inspector = inspect(connection)
                unique_constraints = {
                    constraint["name"]
                    for constraint in inspector.get_unique_constraints(
                        "workflow_viewports"
                    )
                }

                # Nom de l'ancienne contrainte (sans device_type)
                old_constraint_name = None
                for constraint in inspector.get_unique_constraints(
                    "workflow_viewports"
                ):
                    # Chercher une contrainte qui inclut user_id,
                    # workflow_id et version_id
                    # Chercher une contrainte qui inclut
                    # user_id, workflow_id, version_id
                    if {"user_id", "workflow_id", "version_id"}.issubset(
                        set(constraint.get("column_names", []))
                    ):
                        old_constraint_name = constraint["name"]
                        break

                if old_constraint_name:
                    logger.info(
                        "Suppression de l'ancienne contrainte unique : %s",
                        old_constraint_name,
                    )
                    if dialect == "postgresql":
                        connection.execute(
                            text(
                                f"ALTER TABLE workflow_viewports "
                                f"DROP CONSTRAINT {old_constraint_name}"
                            )
                        )
                    else:
                        connection.execute(
                            text(f"DROP INDEX IF EXISTS {old_constraint_name}")
                        )

                # Créer la nouvelle contrainte unique incluant device_type
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_viewports "
                            "ADD CONSTRAINT "
                            "workflow_viewports_user_workflow_version_device "
                            "UNIQUE (user_id, workflow_id, version_id, device_type)"
                        )
                    )
                else:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS "
                            "workflow_viewports_user_workflow_version_device "
                            "ON workflow_viewports "
                            "(user_id, workflow_id, version_id, device_type)"
                        )
                    )

                logger.info(
                    "Migration de workflow_viewports terminée : "
                    "device_type ajouté avec nouvelle contrainte unique"
                )

        # Migration de la contrainte FK pour language_generation_tasks.language_id
        if "language_generation_tasks" in table_names and "languages" in table_names:
            # Vérifier si la contrainte a besoin d'être mise à jour
            fk_constraints = inspector.get_foreign_keys("language_generation_tasks")
            needs_migration = True

            for fk in fk_constraints:
                if fk.get("name") == "language_generation_tasks_language_id_fkey":
                    # La contrainte existe - vérifier si elle a ON DELETE SET NULL
                    # Note: SQLAlchemy inspector ne retourne pas toujours les options ON DELETE
                    # On va vérifier directement dans PostgreSQL
                    if dialect == "postgresql":
                        result = connection.execute(
                            text("""
                                SELECT confdeltype
                                FROM pg_constraint
                                WHERE conname = 'language_generation_tasks_language_id_fkey'
                            """)
                        )
                        row = result.fetchone()
                        if row and row[0] == 'n':  # 'n' = SET NULL
                            needs_migration = False
                            logger.info("Migration language_generation_tasks FK : déjà appliquée")

            if needs_migration:
                logger.info(
                    "Migration language_generation_tasks : mise à jour FK "
                    "pour permettre suppression de langues"
                )
                connection.execute(
                    text("""
                        ALTER TABLE language_generation_tasks
                        DROP CONSTRAINT IF EXISTS language_generation_tasks_language_id_fkey;

                        ALTER TABLE language_generation_tasks
                        ADD CONSTRAINT language_generation_tasks_language_id_fkey
                        FOREIGN KEY (language_id)
                        REFERENCES languages(id)
                        ON DELETE SET NULL;
                    """)
                )
                logger.info(
                    "Migration language_generation_tasks FK terminée : "
                    "ON DELETE SET NULL appliqué"
                )

    # Nettoyer les serveurs MCP en doublon dans les workflows
    _cleanup_duplicate_mcp_servers()


def _cleanup_duplicate_mcp_servers() -> None:
    """Remove duplicate MCP servers from workflow tools (legacy duplicates)."""
    import json

    logger.info("Nettoyage des serveurs MCP en doublon dans les workflows...")

    with SessionLocal() as session:
        # Trouver tous les steps de type voice-agent avec des outils
        result = session.execute(
            text("""
                SELECT ws.id, ws.slug, ws.parameters
                FROM workflow_steps ws
                JOIN workflow_definitions wd ON ws.definition_id = wd.id
                WHERE wd.is_active = true
                  AND ws.kind IN ('voice-agent', 'agent')
                  AND ws.parameters IS NOT NULL
                  AND ws.parameters::text LIKE '%"type"%:%"mcp"%'
            """)
        )

        updated_count = 0
        removed_count = 0

        for row in result:
            step_id, slug, parameters_json = row

            if not parameters_json:
                continue

            parameters = dict(parameters_json) if isinstance(parameters_json, dict) else parameters_json
            tools = parameters.get('tools', [])

            if not tools:
                continue

            # Identifier les serveurs MCP et dédupliquer par URL
            seen_urls: dict[str, dict] = {}
            new_tools = []

            for tool in tools:
                if isinstance(tool, dict) and tool.get('type') == 'mcp':
                    url = (tool.get('server_url') or tool.get('url') or '').strip()
                    if not url:
                        new_tools.append(tool)
                        continue

                    if url in seen_urls:
                        # Doublon détecté - garder le plus complet (avec allowlist)
                        existing = seen_urls[url]
                        has_allowlist = 'allow' in tool or 'allowlist' in tool
                        existing_has_allowlist = 'allow' in existing or 'allowlist' in existing

                        if has_allowlist and not existing_has_allowlist:
                            # Remplacer l'ancien par le nouveau (plus complet)
                            idx = new_tools.index(existing)
                            new_tools[idx] = tool
                            seen_urls[url] = tool
                            logger.debug(
                                "Step '%s': Remplacement serveur MCP %s (ajout allowlist)",
                                slug, url
                            )
                        else:
                            # Garder l'existant, ignorer le nouveau
                            logger.debug(
                                "Step '%s': Ignoré serveur MCP en doublon: %s",
                                slug, url
                            )
                        removed_count += 1
                    else:
                        seen_urls[url] = tool
                        new_tools.append(tool)
                else:
                    new_tools.append(tool)

            # Mettre à jour si des doublons ont été supprimés
            if len(new_tools) < len(tools):
                new_parameters = dict(parameters)
                new_parameters['tools'] = new_tools

                session.execute(
                    text("UPDATE workflow_steps SET parameters = :params WHERE id = :id"),
                    {"params": json.dumps(new_parameters), "id": step_id}
                )
                updated_count += 1
                logger.info(
                    "Step '%s' nettoyé: %d outils → %d outils (%d doublons retirés)",
                    slug, len(tools), len(new_tools), len(tools) - len(new_tools)
                )

        if updated_count > 0:
            session.commit()
            logger.info(
                "Nettoyage terminé: %d workflow step(s) mis à jour, %d serveur(s) MCP en doublon retirés",
                updated_count, removed_count
            )
        else:
            logger.info("Aucun serveur MCP en doublon trouvé")


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

    # Callback global dispatch pour media_active (appelé UNE SEULE FOIS pour tous les appels)
    async def _global_media_active_dispatch(active_call: Any, media_info: Any) -> None:
        """Dispatche les événements media_active vers le callback du bon appel."""
        call_key = id(active_call)
        callback = _media_active_callbacks.get(call_key)
        if callback:
            try:
                await callback(active_call, media_info)
            except Exception as e:
                logger.exception("Erreur dans callback media_active (call_key=%s): %s", call_key, e)

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

        from .telephony.pjsua_audio_bridge import create_pjsua_audio_bridge

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
                    logger.info("✅ Workflow résolu: model=%s, tools=%d, ring=%ds", voice_model, len(voice_tools), ring_timeout_seconds)
                except Exception as exc:
                    logger.warning("Erreur workflow (call_id=%s): %s - utilisation valeurs par défaut", call_id, exc)
                    # Valeurs par défaut si pas de workflow
                    voice_model = "gpt-4o-realtime-preview"
                    voice_instructions = "Vous êtes un assistant vocal. Répondez brièvement."
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
            from .realtime_runner import (
                _normalize_realtime_tools_payload,
                _connect_mcp_servers,
                _cleanup_mcp_servers,
            )
            from agents.realtime.runner import RealtimeRunner
            from agents.realtime.agent import RealtimeAgent

            # Définir la tâche async qui contient TOUTES les opérations bloquantes
            async def run_voice_bridge():
                """Voice bridge avec sonnerie et init agent dans la tâche async."""
                mcp_servers = []
                try:
                    # 1. ENVOYER 180 RINGING (dans la tâche async, ne bloque pas le callback)
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
                        logger.info("Connexion %d serveurs MCP pendant sonnerie...", len(mcp_server_configs))
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

                    async def resume_workflow_hook(transcripts: list[dict[str, str]]) -> None:
                        logger.info("Session terminée")

                    hooks = VoiceBridgeHooks(
                        close_dialog=close_dialog_hook,
                        clear_voice_state=clear_voice_state_hook,
                        resume_workflow=resume_workflow_hook,
                    )

                    voice_bridge = TelephonyVoiceBridge(hooks=hooks, input_codec="pcm")

                    # 4. LANCER LA SESSION SDK EN PARALLÈLE (va se connecter pendant la sonnerie)
                    logger.info("🔌 Démarrage connexion session SDK pendant la sonnerie...")
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
                        logger.info("⏰ Sonnerie de %ds (session SDK se connecte en parallèle)...", ring_timeout_seconds)
                        await asyncio.sleep(ring_timeout_seconds)

                    # 6. RÉPONDRE 200 OK
                    logger.info("📞 Réponse 200 OK (call_id=%s)", chatkit_call_id)
                    await pjsua_adapter.answer_call(call, code=200)

                    # 7. ACTIVER LE MÉDIA - va déclencher pjsua_ready_event → response.create
                    media_active.set()
                    await asyncio.sleep(1)

                    # 8. ATTENDRE que le voice bridge se termine
                    logger.info("⏳ Attente du voice bridge...")
                    stats = await voice_bridge_task

                    logger.info("✅ Terminé: %s", stats)

                except Exception as e:
                    logger.exception("❌ Erreur dans VoiceBridge (call_id=%s): %s", chatkit_call_id, e)
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


def register_startup_events(app: FastAPI) -> None:
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
        app.state.sip_registration = None  # Pas de MultiSIPRegistrationManager avec PJSUA
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
            _build_invite_handler(sip_registration_manager)
        )
        app.state.sip_registration = sip_registration_manager
        app.state.pjsua_adapter = None

    @app.on_event("startup")
    def _on_startup() -> None:
        wait_for_database()
        ensure_database_extensions()
        _run_ad_hoc_migrations()
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
                        logger.warning("Aucun compte SIP actif trouvé - PJSUA en mode sans compte")

                # Initialiser le gestionnaire d'appels sortants avec PJSUA
                from .telephony.outbound_call_manager import get_outbound_call_manager
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
                        "Aucun compte SIP trouvé en BD, tentative de chargement depuis AppSettings"
                    )
                    # Fallback : créer un gestionnaire unique avec les anciens paramètres
                    stored_settings = session.scalar(select(AppSettings).limit(1))
                    if stored_settings and stored_settings.sip_trunk_uri:
                        from .telephony.registration import SIPRegistrationConfig

                        # Créer un compte SIP temporaire depuis AppSettings
                        fallback_config = SIPRegistrationConfig(
                            uri=stored_settings.sip_trunk_uri,
                            username=stored_settings.sip_trunk_username or "",
                            password=stored_settings.sip_trunk_password or "",
                            contact_host=stored_settings.sip_contact_host or sip_contact_host or "127.0.0.1",
                            contact_port=stored_settings.sip_contact_port or sip_contact_port or 5060,
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
                            invite_handler=_build_invite_handler(manager),
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
