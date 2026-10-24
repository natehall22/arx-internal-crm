#!/usr/bin/env bash
# DB tests for the 2026-10 release (payroll atomic approve + claim guard, field-role deny, data fixes) against a LOCAL Postgres that
# already holds the production schema (e.g. `supabase db dump --linked --schema public -f prod_schema.sql`, loaded into a throwaway
# postgres:17 after creating the roles anon/authenticated/service_role, schemas extensions/auth, and auth.uid()).
# Every test body ends in an unconditional RAISE EXCEPTION carrying its report, so nothing it does can be committed. Never point this
# at Supabase: it refuses non-local hosts.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=postgres supabase/tests/run-release-2026-10-batch.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/.."
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
for f in migrations/202610250010_payroll_adjustments.sql migrations/202610270010_threads_audiences.sql migrations/202610280010_atomic_approve_and_field_role_deny.sql \
         data-fixes/2026-10-27_link_orphan_opportunities.sql data-fixes/2026-10-27_merge_notes_into_threads.sql; do
  P -f "$ROOT/$f" >/dev/null 2>&1 || { echo "FAIL applying $f" >&2; exit 1; }
done
for t in payroll_atomic_approve data_fix_link_orphans data_fix_merge_notes threads_field_role; do
  out=$( (echo 'DO $t$'; cat "$HERE/$t.body.sql"; echo '$t$;') | P 2>&1 || true )
  echo "$out" | grep -q 'REPORT (rolled back by design)' || { echo "FAIL $t"; echo "$out" >&2; exit 1; }
  echo "PASS $t"; echo "$out" | grep -E '^(T[0-9]|apply|undo|preview|can_view|message_visible|no-deal)' | sed 's/^/    /'
done
