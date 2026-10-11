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
# Each test file runs on its own fresh copy, so one file's data can't hide another's mistakes.
for t in tests/rules.sql tests/payments.sql tests/incoming.sql; do
  psql -q -d postgres -c "create database ${db}_t template $db"
  psql -q -d "${db}_t" -v ON_ERROR_STOP=1 -o /dev/null -f "$t"
  psql -q -d postgres -c "drop database ${db}_t"
done
echo "All database rule tests passed."
