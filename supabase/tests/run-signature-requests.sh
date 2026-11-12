#!/usr/bin/env bash
# Applies 202611200010 + 202611200020 to a LOCAL throwaway Postgres and runs signature_requests.test.sql.
#   PGHOST=/tmp PGPORT=54999 PGUSER=postgres PGDATABASE=postgres supabase/tests/run-signature-requests.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DO \$\$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
 CREATE TABLE orgs (id uuid PRIMARY KEY DEFAULT gen_random_uuid()); CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
 CREATE TABLE order_form_contracts (id uuid PRIMARY KEY); CREATE TABLE job_change_orders (id uuid PRIMARY KEY);"
P -f "$HERE/../migrations/202611200010_signing_engine.sql" >/dev/null 2>&1
P -f "$HERE/../migrations/202611200020_signature_requests.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -f "$HERE/signature_requests.test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | tee /tmp/signature-requests-db.out
grep -q -E "FAIL|ERROR" /tmp/signature-requests-db.out && exit 1; [ "$(grep -c PASS /tmp/signature-requests-db.out)" -ge 7 ]
