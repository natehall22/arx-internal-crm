#!/usr/bin/env bash
# Rebuilds baseline/prod_baseline_schema.sql: the repo migrations applied up to (not including) 202611100040, in tolerant passes (several early
# files only work on top of objects that exist in production but in no migration), plus prod_drift.sql (those objects, read from production's
# catalogs, metadata only). Needs a LOCAL throwaway Postgres 16 in PG* env vars. Output: the schema-only dump.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$HERE/../../../.."
"$HERE/../reset_db.sh"
cd "$ROOT"
files=$(ls supabase/migrations | grep -E '^[0-9]' | sort | awk '$0 < "202611100040" && $0 !~ /^202611100010/')
for pass in 1 2 3; do
  for f in $files; do psql -X -q -f "supabase/migrations/$f" >/dev/null 2>&1; done
  psql -X -q -f "$HERE/prod_drift.sql" >/dev/null 2>&1
done
pg_dump --schema-only --no-owner --no-privileges -n public -n arx_private -n release_backups "${PGDATABASE:-postgres}" > "$HERE/prod_baseline_schema.sql"
echo "wrote $HERE/prod_baseline_schema.sql"
