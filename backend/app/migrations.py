"""
Auto-migration system - runs database migrations on startup.
"""
import logging
from sqlalchemy import text
from .database import engine

logger = logging.getLogger(__name__)


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
        }
    ]

    logger.info("Checking database migrations...")

    for migration in migrations:
        migration_id = migration["id"]
        description = migration["description"]

        try:
            with engine.begin() as conn:
                # Check if migration is needed
                result = conn.execute(text(migration["check"]))
                row = result.fetchone()

                if row and row[0] == migration["expected"]:
                    logger.info(f"✓ Migration {migration_id} already applied")
                else:
                    logger.info(f"⚡ Applying migration {migration_id}: {description}")
                    conn.execute(text(migration["sql"]))
                    logger.info(f"✓ Migration {migration_id} applied successfully")

        except Exception as e:
            logger.error(f"✗ Failed to apply migration {migration_id}: {e}")
            # Don't crash the app, just log the error
            # Migrations can be applied manually if needed

    logger.info("Database migrations check completed")
