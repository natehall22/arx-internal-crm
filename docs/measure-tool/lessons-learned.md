# Measure tool — post-install calibration memory

**Purpose:** ground truth for tuning the in-house roof measure tool (`app/tools/roof-measure/`). Not CRM UI — this is AI/ops working memory only.

**How this gets filled:** Nathan tells the assistant (Claude/Cursor/Codex) the job's tool output and the actual order/reorder outcome. The assistant appends a row to `../../data/measure-tool-memory/installs.csv` (primary — numeric, one row per job) and, only when there's something non-obvious about *why* the delta happened, a short narrative entry below. If a number wasn't given, leave it blank or write "not recorded" — never estimate or invent a figure.

**Core signal per job:** what the tool measured/suggested (squares, waste %, ridge/hip/valley LF) vs. what was actually ordered and actually used (bundles, squares, reorder). The gap between those is `delta_squares` / `delta_bundles_field` / `delta_bundles_cap` in the CSV — that's the number that matters.

**For AI:** read this file + `installs.csv` together before proposing changes to `lib/roof-waste-model.ts`, `lib/roof-measure-edge-classification.ts`, or `lib/hip-ridge-cap-squares.ts`. Prioritize rows with `reorder_flag=Y` or `|delta_squares| >= 2`. Don't overfit on single clean rows (`reorder_flag=N`, small delta) — those are positive controls, not tuning signal.

---

## Seed patterns (from pre-launch docs — do not delete)

### Hip LF → waste floor (P-00093 lineage)
- **Symptom:** Under-estimated hip LF → waste % too low → under-ordered field shingles.
- **Fix shipped:** Geometric `hips_lf` + waste adjustment when hip LF > 60; cap bundles separated in proposal builder.
- **Test:** `lib/__tests__/roof-measure-downstream.test.ts` — 80 hip LF → waste ≥ 15%.

### Greenway — field + caps on separate PO lines
- **Symptom:** 26 sq ordered vs 33 sq tool recommendation; 10 cap bundles on reorder.
- **Root cause:** First PO ignored suggested waste; caps not on first PO at all.
- **Fix shipped:** Sidebar "Material order (field + caps)"; builder auto-populates squares **with** waste.
- **Detail:** [roof-measure-greenway-case-study.md](../roof-measure-greenway-case-study.md); CSV row `greenway-2026-05`.

### 2D edge LF ≠ 3D Aurora
- **Symptom:** Ridge/hip LF disagrees with EagleView PDF on complex roofs.
- **Expectation:** ARX uses 2D adjacency + facing/drain — not full 3D plane intersection (unless `USE_PLANE_INTERSECTION_LF` flag).

### Pitch must be human-confirmed
- **Policy:** Manual pitch gate is intentional — do not auto-save Solar-suggested pitch without review.

---

## Install log

<!-- Append short entries below, newest first. Only needed when the CSV row alone doesn't explain the delta. -->

### 639 Spring St SW (job 26-0044, Kaestner) — ridge/hip split inverted; the tool's own warning was right
- **Symptom:** Tool read **33 ridge / 87 hip**; field call is **83 ridge / 20 hip**. Cap total was only 14% off (120 vs 103 LF) so the error hid in the cap line — but the *split* was inverted 4x, and ridge vent is computed off `ridges_lf` alone. Sheet would have gone out at **21 LF of ridge vent instead of 71 LF**.
- **Root cause signal we ignored:** `raw_data.validation_notes` on this row already said *"Complex roof detected: ridge lines are estimated"* and *"13 sections may need manual downslope"*, with `measurement_confidence: medium`. **Treat that note as blocking for ridge/hip on manual_draw roofs — a cap total that looks close does not mean the split is.**
- **Eaves also over-read ~36%:** tool house-only 255 LF vs Erie/HOVER **187.77 LF**. Drives starter and drip edge.
- **Structures were conflated:** the detached garage (facets 12–13, 4/12 gable, 337 SF) was folded into the house totals with no marker. Facet centroids were ~40 ft apart — worth auto-flagging disjoint facet clusters as separate structures.
- **Carrier cross-check that works:** on HOVER-sourced carrier estimates the summary `Ridge` LF is **ridge + hips** (it matches the "Ridge Cap Shingles" line item), so compare it against `ridges_lf + hips_lf`, never `ridges_lf`. Rakes and valleys are not reported at all.
- **CSV row:** `kaestner-spring-st-2026-09`.

### Heritage Ct (2300 Heritage Ct, Kannapolis) — IE under-read, fallback range still covered basis
- **Symptom:** Instant Estimate mid **39.1 sq** (`solar_mask_whole`; unreliable) vs hard measure **47 sq w/ waste** (~8 sq under-read).
- **Pricing:** Basis **$413/sq × 47 = $19,411**. IE **$530/sq fallback** range **$17,615–$23,831** still contained $19,411 — rate buffer compensated for square under-read.
- **CSV row:** `heritage-ct-2026-07`.
