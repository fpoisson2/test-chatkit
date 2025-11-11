"""Auto-migration system - runs database migrations on startup."""

import logging
from collections.abc import Callable

from sqlalchemy import inspect, text

from .database import engine
from .models import (
    Base,
    LTIDeployment,
    LTIRegistration,
    LTIResourceLink,
    LTIUserSession,
)

logger = logging.getLogger(__name__)


def _lti_tables_exist(connection) -> bool:
    inspector = inspect(connection)
    required = (
        "lti_registrations",
        "lti_deployments",
        "lti_resource_links",
        "lti_user_sessions",
    )
    return all(inspector.has_table(table) for table in required)


def _create_lti_tables(connection) -> None:
    Base.metadata.create_all(
        bind=connection,
        tables=[
            LTIRegistration.__table__,
            LTIDeployment.__table__,
            LTIResourceLink.__table__,
            LTIUserSession.__table__,
        ],
    )


def _app_settings_has_lti_columns(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("app_settings"):
        return False
    columns = {column["name"] for column in inspector.get_columns("app_settings")}
    required = {
        "lti_tool_client_id",
        "lti_tool_key_set_url",
        "lti_tool_audience",
        "lti_tool_private_key_encrypted",
        "lti_tool_key_id",
    }
    return required.issubset(columns)


def _add_app_settings_lti_columns(connection) -> None:
    statements = (
        "ALTER TABLE app_settings ADD COLUMN lti_tool_client_id VARCHAR(255)",
        "ALTER TABLE app_settings ADD COLUMN lti_tool_key_set_url TEXT",
        "ALTER TABLE app_settings ADD COLUMN lti_tool_audience VARCHAR(512)",
        "ALTER TABLE app_settings ADD COLUMN lti_tool_private_key_encrypted TEXT",
        "ALTER TABLE app_settings ADD COLUMN lti_tool_key_id VARCHAR(255)",
    )
    for statement in statements:
        connection.execute(text(statement))


def check_and_apply_migrations():
    """
    Check and apply all pending database migrations on startup.
    This ensures the database schema is always up to date.
    """
    migrations = [
        {
            "id": "001_fix_language_fk",
            "description": "Fix language_generation_tasks foreign key to allow language deletion",
            "check": """
                SELECT confdeltype
                FROM pg_constraint
                WHERE conname = 'language_generation_tasks_language_id_fkey'
            """,
            "expected": "n",  # 'n' = SET NULL
            "sql": """
                ALTER TABLE language_generation_tasks
                DROP CONSTRAINT IF EXISTS language_generation_tasks_language_id_fkey;

                ALTER TABLE language_generation_tasks
                ADD CONSTRAINT language_generation_tasks_language_id_fkey
                FOREIGN KEY (language_id)
                REFERENCES languages(id)
                ON DELETE SET NULL;
            """,
        },
        {
            "id": "002_create_lti_tables",
            "description": "Create tables used for LTI integrations",
            "check_fn": _lti_tables_exist,
            "apply_fn": _create_lti_tables,
        },
        {
            "id": "003_add_lti_tool_columns",
            "description": "Add columns to store LTI tool configuration",
            "check_fn": _app_settings_has_lti_columns,
            "apply_fn": _add_app_settings_lti_columns,
        },
    ]

    logger.info("Checking database migrations...")

    for migration in migrations:
        migration_id = migration["id"]
        description = migration["description"]

        try:
            with engine.begin() as conn:
                applied = False
                check_fn: Callable | None = migration.get("check_fn")
                if check_fn is not None:
                    applied = bool(check_fn(conn))
                else:
                    result = conn.execute(text(migration["check"]))
                    row = result.fetchone()
                    applied = bool(row) and row[0] == migration.get("expected")

                if applied:
                    logger.info(f"✓ Migration {migration_id} already applied")
                    continue

                logger.info(f"⚡ Applying migration {migration_id}: {description}")
                apply_fn: Callable | None = migration.get("apply_fn")
                if apply_fn is not None:
                    apply_fn(conn)
                else:
                    conn.execute(text(migration["sql"]))
                logger.info(f"✓ Migration {migration_id} applied successfully")

        except Exception as e:
            logger.error(f"✗ Failed to apply migration {migration_id}: {e}")
            # Don't crash the app, just log the error
            # Migrations can be applied manually if needed

    logger.info("Database migrations check completed")
