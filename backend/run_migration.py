#!/usr/bin/env python3
"""
Script to run database migration 002_add_lti_chatkit_options.sql
"""
import os
import sys

# Add the backend directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine

def run_migration():
    migration_file = os.path.join(
        os.path.dirname(__file__),
        'migrations',
        '002_add_lti_chatkit_options.sql'
    )

    print(f"Reading migration from: {migration_file}")

    with open(migration_file, 'r') as f:
        sql = f.read()

    print("Migration SQL:")
    print(sql)
    print("\nExecuting migration...")

    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
        print("✅ Migration completed successfully!")
        return 0
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(run_migration())
