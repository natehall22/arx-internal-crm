#!/usr/bin/env bash
# DB test for lead routing (migration 202611230010): sequential rules + 30 concurrent callers sharing one pointer.
# Needs a THROWAWAY local Postgres 16+; drops schema public. Never point it at Supabase.
#   ALLOW_SCHEMA_RESET=1 PGHOST=/tmp/pg PGPORT=55432 PGUSER=postgres supabase/tests/run-lead-routing.sh
set -euo pipefail
[ "${ALLOW_SCHEMA_RESET:-}" = 1 ] || { echo "refusing: this test drops schema public. Use a throwaway database and set ALLOW_SCHEMA_RESET=1" >&2; exit 2; }
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
out=$(psql -X -q -v ON_ERROR_STOP=1 -f supabase/tests/lead_routing.test.sql 2>&1) || { echo "FAIL (sequential)"; echo "$out" >&2; exit 1; }
echo "$out" | grep -q 'sequential assertions passed' || { echo "FAIL"; echo "$out" >&2; exit 1; }
# Concurrency: 30 separate sessions ask for a turn at once among 2 active people on a fresh scope.
org=11111111-1111-4111-8111-111111111111
a=00000000-0000-4000-8000-000000000001; b=00000000-0000-4000-8000-000000000002
for i in $(seq 1 30); do
  psql -X -q -At -c "SELECT lead_routing_next('$org','race',ARRAY['$a','$b']::uuid[])" > "/tmp/lead-routing-race.$$.$i" &
done
wait
counts=$(cat /tmp/lead-routing-race.$$.* | sort | uniq -c | awk '{print $1}' | tr '\n' ' ')
rm -f /tmp/lead-routing-race.$$.*
[ "$counts" = "15 15 " ] || { echo "FAIL (race): expected 15/15, got: $counts" >&2; exit 1; }
echo "PASS lead_routing (sequential + 30 concurrent callers split 15/15)"
