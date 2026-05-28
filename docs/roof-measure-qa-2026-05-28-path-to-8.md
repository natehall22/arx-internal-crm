# Roof measure — Path to 8/10 QA matrix (2026-05-28)

**Program:** `docs/prompts/roof-measure-path-to-8.md`  
**Baseline:** `docs/roof-measure-qa-2026-05-28-final.md` (2.5D ship GO, score ~6/10)  
**Code shipped (local):** Phase A trust UX + Phase B mask/bbox diagnostics & segment retention + Phase C1 DSM logging  
**Prod URL:** https://arx-internal-crm.vercel.app/tools/roof-measure  

---

## Score estimate

| Dimension | Before (prod 2026-05-27) | After deploy (estimate) | Evidence |
|-----------|---------------------------|-------------------------|----------|
| Auto geometry | 4–5 | **6–7** | B2 projection/pin fix + B3 relaxed dedupe for ≥5 segments; needs prod API retest |
| Trust UX | 5 | **7–8** | A1–A4 merged: hip LF linework note, vertex → re-review, sloped reload, map settle |
| Save → builder | 7 | **7** (unchanged) | No save/schema changes in this PR |
| DSM credibility | 3 | **4** (pending) | C1 structured logs; C2 already null-safe; prod smoke table below |
| **Blunt “order without Roofr first?”** | **~6** | **~7** | **8** blocked until Greenway prod save + Concord ≥5 auto confirmed |

---

## Collateral gate

| NO-GO check | Status | Notes |
|-------------|--------|-------|
| POST rejects valid `solar_auto` + reviewed save | **PASS** | No measurements API changes |
| Builder drops caps when R/H LF > 0 | **PASS** | Untouched |
| Reload bypasses `slopedAreaSqft` | **PASS** | A3: `recalculateFacetFromPoints` on restore |
| P-00093 waste <15% at 80+ hip LF | **PASS** | 38 Jest tests green |
| Untested shared `lib/*` | **PASS** | Consumers grepped; mask/DSM only detect + tool + tests |

---

## Phase A — Trust UX (code)

| ID | Acceptance | Status |
|----|------------|--------|
| A1 | `hasMeasuredLinework` when hips/eaves/rakes > 0 | **PASS** |
| A2 | Vertex edit clears `geometry_reviewed` | **PASS** |
| A3 | Reload recomputes sloped `area_sqft` | **PASS** |
| A4 | `loadSavedMeasurement` awaits map settle | **PASS** |

---

## Phase B — Mask/bbox (code + prod retest required)

### Root cause hypotheses (pre-deploy)

| Address | Hypothesis | Fix in PR |
|---------|------------|-----------|
| **304 Greenway Dr** | WGS84→mask pixel projection mismatch; pin vs `capture_center` | DSM-aligned `lngLatToColRow`; pin-first mask query; `solar_mask_fallback_reason` |
| **1361 Kison Ct NW** | Over-filtering when Solar returns ≥5 segments | Relaxed dedupe / pin bypass when `segments.length >= 5` |

### Prod API matrix (human — fill after deploy)

| Address | Auto sections | `facet_source` | `solar_mask_fallback_reason` | Pass? |
|---------|---------------|----------------|------------------------------|-------|
| 304 Greenway Dr | _ | _ | _ | _ |
| 1361 Kison Ct NW | _ (target ≥5) | _ | _ | _ |
| _NC job 3_ | _ | _ | _ | _ |
| _NC job 4_ | _ | _ | _ | _ |
| _NC job 5_ | _ | _ | _ | _ |

**Greenway save criteria:** ~28 sq ±5%, ~17% waste, hip LF ~100+, builder ridge/hip cap lines.

**Concord criteria:** Not blank; ≤2 manual sections vs auto; save → builder.

---

## Phase C — DSM

| ID | Status | Notes |
|----|--------|-------|
| C1 | **PARTIAL** | Structured `dataLayers:get` logs (`http_error`, `api_error`, `empty_layers`) |
| C2 | **PASS** | `dsmPitchDisagreesWithSolar` returns false when DSM pitch null |

### DSM smoke table (prod logs after deploy)

| Address | `dsm_available` | `dsm_coverage` | Log reason if unavailable |
|---------|-----------------|----------------|---------------------------|
| Greenway | _ | _ | _ |
| Concord | _ | _ | _ |
| _+3 NC_ | _ | _ | _ |

Target: ≥50% of 5-address table not `unavailable`.

---

## Phase D — Deferred until prod matrix filled

- [ ] Greenway save matches case study within tolerance
- [ ] Builder caps confirmed on Pricing step
- [ ] 10-address prod matrix complete
- [ ] Ops sign-off one P-00093-class job

---

## Phase E — Plane LF (staging only)

| ID | Status |
|----|--------|
| E1 | **DEFERRED** — run after Phase B Greenway prod PASS |
| E2 | **PASS** — `USE_PLANE_INTERSECTION_LF` off by default |

---

## Machine gates (2026-05-28)

```text
npm run roof-measure:prelaunch  → PASS
npm test (roof-measure pattern)  → 10 suites, 38 tests PASS
npm run build                    → PASS
```

---

## Explicit deferrals

- EagleView / Roofr / Hover integrations
- iOS LiDAR parity
- `google_solar` fast-path behavior change
- Plane LF in Production
- P1: measurements list View/Use → `?measurement_id=`
