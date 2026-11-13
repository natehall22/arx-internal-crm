#!/usr/bin/env bash
# DB test for the RLS lockdown (202611240040 / 0045 / 0050) against PROD's real policies: builds the money-suite database
# (prod baseline schema + every pending migration, supabase/tests/money/build_db.sh — it DROPS and rebuilds every schema),
# then runs supabase/tests/rls_lockdown.test.sql in a rolled-back transaction. Needs a THROWAWAY local Postgres 16+.
#   ALLOW_SCHEMA_RESET=1 PGHOST=/tmp/pg PGPORT=55432 PGUSER=postgres supabase/tests/run-rls-lockdown.sh
set -euo pipefail
[ "${ALLOW_SCHEMA_RESET:-}" = 1 ] || { echo "refusing: this test drops every schema. Use a throwaway database and set ALLOW_SCHEMA_RESET=1" >&2; exit 2; }
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
supabase/tests/money/build_db.sh >/dev/null || { echo "FAIL: money-suite database did not build (a migration failed)"; exit 1; }
out=$(psql -X -q -f supabase/tests/rls_lockdown.test.sql 2>&1 || true)
echo "$out" | grep -q 'REPORT (rolled back by design): all assertions passed' || { echo "FAIL"; echo "$out" | grep -E 'ERROR|DETAIL|CONTEXT' >&2; exit 1; }
echo "PASS rls_lockdown"
