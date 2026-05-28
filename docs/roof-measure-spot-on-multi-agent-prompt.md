# Multi-agent prompt: Make ARX roof measure spot-on

> **Superseded for product scope:** [roof-measure-in-house-capability-prompt.md](./roof-measure-in-house-capability-prompt.md) — ARX does **not** use EagleView software; vendor names here mean **report-benchmark targets** only.

## Related docs

| Doc | Purpose |
|-----|---------|
| [roof-measure-README.md](./roof-measure-README.md) | Quick start, commands, architecture |
| [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md) | Production launch orchestration |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Human QA before prod |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Calibration & prelaunch gate |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Browser QA report template |
| [roof-measurement-providers.md](./roof-measurement-providers.md) | Aurora / Solo / Google vs ARX |



**Status:** Wave 1 implemented in-repo (see `docs/roof-measure-accuracy-report.md`). Re-run agents only for gaps.

**Copy everything below the line into a new Cursor session (or orchestrator).** Run agents in parallel where marked `PARALLEL`; respect `BLOCKED BY` order for merges.

**Repo:** `/Users/nathanhall/arx-internal-crm`  
**Tool:** `/tools/roof-measure` (`app/tools/roof-measure/page.tsx`)  
**North star:** Saved measurements must produce **material orders crews can build** — correct **sloped area**, **ridge/hip/valley/eave/rake LF**, **waste %**, and **cap bundles** on real jobs (e.g. P-00093 class failures).

**Read first (all agents):**
- `docs/roof-measurement-providers.md` — how Aurora, Solo, Google Solar, and ARX define **roof faces** vs **edges**
- `lib/roof-measure-edge-classification.ts` — current 2D edge inference
- `scripts/roof-measure-eval-fixtures.json` — EagleView/Roofr ground truth targets

**Do NOT:**
- Build or extend **webhooks** / OAuth / Aurora import pipelines in this initiative
- Revert to facet-count **bucket heuristics** for linear LF
- Change `lib/roof-squares-equation.ts` or cap math unless tests prove error
- Break the live tool: feature-flag risky changes; keep manual ridge/valley overrides

---

## Core product model (every agent must follow)

### One facet = one physical roof plane (Aurora / Google / Solo semantics)

| Field | Meaning | Source priority |
|-------|---------|-----------------|
| Footprint polygon | Plan-view outline of **one** sloped plane | User-drawn > Solar mask > vision |
| `pitch` / `pitch_rise` | User-confirmed slope (rise/12) | User required before save; Solar **suggests** only |
| **Facing azimuth** | Compass direction the plane **faces** (panel normal) — Google `azimuthDegrees`, Aurora `faces[].azimuth` | Solar segment when `solar_segment_index` matches |
| **Drain azimuth** | Direction water runs downslope — **internal only** for `classifyRoofEdges` | `computeFacetDrainAzimuth()` — do not confuse with facing |
| `orientation` (saved) | Today: 8-wind from **drain**. Target: **facing** azimuth for display/DB (solar-industry standard) OR add `facing_orientation` and keep drain internal |
| `flat_area_sqft` | Footprint from polygon | `roof-measure-geometry` |
| `area_sqft` | Sloped area | footprint × `pitchMultiplierFromRise` OR cross-check Solar `areaMeters2` when segment linked |
| Linear LF | Per-edge-type totals | `classifyRoofEdges()` + manual ridge/valley lines |

### Why we’re not “Aurora-identical” yet

Aurora/Solo: **3D model → typed edges → LF**.  
ARX: **2D polygons → inferred edges → LF**.  
Goal: **Close the gap** via better plane breaks, snap, facing-aware hints, calibration fixtures, and UX — not pretend 2D equals 3D.

---

## Agent 0 — Lead / integrator (run first, then coordinate)

**Role:** Own merge order, avoid conflicting schema/UI changes, run final gates.

**Tasks:**
1. Read full codebase paths above; produce a 1-page **gap list** (face vs edge vs area vs UX).
2. After parallel agents finish, resolve conflicts (single source of truth for `orientation` vs new fields).
3. Run final gate:
   - `npx tsc --noEmit`
   - `npm test -- lib/__tests__/`
   - `npm run roof-measure-eval` if script exists and API key available
4. Document **residual error budget** (% LF variance vs EagleView fixtures) in `docs/roof-measure-accuracy-report.md`.

**Deliverable:** Merge-ready branch notes + accuracy report.

---

## Agent 1 — Face model & Solar alignment `PARALLEL`

**BLOCKED BY:** nothing  
**BLOCKS:** Agent 2 (edge classification may use facing hints), Agent 5 (UI)

**Mission:** Align each saved facet with **Google Solar / Aurora plane** semantics (pitch + **facing** azimuth).

**Tasks:**
1. **Separate facing vs drain**
   - Add `facing_azimuth_degrees` (or repurpose `orientation` with migration plan) on `RoofFacet` in page state and save payload.
   - On facet create/import: set facing from `suggested_azimuth_degrees` when present; else derive from Solar segment by `solar_segment_index`.
   - Keep `computeFacetDrainAzimuth` **only** inside `classifyRoofEdges` (and optional debug UI).
2. **Surface facing in UI** (`page.tsx` pitch modal / facet list)
   - Show: “Suggested facing: 147° (SE)” from Solar alongside pitch suggestion.
   - Do not label Solar azimuth as “drain direction.”
3. **Sloped area cross-check**
   - When `solar_segment_index` matches and Solar provides `areaMeters2`, show non-blocking note if `|area_sqft - solarSlopedArea| / solarSlopedArea > 10%`.
4. **Helper module** `lib/roof-face-solar-alignment.ts`
   - `facingAzimuthFromSegment(azimuthDegrees)`, `pitchRiseFromSegment(pitchDegrees)`, `slopedAreaSqftFromSegment(areaM2)`.
   - Unit tests with Google doc examples (0° N, 90° E, 180° S).
5. Update `docs/roof-measurement-providers.md` with ARX field mapping after implementation.

**Acceptance:**
- Imported Solar facets show **facing** suggestion in UI.
- Saved measurement stores facing degrees or 8-wind consistent with Solar convention.
- No regression: user must still confirm pitch before save.

**Do not:** Add webhooks or Aurora API calls.

---

## Agent 2 — Edge classification accuracy `PARALLEL`

**BLOCKED BY:** Agent 1 design note on facing vs drain (read only; can start in parallel)  
**BLOCKS:** Agent 4 (fixtures)

**Mission:** Make `classifyRoofEdges` match **EagleView/Roofr-class** LF on standard roofs within agreed tolerance.

**Tasks:**
1. **Audit** `lib/roof-measure-edge-classification.ts` against `docs/roof-measurement-providers.md`.
2. **Snap & adjacency**
   - Tune `SHARED_EDGE_TOLERANCE_DEG` with real lat/lng drawings (hand-drawn jitter).
   - Ensure T-junctions don’t drop edges (`unclassified_shared_lf` → 0 on fixture sets).
3. **Facing-aware interior edges (optional improvement)**
   - If Agent 1 adds per-facet `facing_azimuth_degrees`, use **facing** (not drain) for ridge/hip/valley dot logic on shared edges — document rationale in test comments.
4. **Expand tests** `lib/__tests__/roof-measure-edge-classification.test.ts`
   - Gable, hip (4-quadrant), valley, single facet, dormer-like shared edge.
   - Assert LF within ±5% of haversine ground truth for synthetic polygons.
5. **Golden polygon fixtures** `lib/__tests__/fixtures/roof-edge-golden.json`
   - Encode lat/lng facets for 6 roof types; expected `ridges_lf`, `hips_lf`, etc.

**Acceptance:**
- All classification tests green.
- Golden fixtures: max **±10%** error vs expected LF per type (document exceptions).

**Do not:** Change `calculateWasteFactorDetailed` signature/behavior.

---

## Agent 3 — Google Solar import & plane breaks `PARALLEL`

**BLOCKED BY:** nothing  
**BLOCKS:** Agent 4 (eval)

**Mission:** Facets from Solar should be **one plane per segment**, clean outlines, minimal overlap.

**Files:** `app/api/ai/detect-roof/route.ts`, `lib/solar-roof-mask-facets.ts`, `app/tools/roof-measure/page.tsx` (detect flow)

**Tasks:**
1. **Prefer `solar_mask_plane`** path when mask quality good — one contour per segment, not whole-roof blob.
2. **Reduce bbox-only facets** when mask available; keep bbox fallback for failures.
3. **Segment ↔ facet rules**
   - One primary facet per `solar_segment_index`; flag duplicates in validation notes.
   - Pass `suggested_azimuth_degrees` through to client on **every** facet source (`solar_mask_plane`, `solar_mask_whole`, vision).
4. **Overlap detection** — keep/enhance solar footprint reference check; suggest delete/revise when sum footprint > Solar ref by >8%.
5. **Tests:** extend `lib/__tests__/solar-roof-mask-facets.test.ts` for plane split behavior.

**Acceptance:**
- Detect-roof returns ≥1 facet per visible Solar segment on test coordinates (mock or recorded VCR).
- No increase in “duplicate section” validation noise on typical homes.

---

## Agent 4 — Calibration & eval harness `PARALLEL`

**BLOCKED BY:** Agents 2–3 for final numbers; can start fixtures immediately  
**BLOCKS:** Agent 0 sign-off

**Mission:** Prove accuracy against **real** third-party measurements.

**Files:** `scripts/roof-measure-eval.ts`, `scripts/roof-measure-eval-fixtures.json`

**Tasks:**
1. Extend fixtures with **drawn-polygon inputs** (lat/lng per facet) for:
   - `florida-ave-eagleview` (ridge-heavy, no hip)
   - `kison-court-roofr` (10 facets, valleys, rakes)
   - New: simple 2-facet gable, 4-facet hip (synthetic or NC addresses)
2. Add eval mode: **`--classify-only`** — feed fixture polygons → `classifyRoofEdges` → compare `ridgeLf`, `hipLf`, `valleyLf`, `eavesLf`, `rakesLf` to targets.
3. Output table: expected vs actual, **% error**, pass/fail per field (thresholds below).
4. Add `docs/roof-measure-accuracy-report.md` template filled by eval run.

**Pass thresholds (v1):**
| Metric | Simple gable | Complex hip (≥4 facets) |
|--------|--------------|-------------------------|
| Ridge LF | ±10% | ±15% |
| Hip LF | ±10% | ±20% |
| Valley LF | ±15% | ±20% |
| Eaves + rakes sum | ±15% | ±20% |
| Total sloped area | ±8% | ±12% |

**Acceptance:** Eval script runs in CI-friendly way (skip if no `GOOGLE_SOLAR_API_KEY` for live detect; classify-only always runs).

---

## Agent 5 — Measure tool UX & manual authority `PARALLEL`

**BLOCKED BY:** Agent 1 facing UI strings  
**BLOCKS:** none

**Mission:** Experts can **override** bad geometry fast; tool explains *why* numbers look wrong.

**Files:** `app/tools/roof-measure/page.tsx`

**Tasks:**
1. **Ridge / valley drawing** — make existing manual line tools obvious (labels, totals live-update).
2. **Per-facet panel** — show footprint sqft, sloped sqft, facing, pitch, perimeter; highlight unset pitch.
3. **Validation copy** — plain English tied to provider doc (overlap, unclassified shared edges, LF ratio sanity).
4. **Complex roof** — when `facetCount >= 9` and no manual ridge, keep confidence medium + CTA to draw ridges.
5. **Regression:** no change to save API shape without migration; if new fields, include in `saveMeasurement` payload and `roof_facets` insert.

**Acceptance:** Manual ridge replaces geo ridge; manual valley **adds** to geo valley (unchanged rule); UX smoke path documented in 5 steps.

---

## Agent 6 — Downstream order accuracy `PARALLEL`

**BLOCKED BY:** Agent 2 stable LF  
**BLOCKS:** none

**Mission:** Correct LF → correct **waste** and **cap bundles** on proposals.

**Files:** `app/tools/roof-measure/page.tsx` (`calculateWasteFactorDetailed`), `app/proposals/builder/page.tsx`, `lib/hip-ridge-cap-squares.ts`, `lib/__tests__/hip-ridge-cap-squares.test.ts`

**Tasks:**
1. Integration test: synthetic measurement with `hips_lf: 80`, `valleys_lf: 40` → waste ≥ industry floor (15–17% rules already in code).
2. Builder: `ridgeCapBundles` / `hipCapBundles` from saved `ridges_lf` / `hips_lf` — test fixture job.
3. Document in accuracy report: **P-00093-style** scenario (low hip estimate → low waste → under-order) and confirm fix path.

**Acceptance:** Tests pass; document one end-to-end numeric example in accuracy report.

---

## Agent 7 — Research reference (Aurora / Solo / EagleView) `PARALLEL`

**BLOCKED BY:** nothing  
**BLOCKS:** none (docs only)

**Mission:** No code required unless gaps found — deepen **how they measure faces** for engineering.

**Deliverable:** Append to `docs/roof-measurement-providers.md` or new `docs/roof-face-measurement-deep-dive.md`:

1. **Aurora:** SmartRoof perimeter → internal faces; Edit Roof parameters; AI vs manual; edge typing rules; `roof_summary` field definitions.
2. **Solo (gosolo.io):** DSM → roofline → 3D → pitch/azimuth/edges; what’s DNV-validated vs marketing.
3. **EagleView / Roofr:** What reports include per facet vs totals (use `roof-measure-eval-fixtures.json` providers).
4. **Google Solar:** `pitchDegrees` vs `azimuthDegrees` vs `groundAreaMeters2` vs `areaMeters2` — when to use which in ARX.
5. **Mapping table:** ARX column ↔ industry source column ↔ recommended future improvement.

**Do not:** Spec webhook payloads.

---

## Final integration checklist (Agent 0)

- [ ] Facing azimuth visible and stored; drain internal only
- [ ] `classifyRoofEdges` golden tests + eval within thresholds
- [ ] Solar import: plane-level facets, azimuth on all sources
- [ ] Manual ridge/valley overrides preserved
- [ ] Waste + cap bundles verified on high-hip fixture
- [ ] `tsc` + full `lib/__tests__` green
- [ ] `docs/roof-measure-accuracy-report.md` with % errors vs EagleView/Roofr fixtures
- [ ] No webhook code added

---

## Suggested Cursor execution

```
Wave 1 (parallel): Agent 1, 2, 3, 5, 6, 7
Wave 2: Agent 4 (refresh eval with Wave 1 outputs)
Wave 3: Agent 0 (merge, gates, accuracy report)
```

For each agent: **move workspace to** `/Users/nathanhall/arx-internal-crm` before edits; minimal diffs; tests with every logic change.

---

## One-line mission for any sub-agent

> Make `/tools/roof-measure` treat each facet as a **real sloped plane** (Solar/Aurora-facing + user pitch), infer **ridge/hip/valley/eave/rake LF** as accurately as 2D allows, prove it against **EagleView/Roofr fixtures**, and never ship numbers that under-order cap or field shingles on complex hips.
