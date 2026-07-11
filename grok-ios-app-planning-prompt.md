# Grok — Planning Prompt: Modernize the ARX Sales iOS App to Compete with Terros

**Your role:** You are the reasoning/planning brain. You do NOT write final code. You produce a phased, dependency-ordered implementation plan + spec that a Cursor execution agent will build against. Optimize for: correct sequencing, small shippable slices, and pointing the executor at real endpoints/files (never invent). Where you are unsure something exists, mark it `VERIFY` and tell Cursor to check the codebase/DB before coding — do not guess.

## Context you're planning against

**Product:** ARX Roofing & Exteriors — residential storm/insurance roofing, subcontractor model. Field reps canvass door-to-door, book inspections, close deals. The iOS app is what setters/closers hold in the field, often on cheap phones in direct sun.

**The app being upgraded:** `ARX Sales/` — a **native SwiftUI iOS app** inside the `arx-internal-crm` monorepo. It is a thin field client on the existing web CRM (Next.js 14 / Supabase Postgres 17). It authenticates with Supabase and calls the deployed backend at `https://arx-internal-crm.vercel.app` with the Supabase access token as a bearer.

**Current iOS state (what exists today — do not re-plan from scratch, extend it):**
- `ARX_SalesApp.swift` — auth gate via Supabase `authStateChanges`.
- `ContentView.swift` — `TabView` with 4 tabs: **Dashboard**, **Canvass**, **Opportunities** (gated by `mobileCaps.opportunitiesTab`), **Measure** (gated by `mobileCaps.measureTab`). Capabilities come from `GET /api/mobile/capabilities`.
- `CanvassView.swift` — `MKMapView` (UIViewRepresentable), **hardcoded `.hybrid`** map type, viewport-based pin loading with debounce + bounds cache, long-press to drop a pin, marker clustering, disposition-colored glyphs, a minimal bottom HUD (loading / pin count / error). No follow button, no compass, no search, no layers, no territories, no map-style toggle.
- `APIClient.swift` — bearer-token client. Existing calls: `/api/dashboard/personal-stats`, `/api/dashboard/team-stats`, `/api/canvass/leads/viewport` (GET pins + POST detail-by-ids), `/api/canvass/lead` (save + schedule-inspection round-robin), `/api/opportunities`, `/api/opportunities/:id/measure/lidar`, `/api/measurements`, `/api/mobile/capabilities`.
- `DashboardView`, `OpportunitiesView`, `OpportunityDetailView`, `LeadSheetView`, `ScheduleInspectionSheet`, `MeasureView` + LiDAR mesh pipeline (`MeshProcessor`, `FaceEditView`, `ModelReviewView`, `CaptureGuidanceView`, `MeasurementModels`).
- Client-side disposition list is **hardcoded** in `APIClient.swift` (`CanvassDisposition.all`).
- **No Settings screen, no map-style control, no dark-mode handling, no territories UI, no address search, no calendar, no tags, no offline write queue.**

**Backend endpoints that already exist (the app is under-using these — VERIFY exact shapes before speccing against them):**
- Territories: `/api/admin/canvass-territories`, `/api/admin/canvass-territories/[id]`
- Weather overlay: `/api/canvass/weather` (storm/hail swaths — note prod flag `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY` gating on web)
- Roof age data: `/api/canvass/roof-age`
- Rep availability: `/api/canvass/availability`, `/api/canvass/team-availability`
- Calendar/appointments: `/api/appointments`, `/api/appointments/[id]`, `/api/calendar/profile`, `/api/calendar/sync`, `/api/leads/[id]/schedule-inspection` — **exists but off-limits** (see out-of-scope note below)
- Canvass data/import: `/api/canvass/data`, `/api/canvass/import`

## The competitive target (Terros) — from field screenshots

Terros is the canvassing CRM ARX is competing with. Observed capabilities to match or beat:
1. **Map-first canvass** with a **3D satellite globe** on cold open, smooth zoom down to a **3D oblique (pitched) aerial** neighborhood view. (MapKit supports satellite/hybrid + `MKMapView` camera pitch/heading — no third-party SDK needed.)
2. **Map style switcher** (Satellite / Hybrid / Standard) — Terros exposes it in Settings AND likely a quick on-map toggle.
3. **Territory / area management** with a live **coverage indicator** ("Active 0%") — reps see how much of an assigned area has been knocked.
4. **Layers control** (stacked-squares icon) — toggle overlays on the map (territories, other reps, weather/hail, roof age, statuses).
5. **Recenter/follow-me** button + **compass** + reset-north.
6. **Search** (address / lead lookup) incl. a **voice/mic** entry.
7. **Customizable bottom nav bar** (reorder/show/hide tabs) and a **Settings** screen: Navigation App (Apple Maps/Google), Map Style, Tags, Focus Mode ("show only my activities"), Color Scheme (System/Light/Dark), Nav Bar, Beta program, Help & Feedback.
8. **Tags** on leads/pins.
9. **Time/date scrubber** (calendar-clock icon) — filter pins by recency/time window.

**Explicitly OUT of scope — do not plan it:** Terros has a **Calendar tab**; ARX does not want one. Scheduling already flows through the canvass pin → `ScheduleInspectionSheet` → server round-robin path, and closers live in the web CRM's calendar. Do not add a Calendar tab, do not restructure the scheduling flow, and do not touch `/api/calendar/*` or the appointment/round-robin backend — that machinery is live and shared with the web app. If a later phase would benefit from *reading* a rep's upcoming appointments (e.g., a small "next appointment" card on Dashboard), you may note it as an optional P2 idea, but it must be read-only and must not modify scheduling code.

**Non-negotiable field-UX constraint (from CLAUDE.md):** text contrast is a recurring failure in this build. Never put text directly on the satellite photo — always a solid/opaque-scrim chip. Explicit dark text `#2c2c2a` on light surfaces, never generic gray. Aim WCAG AA. Assume a cheap Android-equivalent screen in direct sun (design for iOS but hold the same legibility bar).

## Offline write-queue is IN SCOPE as P0 — plan it deliberately

Field reps lose cell service mid-neighborhood. Today the app has **no offline handling**: `APIClient.saveLead` just throws on network failure, so a knock recorded in a dead zone is lost (or the rep re-knocks the house). The web canvass PWA already solved this with a Zustand offline queue — the iOS app must reach parity. Plan a durable client-side write queue for canvass actions:

- **Scope it tightly:** queue lead saves / disposition updates (`POST /api/canvass/lead`) first. Scheduling an inspection stays **online-only** (it triggers round-robin, calendar sync, and email server-side — queuing it offline would create phantom appointment expectations; surface a clear "you're offline — scheduling needs a connection" state instead).
- **Design decisions to reason through:** persistence mechanism (e.g., file-backed JSON or SwiftData — pick the simplest durable option), replay order + retry/backoff on reconnect (`NWPathMonitor`), idempotency/dedupe so a retried save doesn't create duplicate leads (**VERIFY** whether `/api/canvass/lead` upserts by `lead_id` and what happens on double-POST of a *new* lead — if the server can't dedupe new-lead creates, spec a client-generated idempotency key and the small additive backend change to honor it), conflict policy when the same pin was edited elsewhere while offline (last-write-wins is acceptable — say so explicitly), and a visible pending-sync indicator (queued count chip on the map HUD, per-pin "pending" state).
- **Read side:** pins already have a viewport bounds cache in memory; decide whether a lightweight last-viewport disk cache is worth it for cold-start-offline, or defer read caching to P2 (queue writes are the P0 — don't let read caching balloon the phase).
- Place it early in the roadmap (Phase 0 or 1) since later features (tags, dispositions) should write through the same queue rather than bolting it on afterward.

## Protect the live product — this is a hard constraint, not a preference

The backend and web CRM are **live and in daily use by the whole company**. Your plan must be structured so that no iOS phase can degrade the web app or existing iOS builds in the field:

- Prefer **read-only consumption** of existing endpoints. When an existing endpoint's response must grow, it's **additive fields only** — never rename/remove/repurpose fields the web app reads, and never change status codes or error shapes.
- New mobile-specific behavior goes in **new `/api/mobile/*` routes**, not by forking logic inside shared routes.
- **Do not touch** the scheduling/round-robin path, calendar sync, payroll/attribution logic (`pin_attributed_user_id` precedence), or the canvass viewport endpoint's existing contract — older app builds in reps' pockets still call the current shapes.
- Schema: additive/nullable only (repo rule), and each phase's migration must be independently applicable and reversible-by-ignoring (the system keeps working if the iOS feature ships late).
- For each phase, include a short **blast-radius note**: which shared routes/tables it touches, what the web app does with them, and why the change can't regress web. If a phase can be built with zero shared-surface changes, structure it that way even at small cost to elegance.

## What I want back from you (the plan)

Produce a single Markdown plan with these sections:

### 1. Gap analysis table
Columns: Terros capability | ARX iOS today | Backend support (endpoint or "none — needs API") | Effort (S/M/L) | Priority (P0 field-blocking / P1 competitive parity / P2 polish). Be honest where the backend has nothing and a new `/api/mobile/*` endpoint is required.

### 2. Phased roadmap (dependency-ordered, each phase independently shippable)
Recommend phases; a sensible default is:
- **Phase 0 — Foundations:** Settings screen + `@AppStorage`/persistence, app-wide color scheme, map-style toggle, follow-me/compass/recenter, 3D camera pitch on zoom-in. (Pure client, no backend — fastest visible win, de-risks everything, zero blast radius.)
- **Phase 1 — Offline write-queue (P0):** durable queue for `POST /api/canvass/lead`, replay on reconnect, pending-sync UI, idempotency (see the offline section above). Client-first; the only backend change allowed is a small additive idempotency-key handling if VERIFY shows double-POST creates duplicates.
- **Phase 2 — Territories + coverage:** consume `/api/admin/canvass-territories`, draw polygons, compute/display coverage %. Flag any new backend aggregation endpoint needed for "% knocked" (new `/api/mobile/*` route, not a change to shared ones).
- **Phase 3 — Layers + search:** layers panel (territories / weather / roof-age / statuses), address search (MapKit local search) + voice input.
- **Phase 4 — Tags, customizable nav bar, Focus Mode, time scrubber, polish.** Tags/dispositions moving to DB-served config must write through the offline queue from day one.

(No Calendar phase — see the out-of-scope note above.)

For each phase give: goal, exact files to create/modify (use the real filenames above), endpoints consumed (with `VERIFY shape`), new Swift models needed, and a crisp "done when" acceptance list.

### 3. Backend deltas
Explicitly list any endpoints that must be added/extended (e.g., a territory coverage aggregate, a tags CRUD for mobile, dispositions served from DB instead of the hardcoded Swift list). For each: proposed route under `/api/mobile/*` or existing namespace, method, request/response sketch, and the repo auth rule it must follow (`requireAuthApi()` throws → wrap try/catch → 401; additive/nullable schema only; migrations authored as SQL under `supabase/migrations/` but applied by Nathan via Supabase MCP `apply_migration`, never `supabase db push`).

### 4. Risks & sequencing notes
Call out: MapKit 3D/camera limits, offline queue edge cases (duplicate creates, replay ordering, token expiry mid-queue-flush), the weather-overlay prod flag, contrast pitfalls specific to overlays on satellite imagery, and — for every phase — the blast-radius note against the live web product (see the hard constraint above).

### 5. Open questions for Nathan
Anything that changes scope (e.g., "Is Google Maps navigation hand-off required, or Apple Maps only?", "Should dispositions/tags be org-configurable from DB?"). Already decided — don't re-ask: **no Calendar tab**, and **offline write-queue is in scope as P0**. Keep to real decisions, not busywork.

**Output format:** one self-contained Markdown doc. It becomes the input to the Cursor execution prompt (`cursor-ios-app-modernization-prompt.md`), so be specific enough that an executor never has to guess an endpoint or filename — only `VERIFY` the ones you flag.
