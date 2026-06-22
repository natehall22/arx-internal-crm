# Canvass Weather Overlay — Research & Design Check

**Status:** Research / design only. No code changes proposed in this document are implemented.
**Author context:** Nathan (ARX). Feature idea: hail/wind overlays on the Canvass map.
**Core principle:** Door-to-door canvassing remains the core business. This is an *assistive layer* for field marketers — it helps reps decide which streets and homes to prioritize. It must never change or block the existing knock/disposition workflow.

> Honesty note: where this doc estimates coverage, effort, or describes how a third party (e.g. HailTrace) sources data, those are clearly flagged as inferences or things to verify. No pricing or vendor claims are presented as confirmed fact.

---

## 1. Goal

In the Canvass PWA, a rep can toggle a weather layer on top of the existing map:

- **Off** (default) — map looks exactly as it does today.
- **Hail** — overlays hail swaths / impact areas, colored by estimated hail size (inches). Door pins stay visible on top.
- **Wind** — overlays wind/severe-storm areas, colored by estimated wind speed (mph). Door pins stay visible on top.
- **Real estate** — explicitly out of scope for now (kept "on ice"). Design leaves a stub so it can be added later without rework.

The point is decision support: a rep standing in a neighborhood can see *was this block actually hit, and how hard* before knocking, so canvassing effort concentrates where insurance claims are most likely to land.

---

## 2. What already exists in the CRM

There is a working beta called **Roof Radar** in the admin section. It is worth understanding because it already solves part of the data problem and we should reuse, not duplicate, it.

| Piece | Path | What it does |
|---|---|---|
| Roof Radar types + scoring | `lib/roofradar.ts` | Defines `RoofRadarStormExposure` (hailEvents, maxHailInches, windEvents, maxWindMph, lastEventDate, recentEvents[]) and an A–D scoring model. |
| Open-data enrichment | `lib/roofradar-open-data.ts` | Pulls **NOAA/SPC storm reports** (free CSVs at `spc.noaa.gov/wcm/data/{year}_{hail|wind}.csv`), parses them, geocodes via the **US Census geocoder**, and computes per-property storm exposure within a radius. Has in-memory caching. |
| Scan API | `app/api/admin/roofradar/scan/route.ts` | Admin-only listing/parcel search, enriched with the storm data above. |
| UI | `app/admin/roofradar/RoofRadarClient.tsx` | Admin search UI. |

**Key takeaways:**

1. We already fetch and parse free NOAA/SPC hail + wind data server-side, with caching and a distance model. That code is reusable for the overlay.
2. **Important gap:** SPC reports are *points* (individual observations of hail size in inches / wind in mph), not *swaths* (the continuous path/area a storm affected). A point layer is useful but it is not the "hail path overlaid on the map" experience. Getting true swaths needs an additional source (see §3).
3. **Auth caveat (must fix in the new code):** the Roof Radar scan route uses raw `supabase.auth.getUser()`. Per `CLAUDE.md`, all auth must go through `requireAuth()` / `requireAuthApi()`. The new weather route must **not** copy that pattern — use `requireAuthApi()`.

---

## 3. Free data source options

Per direction: we are not paying for this. The good news, confirmed by research, is that the commercial hail-map products are themselves built on free U.S. government radar data. HailTrace's public materials describe their maps as derived from NOAA radar data plus a list of NOAA reports — so the underlying inputs are the same ones available to us for free. (This is an inference from their marketing; the exact pipeline is proprietary and not something I can verify.)

There are three usable free tiers, in increasing order of build effort:

### Tier A — NWS Alerts API (live warnings) — *easiest, real-time*
- Endpoint: `https://api.weather.gov/alerts/active` — no API key, no auth, returns **GeoJSON polygons** for active Severe Thunderstorm Warnings, Tornado Warnings, etc.
- These are ready-to-render polygons. Drop straight onto the map.
- **Limitation:** warning polygons describe *where a storm is happening now*, not hail size per location. Good for a live "storm is rolling through right now" view and for wind/severe areas; weaker for "this neighborhood got 2-inch hail last Tuesday."

### Tier B — SPC storm reports (already integrated) — *easy, historical points*
- Free CSVs already parsed in `lib/roofradar-open-data.ts`.
- Gives hail size (inches) and wind (mph) as **point reports** with dates.
- Render as graduated dots / heat points colored by magnitude. Reuses existing code.
- **Limitation:** points, not continuous swaths. Sparse in rural areas (reports depend on someone reporting).

### Tier C — MRMS MESH (true hail swaths) — *most effort, best match to the "hail path" vision*
- **MRMS MESH** (Multi-Radar Multi-Sensor, Maximum Estimated Size of Hail) is NOAA/NSSL's radar-derived gridded estimate of max hail size across the whole CONUS at fine resolution. This is the actual source the swath-style products derive from.
- Distributed as **GRIB2 grids** (raw, heavy). Turning it into map-ready polygons requires server-side processing: contour the grid by hail-size threshold and export GeoJSON.
- Free tooling exists to do this: `gdal_contour`, the `pyhail` toolkit, the `mrms-api` Python interface, and IEM has worked on curating MESH contours.
- **This is the tier that delivers the "hail swath colored by size" overlay reps imagine.** It is also the one that needs a real pipeline (a scheduled job that fetches recent MRMS, contours it, and caches GeoJSON), not a simple passthrough fetch.
- **Coverage caveat to verify:** there are pre-derived hail-swath GeoJSON layers on ArcGIS Hub (the "Northern Hail Project" open data site). I could not confirm their U.S. geographic coverage or update cadence — they appear research/region-specific and should be treated as a *reference pattern*, not a turnkey national feed. Verify before relying on them.

### Recommended phasing
- **Phase 1 (ship first):** Tier A (live NWS warning polygons) + Tier B (SPC point reports, reusing Roof Radar code). This gets a real, useful overlay in front of reps quickly with almost no new data engineering.
- **Phase 2 (the real prize):** Tier C MRMS MESH swath pipeline as a scheduled job that writes cached GeoJSON. Swap it into the same overlay UI when ready — no front-end rework because the map just consumes GeoJSON either way.

---

## 4. How the Canvass map works today (and why an overlay is low-risk)

The map lives in `app/(canvass-app)/canvass/components/CanvassMap.tsx`. Relevant facts:

- It's a **vanilla Google Maps JS** integration (not `@react-google-maps`). The map instance is held in `mapInstanceRef`.
- It already manages several independent layers imperatively:
  - **Pins** — `markersRef` (a `Map<string, Marker>`), with a `MarkerClusterer` in viewport mode.
  - **Territory polygons** — `territoryPolygonsRef`, drawn with `fillOpacity: 0.13` and `zIndex: 0`, *under* the pins. This is the existing proof that we can render tinted polygons beneath pins without interfering with them.
  - **User location marker** — `userMarkerRef`.
- It already has overlay-style UI controls: a map-type toggle and a disposition filter dropdown, positioned with absolute corners.

**Why this makes the overlay safe:** a weather layer is just *another independent layer*. We add a dedicated `google.maps.Data` instance (or a separate array of polygons), styled with low opacity and a `zIndex` below the markers, exactly like the territory polygons already do. We never touch `markersRef`, the clusterer, or `territoryPolygonsRef`. Pins continue to render on top because markers sit above `Data`-layer features by default.

---

## 5. Proposed additive design

### 5.1 Front end (CanvassMap.tsx)
- Add a **new local state**: `weatherLayer: 'off' | 'hail' | 'wind'` (default `'off'`).
- Add a **new control** in the existing control stack (a small segmented toggle, same visual language as the map-type button): Off / Hail / Wind. Real-estate option is rendered only behind a flag and is hidden by default.
- Add **one dedicated overlay layer**: `weatherDataRef = useRef(new google.maps.Data())` bound to the map, or a `weatherPolygonsRef: any[]` array mirroring the territory-polygon approach. Use `google.maps.Data` because it ingests GeoJSON directly via `addGeoJson()` and supports per-feature styling.
- On toggle change:
  - `off` → clear the weather layer only.
  - `hail` / `wind` → fetch GeoJSON for the current map bounds + selected time window from the new API route, load it into the weather layer, and style each feature by magnitude (hail inches → blue→red ramp; wind mph → green→red ramp). Set `zIndex` below markers and `fillOpacity` ~0.25–0.35 so satellite imagery and pins read through.
- Add a **legend** (color scale) that appears only when a layer is active.
- Refetch on `idle` (bounds change) is optional for Phase 1; can debounce or gate behind a "refresh this area" button to control request volume.

### 5.2 New props (the only edit to existing files)
`CanvassMap` gains optional, defaulted props so nothing else changes:
```
weatherOverlayEnabled?: boolean      // feature flag, default false
weatherTimeWindowDays?: number       // default 730 (2 years; insurance claim scope)
```
`app/(canvass-app)/canvass/page.tsx` passes `weatherOverlayEnabled` from a flag. When false, the control never renders and behavior is byte-for-byte identical to today.

### 5.3 New API route
`app/api/canvass/weather/route.ts` (new file):
- Auth via **`requireAuthApi()`** (not raw `supabase.auth.getUser()`).
- Input: bounding box (`n,s,e,w`), `layer` (`hail|wind`), `windowDays`.
- Phase 1 logic:
  - Live: fetch NWS active alerts, filter to bbox, pass through polygons.
  - Historical: reuse `lib/roofradar-open-data.ts` SPC fetch/parse/cache, filter reports to bbox + window, emit as GeoJSON points (or small buffered circles) with `magnitude` properties.
- Phase 2 logic: read cached MRMS-derived swath GeoJSON from a new table (below), filter to bbox/window.
- Output: a GeoJSON `FeatureCollection`. Server-side caching like Roof Radar already does (in-memory map keyed by bbox+window, short TTL).

### 5.4 New data/storage (additive, nullable — per CLAUDE.md)
For Phase 2 only, a new cache table, e.g. `weather_swaths`:
- Columns: `id`, `event_date`, `layer` (`hail|wind`), `magnitude`, `geometry` (GeoJSON/geography), `source`, `created_at`. RLS enabled.
- Populated by a **scheduled job** (separate worker / edge function) that fetches recent MRMS MESH, contours it, and upserts GeoJSON. Nothing reads raw GRIB2 at request time.
- This is purely additive: new table, no changes to existing schema, system stays live.

---

## 6. Non-breaking guardrails (the "do not break anything" contract)

1. **New files only**, except for *additive optional props* on `CanvassMap` and one prop pass-through in `page.tsx`.
2. **Feature-flagged + default OFF.** Ships dark. With the flag off, the canvass app is identical to today.
3. **Separate map layer.** Never read or mutate `markersRef`, `markerClustererRef`, `territoryPolygonsRef`, or `userMarkerRef`. The weather layer is its own `google.maps.Data` instance.
4. **Pins always on top.** Weather features render beneath markers (lower zIndex), low opacity.
5. **Auth correct from day one.** `requireAuthApi()` in the new route.
6. **Schema additive/nullable**, RLS on the new table. No migrations to existing tables.
7. **Own git branch**, not the current `fix/proposal-squares-and-payroll-bonuses` branch.
8. **No new front-end map dependency.** Reuse the already-loaded Google Maps script; `google.maps.Data` is part of core Maps JS.
9. **Real estate stays stubbed/hidden.**

---

## 7. Open questions to confirm before building

- **Time window:** how far back should hail history go for a rep — last storm only, last 12 months, last 24 months? (Drives data volume and relevance.)
- **Live vs historical priority:** is the more valuable view "a storm is happening right now" (NWS warnings) or "this area got hit in the last year" (SPC/MRMS)? Phase 1 can do both, but the default view matters.
- **Geographic footprint:** current canvassing is concentrated around Cabarrus County NC (per Roof Radar's ZIP list). Worth confirming the operating area so we can validate data coverage there specifically.
- **Wind swaths:** radar-estimated wind areas are harder to render cleanly than hail. Phase 1 wind can lean on NWS warning polygons + SPC wind reports rather than a true wind swath.

---

## 8. Summary recommendation

Build it in two phases on a dedicated branch, fully feature-flagged. **Phase 1** reuses the existing Roof Radar SPC pipeline plus the free NWS Alerts API to render hail/wind data as a toggleable, pins-on-top overlay — low effort, low risk, real value to field marketers immediately. **Phase 2** adds a scheduled MRMS MESH → GeoJSON pipeline to deliver true hail swaths colored by size, dropped into the same UI with no front-end rework. At every step the overlay is an independent layer that augments — never alters — the door-to-door knock workflow.
