#!/usr/bin/env bash
# Runs supabase/tests/payroll_pay_week_phase1.test.sql against a LOCAL Postgres (>= 14) in a throwaway database, which is dropped.
# Never point this at Supabase: it refuses non-local hosts.
#   PGHOST=/var/run/postgresql PGUSER=postgres supabase/tests/run-payroll-pay-week-phase1.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
DB="payroll_phase1_test_$$"
TMP="$(mktemp -d)"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
# Sections 0–2b of 202610280010 (private schema, frozen units, writer guards) — the parts this release builds on.
awk '/^-- 0\. Private schema/{on=1} /^-- 3\. One person-total/{on=0} on' "$HERE/../migrations/202610280010_atomic_approve_and_field_role_deny.sql" > "$TMP/sections0to2b.sql"
# The data fix without its trailing prod preview call (the test calls it with its own company ids).
grep -v "^SELECT release_backups.close_stale_payroll_weeks('9089" "$HERE/../data-fixes/2026-11-12_close_stale_payroll_week.sql" > "$TMP/datafix.sql"
createdb "$DB"
OUT=$(psql -X -q -v ON_ERROR_STOP=1 -v sections0to2b="$TMP/sections0to2b.sql" -v datafix="$TMP/datafix.sql" -d "$DB" -f "$HERE/payroll_pay_week_phase1.test.sql" 2>&1) || { echo "$OUT" >&2; echo "FAIL" >&2; exit 1; }
echo "$OUT" | grep -oE 'PASS [0-9].*' || true
echo "$OUT" | grep -q 'ALL PAYROLL PHASE1 TESTS PASSED' || { echo "$OUT" >&2; exit 1; }
echo "ALL PAYROLL PHASE1 TESTS PASSED"
