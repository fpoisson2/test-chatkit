# Database Migrations

This directory contains SQL migration scripts for the database.

## How to apply migrations

### Using docker-compose

```bash
# Connect to the database
docker-compose exec db psql -U chatkit -d chatkit

# Run the migration
\i /path/to/migration.sql
```

### Using psql directly

```bash
# From the host machine
psql -h localhost -p 5432 -U chatkit -d chatkit -f migrations/001_fix_language_fk_constraint.sql
```

### Using Python script

```bash
# From the backend directory
python -c "
from app.database import engine
with engine.begin() as conn:
    with open('migrations/001_fix_language_fk_constraint.sql') as f:
        conn.execute(text(f.read()))
"
```

## Migration: 001_fix_language_fk_constraint.sql

**Purpose**: Fix foreign key constraint on `language_generation_tasks.language_id`

**Issue**: When trying to delete a language from the `languages` table, the operation fails with a foreign key constraint violation if there are associated generation tasks.

**Solution**: Change the foreign key constraint from default (RESTRICT) to `ON DELETE SET NULL`, so when a language is deleted, the `language_id` in related tasks is set to NULL instead of blocking the deletion.

**Applied**: Run this migration after upgrading to the version that includes Celery support.
