Read CLAUDE.md and docs/DATA_ARCHITECTURE_PLAN.md. Follow CLAUDE.md rules exactly (Tesla Algorithm, nullable/additive schema, org scoping, never change pay, mandatory bug-bot + collateral sweep + /code-review + /security-review).

Start with Step 1 and Step 2 only:
1. Confirm the state of Known Redundancy #11 (lib/job-costs.ts, migration 202610090001, scripts/migrate-orders-to-cost-lines.ts). Report what is done and what remains; do not re-implement.
2. Write SQL function `job_cost_summary(job_id)` that mirrors `summarizeJobCosts` exactly, plus shared test fixtures run against BOTH the TS and SQL versions.
3. Create view `rpt_job` (security_invoker = on) with the columns in §4 that existing data can fill today; leave the rest null with a comment naming the step that fills them.
4. Show me a diff of rpt_job vs the current /admin/job-profit-tracker totals for all 41 jobs (contract, costs, GP) and explain every difference over $1. STOP for my review before switching any screen to rpt_job.
