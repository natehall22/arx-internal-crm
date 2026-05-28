# Roof measure — final ship QA (2026-05-28)

**Tester:** Agent D-UI (cursor-ide-browser)  
**Environment:** Production primary · localhost fallback  
**Prod URL:** https://arx-internal-crm.vercel.app/tools/roof-measure  
**Addresses in matrix:** 1361 Kison Ct NW, Concord NC 28027 · 304 Greenway Dr (Greenway case study)  
**Machine gate:** `npm run roof-measure:prelaunch` → **PASS** (2026-05-28, agent run)  
**Build:** **PASS** on clean `.next` (Agent A / orchestrator 2026-05-28; initial D-UI session exit 1)

---

## Human prod verification — Concord (2026-05-27)

**Tester:** Nathan Hall (logged-in prod)  
**URL:** `https://arx-internal-crm.vercel.app/tools/roof-measure` (opportunity + address 1361 Kison Ct NW, Concord NC 28027)

### Solar auto-load vs manual work

| Item | Result |
|------|--------|
| Sections on map after Solar reload | **3 auto-loaded** (colored overlays visible — **not a blank map**) |
| Operator-added sections | **+5 manual** (“Draw a section” / add) → **8 sections** total at save |
| Interpretation | **Known limitation (P1):** Solar under-splits this address; operator can complete the job manually. Aligns with overnight API smoke (2–3 `solar_bbox` facets). **Not a deploy blocker** if save/builder math is sane. |

### Map / trust UI (observed)

- Pitch applied per section (e.g. 9/12 on Section 1 in tool); report showed predominant **7/12** at save.
- **Solar applied** badge; **Facing** shown (e.g. W 251° — panel direction).
- **Looks good ✓** flow used before save.
- **MEDIUM CONFIDENCE** on measurement report modal.

### Save → numbers → proposal

| Metric | Value at save |
|--------|----------------|
| Squares (actual roof) | **17.61** (~17.6 in builder banner) |
| Sq ft (actual / flat) | **1,761** / **1,529** |
| Sections | **8** |
| Suggested waste | **17.49%** (~+3.1 sq) |
| Ridge cap | **0.61 sq** (61 LF measured) |
| Hip cap | **0.46 sq** (46 LF measured) |
| Valleys (field waste) | **50 LF** |
| Eaves / rakes / drip / step flashing | 124 / 139 / 263 / 21 |

**Save → proposal builder:** **PASS** — “Roof Measurement Loaded” on `/proposals/builder` with measurement attached.

### Verification notes (tool)

- Yellow box flagged **sections 3 and 4** as possibly duplicate (auto vs hand-drawn overlap). **Ops:** delete true duplicate before final quote if planes overlap.

### Concord checklist verdict (human)

| Check | Result |
|-------|--------|
| Blank map after Solar reload | **PASS** (3 sections visible) |
| Pitch + Looks good + save | **PASS** |
| Save → builder | **PASS** |
| Waste ~17% with hip LF present | **PASS** |
| Ridge/hip cap LF in summary | **PASS** (confirm cap **line items** on builder Pricing step — pending explicit screenshot) |
| Solar loads full roof without manual sections | **FAIL (acceptable limit)** — only 3/8 auto; 5 manual required |

**Screenshots (workspace):** `assets/Screenshot_2026-05-27_at_11.45.06_PM-*.png` (map), `11.50.36_PM` / `11.50.45_PM` / `11.50.59_PM` (report + builder).

---

## Human prod verification — Greenway (2026-05-27)

**Tester:** Nathan Hall (logged-in prod)  
**Address:** 304 Greenway Dr (P-00093 / case study roof)  
**URL:** `https://arx-internal-crm.vercel.app/tools/roof-measure` (address param `304 Greenway…`)

### Solar auto-load vs manual work

| Item | Result |
|------|--------|
| Sections on map after Solar reload | **7 auto-loaded** — matches case study section count |
| Operator work after load | **Vertex drag only** — “walk” bbox quads to roof lines (expected for `solar_bbox` / **Satellite box (rough)**); **no extra sections drawn** (unlike Concord +5) |
| Geometry source (observed) | **Satellite box (rough)** on sections — prod API path is `solar_bbox`, not `solar_mask_plane` (overnight smoke aligned) |
| Interpretation | **PASS for golden facet count.** Outline refinement is normal ops for bbox quads; not a blank-map or missing-plane failure. |

### Map / trust UI (observed)

- **7** colored numbered overlays on satellite imagery.
- Section 1 example: **729 sqft** roof surface, **673** flat, **5/12** pitch, **Solar applied**, **Facing NW (306°)**.
- Tags: **Auto**, **Satellite box (rough)**, **Solar applied**.
- **Looks good ✓** / save flow — **pending** at time of screenshot (operator still aligning vertices).

### Case study targets (save still required to confirm)

Per [roof-measure-greenway-case-study.md](./roof-measure-greenway-case-study.md) — verify after pitch all + Looks good + save:

| Metric | Target | Human prod |
|--------|--------|------------|
| Sections | 7 | **7 on map** ✓ |
| Squares (actual) | ~28.13 | *pending save* |
| Waste % | ~17% | *pending save* |
| Ridge / hip / valley LF | 112 / 109 / 68 | *pending save* (drawn ridge overrides geo per case study) |

### Greenway checklist verdict (human, in progress)

| Check | Result |
|-------|--------|
| Blank map after Solar reload | **PASS** (7 sections visible) |
| 7 sections without hand-adding planes | **PASS** (all 7 auto) |
| Trust badges (Solar applied, geometry rough bbox) | **PASS** |
| Vertex align to roof lines | **IN PROGRESS** (operator step) |
| Save → builder + ~28 sq / ~17% waste / hip LF | **PENDING** — complete after align + Looks good on all 7 |

**Screenshot (workspace):** `assets/Screenshot_2026-05-27_at_11.55.49_PM-3601ea9a-8da3-4998-8ce3-5c07a224735b.png`

---

## Session summary (automated agent — 2026-05-28)

| Check | Result | Evidence |
|-------|--------|----------|
| Prod route reachable | **PASS** | HTTP 200 on `/login?next=%2Ftools%2Froof-measure` |
| Authenticated CRM session | **FAIL / BLOCKER** | Navigating prod or localhost `/tools/roof-measure` redirects to Sign in (email + password). No credentials available to agent. |
| Prod detect-roof API | **BLOCKED** | `POST /api/ai/detect-roof` → `401` / `{"error":"Unauthorized"}` without session |
| Browser tool loaded roof measure UI | **FAIL** | Never reached tool shell — blocked at login on prod and `localhost:3000` |

**Screenshot (prod):** Sign-in card — “ARX Roofing & Exteriors”, fields Email / Password, button “Sign in”, subtitle “Access your internal CRM and estimating tools.”

---

## Trust UI matrix (requested — prod browser)

| Element | Browser verdict | Evidence |
|---------|-----------------|----------|
| **Quote ready / Not quote ready** chip | **NOT VERIFIED** | Blocked at login. Implemented in `page.tsx` (`measurements.quote_ready` → emerald “Quote ready” vs gray “Not quote ready”). |
| **Pitch source badge** (“Solar applied” / “You chose”) | **NOT VERIFIED** | Blocked at login. `pitchSourceLabel()` renders badges on section rows. |
| **Geometry source badge** (bbox vs mask plane) | **NOT VERIFIED** | Blocked at login. `geometrySourceLabel()` e.g. “Satellite box (rough)”, “Satellite mask (planes)”. |
| **DSM conflict line** (>3° Solar vs DSM) | **NOT VERIFIED** | Blocked at login. Per-section amber note when `dsmPitchDisagreesWithSolar` and pitch set. |
| **Save gating** (pitch + Looks good + bbox) | **NOT VERIFIED** | Blocked at login. Code: Save disabled when `unresolvedPitchCount > 0`; `saveMeasurement()` alerts for missing pitch_source, geometry_reviewed, solar_bbox/whole. |
| **Reload `?measurement_id=`** preserves sloped totals | **NOT VERIFIED** | Blocked at login. Code: `loadSavedMeasurement` → `restoreMeasurementOverlays` → `updateMeasurements(restoredFacets, …)` (not stale flat-only set). |

---

## Launch checklist — row by row

Source: [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md)

### Before you open the browser (engineering)

| Row | Pass/Fail | Evidence |
|-----|-----------|----------|
| `npm run roof-measure:prelaunch` | **PASS** | Agent run 2026-05-28: TypeScript OK, roof unit tests OK, edge classify golden OK. |
| `npm run build` (re-run after doc audit) | **FAIL** (this session) | Exit code 1; output truncated to static route list only. Re-run on clean CI / Agent A for G2. Checklist prior note: PASS on 2026-05-27. |

### Desire path: “I can quote this job” — On the map

| Row | Pass/Fail | Evidence |
|-----|-----------|----------|
| Search address → satellite loads | **FAIL (BLOCKED)** | Auth redirect; Concord/Greenway never searched in browser. |
| Reload outline from satellite → section outlines (not empty boxes only) | **FAIL (BLOCKED)** | Cannot reach map. Prior MCP QA (2026-05-28 local) reported “Loading Google Maps…” / 0 sections even when logged in. |
| Each section shows **Facing** when Solar had it | **FAIL (BLOCKED)** | Not reached. Code shows Facing line on section card when azimuth/orientation present. |
| **Choose roof pitch** on **every** section — save stays blocked until done | **FAIL (BLOCKED)** | Not exercised in browser. Code: `disabled={unresolvedPitchCount > 0}` on Save; helper text “Save and estimate stay grayed out until each section has a roof pitch.” |
| **Looks good ✓** on auto-loaded sections before save | **FAIL (BLOCKED)** | Not exercised. Code: save alert if any `geometry_reviewed !== true`. |

### Numbers you’ll order from

| Row | Pass/Fail | Evidence |
|-----|-----------|----------|
| Simple 2-section gable: **ridge LF** ≈ shared top edge (not 0) | **FAIL (BLOCKED)** | Not reached. Automated classify golden PASS (prelaunch). |
| Complex roof: **hips LF** > 0 when hip planes drawn | **FAIL (BLOCKED)** | Not reached. Greenway frozen tests PASS (Agent F scope). |
| **Ridge** draw button → ridge LF follows your line | **FAIL (BLOCKED)** | Not reached. Prior QA: Ridge/Valley buttons visible in a11y tree when logged in locally. |
| **Valley** draw button → adds to valley LF | **FAIL (BLOCKED)** | Not reached. |

### Save → proposal

| Row | Pass/Fail | Evidence |
|-----|-----------|----------|
| Save → lands in proposal builder with `measurement_id` | **FAIL (BLOCKED)** | Not reached. Code redirects to `/proposals/builder?measurement_id=…`. |
| **Ridge cap** / **hip cap** lines when ridge/hip LF > 0 | **FAIL (BLOCKED)** | Not reached. Builder collateral audited by Agent B (out of scope here). |
| **Waste %** higher on hip-heavy roof than simple gable (sidebar) | **FAIL (BLOCKED)** | Not reached. Greenway case study expects ~17% on hip-heavy 7-section roof. |

### Nothing scary in the console

| Row | Pass/Fail | Evidence |
|-----|-----------|----------|
| No errors on the happy path above | **FAIL (BLOCKED)** | Happy path not run. Login page: no roof-measure console errors observed. |
| Overlap warning if sections way bigger than Solar footprint (~8%+) | **FAIL (BLOCKED)** | Not reached. Code blocks save when flat area / solar ref > 1.08 with alert. |

### Desire path: “I’d order material from these numbers”

| Row | Pass/Fail | Evidence |
|-----|-----------|----------|
| Hip-heavy test roof: hip LF visible, waste % not naive, cap count > 0 | **FAIL (BLOCKED)** | Greenway not loaded in browser. |
| Ops name + date for P-00093-class hip job | **FAIL (PENDING HUMAN)** | Sign-off table empty — requires ops human. |

### Sign-off table

| Role | Name | Date | Status |
|------|------|------|--------|
| Engineering | — | — | Pending human |
| Ops / production | — | — | Pending human |

---

## Golden addresses (prod matrix)

| Address | Expected | Browser result |
|---------|----------|----------------|
| 1361 Kison Ct NW, Concord NC 28027 | Bbox quads visible; pitch dropdown; save gating; no console errors | **PASS (partial)** — 2026-05-27 human prod: 3 auto + 5 manual sections; save → builder OK; ~17.6 sq, ~17.5% waste, ridge/hip caps in summary. **Limit:** Solar under-splits (P1). Duplicate 3/4 warning — ops review. |
| 304 Greenway Dr | 7 sections; ~28 sloped squares; hips/waste/caps plausible | **PASS (partial)** — 2026-05-27: **7 auto** bbox sections on map; **Satellite box (rough)**; vertex align in progress. **Save/math pending** (~28 sq, ~17% waste, R/H/V LF). |

---

## Ship gates (D-UI scope)

| Gate | Status | Notes |
|------|--------|-------|
| **G6** — Desire paths 1–3 on **prod browser** (quote, trust numbers, simple gable) | **PARTIAL** | **Concord:** save → builder PASS. **Greenway:** 7 auto on map PASS; save → builder + math **pending**. |
| **G7** — Golden addresses on prod | **PARTIAL** | Concord + Greenway maps **not blank**; Greenway **7 facets** PASS; mask-plane N/A (bbox on prod). Greenway totals **pending save**. |
| **G10** — QA report filed with PASS/FAIL per checklist row | **PASS** | This file. |

---

## Blockers

1. **CRM authentication (P0 for browser QA):** Prod and local dev redirect to `/login`. Agent has no `@arxroofing.com` credentials and cannot complete MFA if required.
2. **Prod API auth:** `/api/ai/detect-roof` returns Unauthorized without session — cannot smoke Concord/Greenway facets without login or service token.
3. **Concord blank map (ship NO-GO trigger):** **CLEARED** — 2026-05-27 human prod: 3 auto sections on map (see Human prod verification).
4. **Save blocked on valid flow:** **CLEARED for Concord** — save → builder succeeded 2026-05-27. **Greenway save** — pending (map load OK).
5. **Historical MCP flakiness:** [roof-measure-qa-2026-05-28.md](./roof-measure-qa-2026-05-28.md) logged Google Maps stuck on “Loading…” when logged in locally — retest after single dev server + fresh login.
6. **Build gate (G2):** Failed in this agent session; needs Agent A re-run.

---

## Recommendation

- [ ] Ready for production (unqualified)  
- [x] **GO — ready with known limits** (2026-05-28, engineering)  
- [ ] Not ready

**Ship decision:** **GO** for in-house 2.5D roof measure on prod `47570fd+`. Collateral audit (Agent B): **no P0** on save → builder → ops. Human prod: Concord save/builder PASS; Greenway **7 auto** on map PASS (bbox vertex align is expected ops).

**Post-GO follow-ups (non-blocking):**

1. Finish Greenway save when convenient — confirm ~28 sq / ~17% waste vs case study (map load already PASS).  
2. Vercel Production: confirm `NEXT_PUBLIC_USE_PLANE_INTERSECTION_LF` unset or not `true` (G9 — code default off).  
3. Ops sign-off row on [launch checklist](./roof-measure-launch-checklist.md).  
4. P1 collateral: `google_solar` integration completed-without-LF; iOS LiDAR payload gaps; measurements list View/Use dead links; `hasMeasuredLinework` ignores hips; vertex drag auto-confirms geometry.

**Automated gates at GO:** `npm run roof-measure:prelaunch` PASS; frozen Greenway / P-00093 tests green (Agent F); Production deploy `47570fd`.

---

## Commands run

```bash
npm run roof-measure:prelaunch   # PASS
npm run build                    # exit 1 (this session)
curl -X POST https://arx-internal-crm.vercel.app/api/ai/detect-roof  # 401 Unauthorized
```

## Browser steps attempted

1. `browser_navigate` → prod `/tools/roof-measure` → redirect to Sign in (screenshot captured).  
2. `browser_navigate` → `localhost:3000/tools/roof-measure?address=1361 Kison Ct NW…` → redirect to Sign in.  
3. No further UI interaction possible without credentials.
