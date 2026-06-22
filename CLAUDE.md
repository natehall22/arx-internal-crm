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

## UI Conventions
- **Text contrast is an ongoing, recurring problem in this build — always verify text stands out.** Use explicit dark text (`#2c2c2a`, not generic gray) on light surfaces; never place text directly on the satellite/photo map — use a solid or opaque-scrim background; aim for WCAG AA. Validate legibility on a cheap Android in direct sun for any field-facing UI.

## Known Tech Debt
- Roof Radar API routes use raw `supabase.auth.getUser()` (violates the auth rule) in `app/api/admin/roofradar/{scan,storm-lookup,sources}/route.ts`. Do NOT copy this pattern into new code; use `requireAuthApi()`.
- Canvass service worker `public/canvass-sw.js` (~line 46) skips `/api/*` — API responses get no SW caching; client-side fetches must handle their own caching/timeouts.
- Vercel Cron pattern: `vercel.json` runs 3 crons (`sync-444`, `cleanup-inspection-photos`, `promote-insurance-follow-ups`), each secured by `Authorization: Bearer ${CRON_SECRET}` (503 if secret unset, 401 on mismatch). Reuse this for any new cron.
- `lib/roofradar-open-data.ts` fetches/caches free NOAA SPC hail+wind reports (in-memory `Map`, ~30min TTL); only `enrichPropertiesWithOpenData` is exported (helpers are private).

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
- **Canvass weather overlay** (hail/wind) — Phase 1 trial BUILT on `feat/canvass-weather-overlay`, feature-flagged OFF (`NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY`). Recent storm data = free **IEM Local Storm Reports** GeoJSON (bbox-scoped, near-real-time) via `getRecentStormReportsInBbox()` in `lib/roofradar-open-data.ts` — NOT the SPC WCM annual archive (that lags ~1yr; wrong for recent storms). Live NWS Alerts warnings also shown. Window = **2 years / 730 days** (insurance claim scope; hard cap). Hail (inches) + wind gusts (mph) + thunderstorm-wind-damage reports (gray "damage" dots, no speed). Separate `google.maps.Data` layer (`zIndex 1`, `clickable:false`) under pins; collapse-when-off control; claims-safe copy ("may have been impacted — free inspection", always "est."). Route `app/api/canvass/weather/route.ts` uses `requireAuthApi()`. MRMS MESH swaths = Phase 2 (needs GDAL worker, not Vercel). Docs: `docs/canvass-weather-overlay-*.md`. Open: counsel sign-off on claims-safe copy before field use.

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
