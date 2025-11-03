#!/usr/bin/env python3
"""
Apply database migration to fix foreign key constraint.
Run this script to update the language_generation_tasks foreign key constraint.
"""
from app.database import engine
from sqlalchemy import text

def apply_migration():
    """Apply migration 001_fix_language_fk_constraint"""

    migration_sql = """
    -- Drop the existing foreign key constraint
    ALTER TABLE language_generation_tasks
    DROP CONSTRAINT IF EXISTS language_generation_tasks_language_id_fkey;

    -- Add the new constraint with ON DELETE SET NULL
    ALTER TABLE language_generation_tasks
    ADD CONSTRAINT language_generation_tasks_language_id_fkey
    FOREIGN KEY (language_id)
    REFERENCES languages(id)
    ON DELETE SET NULL;
    """

    print("Applying migration: Fix foreign key constraint...")
    print("This will allow deleting languages while keeping task history.")

    try:
        with engine.begin() as conn:
            conn.execute(text(migration_sql))

        print("✓ Migration applied successfully!")

        # Verify the constraint
        with engine.begin() as conn:
            result = conn.execute(text("""
                SELECT conname, confdeltype
                FROM pg_constraint
                WHERE conname = 'language_generation_tasks_language_id_fkey'
            """))
            row = result.fetchone()
            if row:
                print(f"✓ Constraint verified: {row[0]}, delete action: {row[1]}")
            else:
                print("⚠ Warning: Could not verify constraint")

    except Exception as e:
        print(f"✗ Migration failed: {e}")
        raise

if __name__ == "__main__":
    apply_migration()
