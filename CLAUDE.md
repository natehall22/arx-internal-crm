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
- `pin_attributed_user_id` takes precedence over `owner_user_id` for canvass lead attribution
- All schema changes must be nullable/additive — system is live and in daily use
- `bonus_status` enum: `pending_approval | approved | rejected | paid`
- `manager_user_id` self-referential FK for org hierarchy traversal
- **Mandatory change review — no exceptions for size or type:** every code change gets a proactive bug-bot review + full collateral-impact sweep (edge/fringe cases, other features touching the same tables/routes/flags) before it ships, then `/code-review` and `/security-review`. Do this without being asked.

## UI Conventions
- **Text contrast is an ongoing, recurring problem in this build — always verify text stands out.** Use explicit dark text (`#2c2c2a`, not generic gray) on light surfaces; never place text directly on the satellite/photo map — use a solid or opaque-scrim background; aim for WCAG AA. Validate legibility on a cheap Android in direct sun for any field-facing UI.

## Known Tech Debt
- Canvass service worker `public/canvass-sw.js` (~line 46) skips `/api/*` — API responses get no SW caching; client-side fetches must handle their own caching/timeouts.
- Vercel Cron pattern: `vercel.json` runs 3 crons (`sync-444`, `cleanup-inspection-photos`, `promote-insurance-follow-ups`), each secured by `Authorization: Bearer ${CRON_SECRET}` (503 if secret unset, 401 on mismatch). Reuse this for any new cron.
- `lib/roofradar-open-data.ts` now contains only `getRecentStormReportsInBbox()` (IEM Local Storm Reports feed) used by the canvass weather overlay + weather-refresh cron. The Roof Radar admin tool that gave the file its name was removed July 2026 (demo-grade data, superseded by the weather overlay).
- **Weather overlay Phase 2** — Phase 1 + Phase 2 merged (PR #3, #4). The 8 Bugbot items (stale-warning clearing, error-as-empty `degraded` flag, swath read/ingest caps, response-cache expiry, atomic swath replace, clear-day orphans, ingest size guard) are **fixed in PR #5** (`feat/weather-phase2-bugfixes`) — verify on merge. No open weather-code debt after that. Prod flag `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY` stays OFF until the human deploy checklist (GitHub/Vercel secrets, 4th cron, migration-history reconcile, MRMS backfill, preview field QA) is done — see `docs/canvass-weather-overlay-phase2-verification.md`. Claims-safe copy ("est.", "recorded", etc.) is enforced in code; not a separate legal gate. Separate open question (non-weather): confirm the `info@` feedback-routing + canvass "Report Issue" change bundled in commit `22e6ab5` is intended org-wide.

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
- Canvass attribution: `pin_attributed_user_id` > `owner_user_id`

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
