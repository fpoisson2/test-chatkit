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


def _app_settings_has_appearance_columns(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("app_settings"):
        return False
    columns = {column["name"] for column in inspector.get_columns("app_settings")}
    required = {
        "appearance_color_scheme",
        "appearance_radius_style",
        "appearance_accent_color",
        "appearance_use_custom_surface",
        "appearance_surface_hue",
        "appearance_surface_tint",
        "appearance_surface_shade",
        "appearance_heading_font",
        "appearance_body_font",
        "appearance_start_greeting",
        "appearance_start_prompt",
        "appearance_input_placeholder",
        "appearance_disclaimer",
    }
    return required.issubset(columns)


def _add_app_settings_appearance_columns(connection) -> None:
    inspector = inspect(connection)

    if not inspector.has_table("app_settings"):
        logger.warning(
            "Cannot add appearance columns to app_settings because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("app_settings")
    }

    statements: tuple[tuple[str, str], ...] = (
        ("appearance_color_scheme", "VARCHAR(16)"),
        ("appearance_radius_style", "VARCHAR(16)"),
        ("appearance_accent_color", "VARCHAR(32)"),
        ("appearance_use_custom_surface", "BOOLEAN"),
        ("appearance_surface_hue", "FLOAT"),
        ("appearance_surface_tint", "FLOAT"),
        ("appearance_surface_shade", "FLOAT"),
        ("appearance_heading_font", "VARCHAR(128)"),
        ("appearance_body_font", "VARCHAR(128)"),
        ("appearance_start_greeting", "TEXT"),
        ("appearance_start_prompt", "TEXT"),
        ("appearance_input_placeholder", "TEXT"),
        ("appearance_disclaimer", "TEXT"),
    )

    for column_name, column_type in statements:
        if column_name in existing_columns:
            continue
        connection.execute(
            text(
                f"ALTER TABLE app_settings ADD COLUMN {column_name} {column_type}"
            )
        )


def _add_app_settings_lti_columns(connection) -> None:
    inspector = inspect(connection)

    if not inspector.has_table("app_settings"):
        logger.warning(
            "Cannot add LTI columns to app_settings because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("app_settings")
    }

    statements: tuple[tuple[str, str], ...] = (
        ("lti_tool_client_id", "VARCHAR(255)"),
        ("lti_tool_key_set_url", "TEXT"),
        ("lti_tool_audience", "VARCHAR(512)"),
        ("lti_tool_private_key_encrypted", "TEXT"),
        ("lti_tool_key_id", "VARCHAR(255)"),
    )

    for column_name, column_type in statements:
        if column_name in existing_columns:
            continue
        connection.execute(
            text(
                f"ALTER TABLE app_settings ADD COLUMN {column_name} {column_type}"
            )
        )


def _workflows_has_lti_chatkit_options(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("workflows"):
        return False
    columns = {column["name"] for column in inspector.get_columns("workflows")}
    required = {
        "lti_show_sidebar",
        "lti_show_header",
        "lti_enable_history",
    }
    return required.issubset(columns)


def _add_workflows_lti_chatkit_options(connection) -> None:
    inspector = inspect(connection)

    if not inspector.has_table("workflows"):
        logger.warning(
            "Cannot add LTI ChatKit options to workflows because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("workflows")
    }

    statements: tuple[tuple[str, str], ...] = (
        ("lti_show_sidebar", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("lti_show_header", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("lti_enable_history", "BOOLEAN NOT NULL DEFAULT TRUE"),
    )

    for column_name, column_type in statements:
        if column_name in existing_columns:
            continue
        connection.execute(
            text(
                f"ALTER TABLE workflows ADD COLUMN {column_name} {column_type}"
            )
        )


def _lti_user_sessions_has_ags_columns(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("lti_user_sessions"):
        return False
    columns = {column["name"] for column in inspector.get_columns("lti_user_sessions")}
    required = {
        "ags_line_items_endpoint",
        "ags_line_item_endpoint",
        "ags_scopes",
        "ags_line_item_claim",
    }
    return required.issubset(columns)


def _add_lti_user_sessions_ags_columns(connection) -> None:
    inspector = inspect(connection)

    if not inspector.has_table("lti_user_sessions"):
        logger.warning(
            "Cannot add AGS columns to lti_user_sessions because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("lti_user_sessions")
    }

    statements: tuple[tuple[str, str], ...] = (
        ("ags_line_items_endpoint", "TEXT"),
        ("ags_line_item_endpoint", "TEXT"),
        ("ags_scopes", "JSONB"),
        ("ags_line_item_claim", "JSONB"),
    )

    for column_name, column_type in statements:
        if column_name in existing_columns:
            continue
        connection.execute(
            text(
                f"ALTER TABLE lti_user_sessions ADD COLUMN {column_name} {column_type}"
            )
        )


def _users_has_is_lti_column(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("users"):
        return False
    columns = {column["name"] for column in inspector.get_columns("users")}
    return "is_lti" in columns


def _add_users_is_lti_column(connection) -> None:
    inspector = inspect(connection)

    if not inspector.has_table("users"):
        logger.warning(
            "Cannot add is_lti column to users because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("users")
    }

    if "is_lti" in existing_columns:
        return

    # Add is_lti column with default value FALSE
    connection.execute(
        text("ALTER TABLE users ADD COLUMN is_lti BOOLEAN NOT NULL DEFAULT FALSE")
    )

    # Update existing users with @lti.local emails to be marked as LTI users
    connection.execute(
        text("UPDATE users SET is_lti = TRUE WHERE email LIKE '%@lti.local'")
    )

    # Create index for faster queries on is_lti
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS idx_users_is_lti ON users(is_lti)")
    )


def _workflow_steps_has_parent_slug_column(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("workflow_steps"):
        return False
    columns = {column["name"] for column in inspector.get_columns("workflow_steps")}
    return "parent_slug" in columns


def _add_workflow_steps_parent_slug_column(connection) -> None:
    inspector = inspect(connection)

    if not inspector.has_table("workflow_steps"):
        logger.warning(
            "Cannot add parent_slug column to workflow_steps because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("workflow_steps")
    }

    if "parent_slug" in existing_columns:
        return

    # Add parent_slug column to define explicit hierarchical relationships
    connection.execute(
        text("ALTER TABLE workflow_steps ADD COLUMN parent_slug VARCHAR(128) NULL")
    )

    # Add index for faster queries on parent_slug
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS idx_workflow_steps_parent_slug ON workflow_steps(parent_slug)")
    )

    # Add index for combined definition_id + parent_slug lookups
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS idx_workflow_steps_def_parent ON workflow_steps(definition_id, parent_slug)")
    )


def _workflows_has_owner_id_column(connection) -> bool:
    """Check if workflows table has owner_id column."""
    inspector = inspect(connection)
    if not inspector.has_table("workflows"):
        return False
    columns = {column["name"] for column in inspector.get_columns("workflows")}
    return "owner_id" in columns


def _add_workflows_owner_id_column(connection) -> None:
    """Add owner_id column to workflows table."""
    inspector = inspect(connection)

    if not inspector.has_table("workflows"):
        logger.warning(
            "Cannot add owner_id column to workflows because the table does not exist"
        )
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("workflows")
    }

    if "owner_id" in existing_columns:
        return

    # Add owner_id column
    connection.execute(
        text("ALTER TABLE workflows ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    )

    # Add index for faster lookups
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_workflows_owner_id ON workflows(owner_id)")
    )


def _lti_registrations_unique_constraint_is_correct(connection) -> bool:
    inspector = inspect(connection)
    if not inspector.has_table("lti_registrations"):
        return True
    if connection.dialect.name == "sqlite":
        return True

    constraints = inspector.get_unique_constraints("lti_registrations")
    has_composite = any(
        set(constraint.get("column_names") or []) == {"issuer", "client_id"}
        for constraint in constraints
    )
    has_issuer_only = any(
        set(constraint.get("column_names") or []) == {"issuer"}
        for constraint in constraints
    )
    return has_composite and not has_issuer_only


def _ensure_lti_registrations_unique_constraint(connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("lti_registrations"):
        return
    if connection.dialect.name == "sqlite":
        return

    constraints = inspector.get_unique_constraints("lti_registrations")
    has_composite = any(
        set(constraint.get("column_names") or []) == {"issuer", "client_id"}
        for constraint in constraints
    )

    for constraint in constraints:
        columns = set(constraint.get("column_names") or [])
        if columns == {"issuer"}:
            name = constraint.get("name")
            if name:
                connection.execute(
                    text(
                        f'ALTER TABLE lti_registrations DROP CONSTRAINT IF EXISTS "{name}"'
                    )
                )

    if not has_composite:
        connection.execute(
            text(
                "ALTER TABLE lti_registrations "
                "ADD CONSTRAINT uq_lti_registrations_issuer_client "
                "UNIQUE (issuer, client_id)"
            )
        )


def _workflow_shares_table_exists(connection) -> bool:
    """Check if workflow_shares table exists."""
    inspector = inspect(connection)
    return inspector.has_table("workflow_shares")


def _create_workflow_shares_table(connection) -> None:
    """Create workflow_shares table for sharing workflows with users."""
    inspector = inspect(connection)

    if inspector.has_table("workflow_shares"):
        return

    connection.execute(
        text("""
            CREATE TABLE workflow_shares (
                workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission VARCHAR(16) NOT NULL DEFAULT 'read',
                shared_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                PRIMARY KEY (workflow_id, user_id),
                CONSTRAINT ck_workflow_shares_permission CHECK (permission IN ('read', 'write'))
            )
        """)
    )

    # Add index for user lookups
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_workflow_shares_user_id ON workflow_shares(user_id)")
    )


def _workflow_shares_has_permission_column(connection) -> bool:
    """Check if workflow_shares table has permission column."""
    inspector = inspect(connection)
    if not inspector.has_table("workflow_shares"):
        return True  # If table doesn't exist, we'll create it with the column
    columns = {column["name"] for column in inspector.get_columns("workflow_shares")}
    return "permission" in columns


def _add_workflow_shares_permission_column(connection) -> None:
    """Add permission column to workflow_shares table."""
    inspector = inspect(connection)

    if not inspector.has_table("workflow_shares"):
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("workflow_shares")
    }

    if "permission" in existing_columns:
        return

    # Add permission column with default 'read'
    connection.execute(
        text("ALTER TABLE workflow_shares ADD COLUMN permission VARCHAR(16) NOT NULL DEFAULT 'read'")
    )

    # Add check constraint
    connection.execute(
        text("""
            ALTER TABLE workflow_shares ADD CONSTRAINT ck_workflow_shares_permission
            CHECK (permission IN ('read', 'write'))
        """)
    )


def check_and_apply_migrations():
    """
    Check and apply all pending database migrations on startup.
    This ensures the database schema is always up to date.
    """
    migrations = [
        {
            "id": "001_fix_language_fk",
            "description": "Fix language_generation_tasks FK for deletions",
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
        {
            "id": "004_add_lti_chatkit_options",
            "description": "Add LTI ChatKit options to workflows table",
            "check_fn": _workflows_has_lti_chatkit_options,
            "apply_fn": _add_workflows_lti_chatkit_options,
        },
        {
            "id": "005_add_lti_user_session_ags",
            "description": "Add AGS support columns to LTI user sessions",
            "check_fn": _lti_user_sessions_has_ags_columns,
            "apply_fn": _add_lti_user_sessions_ags_columns,
        },
        {
            "id": "006_add_users_is_lti",
            "description": "Add is_lti column to users for proper LTI user identification",
            "check_fn": _users_has_is_lti_column,
            "apply_fn": _add_users_is_lti_column,
        },
        {
            "id": "007_add_parent_slug_to_workflow_steps",
            "description": "Add parent_slug column for explicit parent-child relationships in workflows",
            "check_fn": _workflow_steps_has_parent_slug_column,
            "apply_fn": _add_workflow_steps_parent_slug_column,
        },
        {
            "id": "008_add_workflow_owner_id",
            "description": "Add owner_id column to workflows for ownership tracking",
            "check_fn": _workflows_has_owner_id_column,
            "apply_fn": _add_workflows_owner_id_column,
        },
        {
            "id": "009_create_workflow_shares_table",
            "description": "Create workflow_shares table for sharing workflows with users",
            "check_fn": _workflow_shares_table_exists,
            "apply_fn": _create_workflow_shares_table,
        },
        {
            "id": "010_add_workflow_shares_permission",
            "description": "Add permission column to workflow_shares for read/write access control",
            "check_fn": _workflow_shares_has_permission_column,
            "apply_fn": _add_workflow_shares_permission_column,
        },
        {
            "id": "011_add_appearance_to_app_settings",
            "description": "Add appearance columns to app_settings",
            "check_fn": _app_settings_has_appearance_columns,
            "apply_fn": _add_app_settings_appearance_columns,
        },
        {
            "id": "012_fix_lti_registration_unique_constraint",
            "description": "Ensure LTI registrations allow multiple client IDs per issuer",
            "check_fn": _lti_registrations_unique_constraint_is_correct,
            "apply_fn": _ensure_lti_registrations_unique_constraint,
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
