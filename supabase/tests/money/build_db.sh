#!/usr/bin/env bash
# Builds the money-suite database: production's schema (baseline dump) + every migration newer than production's applied list, in the order of
# docs/domain-cutover.md (Phase 1 in file order, then Phase 3). Prints every migration that FAILS (a real dry run of the release against prod's schema).
# Needs a LOCAL throwaway Postgres 16 (PGHOST/PGPORT/PGUSER/PGDATABASE). Exit 1 if any migration failed.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$HERE/../../.."
"$HERE/reset_db.sh" || exit 1
psql -X -q -v ON_ERROR_STOP=0 -f "$HERE/baseline/prod_baseline_schema.sql" >/dev/null 2>"${TMPDIR:-/tmp}/money_baseline.err"
cd "$ROOT"
phase3="202611160040 202611100050 202611100010 202611100020"
fails=0
apply() { # file
  local out; out=$(psql -X -q -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$1" 2>&1) || { fails=$((fails+1)); echo "MIGRATION FAILED: $1"; echo "$out" | grep -m2 -E 'ERROR|FATAL' | sed 's/^/    /'; }
}
for f in $(ls supabase/migrations | grep -E '^[0-9]' | sort | awk '$0 >= "202611100040"'); do
  case " $phase3 " in *" ${f%%_*} "*) continue ;; esac
  apply "$f"
done
for p in $phase3; do apply "$(ls supabase/migrations | grep "^$p")"; done
# Supabase hands the API roles everything in public by default (RLS is what restricts anon/authenticated); the dump carries no privileges.
psql -X -q -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role; GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA arx_private TO anon, authenticated, service_role; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA arx_private TO anon, authenticated, service_role; NOTIFY pgrst, 'reload schema'" >/dev/null
echo "migration failures: $fails"
[ "$fails" = 0 ]
