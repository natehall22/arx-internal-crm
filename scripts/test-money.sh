#!/usr/bin/env bash
# Money end-to-end suite. Starts a THROWAWAY Postgres 16 + PostgREST on private ports, builds the database (production's schema + every newer
# migration, supabase/tests/money/build_db.sh), runs the suite, and tears everything down.
#   needs: postgres 16 binaries, a PostgREST binary (POSTGREST_BIN, default /tmp/pgrst/postgrest; v12.2.3 static build from github.com/PostgREST/postgrest/releases)
#   MONEY_PG_BIN (default /usr/lib/postgresql/16/bin). Never points at Supabase: PGHOST is forced to the local socket dir.
set -uo pipefail
cd "$(dirname "$0")/.."
PGBIN="${MONEY_PG_BIN:-/usr/lib/postgresql/16/bin}"
PGRST="${POSTGREST_BIN:-/tmp/pgrst/postgrest}"
[ -x "$PGRST" ] || { echo "test-money: PostgREST binary not found at $PGRST (set POSTGREST_BIN)" >&2; exit 2; }
WORK="$(mktemp -d /tmp/money-e2e.XXXXXX)"; PGPORT_="${MONEY_PG_PORT:-55433}"; RESTPORT=3099; PROXYPORT=3098
RUN_AS=""; if [ "$(id -u)" = 0 ]; then chown "$(id -u postgres 2>/dev/null || echo 0)" "$WORK" 2>/dev/null; RUN_AS="su postgres -c"; fi
pgrun() { if [ -n "$RUN_AS" ]; then su postgres -c "$*"; else sh -c "$*"; fi; }
cleanup() { [ -n "${PIDS:-}" ] && kill $PIDS 2>/dev/null; pgrun "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
pgrun "$PGBIN/initdb -D $WORK/data -A trust" >/dev/null || exit 2
pgrun "$PGBIN/pg_ctl -D $WORK/data -o '-p $PGPORT_ -k $WORK -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c listen_addresses=127.0.0.1' -l $WORK/log -w start" >/dev/null || exit 2
export PGHOST="$WORK" PGPORT="$PGPORT_" PGUSER=postgres PGDATABASE=postgres
supabase/tests/money/build_db.sh || { echo "test-money: the database did not build (see the failing migrations above)" >&2; exit 1; }
psql -X -q -c "alter role authenticator password null" >/dev/null
cat > "$WORK/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT_/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "money-e2e-secret-money-e2e-secret-0123456789"
server-port = $RESTPORT
server-host = "127.0.0.1"
db-pool = 10
CONF
"$PGRST" "$WORK/pgrst.conf" >"$WORK/pgrst.log" 2>&1 & PIDS="$!"
node supabase/tests/money/rest-prefix-proxy.js $PROXYPORT $RESTPORT & PIDS="$PIDS $!"
for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$RESTPORT/" >/dev/null && break; sleep 0.5; done
# A pristine copy of the built database, so a suite can reset between scenarios (see money-e2e/world.ts).
export MONEY_PG_HOST="$WORK" MONEY_PG_PORT="$PGPORT_"
npx jest -c jest.money.config.js --runInBand "$@"
