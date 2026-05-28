# Roof measure — path to 8/10 (CRM-safe)

**Use this prompt** for a focused improvement program after **GO on 2.5D** (`47570fd`+).  
**Goal:** Raise field quality from **~6/10 → 8/10** without breaking proposal builder, measurements save/load, ops, webhooks, or unrelated CRM surfaces.

**Read first:**
- [roof-measure-in-house-capability-prompt.md](../roof-measure-in-house-capability-prompt.md) — desire paths (source of truth)
- [roof-measure-greenway-case-study.md](../roof-measure-greenway-case-study.md) — frozen math targets
- [roof-measure-qa-2026-05-28-final.md](../roof-measure-qa-2026-05-28-final.md) — prod Concord/Greenway baseline
- [roof-measure-industry-patterns.md](../roof-measure-industry-patterns.md) — mask/bbox, P0/P1 patterns

**Prod:** `https://arx-internal-crm.vercel.app/tools/roof-measure`  
**Repo:** `/Users/nathanhall/arx-internal-crm`

---

## What 8/10 means (not 10)

| 8 means | 10 means (out of scope) |
|---------|-------------------------|
| Most suburban hip/gable jobs: **≥5 auto sections**, **&lt;2 min** vertex tweak, save → builder trusted | Hover/EagleView report-grade mesh, zero manual edit |
| Greenway-class save: **~28 sq, ~17% waste, hip LF ~100+**, caps in builder | LiDAR / oblique / new vendor geometry |
| Hip-heavy waste **≥15%** when hips LF ≥60 (P-00093) holds on prod saves | Plane LF in prod without beat-2D proof |
| CRM collateral unchanged for in-house path | Rewriting proposals, commissions, canvass, etc. |

**Current baseline (2026-05-27 prod):** Concord 3 auto +5 manual; Greenway 7 auto bbox quads; `solar_mask_plane` rare on prod; DSM often `unavailable`.

---

## CRM collateral — do not damage

Every PR must pass **collateral gate** before merge. Agent B scope from final ship still applies.

### In-scope touchpoints (change only with tests)

| Surface | Path | Must still work |
|---------|------|-----------------|
| Save / load | `app/api/measurements/route.ts`, `[id]/route.ts` | `solar_auto` + `manual` pitch gate; `geometry_reviewed`; block `solar_bbox`/`solar_mask_whole` at save; `raw_data` roundtrip |
| Tool | `app/tools/roof-measure/page.tsx` | Search → detect → pitch → Looks good → save → builder redirect |
| Builder | `app/proposals/builder/page.tsx`, `app/api/proposals/builder/route.ts` | `ridges_lf`/`hips_lf` → cap lines; `waste_category` from `raw_data`; `quote_ready` / `completed` gate |
| Ops | `app/ops/jobs/[id]/page.tsx` | LF columns + waste fallback |
| Detect | `app/api/ai/detect-roof/route.ts`, `lib/solar-roof-mask-facets.ts`, `lib/solar-dsm.ts` | Return drawable facets; no API shape breaks for existing clients |

### Out of scope (do not refactor “while you’re here”)

- EagleView / Roofr / Hover integrations (`app/api/integrations/*`)
- iOS LiDAR (`ARX Sales/APIClient.swift`) — separate ticket unless explicitly requested
- `google_solar` fast-path in `request-measurement` — document only; no behavior change without product sign-off
- Proposals PDF, commissions, canvass, calendar, auth, middleware
- **Enabling `USE_PLANE_INTERSECTION_LF` in prod** — staging only until Greenway beats 2D
- Three.js, new measurement vendors, schema migrations without backward-compatible `raw_data`

### Collateral NO-GO (any one blocks merge)

- `POST /api/measurements` rejects valid `solar_auto` + reviewed geometry save
- Proposal builder drops cap lines when `ridges_lf` or `hips_lf` > 0
- Reload `?measurement_id=` restores flat-only totals (bypasses `updateMeasurements` / `slopedAreaSqft`)
- Hip-heavy fixture drops waste below **15%** at 80+ hip LF (P-00093)
- Untested change to shared `lib/*` used by non-roof routes without grepping consumers

### Required checks after every code PR

```bash
npm run roof-measure:prelaunch
npm test -- --testPathPattern="roof-measure|roof-plane|solar-dsm|measurements-pitch|roof-material-order"
npm run build
```

Optional targeted:

```bash
npm run roof-measure:classify
```

---

## Improvement phases (order matters)

### Phase A — Trust UX fixes (low risk, 1–2 PRs)

**Target:** Path 2 “trust before order” without changing detect geometry.

| ID | Task | File hints | Acceptance |
|----|------|------------|------------|
| A1 | `hasMeasuredLinework` true when `hips_lf > 0` | `page.tsx` (~validation / LF panel) | Hip-only roof: no false “LF not auto-estimated” note |
| A2 | Vertex edit clears `geometry_reviewed` until “Looks good ✓” again | `syncFacetFromOverlay` / polygon listeners | Material polygon edit requires re-confirm; save blocked with clear message |
| A3 | Reload: recompute each facet `area_sqft` via `slopedAreaSqft` before `updateMeasurements` | `restoreMeasurementOverlays` ~650–736 | Saved measurement reload: sidebar sq matches sloped math |
| A4 | `loadSavedMeasurement` awaits `waitForMapToSettle` | `page.tsx` ~551–770 | No empty map race on `?measurement_id=` |

**Do not** change save payload schema or column mapping in Phase A.

---

### Phase B — Mask/bbox & segment count (highest ROI)

**Target:** Geometry **4–5 → 7**; fewer manual sections on Concord-class jobs; mask planes when GeoTIFF available.

| ID | Task | File hints | Acceptance |
|----|------|------------|------------|
| B1 | Diagnose prod mask loss: log why `tryFacetPayloadsFromSolarRoofMask` falls back to bbox (Greenway + Concord) | `detect-roof/route.ts`, `solar-roof-mask-facets.ts` | QA doc: root cause per address |
| B2 | Fix mask path or bounds (mapBounds, zoom, pin vs `capture_center`, GeoTIFF fetch) | same | Prod API: Greenway ≥1 `solar_mask_plane` **or** documented bbox-only with ≥7 facets |
| B3 | Reduce over-filtering of Solar segments (Concord 3 → closer to true plane count) | overlap filter, min area, segment dedupe in `route.ts` | Concord: ≥5 auto sections without manual add on repro |
| B4 | Keep Phase 0 guarantee: never zero drawable facets when Solar returns segments | `prepareSolarBboxFacetsForResponse` | Blank map = FAIL |

**Collateral:** Only `detect-roof` response fields used by `page.tsx`; do not remove existing keys. Additive facet fields OK.

---

### Phase C — DSM reliability (2.5D credibility)

**Target:** `dsm_coverage` not `unavailable` on majority of NC goldens.

| ID | Task | File hints | Acceptance |
|----|------|------------|------------|
| C1 | Prod trace `dataLayers:get` failures (key, radius, rate limit) | `lib/solar-dsm.ts` | Log + QA table for 5 addresses |
| C2 | Surface DSM pitch conflict only when sample exists | `page.tsx` DSM notes | No false conflicts when DSM null |

**Do not** auto-overwrite operator pitch from DSM without explicit UX (suggestion only).

---

### Phase D — Prod validation matrix (human + API)

**Target:** Trust math **7 → 8** with evidence file.

| Address | Pass criteria |
|---------|----------------|
| 304 Greenway Dr | 7 sections; save **~28 sq ±5%**, **~17% waste**, R/H/V LF plausible; builder caps |
| 1361 Kison Ct NW | Not blank; ≤2 manual sections added vs auto; save → builder |
| +3 NC jobs | Document auto section count, geometry source, minutes to quote-ready |

File: `docs/roof-measure-qa-YYYY-MM-DD-path-to-8.md`

---

### Phase E — Plane LF (staging only)

**Only after Phase B + Greenway prod save PASS.**

| ID | Task | Acceptance |
|----|------|------------|
| E1 | Run `npm run roof-measure:classify` + Greenway fixture with flag on in **local/staging** | 2.5D R/H/V ≥ 2D on Greenway or document why not |
| E2 | Keep `NEXT_PUBLIC_USE_PLANE_INTERSECTION_LF` off in Vercel Production | G9 |

---

## Paste prompt — orchestrator (Head of Dev)

```text
You are Head of Dev for ARX roof measure — Path to 8/10 (CRM-safe).
Workspace: /Users/nathanhall/arx-internal-crm — move_agent_to_root first.

Context: 2.5D shipped GO (docs/roof-measure-qa-2026-05-28-final.md). Score ~6/10.
Goal: 8/10 = better auto geometry + trust UX + prod Greenway save proof — NOT new vendors or 3D.

Read: docs/prompts/roof-measure-path-to-8.md (this file), roof-measure-in-house-capability-prompt.md, roof-measure-greenway-case-study.md.

RULES — CRM SAFETY (non-negotiable):
- Minimal diff; one concern per PR preferred
- Touch only: detect-roof, solar mask/dsm libs, roof-measure page.tsx, roof-measure-geometry/solar-pitch, tests
- DO NOT: integrations webhooks, iOS, proposals core, commissions, enable plane LF in prod, schema breaks on raw_data
- After EVERY code change: npm run roof-measure:prelaunch && npm test (roof-measure pattern) && npm run build
- Run collateral grep: raw_data, quote_ready, pitch_source, solar_auto, ridges_lf, hips_lf, slopedAreaSqft consumers
- P0 fix only if collateral NO-GO; otherwise phase backlog

WORK ORDER:
1. Phase A (trust UX) — ship first if tests green
2. Phase B (mask/bbox + segment count) — highest ROI
3. Phase C (DSM) — if API failures understood
4. Phase D — human prod matrix + QA doc
5. Phase E — plane LF staging eval only

Spawn parallel (background):
- Collateral agent: re-run Agent B table; FAIL any PR that touches out-of-scope files
- Detect agent: Phase B root cause + minimal fix
- UX agent: Phase A1–A4
- Test agent: prelaunch + frozen Greenway/P-00093 numbers after each merge

Output: Path-to-8 status memo —
  - Score estimate (1–10) with evidence
  - PRs merged vs open
  - Collateral PASS/FAIL
  - Prod matrix PASS/FAIL per address
  - Explicit deferrals

Do not ask user for approval on tests/commits unless login/MFA or collateral FAIL you cannot fix safely.
Commit message: fix(roof): … or feat(roof): … — one line why for CRM safety.
```

---

## Paste prompt — single worker (one phase)

```text
You are implementing Phase [A|B|C] of docs/prompts/roof-measure-path-to-8.md for ARX roof measure.

CRM-safe rules: read "CRM collateral — do not damage" in that doc. Only edit files listed for your phase.
Before commit: roof-measure:prelaunch, roof-measure jest pattern, npm run build.

Return: PASS/FAIL, files changed, test output summary, collateral checklist (PASS/RISK/FAIL per touchpoint), prod retest steps for human.
Do not enable USE_PLANE_INTERSECTION_LF in prod env.
```

---

## Definition of done (8/10 program)

- [ ] Phase A merged; desire paths 2 and 6 improved in QA notes  
- [ ] Phase B: Greenway prod detect improves (mask plane or stable 7 bbox + Concord ≥5 auto)  
- [ ] Phase C: DSM available on ≥50% of 5-address smoke table  
- [ ] Phase D: Greenway **save** matches case study within agreed tolerance; builder caps confirmed  
- [ ] 10-address prod matrix documented  
- [ ] All collateral NO-GO checks green  
- [ ] `USE_PLANE_INTERSECTION_LF` still **off** in Production  
- [ ] Engineering updates QA doc; ops signs one P-00093-class job  

**Score re-rate:** Team blunt score ≥8 on “would you order from this without Roofr first?” for standard hip/gable in NC.

---

## What not to do (prevents CRM damage)

1. **Broad refactors** of `measurements` API or proposal builder pricing engine  
2. **Auto-set `status: completed`** on incomplete integration measurements  
3. **Changing** `raw_data` facet shape without roundtrip test update  
4. **Removing** save blocks on `solar_bbox` (quote-ready integrity)  
5. **Feature flags on** in prod without staging beat-2D proof  
6. **Copying** vendor report polygons into CRM without license/architecture review  

---

## P1 backlog (post-8, non-blocking)

- Wire measurements list View/Use → `?measurement_id=` / builder  
- iOS LiDAR payload parity with web save  
- `google_solar` integration path → `needs_review` until LF exists  
- Shared-edge snap assistant between adjacent facets  
- Plane LF prod enable after Phase E  

---

## Related commits / docs

- Ship baseline: `47570fd`, QA GO `83d2907`  
- Autonomous ship playbook: [roof-measure-final-ship-autonomous.md](./roof-measure-final-ship-autonomous.md)  
- 2.5D phase spec: [roof-measure-2.5d-implementation.md](./roof-measure-2.5d-implementation.md)
