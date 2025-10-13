from __future__ import annotations

import logging

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
        if "workflow_steps" not in inspector.get_table_names():
            return

        columns = {column["name"] for column in inspector.get_columns("workflow_steps")}
        if "slug" not in columns:
            connection.execute(text("ALTER TABLE workflow_steps ADD COLUMN slug VARCHAR(128)"))
            connection.execute(text("UPDATE workflow_steps SET slug = CONCAT('step_', id)"))
            connection.execute(text("ALTER TABLE workflow_steps ALTER COLUMN slug SET NOT NULL"))

        inspector = inspect(connection)
        uniques = {constraint["name"] for constraint in inspector.get_unique_constraints("workflow_steps")}
        if "workflow_steps_definition_slug" not in uniques:
            connection.execute(
                text(
                    "ALTER TABLE workflow_steps "
                    "ADD CONSTRAINT workflow_steps_definition_slug "
                    "UNIQUE(definition_id, slug)"
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
