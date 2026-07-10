# Build: Admin Goals & Forecast (`/admin/goals`)

You are building a new C-suite Goals & Forecast surface for the ARX Internal CRM (Next.js 14 App Router, TypeScript strict, Supabase Postgres 17). Owners set monthly company goals, review a one-page monthly scorecard, and see a data-grounded forecast. This doc is the full spec — where it says VERIFY, check the codebase/DB before coding; do not guess.

## Non-negotiable repo rules (from CLAUDE.md — violating these fails review)

- Auth: `requireAuth()` (pages) / `requireAuthApi()` (API) from `lib/auth.ts` only. **`requireAuthApi()` THROWS on failure** — wrap in try/catch → return 401. Never raw `supabase.auth.getUser()`.
- All schema changes **additive/nullable** — the system is live. New tables are fine; never alter existing columns.
- Migrations: write SQL files under `supabase/migrations/` but DO NOT run `supabase db push` (CLI is blocked by migration-history drift). Nathan applies them via Supabase MCP `apply_migration`. Say so in your handoff notes.
- Text contrast: explicit dark text `#2c2c2a` on light surfaces, never generic gray for values. WCAG AA.
- Tests run with **jest** (`npm test`), not vitest.
- Every change gets a proactive bug-bot review + collateral-impact sweep before you call it done.

## Access control

Page and all APIs are **admin/owner only**: gate with `isOrgSuperuserRoleSlug(profile.role)` from `lib/permissions.ts` (covers both `admin` and `owner` slugs). Page: 404 via `notFound()` for everyone else. APIs: 403. Do not add a nav item — this lives as a new card on the Admin grid (`app/admin/page.tsx`, VERIFY exact card component pattern there; title "Goals & Forecast", subtitle "Monthly targets, scorecard, and revenue forecasting").

## Why this is new (don't confuse with existing goals code)

- `coaching_goals` table + `/api/coaching/goals` = per-rep income calculator. Leave untouched.
- `user_incentive_goals`, `app/api/admin/sisu/goals` = Sisu incentive goals. Leave untouched.
- There is currently **no org-level monthly goal storage**. You are creating it.

## Data model (new migration, one file)

```sql
-- org monthly goals: one row per org per calendar month
CREATE TABLE org_monthly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  month date NOT NULL,                    -- always first-of-month
  doors_target integer,
  sets_target integer,
  sits_target integer,
  sales_target integer,
  revenue_target numeric(12,2),           -- signed contract value
  notes text,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month)
);
ALTER TABLE org_monthly_goals ENABLE ROW LEVEL SECURITY;
-- RLS: org members read, superusers write — copy the policy shape used by permission_presets (VERIFY).
```

Every goal save also appends an audit row. There is an existing `goal_audit_log` table (migration `202506090004_goal_audit_log`) — VERIFY its schema; if it's generic enough (entity/field/old/new/user), append there with a distinct entity type; if it's Sisu-specific, create `org_monthly_goal_audit` (goal_id, changed_by, changes jsonb, created_at) in the same migration. Do not repurpose Sisu columns.

## Metric definitions — reuse the canonical libs, do NOT reinvent

These already exist and the dashboard/leaderboard/payroll trust them. The scorecard MUST produce numbers consistent with them:

| Metric | Source of truth |
|---|---|
| **Doors knocked** | `leads` rows passing `isCanvassDoorLead()` from `lib/sales-metrics.ts`, counted by `created_at` in period |
| **Sets** | `scheduled_appointments` rows passing `countsAsInspectionSet()` from `lib/inspection-set-metrics.ts` (`appointment_type` null/'inspection', not cancelled), counted by `scheduled_for` in period |
| **Sits** | `fetchEffectiveSitOpportunitiesInPeriod()` from `lib/dashboard-sit-metrics.ts` (org-configured sit outcomes; merges `inspection_status_updates`) |
| **Sales** | signed `order_form_contracts`: `customer_signed_at` in period, `agreement_type IN ('installation','repair')` (`SALE_AGREEMENT_TYPES` in `lib/sales-metrics.ts`). VERIFY whether existing dashboards also filter `status` |
| **Revenue (signed)** | sum of `order_form_contracts.project_cost` over the sales rows above |
| **Revenue (collected)** | sum of `invoice_payments.amount` with payment date in period (VERIFY date column name) |
| **Costs + gross/net profit** | Compute **CRM-natively** from job records: per job, costs = `production_jobs.labor_cost + production_jobs.material_cost`, plus approved, non-deleted `job_cost_lines` rows for that job **only for cost types not already covered by those two columns** (avoid double-counting — VERIFY how the costs panel distinguishes them). Commissions = 5% setter + 7% closer + 6% sales override on commissionable amount (sale − dealer fee / finance cost — VERIFY `commission_comp_base` semantics on `production_jobs` and prefer it when populated). Net = sale − costs − commissions. Do NOT couple this to `app/admin/job-profit-tracker/page.tsx` — that page mirrors an external Sheets model and may change independently. Attribute jobs to a month by `sale_date` (fallback `created_at`). Cost backfill is being verified separately — the scorecard MUST show a per-month data-quality line ("N of M jobs this month missing cost data") instead of silently undercounting |

**Channel attribution** (sets + sales + revenue split): resolve each set/sale to its lead, bucket by:
- `canvass` — lead passes `isCanvassDoorLead()`
- `inside_sales` — lead `channel = 'inbound'` OR source in `('web','call_in','ad_campaign','facebook-ad','Website Contact Form','inbound','call_center')` OR the appointment was booked by a call-center user (VERIFY whether `scheduled_appointments` has a creator column — if not, lead-based bucketing only, and say so in the UI footnote)
- `other` — everything else (csv_import, null source)

Bucket rules live in one exported function in the new lib so tests pin them.

## Pages / UX — one route, three tabs, everything fits one screen per tab

`app/admin/goals/page.tsx` (server component wrapper doing `requireAuth()` + role gate + org fetch) → client component with tabs:

### Tab 1 — Scorecard (default; opens on LAST month)
- Month picker (any past/current month).
- KPI row (6–8 stat tiles): Doors, Sets, Sits, Sales, Revenue signed, Revenue collected, Costs (labor + materials + commissions from the job-profit lib), Net profit. Each tile: big value in `#2c2c2a`, goal underneath ("goal 40 · 87%"), green/amber/red attainment tint (≥100% green, ≥70% amber, else red — subtle backgrounds, AA contrast).
- Funnel strip: Doors → Sets → Sits → Sales with conversion % between stages and the trailing-90-day average % beneath each for context.
- Channel table: rows = canvass / inside sales / other; columns = Sets, Sales, Revenue. Footnote the attribution rule.
- Everything server-computed in one API call; no client-side metric math.

### Tab 2 — Goals
- Month picker (current or future months editable; past months read-only display).
- Form: doors, sets, sits, sales, revenue targets + notes. "Copy from previous month" button. Save shows who/when last updated.
- Optimistic UI not required — plain save + reload is fine.

### Tab 3 — Forecast
- Range picker: presets **This month (MTD → EOM)**, **This quarter**, **Last quarter vs this quarter**, plus custom start/end.
- Weekly trend chart (sets, sits, sales as series; SVG or minimal charting consistent with whatever the dashboard already uses — VERIFY, don't add a new chart dependency).
- Projection panel per metric: actual-to-date, projected end-of-range, goal, gap, and **"needed per remaining week to hit goal"**.
- Assumptions panel (always visible, small text): every rate used, its trailing window, and its sample size — e.g. "sit rate 71% (n=34, trailing 90d)". This is the honesty layer; do not hide it.

## Forecast algorithm — this is the accuracy requirement, follow it exactly

All computation in `lib/goals-forecast.ts` as **pure functions** (inputs: arrays of dated events + goals + as-of date; no Supabase calls inside), so it's unit-testable and backtestable. The API route fetches raw rows and calls the lib.

For a range with as-of date `t` (usually today), per metric:

1. **Actuals to date**: count events in `[start, t)` using the canonical definitions above.
2. **Known future bookings** (sets only): `scheduled_appointments` already on the calendar with `scheduled_for` in `[t, end)` passing `countsAsInspectionSet()`. These are commitments, not extrapolation — count them at a show-adjusted value (× trailing completion rate of future-booked sets; if that rate can't be computed, count at 100% and note it in assumptions).
3. **Run-rate remainder** (doors, additional sets): trailing 8-week average of the metric per weekday (Mon..Sun computed separately — canvassing is strongly weekday-shaped), summed over remaining days in the range. Fall back to a flat trailing-28-day daily average when there aren't 8 weeks of history.
4. **Downstream funnel metrics** (sits, sales, revenue) are NOT independently run-rated. They derive from upstream projections:
   - projected sits = (projected total sets, incl. known bookings) × trailing-90d set→sit rate
   - projected sales = projected sits × trailing-90d sit→close rate
   - projected revenue = projected sales × trailing-90d median `project_cost` of signed contracts (median, not mean — one big commercial job must not skew the forecast)
   - Apply the **median set→sale lag** (compute from historical set date → contract signed date pairs): sets projected in the last `lag` days of the range push their expected sales beyond `end` and must NOT count toward this range's projected sales. Surface the lag value in assumptions.
5. **Rate fallback ladder**: trailing 90d → trailing 180d → all-time, taking the first window with n ≥ 10 conversions; always report which window won and its n. Never silently use n<10.
6. **Range output per metric**: `{ actual, knownBooked, projectedLow, projected, projectedHigh, goal, gapToGoal, neededPerWeek }`. Low/high = P25/P75 of trailing weekly totals scaled to remaining weeks (simple percentile band, clearly labeled "typical range" — no confidence-interval theater).
7. **Quarter-vs-quarter compare mode**: same metric set for both ranges side by side, plus deltas; if the second range is partially in the future, its future part uses the projection machinery above.

### Backtesting requirement (non-negotiable)
Add a jest suite `lib/__tests__/goals-forecast.test.ts` with deterministic fixtures that:
- verifies weekday-shaped run-rate math against hand-computed expectations
- verifies the funnel derivation (sets→sits→sales→revenue) end to end
- verifies the lag exclusion (a set 3 days before range end with a 14-day lag contributes no sales to this range)
- verifies the fallback ladder picks the right window by n
- **backtest shape test**: feed 10 weeks of synthetic history, forecast week 9–10 as-of end of week 8, assert projection within ±15% of the synthetic "actual" — this pins the algorithm against regressions that would quietly wreck accuracy.

## APIs (all: try/catch `requireAuthApi()` → 401; superuser gate → 403; service client; org-scoped)

- `GET /api/admin/goals?month=YYYY-MM` → `{ goal | null }`
- `PUT /api/admin/goals` body `{ month, doors_target, ... , notes }` → upsert by (org_id, month), write audit row, return saved goal
- `GET /api/admin/goals/scorecard?month=YYYY-MM` → full scorecard payload (KPIs + funnel + channels + goal attainment) in one response
- `GET /api/admin/goals/forecast?start=&end=&compareStart=&compareEnd=` → forecast payload incl. the assumptions block

Timezone: all period boundaries in **America/New_York** (business operates ET; VERIFY how the payroll/444 period code converts ET boundaries and reuse that helper).

## Performance note
`leads` is ~7.6k rows and grows fast via canvassing. For doors, use count queries with range filters, not full-table fetches. For sets/sits/sales the row counts are small (hundreds) — fetching rows is fine and needed for funnel/lag math. Bound any fetch with explicit `.limit()` and range filters; PostgREST silently caps at ~1000 rows otherwise (known footgun in this repo).

## Deliverables checklist
- [ ] Migration file (goals table + RLS + audit) — NOT pushed, listed in handoff for MCP apply
- [ ] `lib/goals-forecast.ts` (pure) + `lib/goals-scorecard.ts` (fetch+assemble, thin)
- [ ] 3 API routes with auth gates
- [ ] `app/admin/goals/page.tsx` + client tabs component
- [ ] Admin grid card
- [ ] Jest suites: forecast (incl. backtest shape test) + scorecard channel bucketing + a route-gate test if the repo has an API test pattern (VERIFY)
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes
- [ ] Bug-bot self-review + collateral sweep notes in the handoff (what you checked: dashboard metric parity, Sisu goals untouched, coaching_goals untouched, no nav changes)

## Out of scope (do not build)
- Per-rep goals (exists in Sisu/coaching)
- Editing historical actuals
- Exports/PDF, scheduled emails
- Any ML/external forecasting dependency — this is deterministic funnel math by design
