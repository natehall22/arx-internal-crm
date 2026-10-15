# Proposed SQL reporting layer (NOT applied)

| File | What |
|---|---|
| `001_job_cost_summary.sql` | `public.job_cost_summary(job_id)` - SQL mirror of `summarizeJobCosts` in `lib/job-costs.ts` |
| `002_rpt_job.sql` | `public.rpt_job` view: one row per `production_jobs` row with cost summary, collected, balance, gross profit before comp, `missing_costs` |
| `test/job-cost-fixtures.json` | Shared parity fixtures (inputs plus expected output computed by running the TS function) |
| `test/run_parity.sh` | Throwaway-Postgres parity test |

These live here, not in `supabase/migrations/`, so nothing applies them automatically. Nothing in the app reads them yet.

## Run the parity test

```
supabase/proposed/test/run_parity.sh
```

Needs Postgres server binaries (Linux `/usr/lib/postgresql/*/bin`, Homebrew `postgresql@N`, or set `PGBIN=/path/to/bin`) and `python3`. It creates a temporary cluster (as the `postgres` OS user when run as root), builds stub tables with only the columns used, loads 001 and 002, inserts each fixture as a job, compares every output field (cents, `sources`, flags), smoke-queries `rpt_job`, prints PASS/FAIL per fixture, exits non-zero on any failure, and removes the cluster.

## Apply later

1. Review both files and a green parity run.
2. Copy into a new timestamped migration (e.g. `supabase/migrations/2026MMDDNNNN_job_cost_reporting.sql`), 001 first then 002. Both are `CREATE OR REPLACE` and additive.
3. Grants: both files already `REVOKE` from `anon`/`authenticated` and grant only `service_role` — read `rpt_job` from a server route that checks finance/ops access. Previously noted: the view is `security_invoker`, so callers need RLS access to `production_jobs`, `job_payments`, `job_cost_lines`, `job_product_orders`. Consider who may see cost data (see ops-access redaction in the app) before exposing it to non-finance roles.

## Lockstep rule

`lib/job-costs.ts` is the source of truth. Any change to precedence, filters, fee-line regex or rounding must change the SQL in the same PR, with a new fixture in `job-cost-fixtures.json`. To regenerate expected values, run `summarizeJobCosts` / `netProductOrdersTotal` over the fixture inputs (scratch copy of `lib/job-costs.ts` + `lib/money.ts` with the `@/lib/money` import rewritten to `./money`, run with `npx tsx`).

## Known differences

- Rounding: JS `Math.round(x*100)/100` rounds exact .5 cents toward +infinity (-0.125 -> -0.12); Postgres `round(numeric, 2)` rounds half away from zero (-0.125 -> -0.13). Positive values agree. Also, TS sums IEEE floats while SQL sums exact numerics; amounts are `numeric(12,2)` so sums are exact in SQL and differences can only appear at float noise near a half-cent boundary.
- Null `cost_type`, `approved`, `amount` cannot occur in the real tables (all NOT NULL); they are handled to mirror TS and are only exercised against the relaxed test stubs.
- `rpt_job` has no commissions or overhead: those live in TS (`lib/goals-job-economics.ts`, `lib/reporting/`). `gross_profit_before_comp` is sale minus total cost (including finance) only.
- `production_jobs` has no `deleted_at` or `opportunity_id` in any migration, so `rpt_job` does not filter soft deletes and omits `opportunity_id`.
