# Reporting (v1)

**One definition per metric:** `supabase/migrations/202610220010_reporting_views.sql` creates `rpt_*` views (`security_invoker`): Jobs, Sales, Payments, Job costs, Payroll lines, Canvass doors, Appointments, Leads, Opportunities, Referral partners. Profit, collected, balance due, aging, "sat", "sold" are columns in the views — screens, CSV and emails read them, nothing recomputes them.

**One runner:** `lib/reporting/run.ts` → org fence on every query, viewer scope (own / team / region / all, from existing report permissions), finance-only fields (cost, margin, pay, whole datasets for payroll and job costs) hidden from everyone but `admin/owner/operations`/full-access in rows, filters, grouping, sorting and CSV. CSV needs `reports:export` and neutralises spreadsheet formulas.

**UI:** `/reports/explore` — 24 templates (sales by closer/setter/month/source, close % by setter/closer, sit rate, doors, leads, money collected, AR aging, profit by job/month, costliest jobs, costs by type, payroll by period/person, referrals…), date range, group-by, "show" (count / total / average / % / the list), table ↔ chart, click a bar or row to drill to the underlying rows, Download CSV, Save (+ email every morning).

**Saved/scheduled:** `saved_reports` (org-scoped, `shared_roles`, `schedule`). `lib/reporting/scheduled.ts` is called from the existing morning-update cron; each report runs AS ITS CREATOR so a recipient never sees more than the creator could.

## Deploy
1. Apply migration 202610220010 (views + `saved_reports`; additive). 2. Deploy. Cost numbers are only right once the cost-ledger data fix (#57) has run — `rpt_jobs.cost_total` reads the same ledger.

## Not done (decisions)
- ~~**Reports Overview zeros**~~ DONE: the Overview tab is now KPI cards + 6 template tiles read through the one runner (the old ~25 browser queries, the old builder UI/APIs and the old Excel export route are deleted). The 2 old custom reports are recreated by `supabase/data-fixes/2026-10-22_recreate_saved_reports.sql`; the dashboard 'Custom Reports' tiles now read saved reports with `dashboard_widget`. Old tables `custom_reports`/`report_schedules` are left in place.
- (old note) **Reports Overview zeros** (`app/reports/page.tsx` queries ~25 tables through the browser client, which has no Supabase session under our cookie auth). A thin proxy would re-implement scope enforcement; the clean fix is to retire those tiles onto `/reports/explore` templates (sales/appointments/doors/leads are all there). Your call.
- ~~**Old builder**~~ deleted. (old note) **Old builder** (`/reports/builder`, `/api/reports/builder|custom`, 2 saved reports in prod): not deleted — the 2 reports need re-creating as saved reports first.
- **Supplier orders dataset**: its tables ship with the email-order-sheet PR (#58); add `rpt_supplier_orders` once that merges.
- Excel export = CSV (opens in Excel). Sharing is by role at save time via API; the UI only exposes "email it".
- Aggregation happens in TypeScript over ≤50k rows per run (views hold the definitions; at larger volume push grouping into SQL).

## Known differences from existing definitions (from review; fix by converging, not by adding a third)
- **Sit (resolved here):** `rpt_sits` / `rpt_inspection_sets` now carry the dashboard definitions (sits = latest effective outcome in the org's counts_as_sit set; sets = inspection/untyped, not cancelled). `rpt_canvass_doors` uses the same door-eligibility test as the RPCs. Remaining: `rpt_sits` lacks the one-opportunity-per-lead cap and the TS default outcome list. (old note) **Sit:** `rpt_appointments.was_completed` is appointment status. The goals scorecard/dashboard sit = org-configured inspection outcomes (`getSitOutcomeNormalizedIdSet`) keyed on `opportunities.inspection_outcome_at`. Reports will not match those until the sit definition is moved into one SQL view (Redundancy #8/#14).
- **Doors/leads:** `rpt_canvass_doors` (canvass_knocks, credited to the actual knocker — the direction #8 wants) excludes only `solar_import`; `rpt_leads` owner is the current `owner_user_id` (not the CLAUDE.md transfer-cutoff rule) and includes non-door sources. Treat Leads as leads, not doors.
- **Sales credit:** `rpt_sales` credits the opportunity's current owner/setter; payroll uses per-job overrides.
- **Profit:** `rpt_jobs` uses the cost-ledger rule from #57 (live lines + dealer fee, no approval gate).
- Hidden/inactive users (`show_in_reports`, `active`) are not filtered; month/age math uses the database's UTC date.
- Scheduled emails go with the Mon–Sat morning window ("daily" = Mon–Sat).
- Sales view is one row per completed contract (a split cash/finance deal with two installation agreements counts twice — same as the dashboard today); setter-credited rows are visible only to the closer's scope (own-scope setters see none).
- Month/week grouping and "this year" use UTC; rows with no date drop out of any dated preset.
- Scheduling an email needs `reports:export`, goes only to active team members, and is re-checked at send time.

## Dashboard, Sisu and goals read the views (2026-10-23)
`lib/reporting/period-metrics.ts` (`fetchPeriodMetricRows`) is the one place the Dashboard's weekly numbers (doors, contacts, inspections set / received, sits, sales, calendar appointments), the team leaderboard, the Sisu live metrics and the goals scorecard's door counts come from. Who-sees-whose-numbers filtering stays in each screen. `npx tsx scripts/dashboard-views-compare.ts` (read-only, needs the service key) prints old → new for any window.
**Not migrated (on purpose):** goals forecast history for sets/sits/sales and the scorecard's channel attribution (they need lead ids the views don't carry), payroll sit/period logic (`lib/comp-plan-period-unit-earnings.ts` — pay must not move), the Sisu badge counters (`lib/sisu-weekly-doors.ts`, `lib/sisu-monthly-closed-sales.ts`), `/api/dashboard/team-stats`.
