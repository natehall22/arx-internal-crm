# Composer 2 — Build: ARX Sales iOS App Modernization (field-canvassing competitive parity)

You are the implementation agent for the **ARX Sales** native SwiftUI iOS app inside the `arx-internal-crm` monorepo. The planning pass is DONE and embedded below — endpoint shapes and auth behavior were verified against the actual codebase, so items marked **VERIFIED** are facts you can build on; items marked **VERIFY** you must confirm in-code before wiring. Build the phases **in order**; each phase must be green (compiles + reviewed) before starting the next.

## Where things live
- iOS app: `ARX Sales/ARX Sales/*.swift` (SwiftUI + MapKit + Supabase Swift SDK). Project: `ARX Sales/ARX Sales.xcodeproj`.
- Backend: same repo, Next.js 14 App Router under `app/api/`, deployed at `https://arx-internal-crm.vercel.app` (`APIClient.baseURL`).
- Read in full before coding: `CanvassView.swift`, `ContentView.swift`, `APIClient.swift`, `ARX_SalesApp.swift`, `LeadSheetView.swift`, `ScheduleInspectionSheet.swift`.

## Ground truth (verified against the codebase — do not re-derive)
- `ContentView.swift`: `TabView` with Dashboard, Canvass, Opportunities (gated `mobileCaps.opportunitiesTab`), Measure (gated `mobileCaps.measureTab`). Caps from `GET /api/mobile/capabilities` → returns `{ opportunities_tab, measure_tab }` via effective permissions.
- `CanvassView.swift`: `CanvassMapView: UIViewRepresentable` wrapping `MKMapView`; **`map.mapType = .hybrid` hardcoded**; viewport pin loading with 350ms debounce + padded bounds cache; long-press drops pin; `MKMarkerAnnotationView` clustering; bottom HUD chips on `.ultraThinMaterial`.
- `APIClient.swift`: bearer client (`supabase.auth.session.accessToken`); `request()`/`post()` helpers; all models colocated; `CanvassDisposition.all` hardcoded; `CanvassPin` fields: `id, lat, lng, d (disposition), s (status), o (owner_user_id), t (created_at), ia (sold)`.
- **VERIFIED — bearer auth:** `requireAuthApi()` in `lib/auth.ts` reads the `Authorization: Bearer` header (built for iOS). Routes using it are iOS-callable: `/api/canvass/weather`, `/api/canvass/roof-age`, `/api/canvass/lead`, `/api/canvass/leads/viewport`, `/api/mobile/capabilities`, dashboard routes.
- **VERIFIED — NOT iOS-callable:** `/api/admin/canvass-territories` uses its own cookie-session auth (`getSessionFromRequest`) + `CANVASS_TERRITORY_MANAGER_ROLES` gate. iOS bearer requests will 401. Do NOT modify this route — build a new mobile read route (Phase 2).
- **VERIFIED — idempotency exists server-side:** `POST /api/canvass/lead` dedupes new-lead creates by `client_lead_id` (24h window `.eq('client_lead_id', clientLeadId)` + unique-violation race recovery around line 533–665 of `app/api/canvass/lead/route.ts`). The iOS `SaveLeadRequest` does NOT send it yet — adding it client-side is the whole idempotency story. Zero backend change needed.
- **VERIFIED — overlay response shapes:** `/api/canvass/weather` returns a cached JSON body with a `degraded` flag on failure paths; `/api/canvass/roof-age` returns a GeoJSON `FeatureCollection` (`{ type, features, degraded? }`). VERIFY exact query params (bbox naming) in each route file before wiring.
- **VERIFIED — territories shape (source for the new mobile route):** `canvass_territories` columns `id, org_id, name, color, boundary_geojson, created_at, updated_at` + assignee join; web GET returns `{ territories: [...] }`. Table created in `supabase/migrations/110_canvass_territories.sql`.

## Non-negotiable repo rules (violating any fails review)
1. **Backend auth:** new API routes use `requireAuthApi()` from `lib/auth.ts` — it **THROWS** on failure: wrap in try/catch → return 401. Never raw `supabase.auth.getUser()`.
2. **Schema:** additive/nullable only; migrations as SQL under `supabase/migrations/`; **never run `supabase db push`** — Nathan applies via Supabase MCP `apply_migration`; call out pending migrations in handoff notes. (No migration is expected before optional Phase 4 tags.)
3. **Contrast:** never render text directly on satellite imagery — solid/opaque-scrim chips only. Explicit dark text `#2c2c2a` on light surfaces, never generic gray for values. WCAG AA. Applies to every chip, territory label, layer legend you add.
4. **Live product protection:** the **web CRM is in daily use by the whole company; the iOS app is pre-launch (no reps use it yet)**. So: backend/shared endpoint contracts are frozen for the web app's sake — additive response fields only; new mobile behavior goes in new `/api/mobile/*` routes; do not touch scheduling/round-robin, `/api/calendar/*`, `/api/appointments*`, or payroll/attribution (`pin_attributed_user_id` precedence). On the **iOS side you have full freedom** — refactor Swift files, rename models, restructure views as needed; there are no legacy app builds in the field to stay compatible with.
5. **Out of scope — do not build:** a Calendar tab (scheduling stays pin → `ScheduleInspectionSheet` → server round-robin), any change to shared routes' logic, any third-party map SDK.
6. **Review:** every phase gets a proactive bug-review + collateral-impact sweep, then `/code-review` (+ `/security-review` for any backend change). Backend tests: **jest** (`npm test`).

## Design language — open-map field feel (NOT a Terros clone)

Nathan likes how a competitor's app feels on his iPhone 16 Pro: **the map is the app** — full-bleed imagery, big touchable floating controls, nothing boxing the view in. Match that *feel* using standard iOS/HIG patterns, but the app must read as unmistakably **ARX**, not as anyone else's product.

**Legal guardrail — trade dress:** functional patterns (map-first canvass, floating circular buttons, layers sheet, follow-me/compass, floating tab bar) are industry-standard and fine. What you must NOT do: replicate a competitor's distinctive overall look — their exact control arrangement as a set, their icon choices, color identity, naming, onboarding illustrations, or any copy/wording. Never reference competitor apps in code, comments, asset names, or commit messages. Prefer **native Apple components** (`MKCompassButton`, `MKUserTrackingButton`, `MKScaleView`, system materials, SF Symbols, standard sheet detents) — using the platform's own vocabulary is both the fastest path and the safest one. When a layout decision isn't dictated by function, make the ARX-native choice, not the competitor's.

- **Full-bleed map, zero chrome.** The map ignores all safe areas (`.ignoresSafeArea()` already — keep it). No opaque bars, no cards docked to edges, no persistent panels. Everything floats.
- **Floating circular controls, generous size.** Map controls are circles of **48–52pt** (44pt HIG floor, never below), SF Symbol glyphs ~20–22pt, on translucent dark material (`.ultraThinMaterial`/`.thinMaterial` with a dark tint so white glyphs hold contrast over bright satellite ground). Circles may be translucent; **any text chip still gets an opaque scrim** (repo contrast rule — icons can breathe, words cannot).
- **Control placement (function-driven, ARX's own arrangement):** Settings gear top-left. Map utilities (follow/locate, compass — use the native `MKCompassButton`/`MKUserTrackingButton` where possible) grouped top-right. Data/filter controls (layers, time-scrubber) grouped **bottom-left as one connected vertical capsule group** rather than scattered singles — a deliberate departure from the competitor's scattered-circles look that also reduces mis-taps with gloves. Search bottom-right. ~16pt edge insets, clear of the Dynamic Island and home indicator.
- **Floating pill tab bar.** Replace the default docked `TabView` bar with a **floating capsule** detached from the bottom edge (~12–16pt lift) — this is now a native iOS pattern, not a competitor signature. Dark material, icon+label per tab, active tab tinted ARX brand blue `#3B82F6`. Integrate search as the trailing element **inside** the capsule (another deliberate divergence). Verify on the iPhone 16 Pro simulator, since that's the device the feel was judged on.
- **ARX identity:** brand blue `#3B82F6` as the accent throughout (already the app's pin/accent color), ARX pin glyph set (already custom: flame/dollar/calendar SF Symbols per disposition — keep building on that), and ARX naming ("Canvass", "Dashboard" — generic terms are fine; never adopt competitor-specific feature names).
- **Openness over density.** Generous spacing; HUD chips small, bottom-center, transient (loading/pending/count only). New features wanting persistent on-map UI go behind a button or a medium-detent sheet (map stays visible behind) — never a docked panel.
- **Motion:** camera changes fly (`setCamera` animated), buttons give light haptics, state changes fade — nothing snaps.

Phase 0 is where this lands: build the floating tab bar + control groups there, and every later phase adds its buttons into those groups rather than inventing new placements.

## iOS conventions
- Keep the existing architecture: SwiftUI views + lightweight `ObservableObject` VMs + `APIClient` static funcs with colocated `Codable` models (snake_case `CodingKeys`). No new networking layer, no DI framework.
- Settings persist via `@AppStorage`. Reuse `UIColor(hex:)`, `canvassSheetPresentation()`, and the existing HUD chip styling. Haptics consistent with the existing long-press pattern.
- New tabs/features tied to permissions go through the `/api/mobile/capabilities` pattern (extend endpoint + `MobileAppCapabilities` additively), never hardcoded on.

---

# THE PLAN — build in this order

## Phase 0 — Foundations: Settings, map controls, 3D camera (pure client, zero blast radius)

**Goal:** the app stops feeling hardcoded — reps control map style and appearance; the map gets modern floating controls and the 3D satellite feel.

**Build:**
- `AppSettings.swift` — enums + `@AppStorage` keys: `mapStyle` (standard/hybrid/satellite), `colorScheme` (system/light/dark), `navigationApp` (appleMaps/googleMaps), `enable3DBuildings` (Bool, default true).
- `SettingsView.swift` — standard grouped list (sections: Canvass → Navigation App, Map Style; General → Color Scheme; About → version). Present via a gear button on the Canvass map (top-left, circular material button) AND from Dashboard toolbar.
- `CanvassMapView`: replace hardcoded `.hybrid` with the stored setting (use `MKStandardMapConfiguration` / `MKHybridMapConfiguration` / `MKImageryMapConfiguration` with `elevationStyle: .realistic` when `enable3DBuildings`, falling back to `mapType` if targeting < iOS 16 — VERIFY deployment target in the Xcode project).
- Map controls column (right side, per the Design language section): follow-me button (`MKUserTrackingButton` or custom toggling `userTrackingMode` .none/.follow/.followWithHeading), compass (`MKCompassButton`, visible when heading ≠ north), and show scale. On first fix, keep the existing 500m auto-zoom but arrive with a pitched camera (`MKMapCamera` pitch ~45°, distance ~600m) for the oblique 3D aerial feel; pitch flattens automatically as users zoom out (don't fight MapKit).
- Apply `.preferredColorScheme` at the root in `ARX_SalesApp.swift` from the stored setting.
- Floating pill tab bar (see Design language): replace the default docked `TabView` bar with the floating capsule + separate circular search placeholder (search activates in Phase 3 — until then it can present a simple "coming soon"-free no-op: just omit the button until Phase 3 if a dead button feels wrong). Keep capability gating intact for Opportunities/Measure tabs.
- Navigation hand-off: in `LeadSheetView`, a "Directions" action opens Apple Maps or Google Maps (`comgooglemaps://` with `https://maps.google.com` fallback) per setting. Add `LSApplicationQueriesSchemes` entry for `comgooglemaps` (VERIFY which Info.plist the target actually uses — `ARX-Sales-Info.plist` at `ARX Sales/ARX-Sales-Info.plist`).

**Done when:** builds clean; style + scheme persist across relaunch; follow/compass/recenter work; all new on-map buttons are material-backed circles (no bare glyphs on satellite); no backend diffs at all.

## Phase 1 — Offline write-queue (P0: dead-zone knocks must never be lost)

**Goal:** a rep with zero bars can keep knocking; saves queue locally and replay automatically. **No backend changes — the server already dedupes by `client_lead_id`.**

**Build:**
- `SaveLeadRequest`: add `client_lead_id: String?`. Generate `UUID().uuidString.lowercased()` when creating a NEW lead (no `lead_id`); persist it with the queued item so retries reuse the same key. Updates to existing leads carry `lead_id` as today.
- `OfflineLeadQueue.swift` — an `actor` owning a file-backed JSON queue (Application Support; `Codable` array of pending `SaveLeadRequest` + enqueue timestamp + attempt count). API: `enqueue(_:)`, `pendingCount` (published via a small `ObservableObject` bridge), `flush()`.
- Enqueue policy: only transport-level failures (URLError: notConnectedToInternet/timedOut/networkConnectionLost/dnsLookupFailed) and 5xx. **Never queue 4xx** — that's a validation error; surface it to the rep immediately.
- Replay: `NWPathMonitor` on a background queue; when the path becomes satisfied, `flush()` — strict FIFO (preserves ordering of successive edits to the same lead), sequential (one in flight), exponential backoff on repeat failure (cap ~2min), attempt-count guard (after ~10 failed attempts, keep the item but mark it "needs attention" — never silently drop). Bearer token is fetched fresh per replay attempt (Supabase SDK refreshes expired tokens).
- UI: `LeadSheetView` save path calls a wrapper (`APIClient.saveLeadQueued`) that transparently enqueues on qualifying failure and returns a "saved offline" result — the sheet closes with a distinct confirmation ("Saved — will sync when back online"), not an error. Map HUD gets a pending chip ("⏳ 3 pending sync", opaque scrim, tappable → simple pending list with retry). Queued NEW leads render as local pins immediately (distinct dashed/gray "pending" marker) so the rep sees the knock recorded and doesn't re-knock.
- **Scheduling stays online-only:** in `ScheduleInspectionSheet`, when offline show a plain banner ("You're offline — scheduling an inspection needs a connection") and disable submit. Do not queue scheduling posts (server triggers round-robin + calendar + email).
- Unit tests where practical: queue encode/decode round-trip, FIFO ordering, enqueue policy classification.

**Done when:** airplane-mode save lands in the queue with a local pin + chip; disabling airplane mode syncs it and the pin refreshes to server state; double-flush produces no duplicate lead (`client_lead_id` respected); scheduling correctly blocks offline. Zero backend diffs.

## Phase 1.5 — LiDAR measurement correctness (audited: two critical bugs + accuracy fixes)

**Goal:** measurements the company can bid from. The pipeline (`MeshProcessor.swift`, `MeasurementModels.swift`, `CaptureGuidanceView.swift`, `APIClient.swift` payloads) was audited; fix these in order. Pure client — the backend contract is fine and must not change.

**Fix 1 — compass alignment (CRITICAL):** `CaptureGuidanceView.swift:291` runs `ARWorldTrackingConfiguration()` with default `worldAlignment = .gravity`, so world X/Z are arbitrary — yet `RoofFace`/`WallFace` derive `azimuthDegrees` → "North Slope"/"East Wall" labels → `orientation` and `elevation_name` in the upload. Set `config.worldAlignment = .gravityAndHeading` (VERIFY device heading availability; if unavailable, drop compass labels rather than lie). With heading alignment, −Z is true north — the correct azimuth is `atan2(x, −z)`; the current `atan2(normal.x, normal.z)` flips N↔S. Fix both `RoofFace.init` and `WallFace.init`.

**Fix 2 — elevation-name contract (CRITICAL):** `lib/lidar-measure-ingest.ts` matches wall payloads to web-form elevations by name (`.ilike('elevation_name', …)` against "Front"/"Right"/"Rear"/"Left"). iOS sends `face.label` ("North Wall") — never matches, so data lands on invented elevation rows. In `ModelReviewView`, let the rep assign each wall face one of **Front / Right / Rear / Left** (default from capture position or heading), and send that as `elevation_name` in `LidarMeasurePayload.from(wallFaces:)`. Keep compass info in a separate field only if the backend already has one (VERIFY — do not add backend fields for this).

**Fix 3 — ground counted as roof (CRITICAL):** `MeshProcessor.classify()` marks `normal.y > 0.5` as roof, but lawn/driveway normals point straight up — terrain becomes large flat "roof" faces inflating squares. Use ARKit's per-face `ARMeshClassification` (LiDAR devices provide it; the processor currently ignores `geometry.classification`) to drop `.floor`/ground faces, plus a height filter (reject upward-facing clusters near/below the session's camera height). Keep genuinely flat *roof* sections reachable (porch roofs) — height, not pitch, is the discriminator.

**Fix 4 — clustering accuracy:** (a) replace `abs(simd_dot(…))` with a signed dot — opposite-facing parallel walls within 12m currently merge into one face with a garbage averaged normal; (b) grow clusters by distance to the *nearest cluster member* (or centroid updated as it grows), not only `cluster[0]` — long roof planes fragment and nearby separate structures merge; fix the stale "within 3 meters" comment.

**Fix 5 — area inflation:** raw mesh-triangle-area sums over ARKit's bumpy reconstruction overestimate planar faces (typically +5–15%). Per cluster, fit a least-squares plane, project vertices onto it, and measure the 2D convex-hull (or alpha-shape) polygon area; report that as `areaSqFt`. Add a unit test with a synthetic noisy planar mesh asserting the fitted area beats the raw sum.

**Fix 6 — small ones:** wall height/width in `LidarMeasurePayload.from` uses full Y-extent (outlier-sensitive) — use 5th–95th percentile extent; widen the wall band so >60° slopes (mansards) aren't silently dropped into `.other` (roof if `normal.y > 0.35` is reasonable — re-tune with Fix 3's height filter in place); `process(anchors:scanType:)` ignores its `scanType` param — remove or honor it.

**Done when:** a scan of a known structure produces elevation names the web measure form actually merges into; ground no longer appears as roof faces; synthetic-mesh unit tests pass for classification, clustering (opposite-normal separation), and plane-fitted area; zero backend diffs.

## Phase 2 — Territories on the map + coverage

**Goal:** reps see their assigned territory polygons and knock progress — answering "how much of my area is worked" at a glance.

**Backend (new route, only backend work in this phase):** `app/api/mobile/territories/route.ts` — GET, `requireAuthApi()` try/catch→401, service-role client, returns all org territories:
`{ territories: [{ id, name, color, boundary_geojson, assigned_user_ids: [], assigned_to_me: bool }] }`
Read-only; every authenticated org member may read (territory shapes aren't sensitive; the admin route stays manager-gated for writes). Mirror the org-scoping used by the existing admin GET (VERIFY how it resolves `org_id` from the profile and copy that). Jest test: 401 unauthenticated, shape on success.
- iOS: `APIClient.fetchTerritories()` + `Territory` model. Render `boundary_geojson` (Polygon/MultiPolygon — use `MKGeoJSONDecoder`) as `MKPolygon` overlays: 2pt stroke in territory color, ~15% alpha fill (~25% for `assigned_to_me`). Name label at polygon centroid as a material-chip annotation (opaque scrim — contrast rule), hidden when zoomed far out.
- Coverage v1 (client-side, honest): for the territories intersecting the viewport, count loaded pins inside the polygon (point-in-polygon on `CanvassPin` coords) → chip "Maple Ridge — 34 knocked / 51 pins". Label it as pin-based coverage; do NOT invent a %-of-homes figure (no parcel data). If a territory is only partially loaded (viewport-bounded pins), suffix "in view". A true server-side aggregate is a flagged follow-up, not this phase.
- Territories toggle lives in the Layers panel (Phase 3); until then a simple on/off in Settings → Canvass.

**Done when:** territories render with AA-legible labels on satellite; coverage chip counts match visible pins; new route passes jest + `/security-review`; no shared route touched.

## Phase 3 — Layers panel + address search

**Goal:** a standard map-layers control and a fast way to jump to an address.

**Build:**
- Layers button on the map (below the gear, material circle) → `LayersSheetView` (medium detent): toggles for **Territories**, **Weather (hail swaths)**, **Roof age**, **My pins only** (Focus filter: `pin.o == my user id` — VERIFY that `o` is the `users.id` matching the authenticated profile id, not the raw auth uid; check how the viewport route populates it), plus a map-style segmented shortcut. All persisted via `@AppStorage`.
- Weather overlay: extend `/api/mobile/capabilities` **additively** with `weather_overlay: bool` (server decides — mirror the logic/flag behind `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY`, VERIFY where web reads it; this keeps iOS prod-gated by the same deploy checklist). If capability false → toggle hidden. Fetch `/api/canvass/weather` for the viewport bbox (VERIFY exact query param names in the route), decode GeoJSON → `MKPolygon`/`MKMultiPolygon` renderers (semi-transparent fills; include a small legend chip). Respect `degraded: true` → gray "weather data unavailable" chip, never an error alert.
- Roof-age overlay: same pattern from `/api/canvass/roof-age` (FeatureCollection, `degraded` handling identical). VERIFY feature properties to decide color ramp; legend chip required.
- Search: trailing search element in the floating tab bar (per Design language) → sheet with `MKLocalSearchCompleter` results biased to the current region; selecting a result flies the camera there (keep pitch). Voice comes free via the keyboard mic — no custom speech pipeline. v1 is address-only (lead-name search is a flagged follow-up).
- Debounce overlay refetches with the same bounds-cache pattern pins use; overlays must never block pin loading.

**Done when:** layer toggles persist and render correctly over satellite with AA-legible legends; weather hidden when capability is false; degraded states are quiet chips; search flies to addresses; only backend diff is the additive capabilities field (+ jest coverage for it).

## Phase 4 — Personalization: nav-bar customization, Focus Mode, time scrubber (tags optional)

**Goal:** personal workflow polish — the app adapts to each rep.

**Build:**
- Customizable tab bar: Settings → Nav Bar screen — reorder/hide tabs (Dashboard/Canvass always available; Opportunities/Measure remain capability-gated first, preference-hidden second). Persist order+visibility as a JSON `@AppStorage` string; `ContentView` builds tabs from it.
- Focus Mode: global toggle in Settings ("show only my activity") that applies the my-pins filter app-wide (Canvass filter + Dashboard defaulting to personal stats). Same `o`-field ownership check as Phase 3.
- Time scrubber: calendar-clock button in the bottom-left control group → chips 7d / 30d / 90d / All filtering pins client-side on `t` (created_at). Show an active-filter chip on the HUD so reps never wonder where pins went.
- **Tags (OPTIONAL — requires Nathan's explicit go-ahead before building):** would need an additive migration (`canvass_lead_tags` or a `tags text[]` nullable column on `leads`) + `/api/mobile/*` CRUD + writes routed through the offline queue. Prepare the proposal in handoff notes; do not build unapproved.

**Done when:** tab customization survives relaunch and never resurrects a capability-denied tab; focus + time filters compose correctly with layer toggles; zero backend diffs unless tags were approved.

---

## Definition of done — every phase
1. Xcode builds clean:
   `xcodebuild -project "ARX Sales/ARX Sales.xcodeproj" -scheme "ARX Sales" -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`
   (VERIFY the scheme name first.) Zero errors; no new warnings you introduced.
2. Backend changes (Phases 2–3 only): `npm test` passes; routes follow the auth rule; no shared-contract changes.
3. Contrast rule verified against actual satellite imagery, not a blank canvas.
4. Bug-review + collateral-impact sweep, then `/code-review` (+ `/security-review` for backend). Summarize findings and fixes.
5. Handoff notes: files changed, endpoints added/consumed, anything deferred, and (if any) migrations awaiting `apply_migration`.

Start now with Phase 0. Read `CanvassView.swift`, `ContentView.swift`, `APIClient.swift`, and `ARX_SalesApp.swift` in full first.
