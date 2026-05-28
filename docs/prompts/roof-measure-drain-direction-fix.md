# Roof measure — drain direction & R/H/V classification fix

**Use this prompt** for engineering agents fixing dormer/valley/hip/ridge misclassification in ARX roof measure.

**Repo:** `/Users/nathanhall/arx-internal-crm`  
**Prod tool:** `/tools/roof-measure`  
**Collateral:** `docs/prompts/roof-measure-path-to-8.md`, `docs/roof-measure-in-house-capability-prompt.md`

---

## Problem

Interior LF (`ridges_lf`, `hips_lf`, `valleys_lf`) comes from **shared edges between facet polygons** and a per-facet **downslope bearing** (compass direction water runs on the footprint).

Today that bearing is **`computeFacetDrainAzimuth()`** — centroid → average of exterior edge midpoints. It is **not** true 3D slope and fails on:

| Symptom | 3D truth | Why auto drain fails |
|---------|----------|----------------------|
| Dormer peak → valley | Ridge at dormer head | Tiny facets → parallel drain dots → `dotA×dotB > 0` → valley |
| Valley → hip / ridge | Valley | Wrong drain on one facet; azimuth diff rules misfire |
| Hip → valley | Hip (external corner) | Both facets drain “outward” on plan → valley |
| 0 hips on hip-heavy job | Substantial hip LF | Mis-count into ridge/valley (see Hickory / Greenway class) |

**Do not** fix this by using **Solar panel-facing azimuth** as the default interior classifier input. Facing ≠ downslope (often ~180° on gables). Production fix `be4bb89` uses **drain from footprint** for interior edges; keep that unless a facet has an explicit **confirmed downslope**.

**Industry:** EagleView/Aurora type edges on **3D models** with pitch per face. ARX is 2D polygons + heuristics until mask/plane LF matures.

---

## Product decision: draggable downslope arrow?

### Recommendation: **PHASED YES** (drain arrow, not “facing” arrow)

| Option | Verdict |
|--------|---------|
| Draggable **downslope** arrow on facet centroid | **YES (Phase 2)** — GIS-style; operator points arrow toward **eave / low side** |
| Repurpose Solar **Facing** label as drain control | **NO** — breaks gables; confuses training |
| Auto-only footprint drain | **Keep as default** — zero extra step on simple jobs |
| Compass rose primary | **NO** — use as sidebar fallback only |

### Why an arrow makes sense

- Fixes cases where **outline is OK** but **automatic drain guess is wrong** (dormers, L-plans, symmetric quads).
- Does **not** require redrawing polygons or learning ridge/valley draw tools.
- Maps 1:1 to `classifyRoofEdges` input: bearing 0°=N, 90°=E (same as `computeFacetDrainAzimuth`).
- Collateral-safe: store on `raw_data.facets[]`; no DB migration.

### Why not required on every job

- Simple gable/hip rectangles: auto drain is fine.
- Extra training: **“Downslope ≠ Facing (Solar)”**.
- Must not block save on day one — show when confidence is medium/low or section is `dormer`.

### Wireframe (Phase 2)

```
Map (selected facet):
  ○ centroid ───► blue arrow tip = downslope direction
  drag tip or rotate handle; snap 15° optional

Sidebar:
  Facing: SW (225°) — panel direction, not drain
  Downslope: NE (52°)  [Auto ▼ | Manual]
  [Reset to auto]  [Show on all sections ☐]
```

**Phase 1 (no drag):** Gray read-only auto arrow + degrees when facet selected.  
**Phase 0 (algo):** Better auto + heuristics without UI (ship first).

---

## Data model (additive, backward-compatible)

Per facet in `raw_data.facets[]` and `RoofFacet` in `page.tsx`:

```typescript
drain_azimuth_degrees?: number | null      // confirmed downslope (0=N, 90=E)
drain_azimuth_source?: 'footprint_auto' | 'manual' | 'solar_hint'
suggested_drain_azimuth_degrees?: number | null  // snapshot of computeFacetDrainAzimuth at load
```

**Classifier precedence (interior R/H/V):**

1. `drain_azimuth_degrees` when `drain_azimuth_source === 'manual'`
2. Else `computeFacetDrainAzimuth(...)` from footprint
3. **Never** use `facing_azimuth_degrees` for interior unless product explicitly adds a separate “use Solar for edges” toggle (not recommended)

**Eave/rake:** same drain map as interior (manual override or auto). **Facing** stays display-only.

Extend `FacetInput` in `lib/roof-measure-edge-classification.ts` accordingly.

---

## Implementation phases

### Phase P0 — Algorithm fixes (no UI arrow) — **ship first**

**Goal:** Reduce dormer/valley/hip/ridge swaps without new operator steps.

| ID | Task | File hints |
|----|------|------------|
| P0-1 | **Short shared edge + opposing metadata → prefer ridge** (e.g. length &lt; 12 LF and segment pitches differ) | `roof-measure-edge-classification.ts` |
| P0-2 | **Height-aware valley hint:** when both facets have `plane_height_at_center_meters`, shared edge closer to lower plane → valley candidate | same + pass height from `page.tsx` |
| P0-3 | Validation: `facet_count ≥ 4 && hips_lf === 0 && valleys_lf ≥ 60` (exists); add `unclassified_shared_lf > 0` and `section_type === 'dormer'` | `page.tsx` |
| P0-4 | Golden fixtures: gable dormer (head=ridge), L-valley, T-intersection | `lib/__tests__/fixtures/roof-edge-golden.json` |
| P0-5 | Wire `drain_azimuth_degrees` through classify when present (no UI yet) | `FacetInput`, `page.tsx` |

**Do NOT in P0:**

- Revert interior to Solar facing-first (Hickory regression)
- Enable `USE_PLANE_INTERSECTION_LF` in production
- Change `measurements/route.ts` save gates
- Change waste/cap math modules

**Acceptance:**

```bash
npm run roof-measure:prelaunch
npm test -- --testPathPattern="roof-measure-edge|roof-edge-golden|roof-measure-downstream|roof-material-order"
npm run build
```

Greenway `roof-material-order` frozen numbers unchanged unless inputs intentionally updated in fixture.

---

### Phase P1 — Read-only downslope preview

| ID | Task |
|----|------|
| P1-1 | Selected facet: show gray arrow on map along auto drain bearing |
| P1-2 | Sidebar: `Downslope: NE (52°) — from outline` separate from Facing |
| P1-3 | Tooltip: “Linear edges use downslope from outline; drag to adjust (coming soon)” |

No save requirement. Collateral: display only.

---

### Phase P2 — Draggable downslope arrow + persistence

| ID | Task |
|----|------|
| P2-1 | Map overlay: draggable arrow at centroid (Google Maps Marker or polyline); update `drain_azimuth_degrees` on drag end |
| P2-2 | Sidebar: Auto / Manual toggle; Reset; optional 45° snap |
| P2-3 | `updateMeasurements` on drag → live R/H/V sidebar refresh |
| P2-4 | Save/load roundtrip for `drain_azimuth_*` in `raw_data` |
| P2-5 | Optional: “Apply Solar downslope hint” = `facing + 180°` as **starter only**, labeled, never silent |

**Save gate (optional, Phase 2b):** require manual downslope only when `drain_review_required` (dormer + unclassified edges).

**Acceptance:** Browser test on complex hip + dormer; reload `?measurement_id=` preserves arrow; hips_lf &gt; 0 where expected.

---

### Phase P3 — Per-edge manual type (ops escape hatch)

Override ridge/hip/valley on a **shared edge** without redrawing polygons. Stored in `raw_data` or `linear_features`. Highest ops flexibility; more UI work. Defer until P0+P2 evaluated.

---

## Collateral NO-GO

- `POST /api/measurements` rejects valid `solar_auto` + reviewed save
- Builder drops cap lines when `ridges_lf` or `hips_lf` > 0
- Reload bypasses `slopedAreaSqft`
- P-00093 waste &lt; 15% at 80+ hip LF
- Untested `lib/*` changes without consumer grep

**Grep after each PR:**

```bash
rg -n "drain_azimuth|facing_azimuth|classifyRoofEdges|ridges_lf|hips_lf|valleys_lf" \
  lib/ app/tools/roof-measure/ app/api/measurements/ app/proposals/ components/ops/
```

---

## Engineering agent paste prompt (P0)

```text
You are fixing roof edge classification (ridge/hip/valley) in /Users/nathanhall/arx-internal-crm.

READ FIRST:
  docs/prompts/roof-measure-drain-direction-fix.md (this file)
  lib/roof-measure-edge-classification.ts
  lib/__tests__/roof-measure-edge-classification.test.ts
  app/tools/roof-measure/page.tsx (~2271-2520)

CONTEXT:
  Interior edges use computeFacetDrainAzimuth (footprint), NOT Solar facing (be4bb89).
  Mislabels: dormer peak→valley, valley→hip/ridge, hip→valley.
  Optional future: user sets drain_azimuth_degrees via draggable map arrow (P2).

P0 ONLY — minimal CRM-safe diff:

1. Extend FacetInput with optional plane_height_at_center_meters, drain_azimuth_degrees,
   drain_azimuth_source. When drain_azimuth_source==='manual', use drain_azimuth_degrees
   for that facet in classifyRoofEdges (interior + eave/rake).

2. Add short-edge ridge heuristic: shared edge length < 12 LF and facets have different
   pitch_degrees or solar_segment_index → prefer ridge over valley when dots would valley.

3. Add tests: dormer-like two small facets + main roof; L-valley fixture; keep
   "ignores misleading facing for interior" test (drain wins over facing).

4. Do NOT use facing_azimuth_degrees as default interior input.
5. Do NOT enable USE_PLANE_INTERSECTION_LF in prod.
6. Do NOT change measurements API gates, waste model, or builder cap injection.

RUN:
  npm run roof-measure:prelaunch && npm run build

RETURN: PASS/FAIL, files changed, test summary, collateral checklist, note for P1/P2 arrow UX.
```

---

## Engineering agent paste prompt (P2 — drain arrow UI)

```text
Implement Phase P2 of docs/prompts/roof-measure-drain-direction-fix.md only.

Prerequisite: P0 merged (drain_azimuth_degrees wired in FacetInput + classify).

TASKS:
1. app/tools/roof-measure/page.tsx
   - RoofFacet: drain_azimuth_degrees, drain_azimuth_source, suggested_drain_azimuth_degrees
   - On facet select: render downslope arrow at centroid (tip = bearing)
   - Drag/rotate updates drain_azimuth_degrees, drain_azimuth_source='manual', calls updateMeasurements
   - Sidebar: Downslope row separate from Facing; Auto/Manual; Reset to suggested_drain_azimuth_degrees
   - On Solar load: set suggested_drain from computeFacetDrainAzimuth; default source footprint_auto

2. restoreMeasurementOverlays / acceptDraftItem: roundtrip drain fields

3. lib/__tests__/roof-measure-roundtrip.test.ts: allowlist new raw_data fields

DO NOT:
  - Conflate Facing label with drain arrow
  - Block save on manual drain in v1 (warn only)
  - Change column mapping on roof_measurements POST

UX COPY:
  - "Downslope (water runs this way)"
  - "Facing (Solar panel direction, not drain)"

ACCEPTANCE:
  npm run roof-measure:prelaunch && npm run build
  Manual: complex roof — drag one dormer downslope → hips_lf increases, valleys_lf decreases

RETURN: PASS/FAIL, screenshot steps, collateral grep results.
```

---

## Ops training (one paragraph)

**Facing** is which way the roof plane points (Solar panels). **Downslope** is which way water runs off that plane — it controls ridge, hip, valley, and eave counts. On dormers and L-shaped sections, use **Adjust downslope** and point the arrow toward the **low/eave** side, not toward the Facing label. Simple rectangles can stay on **Auto**.

---

## Explicit deferrals

- Using Solar facing as silent interior default
- Plane LF in production without Greenway + dormer fixtures
- Required downslope arrow on every section before save (v1)
- Per-edge type override (P3) until P0+P2 ship

---

## Related commits

- `be4bb89` — drain over facing for interior (Hickory class)
- `docs/roof-measure-in-house-capability-prompt.md` — desire path #5 (facing display; drain internal)

**Doc alignment TODO:** Update `docs/roof-measurement-providers.md` to say interior uses **confirmed downslope** (auto or manual arrow), not “facing when set.”
