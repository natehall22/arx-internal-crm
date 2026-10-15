# ARX CRM — Company-Level Plan (Oct 9, 2026)

How the CRM should run ARX as a company, not just as a set of tools. Companion docs:
`SURVEY_TO_CRM_SPEC.md` (8 modules), `DATA_ARCHITECTURE_PLAN.md` (reporting layer),
`JOB_COST_CONSOLIDATION_PROMPT.md` (Known Redundancy #11).

Status legend: **Built** (in repo, not wired) · **Next** · **Later**.

---

## 1. The one question the CRM must answer every Monday

> How many jobs did we sign, complete and collect last week; what did each one make after costs,
> comp and overhead; where did they come from; and what is the pipeline for the next 30 days?

Today the answer takes hours across the CRM, the tracker sheet, Gmail, texts with Becky and the bank.
Everything below exists to make that a single page.

## 2. Lead-to-cash — one path, one owner per stage

| Stage | Record | Owner today | Must be captured (gate) |
|---|---|---|---|
| Lead | `leads` | Nathan / setters / web | source + channel (resolveLeadChannel) |
| Set | `scheduled_appointments` | setter / Nathan | lead linked |
| Sit / inspection | inspection outcome | closer (Nathan, Cam) | outcome + photos |
| Sale | `opportunities` → won, contract | closer | **attribution frozen** (channel, campaign, referrer) |
| Job | `production_jobs` | Steve (ops) | sale_amount, salesperson, job_type, job_source |
| Materials | product order / cost line | Steve | material cost entered within 7 days of order |
| Install (per trade) | `work_orders` trade | Steve + sub | sub, date, 4 photos, **sub invoice amount** |
| Complete | job status `complete` | Steve | all trades done, costs complete (starts payroll) |
| Collect | `job_payments` | Andrew / Becky | every payment logged with date + type |
| Review / referral | customer success | Nathan / Cam | review ask sent, referral ask sent |

Rule: each stage has exactly one write path. A stage that can be written two ways (Known Redundancy
#10, #11) is a bug, not flexibility.

## 3. Roles and what each sees

| Role | People | Lives in | Sees money? |
|---|---|---|---|
| Owners | Nathan, Steve, Andrew | Owner scoreboard, job ledger, obligations | Yes, all |
| Earning-in partner | Cam | His pipeline, team, his earn-in statement | His own + statement |
| Closers | Nathan, Cam | Opportunities, proposals, calendar | Own commissions |
| Setters / canvass | (recruiting) | Canvass app, Sisu | Own pay |
| Ops | Steve | Ops board, schedule, subs | Job cost (ops-access) |
| Back office | Andrew, Becky (bookkeeper) | Payments, expenses, close | Yes |
| Subs | crews | Crew photo link only | No |
| Customers | — | Contract, payment, completion cert | Their job only |

Access stays on `PAYROLL_ADMIN_ROLES` / ops-access; partner numbers are owners-only. Never widen those sets.

## 4. Data layer (from DATA_ARCHITECTURE_PLAN.md)

1. **One cost calculator** — `lib/job-costs.ts` (Nathan, Oct 9). **Built.**
2. **SQL mirror + `rpt_job` view** — `supabase/proposed/` with a 30-fixture TS↔SQL parity test. **Built, not applied.**
3. **Job ledger, overhead allocation, sub scorecard, partner calculators** — `lib/reporting/`. **Built, not wired.**
4. **Attribution frozen at sale** — extend the existing `resolveLeadChannel` (do not add a second resolver). **Next.**
5. **`org_expenses` + month close** — overhead, ad spend, software, BBB, Indeed, G Suite. **Next.**
6. **Trade-level cost** (`job_cost_lines.work_order_id`, sub invoice on "Mark done"). **Later** — needed to score gutter/siding crews.
7. **Status events + period close** (`production_job_status_events`, locked months). **Later.**

## 5. Phased roadmap

**Phase 0 — this week (no code risk):** Steve enters missing material/labor and sub invoice amounts on
every completed job (the ledger can't score a crew without labor); Becky sends the monthly overhead list;
owners confirm the open questions in §7.

**Phase 1 — numbers you can trust (2–3 PRs):**
1. Finish #11: point job page Financials, ops board, profit tracker and payroll materialization at
   `summarizeJobCosts`; delete their local math.
2. Wire `buildJobLedger` into `/admin/job-profit-tracker` (gross profit; net blank until overhead exists).
3. Apply `supabase/proposed/` as a migration after review.

**Phase 2 — the company P&L:**
4. `org_expenses` table + simple entry screen (Becky/Andrew); monthly overhead map → net profit per job.
5. Owner scoreboard: signed / completed / collected / net, this month vs goal (`org_monthly_goals`).
6. Sub scorecard on `/admin/subs`.

**Phase 3 — growth engine:**
7. Attribution freeze + campaign ROI (cost per lead, per sit, per sale, per $ of profit by channel).
8. Referral partners (realtors, insurance agents) + partner-hour logging; customer review/referral automation.
9. Recruiting pipeline (Indeed applicants → interview → hired → ramp) and rep ROI.

**Phase 4 — obligations:** owners-only page for Evan buyout (`computeBuyout`) and Cam's quarterly
earn-in statement (`computeEarnIn`) — the agreement requires Nathan to send one each quarter.

## 6. Safety rules for every step

- Additive, nullable schema only; nothing under `supabase/proposed/` applies until copied into a migration.
- Every change: bug-bot agent + collateral-impact agent + `/code-review` + `/security-review`.
- Never change what anyone is paid without Nathan (do not wire `deductible_costs_total` into comp).
- Delete before add: when a page moves to the ledger, its old math is removed in the same PR.
- Redundancy spotted while building this: `EASTERN_TZ` (lib/eastern-datetime.ts) and `DEFAULT_TIMEZONE`
  (lib/timezone.ts) are the same constant — fold into Known Redundancy #5. `getEasternDateIso` shifts a
  bare DATE string one day earlier; `businessDateKey` in lib/reporting guards it.

## 7. Open questions for owners

1. Monthly overhead list — **none for now (Oct 9)**; ledger shows gross profit, net stays blank until overhead is entered.
2. ~~Is OPP 9% a job cost?~~ **Yes — job cost (Nathan, Oct 9).** Open: 9% of sale amount (profit tracker) or of commissionable (CLAUDE.md)?
3. Evan: confirm fixed amount, share %, the four jobs, installments, and whether losses reduce the total. Net cash = what's left after everyone is paid, incl. the 4-way owners draw per the Google sheet (confirmed Oct 9).
4. Cam: confirm Section 7 stage-2 reading (best 12-month window after vesting) and which recruits count.
5. Who owns `org_expenses` entry — Becky or Andrew — and by what day each month?
6. Found in `/admin/job-profit-tracker` (page.tsx ~L258-268), not changed: gross profit subtracts only the
   6% sales override — the setter 5% and closer 7% are computed but not subtracted. Intended (sheet parity)
   or a bug? The ledger subtracts the full 18% pool. (Owner draw `/ 4` is intended — 4-way draw per the sheet.)
