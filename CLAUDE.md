# ARX Internal CRM — Claude Context

## Company
**ARX Roofing & Exteriors** — residential roofing company, primarily storm/insurance work.
Subcontractor model (no in-house crews). Based in the US, field reps canvass door-to-door.

## Ownership Team
| Owner | Domain |
|---|---|
| Nathan Hall | Closing, tech stack, training, leadership development |
| Evan | Setting, social media, relationships, recruiting |
| Steve | In-field operations (paid via OPP 9% of commissionable) |
| Andrew | Back office operations and finance (paid via OPP 9% of commissionable) |

## Business Model
- **Lead gen:** Door-to-door canvassing (setters) → inspection → close
- **Comp stack per job:** Setter 5% + Closer 7% + Sales override 6% + OPP 9% = 27% of commissionable
- **Average ticket:** ~$16,325 gross; ~28 squares/roof
- **Net per roof:** ~$4,962 after sales comp (18%) and OPEX (4%)
- **Subcontractor cost:** ~$145/sq labor + $100/sq materials + $30/sq dump + $75 permits
- **Call center:** 1 Philippine rep on Enzo Dialer ($230/mo)

## Tech Stack
- **Framework:** Next.js 14 App Router, TypeScript strict mode
- **Database:** Supabase (Postgres 17), RLS enabled
- **Auth:** Custom session-cookie auth via `requireAuth()` / `requireAuthApi()` in `lib/auth.ts` — never use raw `supabase.auth.getUser()`
- **Maps:** Google Maps API (canvassing, territory management, roof measurement)
- **Calendar:** Google Calendar API (inspection scheduling, closer sync)
- **Email:** Nodemailer via SMTP
- **State:** Zustand (canvass offline queue), React state elsewhere
- **PDF:** Custom PDF generation for proposals and contracts

## Key Rules — Never Violate
- `requireAuth()` / `requireAuthApi()` for all auth — never raw `supabase.auth.getUser()`. NOTE: `requireAuthApi()` *throws* on failure (does not return null) — wrap in try/catch → 401.
- `PAYROLL_ADMIN_ROLES = ['admin', 'owner', 'operations']` — never expand this set
- **Canvass attribution: `owner_user_id` wins once a pin has been transferred.** This reverses the
  old "`pin_attributed_user_id` always takes precedence" rule (amended 2026-09-04, Nathan's call).
  `pin_attributed_user_id` is frozen for the life of the pin by the `leads_assignee_display_names`
  trigger, so preferring it credited whoever *first* dropped a pin forever — including reps who
  have left. `getAttributedCanvassLeadUserId` now prefers `owner_user_id` for leads reassigned at
  or after `CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM`; `pin_attributed_user_id` stays as the
  fallback for its real remaining job, keeping a pin attributed when `owner_user_id` is cleared on
  user delete. The cutoff makes this forward-only so historical door counts don't restate.
  **Any caller of that helper must select `ownership_reassigned_at`** — a row missing it silently
  falls back to the frozen pin owner instead of failing.
- All schema changes must be nullable/additive — system is live and in daily use
- `bonus_status` enum: `pending_approval | approved | rejected | paid`
- `manager_user_id` self-referential FK for org hierarchy traversal
- **Tesla Algorithm applies to every change** — question the requirement, delete before you add, never build a second implementation of something that exists. See the full rule and the Known Redundancy backlog below.
- **Mandatory change review — no exceptions for size or type:** every code change gets a proactive bug-bot review + full collateral-impact sweep (edge/fringe cases, other features touching the same tables/routes/flags) before it ships, then `/code-review` and `/security-review`. Do this without being asked.

## The Tesla Algorithm — Standing Rule for All AI Work

Apply these five steps **in order** to every task. Order matters: optimizing a
requirement that shouldn't exist, or automating a process that should be deleted,
is wasted work. Most of the value is in steps 1 and 2 — do not skip ahead to 3.

1. **Question every requirement.** Every requirement carries a name, not a
   department. Ask *who* asked for this and *why*. "The CRM has always done it
   that way" is not a requirement. If the requirement is wrong, say so before
   building.
2. **Delete the part or process.** If you aren't adding back at least 10% of what
   you delete, you didn't delete enough. Prefer removing a code path, a table, a
   flag, or a whole screen over adding a new one beside it. **A second
   implementation of something that already exists is a bug, not a feature.**
3. **Simplify or optimize** — only what survived steps 1 and 2.
4. **Accelerate cycle time.** Speed up what's left. Never speed up a step that
   should have been deleted.
5. **Automate — last.** Automating a broken or redundant process just makes it
   fail faster.

### How this applies here — non-negotiable
- **Before writing a new helper, function, constant, or component: grep for it
  first.** If something close exists, extend it. If two now exist, delete one in
  the same change. Do not leave both.
- **Flag repetition when you see it, unprompted.** If you notice the same logic,
  literal, query shape, or boilerplate for the 3rd time, stop and say so — name
  the file count and propose the single home for it. Don't wait to be asked.
- **Don't silently duplicate to avoid a refactor.** If consolidating is out of
  scope for the current task, say that explicitly and add the item to
  **Known Redundancy** below rather than quietly copy-pasting.
- **"Done repeatedly over and over" is a defect report.** Nathan's time is the
  scarce resource. Repeated manual steps, repeated explanations, and repeated
  code all count.

## Known Redundancy — Consolidation Backlog
Audited 2026-08-21. Ranked by risk, not by line count. Each is a step-2 delete
candidate, not a step-3 tidy-up. Do not add to these patterns; when you touch a
listed file, migrate it.

| # | Redundancy | Scale | Risk |
|---|---|---|---|
| 1 | **Authorization is implemented twice.** `lib/permissions.ts` (1,213 lines, real `PermissionName` model + `effective-permissions.ts` DB resolution) exists, but only ~2 API routes call `hasPermission`. Everything else hardcodes role literal arrays. | ~100 inline role arrays across 40+ distinct shapes (`['admin','regional_manager','sales_manager']` ×16, `['admin','regional_manager']` ×14, …); **17 separate single-purpose access modules** in `lib/` (`payroll-admin-access`, `finance-access`, `ops-access`, `goals-admin-access`, `proposal-delete-access`, `sales-doc-access`, `comp-plan-roles`, `manager-commission-roles`, `canvass-territory-manager-roles`, `scheduling-create-permission`, `dashboard-setter-role`, …) | **Highest.** No single place answers "who can do what." A role added or renamed must be found in ~100 spots. Security-relevant. |
| 2 | ~~**`getAdminClient()` redefined per-route.**~~ **DONE 2026-08-21** — all **83** local factories deleted (81 API routes + the `contracts/sign` and `change-orders/sign` server pages, which a `route.ts`-only glob initially missed). Every one now calls `createServiceClient()` from `lib/supabase/service.ts`, hardened with `auth:{autoRefreshToken:false,persistSession:false}` (previously omitted — which also stops a per-call 30s auto-refresh `setInterval` that was keeping the serverless event loop alive on ~198 pre-existing callers). `SUPABASE_SERVICE_ROLE_KEY` now appears in **8** files, down from 88: the helper, `lib/auth.ts`, `app/api/health/route.ts` (presence check), 2 tests, 3 `scripts/`. | was 83 | Closed |
| 3 | ~~**`createServiceClient` name collision.**~~ **DONE 2026-08-21** — dissolved by #2. The 6 aliased files turned out to be 3 real ones using the **anon key + user JWT**, not service role; renamed to `createAnonClient` so the identifier stops lying. | was 6 | Closed |
| 3b | **Local `getAuthClient()` re-parses session cookies by hand.** Found while doing #2. `app/api/admin/scheduling/route.ts`, `app/api/reports/builder/route.ts`, `app/api/reports/custom/route.ts` each hand-roll cookie lookup + JWT extraction, duplicating `lib/supabase/session-cookie.ts` + `createRequestScopedClient()` in `lib/supabase/request-client.ts`. | 3 files | Medium — deliberately NOT folded into the #2 consolidation: it changes auth-token parsing behavior (notably the null-token path, which currently falls back to an unauthenticated anon client). Needs its own change + review. |
| 4 | **Manual org scoping on every query.** `.eq('org_id', …)` hand-written per call site; `.from('users')` raw 372×. | **989 `.eq('org_id')`**, 372 `users`, 137 `production_jobs`, 131 `opportunities`, 111 `leads`, 109 `scheduled_appointments` | High — one omitted `.eq` is cross-org data exposure. This is the mechanism behind the parked AI-assistant F2 finding. Needs scoped query builders per table. |
| 5 | **Timezone hardcoded.** `'America/New_York'` literal. | **154 occurrences** | Medium-high — already caused the inside-sales reschedule double-TZ bug (2026-07-17). Blocks any non-Eastern market. Needs one `ORG_TIMEZONE` source. |
| 6 | **Formatters re-implemented per file.** No shared `lib/format.ts`. | 18 local `formatCurrency`/`formatMoney`, 33 local `formatDate`/`formatTime`, 22 raw `Intl.NumberFormat`, 159 raw `toLocaleDateString` | Medium — proposals/PDFs/commissions can render the same number differently. |
| 7 | **Error-response literals.** | `NextResponse.json({error:'Unauthorized'},{status:401})` **348×**; `'Forbidden'` 403 **168×**; plus 6 competing synonyms for 403 (`'Access denied'` 24, `'Not authorized'` 8, `'Permission denied'` 4, …) | Low severity, high volume — inconsistent client-side error handling. Needs `unauthorized()` / `forbidden()` helpers. |

| 8 | **Doors are counted twice, from two different tables.** Migrations `202608250002/3` moved dashboard door counts onto `canvass_knocks` (credited to the actual knocker at write time), but `app/dashboard/page.tsx:376` (`rawDoors`, per-member) and `app/sisu/page.tsx:64` (`doorsKnocked`) still count them from `leads` via `getAttributedCanvassLeadUserId`. The two disagree on any reassigned pin — and since 2026-09-04 the leads path is additionally cutoff-gated, so member rows need not sum to the org total beside them. Found during the 2026-09-04 attribution work; not fixed there because collapsing it changes what the dashboard reports. | 2 read paths | Medium-high — two live answers to "how many doors did this rep knock," one of them payroll-adjacent. |

| 9 | **"What was sold on this job" still has two resolvers left.** 2026-09-05: the squares + roof-measure chain was collapsed into `lib/job-sold-scope.ts` (`buildJobSoldScope`, `resolveJobProposalId`, `resolveJobOpportunityId`, `findJobRoofMeasurementRow`), now the single source for `/ops/jobs/[id]`, the materials-order print sheet, and `lib/job-run-sheet.ts`. Two paths were deliberately left alone: (a) `components/ops/SoldScopeCard.tsx` re-fetches the proposal + line items **client-side** through the browser/anon client with its own `linked ?? accepted` precedence and its own with-squares/without-squares fallback select; (b) `app/ops/jobs/[id]/page.tsx` ~L147-210 resolves the job's opportunity from `order_form_contracts` → address match → `project.opportunity_id`, which `resolveJobOpportunityId` does not fully reproduce — the page passes its answer in as an override. **Partially closed 2026-09-05:** `resolveJobOpportunityId` gained an org-scoped `address_text` leg that runs only after proposal → project both come up empty, because without it the supplier order sheet resolved a *different* opportunity than the card ops read on screen and printed a blank sheet for jobs whose measurement is linked by `opportunity_id` only. It still does not reproduce the page's `order_form_contracts` leg. | 2 paths | Medium — (a) can render a different sold figure than the server-computed card beside it; (b) means "which opportunity backs this job" still has two answers. Neither is safe to fold in as a drive-by: (a) changes a live card's data source, (b) changes which measurement the job page picks. |

| 10 | **Two write paths to the install-scheduling columns.** 2026-09-05: `POST /api/ops/install-schedule/assign` is now the one place that schedules an install — it clears the retired `assigned_crew_id`, guards the status transition (never downgrades a job past `scheduled`), and syncs the sub's Google all-day invite. Both the schedule board and `ScheduleJobModal` go through it. But the generic `PATCH /api/ops/jobs/[id]` still carries `scheduled_date`, `scheduled_time_start`, `estimated_duration_hours`, `assigned_sub_id` and `assigned_crew_id` in its `ALLOWED_FIELDS`, and does none of those three things. | 2 write paths | Medium — anything writing those columns through the generic PATCH silently skips the calendar sync, so the sub is never told. NOT narrowed in the same change because `app/ops/jobs/[id]/JobDetailClient.tsx` has ~7 PATCH call sites against that route and each needs checking before fields are removed from the whitelist. Do it during the job-page restructure, when that file is already open. |

**Rule going forward:** items 1, 3b, 4 and 5 are the ones that can cause a real incident.
Fix opportunistically — when a task already touches one of these files, migrate
that file rather than extending the pattern.

## UI Conventions
- **Text contrast is an ongoing, recurring problem in this build — always verify text stands out.** Use explicit dark text (`#2c2c2a`, not generic gray) on light surfaces; never place text directly on the satellite/photo map — use a solid or opaque-scrim background; aim for WCAG AA. Validate legibility on a cheap Android in direct sun for any field-facing UI.

## Known Tech Debt
- Canvass service worker `public/canvass-sw.js` (~line 46) skips `/api/*` — API responses get no SW caching; client-side fetches must handle their own caching/timeouts.
- Vercel Cron pattern: `vercel.json` runs 3 crons (`sync-444`, `cleanup-inspection-photos`, `promote-insurance-follow-ups`), each secured by `Authorization: Bearer ${CRON_SECRET}` (503 if secret unset, 401 on mismatch). Reuse this for any new cron.
- `lib/roofradar-open-data.ts` now contains only `getRecentStormReportsInBbox()` (IEM Local Storm Reports feed) used by the canvass weather overlay + weather-refresh cron. The Roof Radar admin tool that gave the file its name was removed July 2026 (demo-grade data, superseded by the weather overlay).
- **Weather overlay Phase 2** — Phase 1 + Phase 2 merged (PR #3, #4). The 8 Bugbot items (stale-warning clearing, error-as-empty `degraded` flag, swath read/ingest caps, response-cache expiry, atomic swath replace, clear-day orphans, ingest size guard) are **fixed in PR #5** (`feat/weather-phase2-bugfixes`) — verify on merge. No open weather-code debt after that. Prod flag `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY` stays OFF until the human deploy checklist (GitHub/Vercel secrets, 4th cron, migration-history reconcile, MRMS backfill, preview field QA) is done — see `docs/canvass-weather-overlay-phase2-verification.md`. Claims-safe copy ("est.", "recorded", etc.) is enforced in code; not a separate legal gate. Separate open question (non-weather): confirm the `info@` feedback-routing + canvass "Report Issue" change bundled in commit `22e6ab5` is intended org-wide.
- **Sold add-ons missing from the materials-ORDER flow (not just the brief)** — 2026-07-15: `components/ops/JobRoofingBrief.tsx` "Job materials brief" card now shows sold proposal adders (Gutters, Decking, Siding, Skylights, Chimney, Ventilation category — from `proposal_line_items` where `is_adder=true`, surfaced via `formatSoldAddOns()` in `lib/job-roofing-brief.ts`), fixing a bug where e.g. Ashley Gaines' job (26-0026, proposal P-00118, 306 LF Seamless Gutters + fascia board + OSB + siding) showed no gutters at all. **This was a display-only fix.** The actual materials-*ordering* system (`job_material_order_overrides` table, `/api/jobs/[id]/material-order`, `job_product_orders` table) still only tracks core roofing materials computed from roof measurements (`lib/materials-order-list.ts`: field shingles, starter, hip/ridge cap, ridge vent, underlayment, ice & water, drip edge, step/wall flashing, pipe boots) — it has no path for sold adders at all. So a sold "Gutters" or "Decking" line can now be *seen* on the job page but still won't flow into whatever ops uses to actually place the supplier order. Before touching `job_material_order_overrides`/`job_product_orders`/the ordering UI, trace where ops actually places material orders today (manually off the proposal, or via `job_product_orders`?) and confirm whether adders need to join that flow or whether the ops team already treats "Sold add-ons" as sufficient at-a-glance visibility.

## Major Features / Modules
| Module | Path | Notes |
|---|---|---|
| Canvassing app | `app/(canvass-app)/canvass/` | PWA, offline queue, Google Maps, rep geo-tagging |
| Dashboard | `app/dashboard/` | Sales metrics, KPIs |
| Leads | `app/leads/` | Full lead lifecycle |
| Opportunities | `app/opportunities/` | Post-inspection pipeline |
| Proposals | `app/proposals/` | Proposal builder with roof squares/adders |
| Contracts | `app/contracts/` | Digital signing |
| Work Orders | `app/work-orders/` | Sub dispatch |
| Sub Portal | `app/sub-portal/` | External subcontractor access |
| Jobs / Projects | `app/jobs/`, `app/projects/` | Production tracking |
| Sisu | `app/sisu/`, `app/admin/sisu/` | Incentive program (444, heats, badges, leaderboard) |
| Payroll | `app/admin/payroll/` | Bonus approval workflow |
| Commissions | `app/commissions/` | Rep commission statements |
| Canvass territories | `app/admin/canvass-territories/` | Territory assignment |
| Inside Sales | `app/inside-sales/` | Call center / inbound |
| Ops | `app/ops/` | Steve's ops dashboard |
| Reports | `app/reports/` | Custom report builder |
| Roof Measure | `app/tools/roof-measure/` | Aerial measurement tool |

## Sisu 444 Program
Incentive program for setters:
- **Week 1:** 400 doors knocked + 4 inspections set = Week 1 bonus
- **Week 2:** Same thresholds again in the same pay period = Week 2 bonus
- Bonus amount configurable per org (`program_444_week_bonus_label` on orgs table)
- Pays within the work week covering the activity
- DB table: `program_444_enrollments` with `week1_qualified_at` / `week2_qualified_at`
- Live door/inspection counts tracked; auto-qualifies on page view

## Canvassing App Details
- Google Maps with pin clustering; reps drop pins on houses
- Dispositions: `not_home`, `bad_roof`, `renter`, `go_back`, `hot_lead`, `not_interested`
- Offline-first: Zustand + IndexedDB queue syncs when connectivity returns
- Rep geo-tagging: captures rep's physical GPS at knock time (`rep_lat/lng/accuracy/captured_at`) — separate from pin lat/lng (property address)
- Territory assignment and visibility controls per role
- Canvass attribution: `owner_user_id` > `pin_attributed_user_id` for pins transferred on/after
  `CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM` (see Key Rules); frozen pin owner before that

## Active Initiatives (as of June 2026)
- **Recruiting plan** — scaling to 30+ reps by Sept 1 2026; priority #1 is insurance pipeline rep (July 15); 8 active setters target; second closer contingent on 4 conditions; Opportunity Nights every other Tuesday 6:30pm; full playbook at https://arxrecruiting.netlify.app/
- **iOS native app** — SwiftUI, Bearer token auth added to API layer
- **SEO content engine** — standalone at `~/Desktop/SEO Buildout/content-engine/`, merging into CRM as SaaS later
- **Proposal/squares work** — auto-filling roof square footage from aerial measurements into proposals (current branch)
- **Measure tool calibration memory** — post-install ground truth for AI tuning only (not CRM UI). Nathan tells the assistant a job's tool output vs. actual order/reorder outcome; the assistant appends a row to `data/measure-tool-memory/installs.csv` (primary — measured/ordered/actual/delta) and, only when non-obvious, a short note in `docs/measure-tool/lessons-learned.md`. Never fabricate a number the user didn't give. `@`-mention both when tuning waste, hip LF, or cap ordering in `app/tools/roof-measure/`.
- **Canvass roof-age layer** — flag `NEXT_PUBLIC_CANVASS_ROOF_AGE` (set in Vercel to enable). `/api/canvass/roof-age`: NC OneMap statewide parcels (`structyear`; coverage Mecklenburg ~99%, Iredell ~91%, Cabarrus 0%) with a Cabarrus fallback joining county parcel geometry (PIN14) to the `canvass_parcel_years` Supabase table — 84k pins bulk-loaded 2026-07-08 from the county's CAMA "Real Property Building" open-data CSV (largest-heated-area building's ActualYearBuilt per parcel; re-ingest ~yearly). Client markers are `google.maps.Circle` (iOS Safari does not paint Data-layer SVG point symbols), zoom-gated ≥16, buckets 10/15/20+ yrs, copy always "est.". Cabarrus's own GIS `YEAR_` column is legacy PIN numbering, NOT year built — never use it.
- **Canvass weather overlay** (hail/wind) — Phase 1 trial BUILT on `feat/canvass-weather-overlay`, feature-flagged OFF (`NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY`). Recent storm data = free **IEM Local Storm Reports** GeoJSON (bbox-scoped, near-real-time) via `getRecentStormReportsInBbox()` in `lib/roofradar-open-data.ts` — NOT the SPC WCM annual archive (that lags ~1yr; wrong for recent storms). Live NWS Alerts warnings also shown. Window = **2 years / 730 days** (insurance claim scope; hard cap). Hail (inches) + wind gusts (mph) + thunderstorm-wind-damage reports (gray "damage" dots, no speed). Separate `google.maps.Data` layer (`zIndex 1`, `clickable:false`) under pins; collapse-when-off control; claims-safe copy ("may have been impacted — free inspection", always "est."). Route `app/api/canvass/weather/route.ts` uses `requireAuthApi()`. MRMS MESH swaths = Phase 2 (needs GDAL worker, not Vercel). Docs: `docs/canvass-weather-overlay-*.md`. Prod enable: human deploy checklist in `docs/canvass-weather-overlay-phase2-verification.md` (not counsel sign-off).

## iOS App
- Native SwiftUI app for field reps
- Bearer token auth (`Authorization: Bearer <token>`) added to API layer
- Separate Xcode project at `ARX Sales/ARX Sales/`

## Supabase Project
- Project: `arx-internal-crm`
- Project ID: `anzqkklwcgaoeunzpqjh`
- Region: `us-east-2`
- Second project: `ARXroofing.com` (`gklmpghyktcuporhdziu`, us-west-2) — separate, the public website

## Git / Branch Conventions
- Main branch: `main`
- Current active branch: `fix/proposal-squares-and-payroll-bonuses`
- Git user: Nathan Hall

## Financial Model Inputs (Feb 2026 baseline)
- Working days/month: 23
- Appts per setter/day: 2.0
- Sit rate: 75% | Close rate: 30%
- Gross margin (pre-comp): 52.4%
- OPEX: 4% of revenue ($653/roof)
- Owner draw: 20% of gross profit
