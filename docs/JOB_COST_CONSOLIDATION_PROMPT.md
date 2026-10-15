# Claude Code prompt: consolidate job costs onto job_cost_lines (Known Redundancy #11)

Read CLAUDE.md first and follow it exactly (Tesla Algorithm, nullable/additive schema only, requireAuth/requireAuthApi, org scoping on every query, PAYROLL_ADMIN_ROLES unchanged, mandatory bug-bot + collateral sweep + /code-review + /security-review).

## Problem (CLAUDE.md Known Redundancy #11, audited in prod 2026-09-07)
A job's cost has 2 write paths and 5 readers that disagree:
- Writes: "+ Job Cost" on the Materials tab → `job_product_orders`; "+ Add cost line" under Photos & files → `job_cost_lines`.
- Readers: job page Financials card (`JobDetailClient.tsx` ~L1206-1228, reads only `job_product_orders`); ops board `getProfitability()` (`OpsClient.tsx` ~L210-228, reads stale `production_jobs.material_cost`, overwritten by the 2026-07-08 bulk import); `/admin/job-profit-tracker` (~L316-347, adds misc/other/permit cost lines on top of the material column); `lib/goals-job-economics.ts` (same pattern); `lib/payroll-period-materialization.ts`.
- Known bad data: 26-0041 has the same $5,421.03 "Interior Work" in both tables; 26-0013 has the same $918 lending fee twice (35s apart); 26-0012/0022/0018/0010 carry $1,774.70 of cost lines the job page ignores.
- Payroll landmine: unapproved `job_cost_lines` rows with `deduct_from_commission_base=true` (the default) block payroll materialization (`derivePayrollEligibility` → `missing_costs`).

## Goal
One source of truth for job cost: `job_cost_lines` (it has cost_type, approval, attachments). One shared function computes a job's costs, and all five readers use it. Same number everywhere.

## Hard constraints
- Do NOT change what anyone is paid. Do NOT wire `deductible_costs_total` into the commission base. Do NOT change `derivePayrollEligibility` behavior except where Nathan approves in Phase 4.
- No destructive migration. Never delete `job_product_orders` rows or the `production_jobs.material_cost` column in this work; mark them legacy.
- Stop and show Nathan the dry-run report before writing any data. Nathan's sign-off is enough before Phase 3 (Andrew's sign-off was dropped 2026-10-09).

## Phase 1 — Read-only audit (no writes)
1. Map every read and write of `job_product_orders`, `job_cost_lines`, and `production_jobs.material_cost` across app/, lib/, components/, scripts/, supabase/ (functions, triggers, views, RLS).
2. Script `scripts/audit-job-costs.ts` (read-only) that prints, per job: contract, product_orders total, cost_lines total by cost_type, material_cost column, and the cost each of the 5 readers currently shows. Flag: (a) likely duplicates (same amount ±$1 and similar description across the two tables or within cost_lines inside 10 min), (b) jobs where readers disagree by > $50, (c) completed/collected jobs with $0 materials (e.g., 26-0047 Jones, 26-0038 Schaap, 26-0045 Alvey, 26-0046 Cox), (d) unapproved deduct_from_commission_base lines.
3. Output a CSV + summary to tmp/ and stop. Show me the summary.

## Phase 2 — Shared calculator (code only, no data changes)
1. Create `lib/job-costs.ts` exporting `getJobCostSummary(jobId)` / a batch variant returning { materials, labor, permit, dumpster, sub, misc, finance, total, sources[], hasLegacyOnly }. Source = `job_cost_lines` (approved + pending shown separately) plus, ONLY until migration completes, any `job_product_orders` rows not already mirrored (dedupe by a `source_product_order_id` link column — add it nullable).
2. Point all 5 readers at it. Delete the per-reader math (Tesla step 2).
3. Unit tests: no double count when the same cost exists in both tables; 26-0041-shaped fixture totals $5,421.03 once; pending vs approved split; legacy-only job.
4. Keep the Financials card's interim "Cost lines (Photos & files)" row only if still needed after this; otherwise remove.

## Phase 3 — Migration (after Nathan's sign-off on the Phase 1 report)
1. Additive migration: `job_cost_lines.source_product_order_id uuid null`, unique where not null.
2. Dry-run script: for each `job_product_orders` row with no mirrored cost line, propose a `job_cost_lines` row (cost_type 'material', amount, description, date, attachments link). Print proposed inserts + any duplicate it would skip. Write nothing.
3. On approval: run in a transaction per job, idempotent (re-runnable), logging to a migration table. Then re-run the audit; every reader must show the same total.
4. Resolve known duplicates (26-0041, 26-0013) by marking the extra line void/rejected with a note — never hard delete — after Nathan confirms which one stays.

## Phase 4 — One write path in the UI
1. "+ Job Cost" on the Materials tab writes a `job_cost_lines` row (cost_type material), not `job_product_orders`. Keep the material ORDER sheet (quantities) separate from COST.
2. Make the default for new lines explicit and visible; show a banner on any job whose payroll is blocked by unapproved cost lines, with a one-click approve for admins. Ask Nathan before changing the `deduct_from_commission_base` default.
3. Add a guard: job cannot move to Complete/Collected without at least one approved material and labor cost line (admin override with reason).

## Done when
- Audit shows 0 jobs where readers disagree.
- 26-0041 and 26-0013 each count their cost once.
- Job page, ops board, profit tracker, goals and payroll show identical totals.
- Tests pass; CLAUDE.md Known Redundancy #11 updated to "resolved" with the date, and remaining legacy columns documented.
