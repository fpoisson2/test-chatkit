from __future__ import annotations

import datetime
import json
import logging
from typing import Any

from sqlalchemy import String, inspect, text
from sqlalchemy.sql import bindparam

from ..config import DEFAULT_THREAD_TITLE_MODEL
from ..models import (
    EMBEDDING_DIMENSION,
    AppSettings,
    AvailableModel,
    ChatThreadBranch,
    McpServer,
    SipAccount,
    TelephonyRoute,
    VoiceSettings,
    Workflow,
    WorkflowAppearance,
)
from . import SessionLocal, engine

logger = logging.getLogger("chatkit.server")

__all__ = ["run_ad_hoc_migrations"]


def run_ad_hoc_migrations() -> None:
    """Apply the ad hoc schema adjustments required at startup."""

    _run_ad_hoc_migrations()
    _cleanup_duplicate_mcp_servers()


def _run_ad_hoc_migrations() -> None:
    """Applique les évolutions mineures du schéma sans Alembic."""

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

        if "workflow_appearances" in table_names:
            workflow_appearance_columns = {
                column["name"]
                for column in inspect(connection).get_columns("workflow_appearances")
            }
            if "appearance_radius_style" not in workflow_appearance_columns:
                logger.info(
                    "Migration du schéma workflow_appearances : ajout de la colonne "
                    "appearance_radius_style",
                )
                connection.execute(
                    text(
                        "ALTER TABLE workflow_appearances ADD COLUMN "
                        "appearance_radius_style VARCHAR(16)"
                    )
                )

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
            logger.info(
                "Création de la table sip_accounts pour les comptes SIP multiples"
            )
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
                        "CREATE INDEX IF NOT EXISTS "
                        "idx_workflow_definitions_sip_account "
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
                        "Migration automatique des paramètres SIP globaux vers un "
                        "compte SIP"
                    )

                    # Créer le compte SIP
                    connection.execute(
                        text(
                            "INSERT INTO sip_accounts "
                            "(label, trunk_uri, username, password, contact_host, "
                            "contact_port, contact_transport, is_default, is_active, "
                            "created_at, updated_at) "
                            "VALUES (:label, :trunk_uri, :username, :password, "
                            ":contact_host, :contact_port, :contact_transport, "
                            ":is_default, :is_active, :created_at, :updated_at)"
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
                        "VARCHAR(64)"
                    )
                )
            if "model_client_secret_encrypted" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_client_secret_encrypted"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN "
                        "model_client_secret_encrypted TEXT"
                    )
                )
            if "model_client_secret_hint" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_client_secret_hint"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_client_secret_hint "
                        "VARCHAR(64)"
                    )
                )
            if "model_custom_headers" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_custom_headers"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_custom_headers TEXT"
                    )
                )
            if "model_custom_query_params" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_custom_query_params"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_custom_query_params "
                        "TEXT"
                    )
                )
            if "language" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "language"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN language VARCHAR(8)"
                    )
                )
            if "timezone" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "timezone"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN timezone VARCHAR(64)"
                    )
                )
            if "voice_provider" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_provider"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_provider VARCHAR(64)"
                    )
                )
            if "voice_api_base" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_api_base"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_api_base TEXT"
                    )
                )
            if "voice_api_key_encrypted" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_api_key_encrypted"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_api_key_encrypted "
                        "TEXT"
                    )
                )
            if "voice_api_key_hint" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_api_key_hint"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_api_key_hint "
                        "VARCHAR(64)"
                    )
                )
            if "voice_region" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_region"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_region VARCHAR(64)"
                    )
                )
            if "voice_model" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_model"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_model VARCHAR(64)"
                    )
                )
            if "voice_voice" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_voice"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_voice VARCHAR(64)"
                    )
                )
            if "voice_instructions" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "voice_instructions"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN voice_instructions TEXT"
                    )
                )
            if "sip_flow_enabled" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_flow_enabled"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_flow_enabled BOOLEAN"
                    )
                )
            if "sip_ring_timeout_seconds" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_ring_timeout_seconds"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_ring_timeout_seconds "
                        "INTEGER"
                    )
                )
            if "sip_silence_timeout_seconds" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_silence_timeout_seconds"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN "
                        "sip_silence_timeout_seconds INTEGER"
                    )
                )
            if "sip_disclaimer" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_disclaimer"
                )
                connection.execute(
                    text("ALTER TABLE app_settings ADD COLUMN sip_disclaimer TEXT")
                )
            if "sip_conference_instructions" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_conference_instructions"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN "
                        "sip_conference_instructions TEXT"
                    )
                )
            if "sip_default_workflow_slug" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_default_workflow_slug"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_default_workflow_slug "
                        "VARCHAR(128)"
                    )
                )
            if "appearance_background" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_background"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_background "
                        "TEXT"
                    )
                )
            if "appearance_avatar_url" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_avatar_url"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_avatar_url "
                        "TEXT"
                    )
                )
            if "appearance_logo_url" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_logo_url"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_logo_url TEXT"
                    )
                )
            if "appearance_support_url" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_support_url"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_support_url "
                        "TEXT"
                    )
                )
            if "appearance_support_email" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_support_email"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_support_email "
                        "TEXT"
                    )
                )
            if "appearance_radius_style" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_radius_style",
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_radius_style "
                        "VARCHAR(16)"
                    )
                )
            if "appearance_links" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_links"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_links TEXT"
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

        # Migration pour les branches de conversation
        if "chat_thread_branches" not in table_names:
            logger.info(
                "Création de la table chat_thread_branches pour le branching de "
                "conversations"
            )
            ChatThreadBranch.__table__.create(bind=connection)
            table_names.add("chat_thread_branches")

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

            if "lti_enabled" not in workflow_columns:
                logger.info(
                    "Migration du schéma des workflows : ajout de la colonne "
                    "lti_enabled"
                )
                connection.execute(
                    text(
                        "ALTER TABLE workflows "
                        "ADD COLUMN lti_enabled BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )

        # Migration pour la table d'association workflow_lti_registrations
        if "workflow_lti_registrations" not in table_names:
            logger.info(
                "Création de la table workflow_lti_registrations pour "
                "l'autorisation LTI par issuer"
            )
            connection.execute(
                text(
                    "CREATE TABLE workflow_lti_registrations ("
                    "workflow_id INTEGER NOT NULL, "
                    "lti_registration_id INTEGER NOT NULL, "
                    "PRIMARY KEY (workflow_id, lti_registration_id), "
                    "FOREIGN KEY (workflow_id) REFERENCES workflows (id) "
                    "ON DELETE CASCADE, "
                    "FOREIGN KEY (lti_registration_id) REFERENCES lti_registrations (id) "
                    "ON DELETE CASCADE"
                    ")"
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
                    text("ALTER TABLE workflow_steps ADD COLUMN slug VARCHAR(128)")
                )
                columns = _refresh_columns()

            if "display_name" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps ADD COLUMN display_name "
                        "VARCHAR(128)"
                    )
                )
                columns = _refresh_columns()

            if "description" not in columns:
                connection.execute(
                    text("ALTER TABLE workflow_steps ADD COLUMN description TEXT")
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

            indexes = {
                index["name"]
                for index in inspect(connection).get_indexes("workflow_definitions")
            }
            if "workflow_definitions_slug_version" not in indexes:
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "workflow_definitions_slug_version "
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
                    # Note: SQLAlchemy inspector ne retourne pas toujours les
                    # options ON DELETE. On va vérifier directement dans PostgreSQL
                    if dialect == "postgresql":
                        result = connection.execute(
                            text(
                                "SELECT confdeltype "
                                "FROM pg_constraint "
                                "WHERE conname = "
                                "'language_generation_tasks_language_id_fkey'"
                            )
                        )
                        row = result.fetchone()
                        if row and row[0] == "n":  # 'n' = SET NULL
                            needs_migration = False
                            logger.info(
                                "Migration language_generation_tasks FK : déjà "
                                "appliquée"
                            )

            if needs_migration:
                logger.info(
                    "Migration language_generation_tasks : mise à jour FK "
                    "pour permettre suppression de langues"
                )
                connection.execute(
                    text(
                        """
                        ALTER TABLE language_generation_tasks
                        DROP CONSTRAINT IF EXISTS
                            language_generation_tasks_language_id_fkey;

                        ALTER TABLE language_generation_tasks
                        ADD CONSTRAINT language_generation_tasks_language_id_fkey
                        FOREIGN KEY (language_id)
                        REFERENCES languages(id)
                        ON DELETE SET NULL;
                        """
                    )
                )
                logger.info(
                    "Migration language_generation_tasks FK terminée : "
                    "ON DELETE SET NULL appliqué"
                )

    # Nettoyer les serveurs MCP en doublon dans les workflows
    _cleanup_duplicate_mcp_servers()


def _cleanup_duplicate_mcp_servers() -> None:
    """Remove duplicate MCP servers from workflow tools (legacy duplicates)."""

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
            """
            )
        )

        updated_count = 0
        removed_count = 0

        for row in result:
            step_id, slug, parameters_json = row

            if not parameters_json:
                continue

            parameters = (
                dict(parameters_json)
                if isinstance(parameters_json, dict)
                else parameters_json
            )
            tools = parameters.get("tools", [])

            if not tools:
                continue

            # Identifier les serveurs MCP et dédupliquer par URL
            seen_urls: dict[str, dict] = {}
            new_tools = []

            for tool in tools:
                if isinstance(tool, dict) and tool.get("type") == "mcp":
                    url = (tool.get("server_url") or tool.get("url") or "").strip()
                    if not url:
                        new_tools.append(tool)
                        continue

                    if url in seen_urls:
                        # Doublon détecté - garder le plus complet (avec allowlist)
                        existing = seen_urls[url]
                        has_allowlist = "allow" in tool or "allowlist" in tool
                        existing_has_allowlist = (
                            "allow" in existing or "allowlist" in existing
                        )

                        if has_allowlist and not existing_has_allowlist:
                            # Remplacer l'ancien par le nouveau (plus complet)
                            idx = new_tools.index(existing)
                            new_tools[idx] = tool
                            seen_urls[url] = tool
                            logger.debug(
                                "Step '%s': Remplacement serveur MCP %s "
                                "(ajout allowlist)",
                                slug,
                                url,
                            )
                        else:
                            # Garder l'existant, ignorer le nouveau
                            logger.debug(
                                "Step '%s': Ignoré serveur MCP en doublon: %s",
                                slug,
                                url,
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
                new_parameters["tools"] = new_tools

                session.execute(
                    text(
                        "UPDATE workflow_steps SET parameters = :params "
                        "WHERE id = :id"
                    ),
                    {"params": json.dumps(new_parameters), "id": step_id},
                )
                updated_count += 1
                logger.info(
                    "Step '%s' nettoyé: %d outils → %d outils (%d doublons retirés)",
                    slug,
                    len(tools),
                    len(new_tools),
                    len(tools) - len(new_tools),
                )

        if updated_count > 0:
            session.commit()
            logger.info(
                "Nettoyage terminé: %d workflow step(s) mis à jour, %d serveur(s) MCP "
                "en doublon retirés",
                updated_count,
                removed_count,
            )
        else:
            logger.info("Aucun serveur MCP en doublon trouvé")
