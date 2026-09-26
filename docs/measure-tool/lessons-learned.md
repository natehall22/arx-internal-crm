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

### Deep review (2026-09-26) — squares are lost to unmeasured sections; LF is limited by drawn topology
- **Biggest money error is missing area, not LF.** Against Google Solar's footprint for the building, every under-measured carrier job sat at 0.40–0.83 of Google's ground area (Briarfield 0.40, Denbur 0.61, Florence 0.76 — 6.2 sq drawn vs 12.65 carrier, Peduto 0.83 — the missed addition) and every correctly measured one at 0.97–1.17 (drawn roofs include eave overhang). The tool only ever warned when drawn was ABOVE Google, and only fetched Google's reference when a rep pressed "Load roof" (35 of 178 saves). **Shipped:** an automatic lookup (`/api/measurements/solar-footprint`, keyed to the drawn roof's centroid) and an advisory note below 0.88 (`solarCoverageNote`). Saved as `raw_data.solar_coverage_ground_sqft`. Never blocks. Google sometimes locks onto one wing or a neighbor (Kaestner 250 sq ft, Nottingham 1.64×) — that only raises the ratio, so it can't fake a "missing" note.
- **~88% of facets drawn in the last 90 days take their downslope from `footprint_auto`** (a guess from polygon shape); only AI-drafted facets carry DSM/Solar heights. Every ridge/hip/valley and eave/rake call hangs off that guess.
- **Tried and NOT shipped** (`npm run roof-measure:dsm-eval`, 10 carrier jobs, auto geometry only): DSM plane fit per facet (`lib/roof-facet-dsm-plane.ts`) and T-junction edge splitting (`lib/roof-facet-tjunction.ts`). Ridge mean abs error 61% today → 44% DSM direction → **30%** DSM + T-junction, but ridge+hip cap error 21% → 25% → 35%. Cause: hand-drawn facets don't form a clean partition (T-junctions, overlaps), so fixing one layer exposes miscounts in another; and BASE DSM fit only ~half the facets on Magnolia/Nottingham. Don't ship LF math on mixed results — the tool's cap total is currently right partly by offsetting errors.
- **Where LF accuracy has to come from next:** clean topology at draw time (snap new vertices onto neighbor edges, which removes T-junctions at the source) and a better 3D source than BASE DSM. Eval harness is in place to prove either.

### 2563 Whispering Oaks Dr (Peduto, Erie) — same double count, and the fix generalised
- **Carrier scope is three roofs:** dwelling 34.6 sq (ridge 100.88', eaves 163.39'), workshop 21.9 sq, shed 5.8 sq. The saved tool measurement (28.8 sq, 7 manual_draw facets) matches the dwelling only.
- **Same mechanism as Corriher:** two drawn ridge lines (85') replaced the auto ridge while 71' of auto hips stayed, ~54' of the drawn ridge lying on auto-hip edges → cap 156' vs 100.88' (+55%). After the drawn-line supersede fix the replay gives **106' (+5%)**. This job was not used to design the fix, so it is the first out-of-sample check.
- **What was ordered vs used (Nathan, 2026-09-25):** ordered = the job board (job 26-0039): field shingles **121 bundles / 40.33 sq**, cap 7 bundles, starter 4 bundles; **12 sq (36 bundles) left over** → ~85 bundles / ~28.3 sq used (derived; 12 is a round figure). The proposal was sold at the tool's 28.80 sq + **40% waste** (rep-chosen; the tool suggested 17%) = 40.32 sq.
- **Claim check (2026-09-25):** the claim's shingle lines total **40.39 sq** = Dwelling 34.59 + Shed 5.80 (the Workshop has no shingle lines). The job-board order was 40.33 sq — the claim count within 0.14%. The tool measured 28.80 sq, **11.59 sq short**; the rep's 40% waste (40.2% would be exactly enough) closed that gap, so it was a plug to the claim count, not a real waste factor. Claim 40.39 − used ~28.3 = 12.06, which is the ~12 sq left over.
- **Nathan's explanation, now consistent:** the new addition (already re-roofed, ~12 sq) was in the claim and so in the order, but never installed; he confirms it **should have been measured in**, i.e. the tool's area excluded it. So the leftover is a scope gap between what was measured and what the claim paid for, papered over with 40% waste — not a measure error and not a real waste block. (My earlier "waste block" reading is superseded; implied waste on the ~28.8 sq actually replaced is ~0%, so the 12 sq and/or the measured area carry a few sq of slop.)
- **Lesson:** when the tool's squares are well under the claim's, the gap is the first thing to explain (here, an unmeasured addition) — a large sold waste percent that lands on the claim count is a sign the measure is missing area. The tool's own 17% on 28.8 sq would have ordered ~33.7 sq (102 bundles), 19 bundles fewer than the 121 ordered.
- **Manual-only quantities came back 0 again:** step flashing 0 vs carrier 83', chimney 0 vs 1 (Kaestner: step flashing 0 vs 62'). Second job in a row where step/wall flashing isn't captured unless drawn.
- **Erie 'Ridge' = ridge+hip cap:** ridge cap and ridge vent both use 100.88', same rule as Kaestner/HOVER — compare against `ridges_lf + hips_lf`.
- **CSV row:** `peduto-whispering-oaks-2026-09` (ordered 121 / 7 cap bundles from the job board; actual 85 derived; `delta_squares` −12, `delta_bundles_field` −36 at 3 bundles/sq).

### Fix status (2026-09-25, uncommitted on feat/job-trades-multi-crew)
Drawn ridge/hip/valley lines now supersede the auto edges they lie on (`lib/roof-drawn-line-supersede.ts`, wired in `app/tools/roof-measure/page.tsx` `updateMeasurements`), and a Hip draw tool exists. Ridge lines stay the full ridge set; hips and valleys keep auto edges no drawn line lies on. Cap error on the 6 scored jobs: mean ≈49% → ≈12% (Corriher 597→351 vs 326, Peduto 156→106 vs 101, Magnolia 218→139 vs 115, Morales 75→60 vs 56). Known gaps: legacy drawn-ridge-over-hip lines still count as ridge (ridge vent unchanged for old saves); a Hip line drawn over a legacy ridge line double counts; reopening an old measurement recomputes its numbers on screen but the saved row only changes on re-save.

### 111 Corriher Springs Rd (job 26-0046, Cox) — combined ridge+hip over-read ~2x, not just a split error
- **Symptom:** Tool's combined ridge+hip cap LF is **597'** (301 ridge + 296 hip); NC Farm Bureau's Xactimate estimate puts it at **326'** (135.30 ridge + 190.69 hip) — a "Hip / Ridge cap" line item that matches ridges_lf+hips_lf exactly, same cross-check that worked on Kaestner. Total squares were close (75.93 vs 74.02).
- **Root cause (replayed through the real classifier 2026-09-25 — reproduces the saved 296 hip / 407 valley exactly):** the auto classifier alone gives ridge 47 + hip 296 = **343' — within 5% of carrier on the combined total**, but it labeled the 82' main ridge a *hip* (split wrong). The rep then hand-drew 301' of "ridge" lines (there is no hip draw tool, so hips get drawn as ridges). `manualRidges` REPLACES auto ridge but auto hips are never touched, so ~235' of drawn ridge sits on edges that are also counted as auto hips — a **double count**. Valleys are worse in kind: `valleys = auto + manual` (ADDS; the code comment above it says "override") → 174 + 233 = 407 vs ~217 carrier-derived.
- **Waste (unverified):** the tool suggested 22.88%; the carrier *allowed* ~7.6% — that is a payment allowance, not measured need, and there is no post-install usage yet. Re-running `calculateRoofWaste` with carrier LF gives 17.07%: the LF over-read explains ~5.8 of the 22.88 points, the model's own baseline the rest. Don't treat 7.6% as truth.
- **Same warning as Kaestner:** `raw_data.validation_notes` already said "verify total ridge LF before quoting" (medium confidence, footprint 17% above Solar reference) and the proposal was built off the tool numbers anyway. Nathan's call: this stays advisory — no hard gate, it would block designs from being created.
- **CSV row:** `corriher-springs-2026-09`.

### Hip/ridge accuracy audit (2026-09-25) — cap total is trustworthy, the split and the manual-draw layering are not
Scored the current classifier against the carrier-report jobs where tool scope matched (n=6; small sample — treat as direction, not calibration; Peduto was added 2026-09-25 after the fix was designed). Cap = ridge+hip:

| Job (carrier) | Truth R / H | Cap: as-saved-pipeline* | Cap: auto geometry only | Auto ridge vs truth |
|---|---|---|---|---|
| Corriher (Xactimate) | 135 / 191 | **+83%** | **+5%** | 47 (−65%) |
| Magnolia Estates (Xactimate) | 106 / 9 | **+90%** | **+2%** | 3 (−97%) |
| Morales (Homesite) | 56 / 0 | +24% / +35% (2 saves) | 0% / +2% | 42 (−25%) |
| Nottingham (Xactimate) | 124 / 27 | −18% | −18% | 75 (−39%) |
| Kaestner (Hover) | 83 / 20 (field) | +11% | +11% | 33 (−60%) |
| Peduto dwelling (Erie) | cap only: 100.88 | **+55%** | +16% | n/a (Erie reports the cap total only) |
*current code before the fix: drawn ridge if any, else auto ridge, plus auto hips. Mean abs error ≈ 49% vs ≈ 9% for auto-only (6 jobs, Morales counted once at its later save).

- **Cap LF from auto geometry (all convex interior edges) lands within −18%…+11%** on all five. The **ridge/hip split is the weak part**: auto ridge under-reads on every job (−25% to −97%) with the difference showing up as hip — the `azdiff ≥ 135°` rule runs on *footprint-derived* drain azimuths, not real slope, so a big main ridge between asymmetric planes reads as a hip. Ridge vent uses `ridges_lf` alone, so the split matters there even when cap is fine.
- **Drawn ridge lines are good when the rep draws real ridges** (Magnolia 104 vs 106, Morales 55–60 vs 56) and bad when hips are drawn as ridges (Corriher 301 vs 135). Nothing in the tool distinguishes them.
- **Prevalence:** of 177 saved measurements, 131 have drawn lines and 120 carry both ridge and hip LF. Restricted to the 61 rows that current code reproduces exactly (the rest were saved under older code), 18 of 21 rows with both drawn ridges and auto hips have ≥15' of drawn ridge on an auto-hip edge; a median 25% of their cap LF is duplicated. Valleys: 27% of drawn+auto valley LF overlaps. Only 61/176 replays match — older saves (e.g. Nottingham 73/192 saved vs 75/48 today) predate fixes, so old proposals may carry bigger errors than current code would.
- **Existing eval can't see any of this:** `npm run roof-measure:classify` covers 7 synthetic shapes (gable, 4-quadrant hip, T, L…); nothing exercises a hand-drawn multi-facet roof or the drawn-line layering. The 14 carrier fixtures in `scripts/roof-measure-eval-fixtures.json` have never been compared to the saved CRM measurements for those addresses.
- **Ruled out as ground truth:** Randy Hart (target is an ARX-reviewed row — not independent), Lloyd (tool ridge equals carrier ridge to the cent — pre-filled), Wittersheim (different structure scope). Peduto was first excluded as multi-structure, but the tool row matches the Erie *dwelling* roof plan alone, so it is now included, Florida Mar row (multi-structure).

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
