#!/usr/bin/env bash
# Applies the stub + EVERY numbered migration in filename order to the throwaway database. Prints each failing file.
# Usage: apply_migrations.sh   (PGHOST/PGPORT/PGUSER/PGDATABASE must point at a LOCAL throwaway Postgres 16)
set -uo pipefail
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
psql -X -q -v ON_ERROR_STOP=1 -f supabase/tests/money/00_supabase_stub.sql >/dev/null || exit 1
fails=0
for f in $(ls supabase/migrations | grep -E '^[0-9]' | sort); do
  if ! out=$(psql -X -q -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f" 2>&1); then
    fails=$((fails+1)); echo "MIGRATION FAILED: $f"; echo "$out" | grep -m2 -E 'ERROR|FATAL' | sed 's/^/    /'
  fi
done
echo "migration failures: $fails"
