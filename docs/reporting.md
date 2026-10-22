# Reporting (v1)

**One definition per metric:** `supabase/migrations/202610220010_reporting_views.sql` creates `rpt_*` views (`security_invoker`): Jobs, Sales, Payments, Job costs, Payroll lines, Canvass doors, Appointments, Leads, Opportunities, Referral partners. Profit, collected, balance due, aging, "sat", "sold" are columns in the views — screens, CSV and emails read them, nothing recomputes them.

**One runner:** `lib/reporting/run.ts` → org fence on every query, viewer scope (own / team / region / all, from existing report permissions), finance-only fields (cost, margin, pay, whole datasets for payroll and job costs) hidden from everyone but `admin/owner/operations`/full-access in rows, filters, grouping, sorting and CSV. CSV needs `reports:export` and neutralises spreadsheet formulas.

**UI:** `/reports/explore` — 24 templates (sales by closer/setter/month/source, close % by setter/closer, sit rate, doors, leads, money collected, AR aging, profit by job/month, costliest jobs, costs by type, payroll by period/person, referrals…), date range, group-by, "show" (count / total / average / % / the list), table ↔ chart, click a bar or row to drill to the underlying rows, Download CSV, Save (+ email every morning).

**Saved/scheduled:** `saved_reports` (org-scoped, `shared_roles`, `schedule`). `lib/reporting/scheduled.ts` is called from the existing morning-update cron; each report runs AS ITS CREATOR so a recipient never sees more than the creator could.

## Deploy
1. Apply migration 202610220010 (views + `saved_reports`; additive). 2. Deploy. Cost numbers are only right once the cost-ledger data fix (#57) has run — `rpt_jobs.cost_total` reads the same ledger.

## Not done (decisions)
- **Reports Overview zeros** (`app/reports/page.tsx` queries ~25 tables through the browser client, which has no Supabase session under our cookie auth). A thin proxy would re-implement scope enforcement; the clean fix is to retire those tiles onto `/reports/explore` templates (sales/appointments/doors/leads are all there). Your call.
- **Old builder** (`/reports/builder`, `/api/reports/builder|custom`, 2 saved reports in prod): not deleted — the 2 reports need re-creating as saved reports first.
- **Supplier orders dataset**: its tables ship with the email-order-sheet PR (#58); add `rpt_supplier_orders` once that merges.
- Excel export = CSV (opens in Excel). Sharing is by role at save time via API; the UI only exposes "email it".
- Aggregation happens in TypeScript over ≤50k rows per run (views hold the definitions; at larger volume push grouping into SQL).
