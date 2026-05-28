# Roof measure — Path to 8/10 QA matrix (2026-05-28)

**Program:** `docs/prompts/roof-measure-path-to-8.md`  
**Baseline:** `docs/roof-measure-qa-2026-05-28-final.md` (2.5D ship GO, score ~6/10)  
**Prod URL:** https://arx-internal-crm.vercel.app/tools/roof-measure  

---

## Head engineer review — Greenway screenshot (2026-05-28 00:13)

**URL:** `?opportunity_id=78248c1d-…&address=304 Greenway Dr`  
**Screenshot:** `assets/Screenshot_2026-05-28_at_12.13.34_AM-*.png`

| Phase | Verdict | Evidence |
|-------|---------|----------|
| **A — Trust UX** | **PASS (visual)** | 9 sections on map (not blank); **Solar applied**; **Looks good ✓**; pitch/facing on Section 1 (5/12, NW 306°); sidebar sloped sq (729 sqft §1). Save not shown — D pending. |
| **B — Geometry** | **PARTIAL** | Still **Satellite box (rough)** (`solar_bbox`). **9 auto sections** (Google **12** segments; dedupe → 9). Target was **7** case-study planes — acceptable band (≥7) but watch overlap. **Mask path:** API diagnose → `label_budget_exceeded` + `whole_contour_pin_miss`; split planes **~184 m** off pin → mask/bbox misalignment still open. |
| **C — DSM** | **LIKELY OK (not visible)** | Offline: `dataLayers` returns **mask + DSM** for Greenway. UI had no DSM conflict banner (C2). Prod `dsm_coverage` not yet logged in browser. |
| **D — Save → builder** | **PENDING** | Need save after vertex align on all 9 §; confirm **~28 sq ±5%**, **~17% waste**, hip LF **~100+**, builder caps. |

**Blunt score after deploy `3bc0a02`:** **~7/10** — trustworthy enough to edit; not yet “order without Roofr” until save math + mask planes or stable 7–9 bbox with &lt;2 min tweak.

---

## API diagnose (local key, post-fix branch)

Script: `npx tsx scripts/roof-measure-mask-diagnose.ts`

| Address | Solar segments | Mask layers | Mask result (before single-whole guard) |
|---------|----------------|-------------|----------------------------------------|
| **304 Greenway Dr** | **12** | mask + DSM yes | split pin miss (~184 m); whole contour → **1** `solar_mask_whole` |
| **1361 Kison Ct NW** | **8** | mask + DSM yes | split pin miss (~138 m); whole contour → **1** facet |

**Prod behavior:** detect prefers **solar_bbox** when mask would return only one whole-roof polygon on ≥5 segments (`single_whole_multisegment`).

---

## Score estimate

| Dimension | Score | Notes |
|-----------|-------|-------|
| Auto geometry | **6–7** | 9 bbox ≥7; mask planes still blocked |
| Trust UX | **7–8** | Phase A + detection diagnostics banner |
| Save → builder | **7** | Unchanged until D |
| DSM | **5–6** | Layers fetch OK; sampling TBD on prod |
| **Overall** | **~7** | D + Concord matrix → 8 |

---

## Collateral gate

| NO-GO check | Status |
|-------------|--------|
| POST rejects valid `solar_auto` + reviewed | **PASS** |
| Builder caps when R/H LF > 0 | **PASS** |
| Reload bypasses slopedAreaSqft | **PASS** |
| P-00093 waste floor | **PASS** |
| Untested shared lib/* | **PASS** (mask/dsm/tool only) |

---

## Phase A — Trust UX

| ID | Status |
|----|--------|
| A1–A4 | **PASS** (shipped `3bc0a02`) |

---

## Phase B — Mask/bbox

| ID | Status |
|----|--------|
| B1 | **PASS** — root cause documented (label budget + pin/projection on split) |
| B2 | **IN PROGRESS** — segment cap for labeling; structure ref; whole-contour pin relax; prefer bbox over single-whole |
| B3 | **PASS on Greenway** (9 ≥ 7); Concord retest pending |
| B4 | **PASS** — map not blank |

### Prod matrix

| Address | Auto § | Source | `solar_mask_fallback_reason` | Pass? |
|---------|--------|--------|-------------------------------|-------|
| 304 Greenway Dr | **9** | `solar_bbox` | `single_whole_multisegment` (expected post-fix) | **PARTIAL** — count OK; mask plane **FAIL** |
| 1361 Kison Ct NW | _ | _ | _ | **PENDING** |

---

## Phase C — DSM

| ID | Status |
|----|--------|
| C1 | **PARTIAL** — structured logs + offline confirms layers for NC goldens |
| C2 | **PASS** |

| Address | mask+dsm fetch | Prod UI |
|---------|----------------|---------|
| Greenway | yes / yes | TBD |
| Concord | yes / yes | TBD |

---

## Phase D — Human

- [ ] Greenway: Looks good on **all 9** sections after vertex align
- [ ] Save → ~28 sq, ~17% waste, caps in builder
- [ ] Concord: ≥5 auto, ≤2 manual
- [ ] +3 NC jobs in matrix

---

## Phase E

**DEFERRED** — plane LF staging after B2 + Greenway save PASS.

---

## Machine gates

```text
npm run roof-measure:prelaunch  → run before merge
npm test (roof-measure pattern)
npm run build
```

---

## Next engineering tranche (ordered)

1. **Mask GeoTIFF row/origin alignment** — split planes 130–180 m off pin (Concord/Greenway).
2. **Prod D** — Greenway save + builder caps screenshot.
3. **Concord** — confirm ≥5 bbox after deploy.
4. **C1 prod** — Vercel logs `dataLayers:get` for 5 pins.
5. **Phase E** — classify eval when D green.
