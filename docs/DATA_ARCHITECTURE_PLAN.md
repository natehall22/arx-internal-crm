# ARX CRM — Data Architecture Plan (reporting you can trust in one query)

Written Oct 9, 2026 from a read of CLAUDE.md, lib/ and supabase/migrations. Goal: any question an owner asks — "what did we net last month", "cost per sale by channel", "which crew makes us the most money per square", "what do we owe Evan" — is answered by one query against one trusted layer, in seconds, with the same number on every screen.

Follow CLAUDE.md: Tesla Algorithm (delete before you add; a second implementation is a bug), nullable/additive schema, org scoping, mandatory review. Nothing here changes pay.

---

## 1. The diagnosis (60,000 ft)

The CRM is an excellent **operational** system (canvass, scheduling, proposals, production, payroll). It is not yet an **analytical** system. Every report re-derives business facts in TypeScript, page by page, in its own way:

| Symptom | Where it shows | Root cause |
|---|---|---|
| Same job shows different profit on different screens | Known Redundancy #11 (5 cost readers) — partly fixed today by `lib/job-costs.ts` | Facts computed in app code per screen instead of once in the database |
| Doors differ between dashboard and Sisu | Redundancy #8 and #13 | Two source lists + two tables for "a door" |
| 5 of 6 September sales landed in channel "Other" | `lib/goals-channel-attribution.ts` buckets on free-text `leads.source` | Attribution is spread across `leads.source` (free text), `lead_sources` table, `campaigns`, `channel`, `canvass_disposition`, `is_self_generated`, `referrals`, inside-sales booker logic — never frozen on the sale |
| Can't say which crew is most profitable | `job_cost_lines` has `vendor_id` but no `work_order_id`/`sub_id`; labor is often one `production_jobs.labor_cost` number per job; two crew models (`crews` table vs `sub_contractors` on `work_orders`, with `assigned_crew_id` retired) | Cost is not tied to the trade/crew that incurred it |
| No net profit, no overhead, no cash view | Budgets/Capital are stubs; QuickBooks not connected | No expense table; no allocation rule |
| Can't see cycle time (signed → materials → install → collected) | Mclaughlin/Schaap sat 10 weeks unordered unnoticed | `production_jobs.status` is overwritten in place; no job status history |
| Numbers move after a month is "done" | Costs entered late, payments back-dated | No period close / snapshot |
| Month boundaries can be wrong | 154 hard-coded `'America/New_York'` (Redundancy #5) | No single org timezone for bucketing |
| Reports are slow and risky | `JOB_ID_CHUNK = 50` loops, 989 manual `.eq('org_id')` (Redundancy #4) | No set-based SQL layer with RLS |

**The fix is one idea:** define each business fact once, in SQL, close to the data, and make every screen, export, owner email and the AI assistant read those definitions. Then fix data capture so the facts are complete.

---

## 2. Target shape: three layers

1. **Operational tables (exist):** leads, canvass_knocks, opportunities, scheduled_appointments, proposals, projects, production_jobs, work_orders (trades), job_cost_lines, job_payments, payroll_*, deal_commission_roles, campaigns, lead_sources, referrals.
2. **Fact views (new, SQL, `security_invoker = on` so RLS applies; materialize the heavy ones nightly + on demand):**
   - `rpt_job` — one row per production job (the "job ledger").
   - `rpt_job_trade` — one row per job × trade (crew/sub level).
   - `rpt_funnel` — one row per opportunity with every stage timestamp and the people/source at each stage.
   - `rpt_rep_day` — one row per rep per day: doors (from `canvass_knocks` only), contacts, sets, sits, sales, hours, pay.
   - `rpt_spend_month` — expenses by month × category × campaign.
   - `rpt_month` — org month: signed, completed, collected, job costs, comp, overhead, net, cash in, AR, AP.
3. **Consumers:** Goals/Reports pages, owner morning email, job profit tracker, payroll, CSV export, and the AI chat (read-only on `rpt_*` only).

Rule: **no new report may query operational tables directly for money or attribution.** If a number is missing, add it to a `rpt_*` view.

---

## 3. Definitions to lock (write them in `docs/METRICS.md` and in view comments)

| Term | Definition |
|---|---|
| Signed revenue | `contract_original` on the sale date (installation agreement signed) |
| Current contract | original + approved change orders + approved supplements |
| Completed revenue | current contract of jobs whose status reached `complete` in the period (Cam's earn-in uses this) |
| Collected | sum of `job_payments` received in the period, by received date |
| Job direct cost | materials + labor/sub + permit + dumpster + misc (one calculator: `lib/job-costs.ts` → mirrored as SQL `job_cost_summary(job_id)`) |
| Finance cost | lender/dealer fee |
| Sales comp | setter + closer + inspector + self-gen + overrides from the payroll snapshot (actual, not % assumption) |
| Owner comp (OPP) | separate line — decide with owners whether it is a job cost |
| Gross profit | current contract − direct cost − finance − sales comp |
| Overhead | expenses with no job (rpt_spend_month) |
| Allocated overhead per job | month's overhead ÷ jobs **completed** that month (Nathan's rule, Oct 9) |
| Net profit per job | gross profit − allocated overhead |
| A door | a `canvass_knocks` row (only) |
| A set / a sit / a sale | inspection appointment created / inspection outcome counted as sat / installation agreement signed |
| Channel | frozen `attribution_channel` on the opportunity at sale (see §5) |

---

## 4. `rpt_job` — the job ledger (build first)

Columns (one row per production job):
- ids: job_id, job_number, project_id, opportunity_id, customer_id, address, zip, city, lat/lng, area (Concord / Kannapolis / …)
- type: job_type, job_source (retail/insurance), carrier, claim_stage, squares sold, squares measured, waste %
- dates: sale_date, materials_ordered_at, first_install_date, completed_at, collected_at (last payment that zeroed balance); derived days: sale→order, sale→install, install→complete, complete→collected
- money: contract_original, change_orders, supplements, contract_current, collected_to_date, balance_due, acv, depreciation
- cost: materials, labor_sub, permit, dumpster, misc, finance, direct_cost_total, cost_complete (bool), cost_sources
- comp: setter_comp, closer_comp, inspector_comp, selfgen_comp, override_comp, opp_comp (each from payroll snapshot; null if not materialized)
- profit: gross_profit, gross_margin_pct, allocated_overhead, net_profit, net_margin_pct, gp_per_square
- people: setter_id, closer_id, inspector_id, sales_manager_id (from `deal_commission_roles` at sale)
- attribution: attribution_channel, lead_source, campaign_id, referring_partner_id, referring_customer_id, is_self_generated
- quality: go_back_count, warranty_count, change_order_count, review_requested_at, review_received_at
- flags: missing_costs, materials_late (>7 days unordered after sale), collection_overdue (>30 days after complete)

Build it as SQL using one `job_cost_summary` function that mirrors `lib/job-costs.ts` exactly (unit-test both against the same fixtures so TS and SQL can never disagree). Then point `/admin/job-profit-tracker`, Goals job economics, ops board profitability and the job Financials card at it, and delete their local math.

---

## 5. Attribution — freeze it at the sale

Add to `opportunities` (nullable): `attribution_channel` enum (door_to_door, self_gen, referral_customer, referral_partner, web_instant_estimate, web_form, yelp, google_ads, lsa, facebook, mailer, call_center, inside_sales, storm, other), `campaign_id`, `referring_partner_id`, `referring_customer_id`, `attribution_locked_at`.
- Set on create from the lead (one resolver replacing `resolveLeadChannel` + `leadSourceLabel` + booker logic); **required before an opportunity can be marked Won**; locked at sale.
- Backfill the 41 jobs with a reviewed script (Nathan confirms ambiguous ones).
- Collapse the door definitions (#8, #13) into one module; doors come only from `canvass_knocks`.
- Add `referral_partners` + `partner_touches` (partner hour) and link `referrals` to them.

---

## 6. Crew / trade profitability — what's missing and the fix

Today: trades exist (`work_orders` with `trade`, `assigned_sub_id`, `install_days`, crew photo link), but cost is not attached to a trade, revenue is not split by trade, and quality isn't counted per sub. So "which crew is most profitable" can't be answered.

Add (nullable/additive):
1. `job_cost_lines.work_order_id` (FK to the trade) and `job_cost_lines.sub_id` (denormalized for speed). Labor/sub lines require a trade when the job has trades.
2. On trade completion (`Mark done`), require the sub's invoice amount → creates the labor cost line for that trade (attach invoice photo). Material cost lines may stay job-level, or carry trade for gutters/siding.
3. Revenue by trade: tag each `proposal_line_items` row with `trade` (roofing/gutters/siding/windows/other; default from category) so `rpt_job_trade.revenue` = sum of sold lines for that trade (+ pro-rata change orders).
4. `rpt_job_trade` columns: job, trade, sub_id, sub_name, scheduled/completed dates, install_days planned vs actual (from crew-link photo timestamps), squares (roofing), revenue_trade, labor_cost, material_cost_trade, gross_profit_trade, labor_per_square, go_backs (work_orders type go_back/warranty on same project+trade within 12 months), photo_compliance (4/4), change_orders_found_on_site, customer review score if any.
5. Crew scorecard view `rpt_sub_scorecard` (per sub, rolling 90 days / YTD): jobs, squares, avg labor $/sq, avg gross margin on their trades, go-back rate, on-time rate, photo compliance, avg days on site. Show on `/admin/subs`.
6. Retire one crew model: either delete the legacy `crews` table usage (assigned_crew_id is already retired) or make `crews` the sub's teams. Pick one (Tesla step 2).

---

## 7. Money that isn't jobs

- `org_expenses` (from the survey spec, module 1) + `rpt_spend_month`; seed recurring items; later pull from QuickBooks.
- `rpt_month`: signed, completed, collected, direct cost, comp, overhead, net; AR (balance_due on completed jobs); AP (QXO due on the 20th = materials on jobs installed last month; editable actual).
- Overhead allocation per §3 so each job shows net profit; the Evan buyout tracker reads `rpt_job.net_profit` for the four named jobs.
- Owner obligations (Evan, Cam earn-in) read only from `rpt_job` / `rpt_month`.

---

## 8. History, close and time

- `production_job_status_events` (job_id, from, to, at, by) written by the one status-change path; backfill from notes/timestamps where possible. Enables cycle-time and "stuck" alerts.
- Same for opportunities if not already captured.
- **Monthly close:** `period_closes` (org, month, closed_at, closed_by) + `rpt_job_snapshot` / `rpt_month_snapshot` frozen at close. Changes after close show as adjustments in the next month.
- **One org timezone** (Redundancy #5): `orgs.timezone`, and every `rpt_*` view buckets dates with it.

---

## 9. Capture quality gates (data is only as fast as it is complete)

| Transition | Required |
|---|---|
| Lead → Opportunity | lead source / channel |
| Opportunity → Won | attribution locked; setter/closer/inspector roles; job_source; carrier + claim # if insurance |
| Sold → Materials | material order or cost line within 7 days (alert after) |
| Trade → Done | 4 photos + sub invoice amount (creates labor line) |
| Job → Complete | approved material + labor cost lines; color/scope sign-off file |
| Job → Collected | balance_due = 0 (or write-off with reason) |
| Month → Closed | no completed job with missing costs |

---

## 10. Speed and safety

- Views with `security_invoker = on` and existing RLS; materialized views refreshed nightly (cron, `CRON_SECRET` pattern) and on demand from Reports.
- Indexes: (org_id, sale_date), (org_id, completed_at), job_cost_lines(job_id, work_order_id), job_payments(job_id, received_at), canvass_knocks(org_id, user_id, knocked_at).
- Scoped query helpers per table (Redundancy #4) for the remaining operational reads.
- The AI chat gets a read-only role on `rpt_*` only, plus `docs/METRICS.md` as context, so "which crew makes the most per square this quarter" is one SELECT.

---

## 11. Build order

1. **Finish #11** (already underway today: `lib/job-costs.ts`, migration `202610090001`, `scripts/migrate-orders-to-cost-lines.ts`). Then SQL `job_cost_summary()` mirroring it, with shared fixtures.
2. `rpt_job` + switch the 5 money readers to it. Delete local math.
3. Attribution freeze (§5) + backfill 41 jobs + collapse door definitions.
4. Status events + org timezone.
5. Trade-level cost + revenue (§6) + `rpt_job_trade` + sub scorecard.
6. `org_expenses`, `rpt_spend_month`, `rpt_month`, overhead allocation, net per job.
7. Period close + snapshots.
8. Owner email, Goals, AI chat read `rpt_*` only.

Each step ships alone, with tests, review, and a short note in CLAUDE.md (and the Known Redundancy rows it closes).
