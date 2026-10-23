#!/usr/bin/env bash
# Builds a fresh local copy of the database: every migration, then the made-up test data.
# Usage: PGHOST=... PGPORT=... PGUSER=... e2e/db.sh [dbname]
set -euo pipefail
cd "$(dirname "$0")/.."
db="${1:-app}"
psql -q -d postgres -c "drop database if exists $db with (force)" -c "create database $db"
psql -q -d "$db" -v ON_ERROR_STOP=1 -f supabase/tests/stub_auth.sql
for f in supabase/migrations/*.sql; do psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
psql -q -d "$db" -v ON_ERROR_STOP=1 -f e2e/roles.sql
psql -q -d "$db" -v ON_ERROR_STOP=1 -f e2e/seed.sql
psql -q -d "$db" -c "notify pgrst, 'reload schema'"
