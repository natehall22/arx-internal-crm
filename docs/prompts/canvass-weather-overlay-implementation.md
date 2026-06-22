# Implementation Prompt — Canvass Weather Overlay (Hail / Wind) — Phase 1 TRIAL

> **Paste this whole file into Cursor as the task brief.** It is self-contained: you do not need any other doc open to build it. The other docs in `docs/canvass-weather-overlay-*.md` are background only and are referenced where useful.
>
> Scope is a **Phase 1 trial**: a toggleable, feature-flagged weather overlay (hail/wind) under the canvass pins, built from **free data that already exists in this repo** (SPC storm reports via `lib/roofradar-open-data.ts`) plus the **live NWS Alerts API**. It must be **additive and non-breaking** — with the flag off, the canvass app is byte-for-byte identical to today. **Do not build the MRMS MESH swath pipeline** (that is Phase 2, out of scope — see the bottom of this doc).

---

## 0. HANDOFF-READINESS VERDICT (read first)

**Is this ready to hand to Cursor to build a trial? YES — with the two must-decide-first items below resolved.**

This brief has been QA'd against the live codebase. The architecture (separate `google.maps.Data` layer under pins, feature flag, `requireAuthApi()` route, fail-soft fetch) is sound and genuinely low-risk because it mirrors patterns already in `CanvassMap.tsx` (territory polygons at `fillOpacity 0.13 / zIndex 0`, under pins). The trial is small: one new API route, additive props on `CanvassMap`, a small UI control + status strip + legend, a claims-safe storm block in the existing bottom sheet, one new export from an existing lib, and one line in `page.tsx`.

**Must decide BEFORE building (two items only):**

1. **Claims-safe / legal copy (BLOCKER for launch, not for code).** Every magnitude shown to a rep or homeowner must read as an *estimate* and must never assert damage or instruct a claim. Approved wording for the trial UI: *"This area may have been impacted — free inspection"* and *"est. up to 1.5″ hail · May 14."* Forbidden: *"you have damage," "your roof is damaged," "file a claim."* This shapes the bottom-sheet copy you write in this trial, so the wording must be locked before you write that copy. **Recommendation to verify with counsel** before reps use it in the field; you may build the UI with the approved strings as placeholders.
2. **Auth requirement (BLOCKER, code-enforced).** The new rep-facing route MUST use `requireAuthApi()` from `lib/auth.ts`. The existing Roof Radar routes use raw `supabase.auth.getUser()` — **do not copy that pattern.** Verification must prove an unauthenticated request returns 401.

**Explicitly out of scope for the trial (do not build):** MRMS MESH GRIB2 → contour pipeline; the daily refresh cron is *optional* pre-warm only (see §8); a `weather_swaths` / `weather_cache` table is **not** created in the trial; no anti-cherry-picking / knock-volume UI (the product owner is not worried about it — monitor knock volume later if desired, but it adds zero build steps here).

> **Every numeric threshold, color, opacity, time window, freshness value, and legal/compliance statement in this brief is a recommendation to verify, not an established fact.** They are sensible defaults chosen to ship a trial; confirm with the product owner / counsel before treating any as final.

---

## 1. Role & objective

You are working in the ARX internal CRM (Next.js 14 App Router, TypeScript strict, Supabase, custom cookie/Bearer auth via `lib/auth.ts`). Add an **assistive weather overlay** to the field-rep Canvass PWA (`app/(canvass-app)/canvass/`): a toggle that layers hail or wind storm data on the existing Google Map, with door pins still on top and still tappable. This is a decision aid for door-to-door reps — it must not change or block the existing knock/disposition workflow.

**Primary user = the field door team.** This is first and foremost a one-thumb, in-the-field tool used on a cheap Android in direct sun on spotty LTE. Every design call serves that rep at the door: glanceable, sunlight-readable, never blocking pin-dropping or dispositions, never adding a step. Any office/manager/reporting use is strictly secondary and must not add weight to the rep experience.

---

## 2. Hard constraints — do not violate

1. **Feature-flagged, default OFF.** Gate everything behind `process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY === 'true'`. With it off (or unset), the canvass app is byte-for-byte identical to today.
2. **Additive only.** New files, plus *optional/defaulted* props on `CanvassMap`, one line in `page.tsx`, and **one new named export** added to `lib/roofradar-open-data.ts` (see §5 — this is a pure addition, no existing code in that file changes). No other edits to existing files.
3. **Never touch** `markersRef`, `markerVisualsRef`, `markerClustererRef`, `clusteredPinIdsRef`, `territoryPolygonsRef`, `userMarkerRef`, or `mapInstanceRef`'s existing marker/clusterer/idle logic in `CanvassMap.tsx`. The weather layer is a **separate** `google.maps.Data` instance in a **new** ref.
4. **Pins always on top and clickable.** Weather features render *beneath* markers (`zIndex: 1` — above the territory polygons at `0`, below all markers; sold pins are `700`, user marker `1000`). Swath features are **non-interactive** (`clickable: false`) so a tap always reaches the pin or drops a new pin exactly as today.
5. **Auth:** the new rep-facing route MUST use `requireAuthApi()` from `lib/auth.ts`. **Do NOT use raw `supabase.auth.getUser()`.** Note: `requireAuthApi()` *throws* on failure (it does not return null) — wrap it in try/catch and return 401 on throw.
6. **No schema changes, no migrations, no new tables in the trial.** (Phase 2 may add a nullable, additive, RLS-enabled cache table — not now.)
7. **No new front-end map dependency.** Reuse the already-loaded Google Maps JS; `google.maps.Data` is part of core Maps JS. No new npm packages.
8. **Offline isolation (hard requirement).** The weather code must NEVER read or write the offline store (`useOfflineStore`/`offlineStore`), `pendingLeads`, the pin-drop FAB, the map-click handler, or `LeadModal`'s actions. The service worker (`public/canvass-sw.js`, line 46) skips `/api/*` entirely, so the weather fetch gets zero SW help — it must have its **own `AbortController` + a hard timeout (~6–8s)** and must **never block pin-dropping, disposition logging, or sync.** If `navigator.onLine === false`: render last-good cached features if present (calm "Offline — last data shown · [date]" strip), else show a muted "Offline — no stored storm data." Never an indefinite spinner, never an error wall over the map.
9. **Work on a new branch** off `main` (e.g. `feat/canvass-weather-overlay`). Do NOT build on `fix/proposal-squares-and-payroll-bonuses`.
10. TypeScript strict must pass; run lint and `next build` before declaring done.

---

## 3. Use agents / subagents (required workflow)

1. **Explore agent first (read-only).** Before writing code, map exactly how `CanvassMap.tsx` manages its layers (markers, `MarkerClusterer`, territory polygons, user marker, the `idle` listener, the `onRefreshArea` button, the left control stack), how `page.tsx` wires props (it passes `onBoundsChanged`, `onRefreshArea={clearViewportCache}`, `isOnline`, etc.), and what `lib/roofradar-open-data.ts` actually exports today (**only `enrichPropertiesWithOpenData`** — the SPC fetch/parse helpers are private). Report the precise refs, effects, and signatures to avoid or reuse. Do not edit until this map is done.
2. **Plan agent.** Lock the API route contract (params + GeoJSON response shape + cache key), the new export to add to `lib/roofradar-open-data.ts`, and the minimal additive diff to `CanvassMap.tsx`. Human reviews the plan before any file is edited.
3. **Implement** once the plan is approved.
4. **Verification agent at the end (required).** A separate agent confirms: no existing refs/effects mutated; flag truly no-ops when off; `requireAuthApi()` enforced (unauth → 401); weather fetch fully isolated from the offline queue; `tsc --noEmit`, lint, and `next build` pass. Then run the repo's **`security-review`** on the branch diff. Treat any finding as a blocker.

---

## 4. Files in play

**New files:**
- `app/api/canvass/weather/route.ts` — the rep-facing GeoJSON API (§5).

**Edited files (additive only):**
- `lib/roofradar-open-data.ts` — add **one new exported function** that fetches+parses SPC reports for a bbox/window (§5.1). The existing private `fetchSpcReports`, `parseCsv`, `readCell`, `parseSpcDate`, `distanceMiles`, `candidateYears` are NOT exported today; rather than exporting all of them, add a single new exported wrapper (e.g. `getSpcReportsInBbox`) that uses them internally. No existing code in this file changes.
- `app/(canvass-app)/canvass/components/CanvassMap.tsx` — additive props, a new `google.maps.Data` ref, the toggle/strip/legend UI, the bottom-sheet storm block (§6, §7).
- `app/(canvass-app)/canvass/page.tsx` — one line passing the flag prop (§6.4).

**Read for reference (do not edit):**
- `lib/auth.ts` — `requireAuthApi()` (throws on failure).
- `app/api/cron/sync-444/route.ts` — the `CRON_SECRET` Bearer pattern, only if you build the optional pre-warm cron (§8).
- `public/canvass-sw.js` — confirms `/api/*` is skipped by the SW (line 46); your fetch is on its own.
- `vercel.json` — currently 3 crons (two hourly, one daily `0 3 * * *`).

---

## 5. New API route: `app/api/canvass/weather/route.ts`

- `GET`, `export const dynamic = 'force-dynamic'`.
- **Auth:** `try { await requireAuthApi() } catch { return NextResponse.json({error:'Unauthorized'}, {status:401}) }`. (It throws; it does not return null.)
- **Query params:**
  - `n,s,e,w` — bbox floats (north, south, east, west).
  - `layer` — `'hail' | 'wind'`.
  - `windowDays` — integer, default **730** (2 years; see §9). Hard cap 730.
- **Logic:**
  - **Historical points (SPC):** call the new exported helper from `lib/roofradar-open-data.ts` (§5.1) to get SPC reports for `layer` within the bbox and `windowDays`. Emit each as a GeoJSON `Point` feature:
    ```
    properties: { kind: 'report', layer, magnitude /* inches or mph */, date /* ISO */, source: 'spc' }
    ```
  - **Live warnings (NWS):** fetch `https://api.weather.gov/alerts/active?status=actual&message_type=alert` with a `User-Agent` header (NWS requires one — use `ARX-CRM (nathan@arxroofing.com)`). Keep features that are Severe Thunderstorm / Tornado warnings whose geometry intersects the bbox. Pass their polygon geometry through as features:
    ```
    properties: { kind: 'warning', layer, event /* e.g. "Severe Thunderstorm Warning" */, source: 'nws', expires /* ISO if present */ }
    ```
  - **Server cache:** in-memory `Map` with short TTL (~30 min, matching `roofradar-open-data.ts`'s `DEFAULT_CACHE_MS`), keyed by `` `${n}|${s}|${e}|${w}|${layer}|${windowDays}` ``. (Note: this is per-lambda and will not survive cold starts — acceptable for a trial; durable caching is Phase 2.)
- **Response:** a GeoJSON `FeatureCollection`. **Fail soft** — on any upstream error, return an empty `FeatureCollection` with **HTTP 200**, never break the client. Include a top-level `refreshedAt` ISO timestamp in the response body (the client uses it for the freshness label).

### 5.1 New export to add to `lib/roofradar-open-data.ts`

The SPC fetch/parse code already exists in this file but is **private**, and the only export today (`enrichPropertiesWithOpenData`) returns per-property A–D scoring, not a bbox report list. Add **one new exported function** (no changes to existing code):

```ts
// Returns SPC reports of the given type within a bbox, restricted to the last `windowDays`.
export async function getSpcReportsInBbox(
  bbox: { n: number; s: number; e: number; w: number },
  type: 'hail' | 'wind',
  windowDays: number,
): Promise<Array<{ lat: number; lng: number; magnitude: number; date: Date }>>
```

Implement it using the existing private `fetchSpcReports(year, type)` across `candidateYears()`, filtering by bbox and by `date >= now - windowDays`. (SPC CSV URL in this repo is `https://www.spc.noaa.gov/wcm/data/{year}_{type}.csv` — note the `www.` — and the in-memory `reportCache` already dedupes per `year-type` within a process.)

> SPC reports are sparse human-reported **points**, not continuous coverage. Do NOT interpolate them into fake "swaths." Render them as graduated/soft point markers and keep all copy honest (see §7).

---

## 6. `CanvassMap.tsx` — additive changes

### 6.1 New props (defaulted so nothing changes when absent)
```ts
weatherOverlayEnabled?: boolean   // default false
weatherTimeWindowDays?: number    // default 730 (2 years)
```

### 6.2 New refs/state (all additive)
```ts
const weatherDataRef = useRef<any>(null) // dedicated google.maps.Data instance
const [weatherLayer, setWeatherLayer] = useState<'off' | 'hail' | 'wind'>('off')
const weatherAbortRef = useRef<AbortController | null>(null)
// plus: last-good cached FeatureCollection (in-memory, this session) + a freshness date for the strip
```
Initialize `weatherDataRef.current = new google.maps.Data({ map: mapInstanceRef.current })` **once**, after the map is created, in a **new** effect — do not modify the existing map-init effect's marker/idle logic. Style features with `setStyle` (a function) and `weatherDataRef.current.setStyle` so there is one paint, not N. Set features `clickable: false`.

### 6.3 UI — only renders when `weatherOverlayEnabled` is true
Match the existing controls exactly: white `rounded-full shadow-lg` buttons, `w-12 h-12` (48px), in the left stack at `bottom-24 left-4` (see the map-type button for the pattern). Tap targets ≥44px.

- **Toggle control (collapse-when-off):** a collapsed 48px cloud/storm button joins the **top** of the left control stack. Tapping it expands a white segmented pill: **Off / Hail / Wind**. Selecting `Off` collapses it back to the button. (Do NOT render a locked "Real estate" segment in the trial — leave real estate fully out; see §7.4.)
- **Status strip:** a thin pill pinned **top-center** (`top: max(16px, env(safe-area-inset-top))`, centered, `z-10`), shown only when a layer is active. Shows the single most useful number for the current viewport, claims-safe: e.g. **"est. up to 1.5″ hail · May 14"** (hail) / **"est. up to 68 mph wind · May 14"** (wind). On empty: muted **"No recorded hail in this area"** (never "no hail occurred"). On offline-with-cache: **"Offline — last data shown · [date]"** with an amber dot.
  - The strip is **read-only** (top-center is out of a walking thumb's reach). Do NOT put a refresh tap target on the strip. If you offer a manual refresh, reuse the existing bottom-left refresh button area (thumb-reachable) — but for the trial, fetching once on layer activation is sufficient.
- **Legend chip:** bottom-left, just above the left control stack, shown only when a layer is active. A compact swatch→label key using §7.1 buckets, with real-world size anchors ("1″ quarter," "1.25″ half-dollar," "1.75″ golf ball"). Swatch dots get a 1px `rgba(0,0,0,0.15)` ring so saturated low buckets stay visible on white.

### 6.4 On layer change
- `off` → clear weather features only (`weatherDataRef.current.forEach(f => weatherDataRef.current.remove(f))`); hide strip + legend; abort any in-flight fetch.
- `hail` / `wind` → abort any prior fetch, start a new `AbortController`, fetch `/api/canvass/weather?...` for the current map bounds + window with a **hard ~6–8s timeout**. On success: clear old features, `addGeoJson()` the new collection, apply `setStyle`, show strip + legend. On timeout/error/offline: fall to last-good cached features if present, else the calm empty/offline strip. **Never block, never spin indefinitely, never touch the offline queue.**

### 6.5 `page.tsx` — one line
Pass `weatherOverlayEnabled={process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY === 'true'}` into `<CanvassMap />`. Nothing else.

---

## 7. Visual + at-the-door behavior

### 7.1 Color ramps (recommendations — tuned for a sunlit hybrid/satellite basemap; verify outdoors on a cheap Android)

Sunlight legibility is the #1 field risk. Translucent pastels vanish on a bright budget screen over satellite imagery. So: **raise the opacity floor, bias low buckets toward saturated/darker (not pastel), and make a thin saturated stroke the primary read.** Validate on an actual ~$150 Android in direct sun before finalizing.

**Hail (by estimated inches)** — violet/magenta family (deliberately avoids red/green so it never collides with disposition pin colors):

| Bucket (in) | Fill | Fill opacity | Stroke |
|---|---|---|---|
| 0.75–1.00 | `#2DD4BF` (teal-400, saturated) | 0.35 | `#0F766E` 0.85, 1.5px |
| 1.00–1.25 | `#6366F1` (indigo-500) | 0.35 | `#4338CA` 0.85, 1.5px |
| 1.25–1.75 | `#A855F7` (violet-500) | 0.38 | `#7E22CE` 0.9, 1.5px |
| ≥1.75 | `#E11D74` (magenta) | 0.40 | `#9D174D` 0.9, 1.5px |

**Wind (by estimated mph)** — amber→orange→red family:

| Bucket (mph) | Fill | Fill opacity | Stroke |
|---|---|---|---|
| 45–58 | `#F59E0B` (amber-500) | 0.35 | `#B45309` 0.85, 1.5px |
| 58–70 | `#F97316` (orange-500) | 0.38 | `#C2410C` 0.85, 1.5px |
| ≥70 | `#B91C1C` (dark red) + 1.5px dashed stroke | 0.38 | `#7F1D1D` 0.9, dashed |

- **Opacity ceiling 0.40** so satellite texture and pins always read through.
- **Stroke is the primary read** — solid/dashed 1.5px saturated edges survive glare better than fills.
- The only clash risk is wind ≥70 (dark red) under a red `hot_lead` pin; the pin's solid white/amber teardrop ring + the dashed wind stroke keep them separate.
- SPC points: render as soft graduated circles (small disc) colored by bucket; do not draw hard "swath" polygons from points.

### 7.2 Layering (must match existing)
- Territory polygons: `fillOpacity 0.13`, `zIndex 0` — **unchanged**, sits below.
- Weather features: `zIndex 1`, `fillOpacity` per §7.1 — above territories, below all markers, `clickable: false`.
- Pins/markers: default marker stack (above `Data`); sold `700`; user `1000` — **unchanged**.

### 7.3 Bottom sheet — claims-safe per-home storm block
The sheet is the **existing** `LeadModal` knock/disposition sheet. Add a **single collapsed one-line banner** at the top of the sheet body, only when a layer is active, e.g. **`⛈ est. golf-ball hail · May 14 ▸`** — tap to expand. Keep it ONE line by default so it never pushes the **disposition chips** below the fold; the disposition chips remain the dominant, top-most action. No new required step in the knock flow.

Expanded content (claims-safe; verify wording with counsel):
- Headline magnitude at this location, **always prefixed "est."**: *"est. 1.5″ hail"* / *"est. 68 mph wind."* If the pin is outside any feature: muted *"No recorded hail at this address — data is incomplete."*
- Event date (historical) or *"Active warning until 4:15 PM"* (live warning). A home inside *only* a warning polygon (no SPC report) shows *"In an active storm warning — no confirmed or estimated hail yet,"* not a magnitude.
- A one-tap **talk-track hook** (claims-safe): *"Your street may have been impacted by hail on May 14 — we're offering free roof inspections in the area."*
- **Forbidden copy anywhere:** "you have damage," "your roof is damaged," "file a claim," "NOAA confirms." The overlay is a canvassing prioritizer, not a damage assessment or claims tool.
- Use the pin's own lat/lng for the per-home magnitude lookup (precise), not a re-geocode of the address string.

Optional priority chip ("Knock first / Worth a look / Low signal") is allowed as coaching, never a gate, and never relabeled "skip." It is not required for the trial.

### 7.4 Real estate
Out of scope. Do **not** render a real-estate segment or locked teaser in the trial (it eats thumb space and fires toasts for no value). Leave the architecture open so it can be added later, but render nothing for it now.

---

## 8. Optional daily pre-warm cron (NOT required for the trial)

A simple Vercel cron may pre-warm the SPC fetch so the day's first rep request is faster, but it is **optional** for the trial and adds no value unless durable caching exists (the route's in-memory cache is per-lambda). If you build it:
- New route `app/api/cron/weather-refresh/route.ts`, `GET`, `export const dynamic = 'force-dynamic'`.
- Secure it with the **`Authorization: Bearer ${CRON_SECRET}`** pattern, copied exactly from `app/api/cron/sync-444/route.ts`: return 503 if `CRON_SECRET` unset, 401 if the header mismatches. Do **NOT** use `requireAuthApi()` (a machine cron has no session).
- It just calls the same SPC fetch to warm caches; it writes **no new tables** in the trial.
- Adding it requires one entry in `vercel.json`. **Verify the current Vercel plan allows a 4th cron** before merging (the repo already runs 3). If unsure, skip the cron entirely — the trial works fully without it (cold fetch on first request).

**The full MRMS MESH / GRIB2 worker and any `weather_swaths`/`weather_cache` tables are Phase 2 and explicitly out of scope.**

---

## 9. Defaults for the trial (recommendations to confirm)

- **Default layer when first turned on:** Hail (ARX is storm/insurance roofing; hail drives most insurable claims). Remember last-used layer per device.
- **Default time window:** 730 days (2 years), hard-capped at 730 — insurance claim scope does not run past 2 years (decided with ARX). Always show the event date so recency is never ambiguous.
- **Live vs historical in the strip:** when an active NWS warning and historical SPC data both exist, the live warning takes the strip headline (always labeled "warning"); historical magnitude shows only when it exists.
- **Default basemap:** unchanged (hybrid/satellite).

---

## 10. Definition of Done / acceptance checklist

- [ ] **Flag off (or unset):** canvass app is identical to today — pins, clusterer, territories, dispositions, pin-drop, offline queue all unchanged. No weather control renders.
- [ ] **Flag on:** tapping Hail/Wind draws colored storm features *under* the pins; pins remain clickable and on top; switching layers swaps cleanly; Off clears the layer and collapses the control.
- [ ] **Auth:** `requireAuthApi()` enforced on `app/api/canvass/weather/route.ts`; an unauthenticated request returns **401**. Raw `supabase.auth.getUser()` is NOT used anywhere in the new code.
- [ ] **Fail-soft:** upstream (SPC/NWS) error → route returns 200 + empty FeatureCollection; client shows the calm empty state, never an error wall.
- [ ] **Offline isolation:** with `navigator.onLine === false`, the weather layer shows cached/last-good or a calm offline strip and does nothing else; it never calls `useOfflineStore`, never blocks `LeadModal` or pin-dropping, never intercepts map clicks. The weather fetch uses its own `AbortController` + hard timeout.
- [ ] **No forbidden edits:** only the new route, the one new export in `lib/roofradar-open-data.ts`, `CanvassMap.tsx` (additive), one line in `page.tsx`, and (optional) the cron route + one `vercel.json` line. No migrations, no new tables.
- [ ] **Claims-safe copy:** every magnitude reads "est."; bottom-sheet and talk-track use the approved wording; no "you have damage / file a claim" anywhere.
- [ ] **Build health:** `tsc --noEmit`, lint, and `next build` all pass.
- [ ] **Sign-off:** verification agent confirms the above and `security-review` on the branch diff is clean. Any finding is a blocker.

---

## 11. Phase 2 (do NOT build now — note for later)
A scheduled worker (GitHub Action / container with GDAL+Python — **not** a Vercel lambda) fetches recent NOAA **MRMS MESH** GRIB2, contours it by hail-size threshold (`gdal_contour` / `pyhail`), simplifies the geometry, and upserts GeoJSON into a new nullable, additive, RLS-enabled `weather_swaths` table (writes via service role). The same API route then reads cached swaths and serves them through the identical `FeatureCollection` shape — no front-end rework. This is what delivers true HailTrace-style hail swaths colored by size. None of it is in the trial.

---

## Appendix — contradictions reconciled from the source docs

The six background docs disagreed on several values. This brief states ONE answer for each:

| Topic | The conflict | Resolved to (in this brief) |
|---|---|---|
| Swath fill opacity | design doc `0.25–0.35`; impl prompt `~0.3`; UI spec `0.26–0.34`; field-readiness "raise floor to ~0.35" | **Floor 0.35, ceiling 0.40**, saturated low buckets, stroke as primary read (field-readiness wins — sunlight legibility). |
| Hail color ramp | UI spec teal→indigo→violet→magenta pastels; field-readiness says pastels vanish in sun | Same violet/magenta family but **saturated/darker**, opacities raised (§7.1). |
| Refresh strategy | impl prompt "optional, debounce or gate"; UI spec "explicit Refresh on the top-center strip"; field-readiness "strip refresh is unreachable mid-walk" | **Fetch once on layer activation for the trial.** No refresh tap target on the strip; if a manual refresh is added later, use the thumb-reachable bottom-left button. |
| Default time window | open question in design doc; UI spec & impl prompt = 365 | **730 days (2 years)**, hard-capped — insurance claim scope (decided with ARX). |
| Default layer | UI spec recommends Hail; design doc lists it as open | **Hail**, remember last-used per device. |
| Bottom-sheet storm block | UI spec "~3 compact rows"; field-readiness "collapsed one-liner, expandable" | **Collapsed one-liner, expandable** — disposition chips must stay top-most. |
| Real-estate segment | design/UI specs render a locked "coming soon" segment; field-readiness says hide it | **Render nothing** for real estate in the trial. |
| Reusing SPC code | impl prompt said "reuse `fetchSpcReports`" but that function is **private** (only `enrichPropertiesWithOpenData` is exported) | Add **one new exported wrapper** `getSpcReportsInBbox` to `lib/roofradar-open-data.ts`; existing code unchanged. |
| Cron / refresh job | refresh-job spec treats a daily cron + new `weather_cache` table as core | **Optional pre-warm only, no new tables** in the trial; full job is Phase 2. |
| `requireAuthApi()` return | impl prompt implied `if (!auth) return 401` | It **throws** on failure — use try/catch → 401. |
| Cherry-picking / 444 | risk + field-readiness docs make it a major design concern | **Down-ranked per product owner** — no anti-cherry-pick UI; monitor knock volume later if desired. |
| SPC URL | impl prompt wrote `spc.noaa.gov/...` | Actual repo URL is `https://www.spc.noaa.gov/wcm/data/{year}_{type}.csv` (with `www.`). |
