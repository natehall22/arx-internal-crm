#!/usr/bin/env bash
# Parity test: runs job_cost_summary (SQL) against the fixtures computed from lib/job-costs.ts (TS).
# Spins up a throwaway Postgres cluster; nothing outside a temp dir is touched. Needs postgres binaries
# under /usr/lib/postgresql/*/bin and python3 (stdlib only). Exit non-zero on any failure.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROPOSED="$(dirname "$HERE")"
# PGBIN=/path/to/postgres/bin overrides (e.g. Homebrew: /opt/homebrew/opt/postgresql@16/bin).
BIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin 2>/dev/null | tail -1 || true)}"
[ -n "$BIN" ] || { echo "no postgres binaries found; set PGBIN" >&2; exit 2; }

WORK="$(mktemp -d /tmp/jobcost-parity.XXXXXX)"
# initdb refuses to run as root: run server commands as the postgres user when we are root.
if [ "$(id -u)" -eq 0 ]; then
  RUNAS=(su postgres -s /bin/bash -c)
  chown postgres "$WORK"
else
  RUNAS=(bash -c)
fi
as_pg() { "${RUNAS[@]}" "$1"; }

SOCK="$WORK/sock"; DATA="$WORK/data"
mkdir -p "$SOCK"; [ "$(id -u)" -eq 0 ] && chown postgres "$SOCK"
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')

cleanup() { as_pg "$BIN/pg_ctl -D $DATA -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$WORK"; }
trap cleanup EXIT

as_pg "$BIN/initdb -D $DATA -U postgres --auth=trust >/dev/null"
as_pg "$BIN/pg_ctl -D $DATA -o \"-p $PORT -k $SOCK -c listen_addresses=''\" -w -l $WORK/pg.log start >/dev/null"
PSQL=("$BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -U postgres -d postgres)

# Minimal stubs: only columns the proposed SQL touches, real types. Nullability is relaxed on
# job_cost_lines (amount, cost_type, approved) and job_product_orders.amount so edge cases the TS handles
# (nulls) can be exercised; the real tables declare these NOT NULL.
"${PSQL[@]}" <<'SQL'
-- Supabase's built-in roles, so the GRANT/REVOKE lines in 001/002 run as they would in prod.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;

CREATE TABLE production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_number text NOT NULL DEFAULT 'T',
  status text NOT NULL DEFAULT 'sold',
  job_type text NOT NULL DEFAULT 'roofing',
  job_source text NOT NULL DEFAULT 'retail',
  sale_amount numeric(12,2),
  sale_date date,
  salesperson_id uuid,
  assigned_sub_id uuid,
  completed_at timestamptz,
  material_cost numeric(12,2),
  labor_cost numeric(12,2),
  dealer_fee_amount numeric(12,2)
);
CREATE TABLE job_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  description text,
  amount numeric(12,2),
  cost_type text,
  status text NOT NULL DEFAULT 'active',
  approved boolean,
  deleted_at timestamptz
);
CREATE TYPE job_product_order_status AS ENUM ('ordered','received','paid','returned');
CREATE TABLE job_product_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  amount numeric(12,2),
  status job_product_order_status NOT NULL DEFAULT 'ordered'
);
CREATE TABLE job_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL
);
SQL
"${PSQL[@]}" -f "$PROPOSED/001_job_cost_summary.sql"
"${PSQL[@]}" -f "$PROPOSED/002_rpt_job.sql"

# Fixtures -> INSERTs (one job per fixture, ids index-derived), run, then compare to expected.
python3 - "$HERE/job-cost-fixtures.json" "$WORK/load.sql" <<'PY'
import json, sys
fx = json.load(open(sys.argv[1]))
q = lambda v: 'NULL' if v is None else ("'" + str(v).replace("'", "''") + "'")
n = lambda v: 'NULL' if v is None else repr(v)
out = []
for i, f in enumerate(fx):
    jid = "00000000-0000-0000-0000-%012d" % (i + 1)
    j = f['job']
    out.append(f"INSERT INTO production_jobs(id,material_cost,labor_cost,dealer_fee_amount,sale_amount) VALUES ('{jid}',{n(j['material_cost'])},{n(j['labor_cost'])},{n(j['dealer_fee_amount'])},20000);")
    for o in f['orders']:
        out.append(f"INSERT INTO job_product_orders(job_id,amount,status) VALUES ('{jid}',{n(o['amount'])},{q(o['status'])});")
    for l in f['lines']:
        ap = 'NULL' if l['approved'] is None else str(bool(l['approved'])).lower()
        out.append(f"INSERT INTO job_cost_lines(job_id,amount,cost_type,approved,description) VALUES ('{jid}',{n(l['amount'])},{q(l['cost_type'])},{ap},{q(l['description'])});")
# Rows that must be ignored: archived and soft-deleted lines on fixture 1, and a payment for the rpt_job smoke test.
out.append("INSERT INTO job_cost_lines(job_id,amount,cost_type,approved,status) VALUES ('00000000-0000-0000-0000-000000000002',999,'misc',true,'archived');")
out.append("INSERT INTO job_cost_lines(job_id,amount,cost_type,approved,deleted_at) VALUES ('00000000-0000-0000-0000-000000000002',999,'misc',true,now());")
out.append("INSERT INTO job_payments(job_id,amount_cents) VALUES ('00000000-0000-0000-0000-000000000001',1000050),('00000000-0000-0000-0000-000000000001',-5025);")
open(sys.argv[2], 'w').write("\n".join(out) + "\n")
PY
"${PSQL[@]}" -f "$WORK/load.sql"

"${PSQL[@]}" -At -c "
SELECT json_agg(r ORDER BY job_id) FROM (
  SELECT j.id AS job_id, s.materials, s.labor, s.permit, s.misc, s.finance, s.direct, s.total,
         s.pending_extras, s.pending_lines, s.sources, s.has_legacy_only
  FROM production_jobs j CROSS JOIN LATERAL job_cost_summary(j.id) s) r" > "$WORK/actual.json"

RC=0
python3 - "$HERE/job-cost-fixtures.json" "$WORK/actual.json" <<'PY' || RC=$?
import json, sys
fx = json.load(open(sys.argv[1])); act = {r['job_id']: r for r in json.load(open(sys.argv[2]))}
keys = {'materials':'materials','labor':'labor','permit':'permit','misc':'misc','finance':'finance','direct':'direct','total':'total','pendingExtras':'pending_extras','pendingLines':'pending_lines','sources':'sources','hasLegacyOnly':'has_legacy_only'}
fails = 0
for i, f in enumerate(fx):
    a = act["00000000-0000-0000-0000-%012d" % (i + 1)]
    bad = []
    for ek, ak in keys.items():
        e, v = f['expected'][ek], a[ak]
        ok = (v == e) if isinstance(e, (list, bool)) else abs(float(v) - float(e)) < 0.005
        if not ok: bad.append(f"{ek}: expected {e!r} got {v!r}")
    print(("PASS  " if not bad else "FAIL  ") + f['name'])
    for b in bad: print("      " + b)
    fails += bool(bad)
print(f"\n{len(fx)-fails}/{len(fx)} fixtures passed")
sys.exit(1 if fails else 0)
PY

echo "--- rpt_job smoke ---"
"${PSQL[@]}" -x -c "SELECT job_id IS NOT NULL AS has_id, sale_amount, total, collected_to_date, balance_due, gross_profit_before_comp, missing_costs, sources FROM rpt_job WHERE job_id='00000000-0000-0000-0000-000000000001'"
"${PSQL[@]}" -At -c "SELECT count(*) || ' rpt_job rows, ' || count(*) FILTER (WHERE missing_costs) || ' missing_costs' FROM rpt_job"
exit $RC
