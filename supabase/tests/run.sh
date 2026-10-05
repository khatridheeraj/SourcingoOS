#!/usr/bin/env bash
# Applies every migration to a fresh database and runs the rule tests.
# Usage: PGHOST=... PGUSER=... supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
db="sourcingo_test_$$"
psql -q -d postgres -c "create database $db"
trap 'psql -q -d postgres -c "drop database if exists $db" >/dev/null' EXIT
psql -q -d "$db" -v ON_ERROR_STOP=1 -f tests/stub_auth.sql
for f in migrations/*.sql; do psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -d "$db" -v ON_ERROR_STOP=1 -o /dev/null -f tests/rules.sql
echo "All database rule tests passed."
