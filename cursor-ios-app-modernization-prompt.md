# Cursor — Execution Prompt: Modernize the ARX Sales iOS App (compete with Terros)

You are the execution/implementation agent for the **ARX Sales** native iOS app (SwiftUI) inside the `arx-internal-crm` monorepo. A separate planning pass (see `grok-ios-app-planning-prompt.md`) produces the phased roadmap; **paste that plan above this prompt and build it phase by phase.** This doc is your operating harness: the repo rules, the ground truth about the app, and the definition of done. Where it says **VERIFY**, open the file/route/DB and confirm before coding — never guess or invent an endpoint.

## Where things live
- iOS app: `ARX Sales/ARX Sales/*.swift` (SwiftUI, MapKit, Supabase Swift SDK). Xcode project: `ARX Sales/ARX Sales.xcodeproj`.
- Backend it calls: this same repo, Next.js 14 App Router under `app/api/`, deployed at `https://arx-internal-crm.vercel.app` (hardcoded in `APIClient.baseURL`).
- Existing prompt convention: `cursor-goals-forecast-prompt.md` (match its rigor).

## Ground truth about the app today (read these before touching anything)
- `ContentView.swift` — `TabView`, 4 tabs: Dashboard, Canvass, Opportunities (gated `mobileCaps.opportunitiesTab`), Measure (gated `mobileCaps.measureTab`). Caps from `GET /api/mobile/capabilities` → `MobileAppCapabilities` in `APIClient.swift`.
- `CanvassView.swift` — `CanvassMapView: UIViewRepresentable` wrapping `MKMapView`. **`map.mapType = .hybrid` is hardcoded.** Viewport pins via `vm.loadPins(region)` → `APIClient.viewportPins(...)`; bounds cache + 350ms debounce; long-press drops a pin; `MKMarkerAnnotationView` clustering with disposition color/glyph; minimal bottom HUD.
- `APIClient.swift` — `struct APIClient`, `baseURL`, `bearerToken()` (Supabase `session.accessToken`), generic `request(path:queryItems:)` (GET) and `post(path:body:)`. All models (`CanvassPin`, `Opportunity`, `SavedMeasurement`, etc.) live here. **`CanvassDisposition.all` is a hardcoded Swift array** — if the plan moves dispositions/tags to the DB, add an endpoint + decode it, don't hand-edit this list.
- Auth: `ARX_SalesApp.swift` gates on Supabase `authStateChanges`; `AuthView.swift` for sign-in. Don't touch the auth flow unless the phase requires it.

## Backend endpoints that already exist (VERIFY exact request/response before wiring)
`/api/admin/canvass-territories` & `/[id]` (territories) · `/api/canvass/weather` (hail/storm swaths, gated by `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY`) · `/api/canvass/roof-age` · `/api/canvass/availability`, `/api/canvass/team-availability` · `/api/canvass/leads/viewport`, `/api/canvass/lead`, `/api/canvass/data`, `/api/mobile/capabilities`.

## Explicitly out of scope — do not build or touch
- **No Calendar tab.** Scheduling stays as-is: canvass pin → `ScheduleInspectionSheet` → server round-robin. Do not modify `/api/calendar/*`, `/api/appointments*`, the round-robin/schedule-inspection path, or `ScheduleInspectionSheet.swift`'s server contract — that machinery is live and shared with the web CRM.
- **Do not change existing shared endpoint contracts.** Older iOS builds in reps' pockets and the live web app call the current shapes. Response changes are additive-fields-only; new mobile behavior goes in new `/api/mobile/*` routes, never by forking logic inside shared routes.
- Do not touch payroll/attribution logic (`pin_attributed_user_id` precedence over `owner_user_id`).

## Non-negotiable repo rules (violating any of these fails review)
1. **Backend auth:** any NEW or edited API route uses `requireAuth()` (pages) / `requireAuthApi()` (API) from `lib/auth.ts` — never raw `supabase.auth.getUser()`. **`requireAuthApi()` THROWS on failure** — wrap in try/catch → return 401. Mobile routes must also respect role/capability gating consistent with `/api/mobile/capabilities`.
2. **Schema changes are additive/nullable only** — the system is live and in daily use. New tables/columns fine; never alter or drop existing columns. Write migrations as SQL files under `supabase/migrations/`, **do NOT run `supabase db push`** (CLI is blocked by history drift) — hand the file to Nathan to apply via Supabase MCP `apply_migration`, and say so in your handoff notes.
3. **Text contrast (recurring failure in this build):** never render text directly on the satellite/photo map — always a solid or opaque-scrim chip/card. Explicit dark text `#2c2c2a` on light surfaces, never generic gray for values. WCAG AA. This applies to every HUD chip, layer label, and territory badge you add.
4. **Capability gating:** new tabs/features that map to a permission must be gated through the `/api/mobile/capabilities` pattern (extend the endpoint + `MobileAppCapabilities`), not hardcoded on.
5. **Mandatory change review — no exceptions for size:** every change gets a proactive bug-bot review + collateral-impact sweep (what else hits the same routes/tables/flags) before you call it done, then run `/code-review` and (for any backend/auth/schema change) `/security-review`. Do this without being asked.
6. **Tests:** backend tests run with **jest** (`npm test`), not vitest. For Swift, add/adjust unit tests where logic is testable (models, coverage math, disposition/tag mapping) and ensure the app **builds** (see Definition of done).

## iOS engineering conventions to follow
- Keep the existing architecture: SwiftUI views + lightweight `ObservableObject` view models + `APIClient` static funcs. Don't introduce a new networking layer or DI framework.
- New API calls go in `APIClient.swift` as `static func`s returning `Codable` models defined in that file (mirror the existing style, including `CodingKeys` for snake_case).
- MapKit: prefer native `MKMapView` capabilities (satellite/hybrid/standard via `mapType` or `MKMapConfiguration`, 3D via `MKMapCamera` pitch/heading, `MKLocalSearch` for address search, `showsUserLocation`/`userTrackingMode` for follow-me, `MKPolygon`/`MKPolygonRenderer` for territories). **No third-party map SDKs.**
- Persist user settings with `@AppStorage`. Apply color scheme app-wide via `.preferredColorScheme` driven by a stored enum (System/Light/Dark).
- Respect the gated-tab pattern for any new tab. Custom nav-bar ordering persists via `@AppStorage`.
- Haptics on meaningful actions (there's already `UIImpactFeedbackGenerator` on long-press — stay consistent).
- **Offline write-queue (P0 — see plan):** lead saves/disposition updates must survive dead zones. Durable local queue (simplest durable persistence wins), replay on reconnect via `NWPathMonitor`, visible pending-sync state (HUD chip + per-pin), and idempotent replay — VERIFY `/api/canvass/lead`'s behavior on double-POST of a new lead before deciding whether a client idempotency key + small additive backend change is needed. Scheduling an inspection remains **online-only** (server triggers round-robin/calendar/email) — show a clear offline state instead of queuing it. Later features that write canvass data (tags, dispositions) go through this queue, not around it.

## Working style
- **Build one phase at a time**, in the plan's order. After each phase: it compiles, the new surface is reachable, and you've done the review sweep. Do not start the next phase until the current one is green.
- Make the **smallest diff** that achieves the phase. Reuse existing models/patterns (`UIColor(hex:)`, `canvassSheetPresentation()`, HUD chip styling) rather than reinventing.
- If a phase needs a backend endpoint that doesn't exist, build it under `app/api/mobile/...` following rule #1, add the Swift client method, and note the migration (if any) for Nathan — don't block the whole phase.
- If you hit a genuine fork (endpoint shape ambiguous, permission unclear), state the options and your recommendation in your handoff notes and pick the safest reversible default; don't stall.

## Definition of done (per phase)
1. Xcode builds clean for the `ARX Sales` scheme (simulator, latest iOS): run
   `xcodebuild -project "ARX Sales/ARX Sales.xcodeproj" -scheme "ARX Sales" -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`
   (VERIFY the exact scheme/target name in the project first) — zero errors, no new warnings you introduced.
2. Backend changes: `npm test` passes; new/edited routes follow the auth rule; any migration SQL is written but NOT pushed, and is called out in handoff notes.
3. Contrast rule honored on every new on-map element (verify against satellite imagery, not a blank canvas).
4. Review sweep done: bug-bot + collateral-impact, then `/code-review` (+ `/security-review` for backend/auth/schema). Summarize findings and fixes.
5. Handoff notes list: files changed, endpoints added/consumed, migrations awaiting `apply_migration`, and anything deferred to a later phase.

Start by reading `CanvassView.swift`, `ContentView.swift`, and `APIClient.swift` in full, then implement **Phase 0** from the plan above.
