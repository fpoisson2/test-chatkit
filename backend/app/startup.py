from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI
from sqlalchemy import inspect, select, text

from .config import get_settings
from .database import SessionLocal, engine, wait_for_database
from .models import Base, User
from .security import hash_password

logger = logging.getLogger("chatkit.server")
settings = get_settings()


def _run_ad_hoc_migrations() -> None:
    """Apply les évolutions mineures du schéma sans Alembic."""

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
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
                if dialect == "postgresql":
                    connection.execute(
                        text("UPDATE workflow_steps SET slug = CONCAT('step_', id)")
                    )
                    connection.execute(
                        text("ALTER TABLE workflow_steps ALTER COLUMN slug SET NOT NULL")
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
                    text("ALTER TABLE workflow_steps ADD COLUMN display_name VARCHAR(128)")
                )
                columns = _refresh_columns()

            agent_key_column = _get_column("agent_key")
            if agent_key_column is None:
                connection.execute(
                    text("ALTER TABLE workflow_steps ADD COLUMN agent_key VARCHAR(128)")
                )
                agent_key_column = _get_column("agent_key")
            if agent_key_column is not None and not agent_key_column.get("nullable", True):
                if dialect == "postgresql":
                    connection.execute(
                        text("ALTER TABLE workflow_steps ALTER COLUMN agent_key DROP NOT NULL")
                    )
                    agent_key_column = _get_column("agent_key")
                else:
                    logger.warning(
                        "Impossible de rendre la colonne agent_key nullable pour le dialecte %s",
                        dialect,
                    )
            columns = _refresh_columns()

            if "position" not in columns:
                if "order" in columns:
                    connection.execute(text("ALTER TABLE workflow_steps ADD COLUMN position INTEGER"))
                    connection.execute(text("UPDATE workflow_steps SET position = \"order\""))
                    if dialect == "postgresql":
                        connection.execute(
                            text(
                                "ALTER TABLE workflow_steps ALTER COLUMN position SET NOT NULL"
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
                        f"ALTER TABLE workflow_steps ADD COLUMN {metadata_column} {json_type} "
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
                    for column in inspect(connection).get_columns("workflow_transitions")
                }

            columns = _refresh_transition_columns()

            if "condition" not in columns:
                connection.execute(
                    text("ALTER TABLE workflow_transitions ADD COLUMN condition VARCHAR(64)")
                )
                columns = _refresh_transition_columns()

            metadata_column = "metadata"
            if metadata_column not in columns:
                connection.execute(
                    text(
                        f"ALTER TABLE workflow_transitions ADD COLUMN {metadata_column} {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )


def register_startup_events(app: FastAPI) -> None:
    @app.on_event("startup")
    def _on_startup() -> None:
        wait_for_database()
        _run_ad_hoc_migrations()
        Base.metadata.create_all(bind=engine)
        if settings.admin_email and settings.admin_password:
            normalized_email = settings.admin_email.lower()
            with SessionLocal() as session:
                existing = session.scalar(select(User).where(User.email == normalized_email))
                if not existing:
                    logger.info("Creating initial admin user %s", normalized_email)
                    user = User(
                        email=normalized_email,
                        password_hash=hash_password(settings.admin_password),
                        is_admin=True,
                    )
                    session.add(user)
                    session.commit()
