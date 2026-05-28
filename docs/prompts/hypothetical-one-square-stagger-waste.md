# Executive prompt: Parametric full-face shingle model (stagger + angles + granular waste)

**Purpose:** Hypothetical / research / future calibration — **not** production UI unless explicitly approved after sign-off.

**Sponsor (brain):** Senior coder. Workers execute; brain monitors checklist at bottom.

**Goal:** A **scale-invariant** model: any roof **face** (small or large) → shingle count, waste **by bucket**, and order quantities. Must include **pitch**, **hips**, **valleys**, **ridges**, **rakes/eaves**, and **industry stagger** — as granular as practical.

**Alignment target:** Compare outputs to `lib/roof-waste-model.ts`, `lib/roof-shingle-constants.ts`, `lib/roof-material-order.ts`, `lib/hip-ridge-cap-squares.ts` — document gaps; do not silently diverge from production constants without flagging.

---

## 1. Coordinate system (define once; every worker uses this)

```
Plan view (bird's eye):
  EAVE_RUN_FT  — length along the eave where courses start (horizontal in plan)
  RAKE_SPAN_FT — distance eave → ridge in plan (perpendicular to eave run)
  PITCH_RISE   — rise per 12" run (e.g. 4, 8, 12)
  FACE_SLOPE_FT — sloped length along the face = RAKE_SPAN_FT × pitchMultiplier

pitchMultiplier = √(1 + (PITCH_RISE/12)²)   [same as pitchMultiplierFromRise]
pitchDegrees    = atan(PITCH_RISE/12) × 180/π

Sloped face area (field):
  FACE_AREA_SQFT = EAVE_RUN_FT × RAKE_SPAN_FT × pitchMultiplier
  FACE_SQUARES   = FACE_AREA_SQFT / 100
```

**Course direction:** shingles run **parallel to the eave** (along `EAVE_RUN_FT`). Courses stack **up the rake** using **exposure**, not full shingle length.

### Canonical teaching anchor (brain-approved — do not drift)

| Input | Value | Meaning |
|-------|--------|---------|
| `FACE_AREA_SQFT` | **100** | One **sloped** roofing square (order unit), not plan ft² |
| `EAVE_RUN_FT` | **30** | Course run along eave |
| `L_SHINGLE_FT` | **3** | Hypothetical strip length |
| `PITCH_RISE` | **4** (default) | Use 8/12 for pitch-sensitivity runs |
| Row 1 shingles | **10** | `ceil(30 / 3)` — fixed sanity check |

**Derived plan rake (do not use 10′×10′ plan):**

```
RAKE_SPAN_FT = FACE_AREA_SQFT / (EAVE_RUN_FT × pitchMultiplier)
             ≈ 3.16′ plan @ 4/12  (100 / (30 × 1.054))
```

A literal **10′×10′ plan = 100 plan ft²** contradicts a **30′ eave** on the same rectangle. Workers must **stop** if they mix those without relabeling (plan ft² vs sloped square).

**Implementation:** `lib/hypothetical-roof-face-granular.ts` + `lib/__tests__/hypothetical-roof-face-granular.test.ts` — brain sign-off tests encode this geometry.

**Exposure:** Default **`EXPOSURE_FT` = 5.625″** (production). Optional `teachingExposureFt` only when labeled `exposureLabel: 'teaching'`.

**Stagger policies in code:** `NONE`, `S1_HALF_TAB` (1.5′ offset on odd courses), `S2_SIX_IN_STEP` (6″ cumulative). Industry: GAF R-146 **≥4″** joint offset ([GAF R-146](https://www.gaf.com/en-us/document-library/documents/technical-bulletins-&-notes/r-146-shingle-offsets.pdf)); Timberline pattern uses **6″ / 11″ / 17″** rake trims — not identical to S1/S2 but same principle (extra caps per course).

---

## 2. Parametric inputs (any size)

### 2.1 Per face (repeat for each roof plane)

| Parameter | Symbol | Unit | Notes |
|-----------|--------|------|--------|
| Eave run | `EAVE_RUN_FT` | ft | Along eave; drives shingles **per course** |
| Rake span (plan) | `RAKE_SPAN_FT` | ft | Eave → ridge plan distance |
| Pitch rise | `PITCH_RISE` | /12 | 4, 8, 12, … |
| Shingle length | `L_SHINGLE_FT` | ft | Default **3** (36″); match `SHINGLE_LENGTH_IN/12` in production |
| Tab width | `W_TAB_FT` | ft | Default **1** (12″); 3 tabs → **3′** strip width |
| Exposure | `E_EXPOSURE_FT` | ft | Default **5.625/12** (`EXPOSURE_FT`); label “teaching exposure” if overridden |
| Stagger policy | `STAGGER` | enum | `S1_HALF_TAB`, `S2_6IN_STEP`, `S3_MANUFACTURER` (cite spec) |
| Rake overhang cut | `RAKE_CUT_IN` | in | Waste at gable ends per course |
| Starter row | `STARTER` | enum | `FULL`, `CUT_STARTER`, `DOUBLE_STARTER` |

### 2.2 Whole roof (aggregate faces + lines)

| Parameter | Symbol | Unit | Notes |
|-----------|--------|------|--------|
| Total field squares | `BASE_SQUARES` | sq | Sum of face `FACE_SQUARES` |
| Facet count | `N_FACETS` | count | Complexity modifier |
| Valley LF (plan) | `V_LF` | LF | Open valley; **both sides** cut field shingles |
| Hip LF (plan) | `H_LF` | LF | Hip line; angled field cuts |
| Ridge LF (plan) | `R_LF` | LF | Ridge line; **field trim** + **cap order** (separate) |
| Eave LF | `E_LF` | LF | Starter / drip context (optional bucket) |
| Rake LF | `RK_LF` | LF | Gable trim context (optional bucket) |
| Avg pitch mult | `PITCH_MULT` | — | Area-weighted mean across faces |
| Avg pitch deg | `PITCH_DEG` | ° | For >25° / >35° modifiers |

**Caps are NOT field squares:** `CAP_SQ = (R_LF + H_LF) / 100` (LF per cap “square”); bundles = `ceil(LF / CAP_LF_PER_BUNDLE)`.

---

## 3. Granular waste buckets (required breakdown)

Every run must output **shingles** and **squares** per bucket, then sum to **total field order**.

| Bucket | ID | Formula sketch (workers expand to code) |
|--------|-----|----------------------------------------|
| **Face layout (net)** | `FACE_NET` | Sum over courses of shingles needed to cover `EAVE_RUN_FT` × sloped span with exposure |
| **Horizontal stagger** | `STAGGER` | Extra shingles vs naive `n_courses × shingles_per_course` from offset policy |
| **Rake / gable cuts** | `RAKE` | Partial tabs at ends of each course × `n_courses` |
| **Starter / first row** | `STARTER` | Extra or cut pieces for first course + optional second starter course |
| **Base area waste** | `BASE_AREA` | `BASE_SQUARES × BASE_AREA_WASTE_RATE × sizeFactor` (match production) |
| **Valley field cuts** | `VALLEY` | `coursesAlongLinearLf(V_LF, PITCH_MULT) × WASTE_SHINGLES_PER_COURSE_VALLEY` → sq |
| **Hip field cuts** | `HIP` | `coursesAlongLinearLf(H_LF, PITCH_MULT) × WASTE_SHINGLES_PER_COURSE_HIP` → sq |
| **Ridge field trim** | `RIDGE_TRIM` | `coursesAlongLinearLf(R_LF, PITCH_MULT) × WASTE_SHINGLES_PER_COURSE_RIDGE_TRIM` → sq |
| **Facet complexity** | `FACET` | `N_FACETS`, small facet penalty (match `roof-waste-model`) |
| **Pitch modifier** | `PITCH_MOD` | +1% base if `PITCH_DEG > 25`; +2% if `> 35` |
| **LF floor calibration** | `FLOOR` | If `V_LF≥40` & `H_LF≥60` and % < 17 → floor to 17%; scale breakdown (document) |
| **Order round-up** | `ROUND` | Bundles: `ceil(sq × 3)`; document bundle vs sq rounding |

**Valley vs hip (angles):** Plan-view LF is not sloped LF. Production uses **`LF_plan × pitchMultiplier / EXPOSURE_FT`** = **sloped courses** along that line. Workers must show one worked example: 68′ valley @ 4/12 vs 8/12 → course count delta.

**Hip angle (granular optional v2):** If research supports it, add `hip_angle_deg` at each hip segment → adjust `WASTE_SHINGLES_PER_COURSE_HIP` (e.g. 0.24 @ ~45°, higher for shallower hips). v1 may use single coefficient; **cite** if extending.

---

## 4. Full-face course model (scale to any `EAVE_RUN_FT` × `RAKE_SPAN_FT`)

### 4.1 Courses up the face

```
n_courses = ceil( (RAKE_SPAN_FT × pitchMultiplier) / E_EXPOSURE_FT )
```

Use **sloped** rake length, not plan rake only.

### 4.2 Shingles per course (along eave)

For course index `i = 0 … n_courses-1`:

```
offset_i = staggerOffset(i, STAGGER)   // e.g. 0, 1.5′, 3″ step, …
effective_run_i = EAVE_RUN_FT + offset_i   // wrap / modulo per policy
shingles_i = countShinglesAlongRun(effective_run_i, L_SHINGLE_FT, W_TAB_FT, RAKE_CUT_IN)
```

`countShinglesAlongRun`: number of **3′ strips** (or partials counted as 1) to cover run including rake cuts.

### 4.3 Face totals

```
FACE_NET_SHINGLES = Σ shingles_i
FACE_STAGGER_SHINGLES = FACE_NET_SHINGLES - (n_courses × ceil(EAVE_RUN_FT / L_SHINGLE_FT))   // define naive baseline clearly
```

### 4.4 Scale check

Workers must run **three sizes** and show linear scaling where expected:

| Case | EAVE_RUN | RAKE_SPAN | Pitch | Expect |
|------|----------|-----------|-------|--------|
| **S** (anchor) | 30′ | **~3.16′** plan (derived) | 4/12 | Row 1 = 10; 100 sq ft **sloped** |
| **M** | 60′ | derived for **200 sq ft** sloped | 4/12 | ~2× naive baseline shingles vs S (double **area**, not eave alone) |
| **L** | Greenway | per measure | 8/12 | `calculateRoofWaste` % > 4/12; caps unchanged |

---

## 5. Industry research (W1 — citations required)

1. Horizontal stagger (half-tab, 6″, 4.5″, racked vs stair-step).
2. Exposure 5.625″ and course count on steep pitch (8/12, 12/12).
3. Valley: shingles per course both sides; open vs closed valley waste delta.
4. Hip: field shingle waste vs **cap** order (caps = separate LF model).
5. Typical total waste %: gable, hip, hip+valley (15–20% band).
6. Whether plan LF or sloped LF is used in the field for valley/hip estimating (justify `coursesAlongLinearLf`).

---

## 6. Worker assignments

| Worker | Deliverable |
|--------|-------------|
| **W1 — Research** | Cited table; valley > hip waste per LF; stagger rules |
| **W2 — Face engine** | Parametric formulas §4; TypeScript sketch `computeFaceShingles(input)` — any `EAVE_RUN_FT`, `RAKE_SPAN_FT`, `PITCH_RISE` |
| **W3 — Line features** | Valley/hip/ridge shingle waste from §3; pitch sensitivity table (4/12 vs 8/12 vs 12/12) |
| **W4 — Aggregator** | `computeRoofOrder(input)` → breakdown JSON + total sq + bundles; map fields to `RoofWasteBreakdown` |
| **W5 — Validation** | Run S/M/L + **Greenway** (28.13 sq, V68, H109, R112, 7 facets); compare to `calculateRoofWaste` / `roofWasteAndOrder` |
| **W6 — Diagrams** | Mermaid: face courses, stagger offset, valley/hip on multi-facet roof |

**Optional W7 — Tests:** `lib/__tests__/hypothetical-roof-face-granular.test.ts` only; **no** production UI wiring.

---

## 7. Brain monitor checklist (sign-off)

- [x] Model is **parametric** (`computeFaceShingles` any area/eave/pitch).
- [x] Sanity: **30′ eave, 3′ shingle → 10 in row 1** (jest).
- [x] **No 10′×10′ plan** with 30′ eave unless relabeled; anchor uses **derived rake ~3.16′** @ 4/12.
- [x] Stagger **increases** count vs `NONE` (S1, S2 — jest).
- [x] **Production exposure** default; teaching exposure **labeled**.
- [x] **Pitch** on anchor: `nCourses` unchanged when **sloped sq ft + eave** fixed (slope length = area/eave); Greenway `calculateRoofWaste` higher @ 8/12 via valley/hip **courses** (jest).
- [x] **Caps** LF-only; unchanged when pitch changes (jest).
- [ ] Line-feature buckets (valley/hip) in **same module** as face — v2; production `roof-waste-model` used for roof-level compare today.
- [ ] “Toy face shingle total” vs **63/square** order — documented; face layout ≠ production order formula alone.

---

## 8. Acceptance criteria

1. **Formula sheet** (§2–§4) with symbols — copy-paste ready for implementation.
2. **Numeric tables:** S/M/L faces + Greenway @ 4/12 and 8/12 — every waste bucket in shingles and squares.
3. **Comparison table:** hypothetical granular total vs `calculateRoofWaste` — explain deltas.
4. **Executive summary** (≤12 bullets) + recommendation: adopt into `roof-waste-model` or keep research-only.
5. **Next-step prompt** if v2 needs hip-angle or eave/starter buckets in production.

---

## 9. Non-goals

- No EagleView/Hover/Aurora API integration.
- No change to `/tools/roof-measure` UI without separate task.
- No conflation of cap squares (100 LF) with field squares (100 sq ft).

---

## 10. Copy-paste worker kickoff

```
Read docs/prompts/hypothetical-one-square-stagger-waste.md.
Run: npx jest lib/__tests__/hypothetical-roof-face-granular.test.ts

Brain sign-off already encoded for anchor geometry + stagger + pitch + Greenway caps.
Extend (W3–W4 v2) only if adding valley/hip/rake buckets into hypothetical-roof-face-granular.ts:
- Import coursesAlongLinearLf + production coefficients
- Sum FACE_NET + STAGGER + line buckets; compare to calculateRoofWaste

Do NOT use 10′×10′ plan with 30′ eave. Use ANCHOR_ONE_SQUARE in lib/hypothetical-roof-face-granular.ts.

Stop and ask brain before changing stagger formulas (GAF R-146 ≥4″ offset; half-tab is teaching simplification).
```

### Brain vs ARX production (short list)

- **Face module:** course-by-course layout + stagger waste on a **single plane**.
- **`roof-waste-model`:** roof-level **squares** from LF + facet complexity + floors — no per-course stagger.
- **Order:** production uses **3 bundles/sq** after waste %; toy face uses **shingle count ÷ 63**.
- **Caps:** always **LF ÷ 100**, never in face stagger math.
