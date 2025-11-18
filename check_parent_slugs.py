#!/usr/bin/env python3
"""Script to check parent_slug values in workflow_steps table."""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from sqlalchemy import create_engine, text
from app.database import get_database_url

def check_parent_slugs():
    """Check and display parent_slug values for all workflow steps."""
    database_url = get_database_url()
    engine = create_engine(database_url)

    with engine.connect() as conn:
        # Check if parent_slug column exists
        result = conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'workflow_steps' AND column_name = 'parent_slug'
        """))

        if not result.fetchone():
            print("❌ Column 'parent_slug' does not exist in workflow_steps table")
            return

        print("✅ Column 'parent_slug' exists\n")

        # Get all workflow steps with their parent_slug
        result = conn.execute(text("""
            SELECT
                ws.slug,
                ws.kind,
                ws.parent_slug,
                wd.id as definition_id,
                wd.workflow_id
            FROM workflow_steps ws
            JOIN workflow_definitions wd ON ws.definition_id = wd.id
            ORDER BY wd.workflow_id, ws.position
        """))

        rows = result.fetchall()

        if not rows:
            print("No workflow steps found")
            return

        current_workflow_id = None
        for row in rows:
            slug, kind, parent_slug, definition_id, workflow_id = row

            if workflow_id != current_workflow_id:
                current_workflow_id = workflow_id
                print(f"\n{'='*60}")
                print(f"Workflow ID: {workflow_id}, Definition ID: {definition_id}")
                print('='*60)

            parent_info = f"parent_slug={parent_slug}" if parent_slug else "no parent"
            print(f"  {slug:30s} [{kind:15s}] {parent_info}")

        # Count nodes with parent_slug
        result = conn.execute(text("""
            SELECT COUNT(*)
            FROM workflow_steps
            WHERE parent_slug IS NOT NULL
        """))
        count_with_parent = result.fetchone()[0]

        result = conn.execute(text("""
            SELECT COUNT(*)
            FROM workflow_steps
        """))
        total = result.fetchone()[0]

        print(f"\n{'='*60}")
        print(f"Summary: {count_with_parent}/{total} nodes have parent_slug defined")
        print('='*60)

if __name__ == '__main__':
    check_parent_slugs()
