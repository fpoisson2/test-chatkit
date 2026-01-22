#!/bin/bash
# Migration script: Local PostgreSQL -> Supabase
#
# Prerequisites:
#   - pg_dump and psql installed locally
#   - Access to both local and Supabase databases
#   - pgVector extension enabled on Supabase (run in SQL editor first)
#
# Usage:
#   ./scripts/migrate_to_supabase.sh
#
# Environment variables (or set in .env):
#   LOCAL_DATABASE_URL - Local PostgreSQL connection string
#   SUPABASE_DATABASE_URL - Supabase direct connection string (NOT pooler!)
#                           Use: postgresql://postgres.[REF]:[PASS]@db.[REF].supabase.co:5432/postgres

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  PostgreSQL -> Supabase Migration${NC}"
echo -e "${GREEN}========================================${NC}"

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Check required variables
if [ -z "$LOCAL_DATABASE_URL" ]; then
    echo -e "${RED}Error: LOCAL_DATABASE_URL is not set${NC}"
    echo "Set it in .env or export it:"
    echo "  export LOCAL_DATABASE_URL=postgresql://user:pass@localhost:5432/chatkit"
    exit 1
fi

if [ -z "$SUPABASE_DATABASE_URL" ]; then
    echo -e "${RED}Error: SUPABASE_DATABASE_URL is not set${NC}"
    echo "Set it in .env or export it (use DIRECT connection, not pooler):"
    echo "  export SUPABASE_DATABASE_URL=postgresql://postgres.[REF]:[PASS]@db.[REF].supabase.co:5432/postgres"
    exit 1
fi

# Warn if using pooler URL
if [[ "$SUPABASE_DATABASE_URL" == *"pooler.supabase.co"* ]]; then
    echo -e "${YELLOW}Warning: You're using the pooler URL. For migration, use the direct connection:${NC}"
    echo "  postgresql://postgres.[REF]:[PASS]@db.[REF].supabase.co:5432/postgres"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

DUMP_FILE="/tmp/chatkit_migration_$(date +%Y%m%d_%H%M%S).sql"

echo ""
echo -e "${YELLOW}Step 1: Testing connections...${NC}"

# Test local connection
echo -n "  Local database: "
if psql "$LOCAL_DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
    exit 1
fi

# Test Supabase connection
echo -n "  Supabase database: "
if psql "$SUPABASE_DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 2: Checking pgVector extension on Supabase...${NC}"
VECTOR_EXISTS=$(psql "$SUPABASE_DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector';" 2>/dev/null | tr -d ' ')
if [ "$VECTOR_EXISTS" != "1" ]; then
    echo -e "${RED}pgVector extension not found on Supabase!${NC}"
    echo "Run this in Supabase SQL Editor first:"
    echo "  CREATE EXTENSION IF NOT EXISTS vector;"
    exit 1
fi
echo -e "  pgVector: ${GREEN}OK${NC}"

echo ""
echo -e "${YELLOW}Step 3: Exporting local database...${NC}"

# Export schema and data (excluding extensions, they're already on Supabase)
pg_dump "$LOCAL_DATABASE_URL" \
    --no-owner \
    --no-privileges \
    --no-comments \
    --if-exists \
    --clean \
    --exclude-table='_sqlalchemy*' \
    --exclude-table='alembic_version' \
    > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "  Dump created: ${GREEN}$DUMP_FILE ($DUMP_SIZE)${NC}"

echo ""
echo -e "${YELLOW}Step 4: Preview tables to migrate...${NC}"
grep -E "^CREATE TABLE" "$DUMP_FILE" | head -20

TABLE_COUNT=$(grep -c "^CREATE TABLE" "$DUMP_FILE" || true)
echo -e "  Total tables: ${GREEN}$TABLE_COUNT${NC}"

echo ""
echo -e "${YELLOW}Step 5: Ready to import to Supabase${NC}"
echo -e "${RED}WARNING: This will DROP existing tables on Supabase!${NC}"
read -p "Continue with import? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled. Dump file saved at: $DUMP_FILE"
    exit 0
fi

echo ""
echo -e "${YELLOW}Step 6: Importing to Supabase...${NC}"

# Import to Supabase
psql "$SUPABASE_DATABASE_URL" < "$DUMP_FILE"

echo ""
echo -e "${YELLOW}Step 7: Verifying migration...${NC}"

# Count rows in key tables
for table in users workflows workflow_definitions chat_threads; do
    LOCAL_COUNT=$(psql "$LOCAL_DATABASE_URL" -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ' || echo "0")
    SUPABASE_COUNT=$(psql "$SUPABASE_DATABASE_URL" -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ' || echo "0")

    if [ "$LOCAL_COUNT" == "$SUPABASE_COUNT" ]; then
        STATUS="${GREEN}OK${NC}"
    else
        STATUS="${RED}MISMATCH${NC}"
    fi
    echo -e "  $table: Local=$LOCAL_COUNT, Supabase=$SUPABASE_COUNT [$STATUS]"
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Migration Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Update your .env file:"
echo "   SUPABASE_DATABASE_URL=postgresql://postgres.[REF]:[PASS]@[REGION].pooler.supabase.co:6543/postgres?sslmode=require"
echo "   DATABASE_USE_SUPABASE_POOLER=true"
echo ""
echo "2. Start with Supabase:"
echo "   docker-compose -f docker-compose.yml -f docker-compose.supabase.yml up -d"
echo ""
echo "3. Clean up dump file:"
echo "   rm $DUMP_FILE"
