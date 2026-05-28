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

---

## Prerequisites (must be green before Phase 2+)

- [ ] P0 overlay path: detect → visible polygons; saved `measurement_id` → `restoreMeasurementOverlays` on map idle ([missing-google-polygons prompt](./roof-measure-missing-google-polygons.md))
- [ ] `npm run roof-measure:prelaunch` + `npm run build` pass
- [ ] `main` deployed with overlay fixes (`617f2d9`, `f1e5177`, `19d8793`+)

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

Read:
- docs/prompts/roof-measure-2.5d-implementation.md
- docs/roof-measure-industry-patterns.md
- docs/roof-measurement-providers.md

Rules:
- Keep app/tools/roof-measure/page.tsx as 2D Maps UI.
- No Three.js, no Hover capture, no EagleView API.
- Cite Google Solar docs for any API field you use.
- Every phase ends with: jest roof tests, roof-measure:prelaunch, build, tsc.

Start with Phase 1 only. Commit when tests pass. Do not start Phase 3 until Phase 1+2 merged and Greenway browser spot-check documented in docs/roof-measure-qa-YYYY-MM-DD.md.

If planeHeightAtCenterMeters is missing from detect-roof response, add it from buildingInsights roofSegmentStats[segment_index] — do not invent fields.
```

---

## Head of Dev sign-off (per phase)

| Phase | Ship when |
|-------|-----------|
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
