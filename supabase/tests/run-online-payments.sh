#!/usr/bin/env bash
# DB test for online payments (migration 202611120020 on top of the invoice migrations). Needs a THROWAWAY local
# Postgres 16+; the test DROPS and rebuilds schemas public and auth.
#   ALLOW_SCHEMA_RESET=1 PGHOST=/tmp/pg PGPORT=55432 PGUSER=postgres supabase/tests/run-online-payments.sh
set -euo pipefail
[ "${ALLOW_SCHEMA_RESET:-}" = 1 ] || { echo "refusing: this test drops schema public. Use a throwaway database and set ALLOW_SCHEMA_RESET=1" >&2; exit 2; }
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
out=$(psql -X -q -f supabase/tests/online_payments.test.sql 2>&1 || true)
echo "$out" | grep -q 'REPORT: online payments assertions passed' || { echo "FAIL"; echo "$out" >&2; exit 1; }
echo "PASS online_payments"
