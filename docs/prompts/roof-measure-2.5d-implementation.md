# Executive prompt: ARX roof measure **2.5D** (not full 3D)

**Owner:** Head of Dev  
**Repo:** `/Users/nathanhall/arx-internal-crm`  
**Goal:** Improve accuracy and trust using **Google Solar planes + DSM** while keeping the **2D Maps measure UI**. Do **not** build Aurora/Hover/EagleView-style 3D editors, photo capture, or mesh viewers.

**Read first:**
- [roof-measure-in-house-capability-prompt.md](../roof-measure-in-house-capability-prompt.md) — desire paths
- [roof-measurement-providers.md](../roof-measurement-providers.md) — 2D vs 3D mismatch
- [roof-measure-industry-patterns.md](../roof-measure-industry-patterns.md) — P0/P1, what not to copy

---

## What 2.5D means here

| In scope (2.5D) | Out of scope (full 3D) |
|-----------------|-------------------------|
| Per-facet **tilted plane** from Solar (`pitchDegrees`, `azimuthDegrees`, `planeHeightAtCenterMeters`, `center`) | Navigable 3D twin / Three.js roof editor |
| **Sloped area** from plane + footprint (verify vs `footprint × pitchMultiplier`) | Hover photo capture pipeline |
| **DSM GeoTIFF** from `dataLayers:get` for height snap / boundary QA | EagleView/Roofr report APIs as geometry source |
| **Ridge/hip/valley LF** from **plane-plane intersection** (optional flag) vs pure 2D `classifyRoofEdges` | LiDAR / oblique photogrammetry stack |
| Same UX: search address → satellite → edit vertices → pitch → save → builder | SmartRoof-style perimeter → infer all faces |

**Success:** Complex hip job (e.g. Greenway) has **defensible LF + waste + caps** without users learning a new tool.

**Blocked until Phase 0 passes:** User still reports **no satellite outline on the map** after deploy (see below).

---

## Phase 0 — Satellite outline visible on map (BLOCKER — do this first)

**Do not start Phase 1–4 until Phase 0 is fixed, verified on production, and signed off.**

### Active production bug (user report)

| Field | Value |
|-------|--------|
| **URL** | `arx-internal-crm.vercel.app/tools/roof-measure` |
| **Example address** | `1361 Kison Court Northwest, Concord NC` (`1361 Kison Ct NW, Concord, NC 28027, USA`) |
| **Symptom** | Satellite imagery loads; sidebar shows **“Satellite data for this address has rough outlines only…”** but **no blue/colored polygons** on the roof after search or **Reload outline from satellite** |
| **Expected** | At minimum **visible draft or accepted facet polygons** (even if rough bbox quads), plus ridge/valley lines when API returns them |

This is **not** a 2.5D problem — it is **detect → render** (or **API returned zero drawable facets**). Fix before plane/DSM work.

### Read together

- [roof-measure-missing-google-polygons.md](./roof-measure-missing-google-polygons.md) — architecture, repro matrix, hypotheses
- [roof-measure-industry-patterns.md](../roof-measure-industry-patterns.md) — P0-1 through P0-5

### Phase 0 worker tasks

| ID | Task | Files |
|----|------|--------|
| **P0-A** | Reproduce Concord on **prod + local**; capture HAR for `POST /api/ai/detect-roof` (`facet_source`, `facets[]` length, coordinates) | — |
| **P0-B** | If API returns `facets` but map empty: trace `detectRoofWithAI` → `autoAcceptAllDrafts` → `acceptDraftItem` → `polygonsRef.setMap`; log `acceptDraftItem: skipped` | `page.tsx` |
| **P0-C** | If API returns **zero facets** + bbox-only note: **still draw** `solar_bbox` quads as dashed drafts (do not leave map blank); user must see *something* to drag | `detect-roof/route.ts`, `page.tsx` |
| **P0-D** | Gate auto-detect on `mapsLoaded && googleMapRef && google.maps.geometry`; run `restoreMeasurementOverlays` after `waitForMapToSettle` on saved load | `page.tsx` |
| **P0-E** | After **Reload outline from satellite**, user must see overlays within 10s; `isDetecting` must not clear drafts before attach completes | `page.tsx` |

### Phase 0 acceptance (all required)

- [ ] **Concord** (`1361 Kison Ct NW`): polygons **visible** on map after reload (rough is OK; blank is FAIL)
- [ ] **Greenway** (`304 Greenway Dr, Huntersville NC`): polygons visible (regression)
- [ ] Fresh address: auto-detect shows overlays without manual draw
- [ ] Saved `measurement_id` reload: overlays redrawn
- [ ] Console: no silent skip of **all** facets on accept
- [ ] `npm run roof-measure:prelaunch` + `npm run build` pass
- [ ] QA note in `docs/roof-measure-qa-YYYY-MM-DD.md` with screenshots (prod)

**Phase 0 commit message pattern:** `fix(roof): show satellite outline overlays when …`

---

## Prerequisites (must be green before Phase 2+)

- [x] Overlay commits on `main` (`617f2d9`, `f1e5177`, `19d8793`) — **insufficient alone** until Phase 0 acceptance passes on prod
- [ ] **Phase 0 complete** (Concord + Greenway visible polygons)
- [ ] `npm run roof-measure:prelaunch` + `npm run build` pass

---

## Phase 1 — Plane metadata on facets (1–2 days)

### Workers

**W1 — API audit**  
Read `app/api/ai/detect-roof/route.ts`, `lib/solar-roof-mask-facets.ts`. Document what is already returned per facet: `suggested_pitch_degrees`, `suggested_azimuth_degrees`, `solar_segment_index`, `facet_source`. Confirm whether `planeHeightAtCenterMeters` from `roofSegmentStats` is stored anywhere; if not, add to facet payload + DB `raw_data`.

**W2 — Sloped area**  
In `lib/roof-measure-geometry.ts` (or new `lib/roof-plane-geometry.ts`):

```text
slopedAreaSqft(facet) =
  if segment stats area available → use Google stats.areaMeters2 converted
  else footprintSqft × pitchMultiplierFromRise(rise)
```

Wire `updateMeasurements` in `page.tsx` to prefer plane-based area when `facet_source === 'solar_mask_plane'`. Show both in UI debug line optional: “footprint / sloped”.

**W3 — Solar pitch policy**  
Integrate `lib/roof-measure-solar-pitch.ts`:

- On `acceptDraftItem`, if `shouldAutoApplySolarPitch(draft)` → set `pitch_source: 'solar_auto'`, pitch from suggestion.
- Save gate: `isConfirmedPitchSource` (manual or solar_auto) per product decision — **document in capability prompt** if solar_auto counts as “measured pitch.”
- Tests in `roof-measure-solar-pitch.test.ts` must pass.

**Acceptance:** Greenway reload shows facets with stored segment index; sloped sq within 2% of current multiplier path unless Google area used.

---

## Phase 2 — DSM assist (3–5 days)

### Data

Google [dataLayers:get](https://developers.google.com/maps/documentation/solar/data-layers) returns `dsmUrl`, `maskUrl`, `rgbUrl` ([GeoTIFF spec](https://developers.google.com/maps/documentation/solar/geotiff)).

Extend `lib/solar-roof-mask-facets.ts` (or `lib/solar-dsm.ts`):

1. Fetch DSM raster (reuse geotiff pipeline from mask).
2. Sample elevation along facet polygon edges / vertices.
3. Outputs (per facet, optional):
   - `dsm_median_height_m`
   - `pitch_suggested_from_dsm` (compare to Solar pitch — flag if Δ > 3°)
   - Note in `validation_notes` if DSM unavailable for lat/lng (no coverage).

**Do not** replace mask polygons with DSM alone — DSM is for **QA and snap hints**, not sole footprint.

**Acceptance:** Log DSM success rate by region; no regression in mask facet count; prelaunch still pass.

---

## Phase 3 — Plane-intersection linear LF (5–10 days)

### Math (document in code comments)

For each pair of adjacent facets with planes **P1**, **P2**:

1. Plane from Solar: normal from `(pitchDegrees, azimuthDegrees)`, point from `center` + `planeHeightAtCenterMeters`.
2. Intersection of two planes → 3D line; project to ground → plan-view segment.
3. Classify segment as ridge vs hip vs valley using **dihedral angle** between planes (supplement 2D `classifyRoofEdges` azimuth heuristic).

New module: `lib/roof-plane-edge-classification.ts`  
Feature flag: `USE_PLANE_INTERSECTION_LF` (env or constant default **false** until calibrated).

### Calibration

- Run on `lib/__tests__/fixtures/roof-edge-golden.json` + Greenway (68 V, 109 H, 112 R @ 4/12).
- Target: **closer to** EagleView/Aurora benchmark where documented; never claim sub-inch.
- If plane LF worse than 2D on golden fixtures, keep flag off.

**Acceptance:** Jest suite comparing 2D vs 2.5D LF; README in test file explains when 2.5D wins.

---

## Phase 4 — UI / ops (2 days)

- Sidebar: show **facet source** (`solar_mask_plane`, `solar_bbox`, manual).
- When DSM/Solar pitch disagree > threshold → yellow note.
- Material order panel unchanged unless `total_squares` source switches to plane area (call out in release notes).

---

## Worker kickoff (copy-paste)

```
You are implementing ARX roof measure 2.5D (NOT full 3D).

BLOCKER FIRST — satellite outline not visible:
- Prod bug: 1361 Kison Ct NW, Concord NC — map loads, sidebar says "rough outlines only", NO polygons on roof after Reload outline from satellite.
- Read docs/prompts/roof-measure-missing-google-polygons.md and Phase 0 in docs/prompts/roof-measure-2.5d-implementation.md.
- Fix detect → draft/accept → google.maps.Polygon on map. If API returns bbox-only, STILL draw rough quads on map (never blank map + text only).
- Verify Concord + Greenway on arx-internal-crm.vercel.app after fix. Screenshot QA doc required.
- Do NOT start Phase 1 until Phase 0 passes.

Then 2.5D (phases 1–4 only after Phase 0):
- Read docs/prompts/roof-measure-2.5d-implementation.md
- docs/roof-measure-industry-patterns.md
- docs/roof-measurement-providers.md

Rules:
- Keep app/tools/roof-measure/page.tsx as 2D Maps UI.
- No Three.js, no Hover capture, no EagleView API.
- Cite Google Solar docs for any API field you use.
- Every phase ends with: jest roof tests, roof-measure:prelaunch, build, tsc.
- Commit only when 100% certain for real-world use; push after Phase 0 + each phase.

If planeHeightAtCenterMeters is missing from detect-roof response, add it from buildingInsights roofSegmentStats[segment_index] — do not invent fields.
```

---

## Head of Dev sign-off (per phase)

| Phase | Ship when |
|-------|-----------|
| **0** | **Concord + Greenway** polygons visible on prod; QA doc with screenshots |
| 1 | Plane metadata persisted; solar pitch policy documented; tests green |
| 2 | DSM sampled; failures graceful; no mask regression |
| 3 | Plane LF beats or matches 2D on golden + Greenway; flag default off until ops OK |
| 4 | Notes/source visible; release notes for square source |

---

## Explicit non-goals

- Full 3D editor, SKP export, async Hover jobs
- Replacing `roof-waste-model` or cap math (LF input may improve later)
- Promising EagleView parity without fixture proof

---

## File map (expected touch)

| Phase | Files |
|-------|--------|
| 1 | `detect-roof/route.ts`, `page.tsx`, `roof-measure-solar-pitch.ts`, `roof-measure-geometry.ts`, measurements API `raw_data` |
| 2 | `solar-roof-mask-facets.ts`, new `solar-dsm.ts`, `detect-roof/route.ts` |
| 3 | `roof-plane-edge-classification.ts`, `roof-measure-edge-classification.ts` (delegate or compare), tests |
| 4 | `page.tsx` notes panel, docs |
