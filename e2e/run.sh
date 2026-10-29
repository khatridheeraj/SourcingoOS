#!/usr/bin/env bash
# Starts a complete local copy of Sourcingo OS on made-up data and checks it, with nothing real touched:
# Postgres with every migration and e2e/seed.sql, PostgREST, a stand-in for Supabase's auth and storage
# (e2e/gateway.mjs), and the app itself; then the journey tests and a crawl of every screen as every role.
#   e2e/run.sh            start everything, run the checks, leave it running for screenshots (node e2e/shot.mjs)
#   e2e/run.sh --quick    phone only, fewer detail pages
#   e2e/run.sh --up       only start everything
# Works in a fresh Claude Code cloud container (Ubuntu, Postgres 16 installed, root user).
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="${E2E_WORK:-/var/tmp/sourcingo-e2e}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres
mkdir -p "$WORK" && chmod 777 "$WORK"

# 1. Postgres, as the postgres user (it refuses to run as root).
if ! pg_isready -q 2>/dev/null; then
  if [ ! -d "$WORK/pg" ]; then
    install -d -o postgres "$WORK/pg"
    su postgres -c "$PGBIN/initdb -D $WORK/pg -U postgres -A trust" >/dev/null
  fi
  su postgres -c "$PGBIN/pg_ctl -D $WORK/pg -o '-p 54329 -k $WORK -c listen_addresses=127.0.0.1' -l $WORK/pg.log start" >/dev/null
  until pg_isready -q; do sleep 0.5; done
fi
e2e/db.sh app

# 2. PostgREST.
if [ ! -x "$WORK/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$WORK"
fi
if ! curl -s -o /dev/null http://127.0.0.1:54322/; then
  nohup "$WORK/postgrest" e2e/postgrest.conf >"$WORK/postgrest.log" 2>&1 &
fi

# 3. The Supabase stand-in.
if ! curl -s -o /dev/null http://127.0.0.1:54321/; then
  nohup node e2e/gateway.mjs >"$WORK/gateway.log" 2>&1 &
fi

# 4. The app, in dev mode against the local stack.
[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null
if ! curl -s -o /dev/null http://localhost:3100/login; then
  NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(node e2e/token.mjs anon)" \
    nohup npx next dev -p 3100 >"$WORK/next.log" 2>&1 &
  for _ in $(seq 1 90); do curl -s -o /dev/null http://localhost:3100/login && break; sleep 1; done
fi
sleep 1
curl -s -o /dev/null http://localhost:3100/login || { echo "The app did not start; see $WORK/next.log"; exit 1; }
echo "Running: app http://localhost:3100, gateway :54321, PostgREST :54322, Postgres :54329 (logs in $WORK)."
[ "${1:-}" = "--up" ] && exit 0

# 5. The checks.
status=0
node --experimental-strip-types --test src/lib/*.test.ts >"$WORK/unit.log" 2>&1 && echo "Unit tests passed." || { echo "UNIT TESTS FAILED:"; tail -40 "$WORK/unit.log"; status=1; }
node e2e/crawl.mjs ${1:-} || status=1
node e2e/help.mjs || status=1
exit $status
