# LAUNCH PROMPT — Roof measure 100% production ready

## Related docs

| Doc | Purpose |
|-----|---------|
| [roof-measure-README.md](./roof-measure-README.md) | Quick start, commands, architecture |
| [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md) | Multi-agent launch orchestration |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Human QA before prod |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Calibration & prelaunch gate |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Browser QA report template |
| [roof-measurement-providers.md](./roof-measurement-providers.md) | Aurora / Solo / Google vs ARX |


**Repo:** `/Users/nathanhall/arx-internal-crm`  
**Tool:** `/tools/roof-measure`  
**Orchestrator:** Run as **Head Coder**. Use **parallel Cursor agents** (or Task subagents) per wave. Full permissions: shell, MCP `move_agent_to_root`, browser MCP for QA.

**Already shipped (do not redo unless broken):**
- `lib/roof-measure-edge-classification.ts` — geometric LF
- `lib/roof-face-solar-alignment.ts` — Solar/Aurora facing
- Facing on facets + interior edge classification in `page.tsx`
- `npm run roof-measure:classify` + golden fixtures
- Proposal builder cap bundles from `ridges_lf` / `hips_lf`
- Docs: `roof-measurement-providers.md`, `roof-measure-accuracy-report.md`

**Explicitly OUT OF SCOPE for launch:**
- Aurora / Solo / EagleView **webhooks**
- New DB migrations (store facing in `raw_data` JSON via existing save)
- 3D parity with Aurora edge typing

---

## Launch definition of done

1. `npm run roof-measure:prelaunch` → exit 0  
2. `npm run build` → exit 0  
3. `docs/roof-measure-launch-checklist.md` → every item checked in browser  
4. EagleView fixture **classify-only** within ±15% on at least **one** real-address polygon set  
5. Untracked roof files **committed** to main branch  
6. No P-00093-class failure: hip LF → waste % → cap bundles chain verified  

---

## Wave 0 — Orchestrator (you)

```text
cd /Users/nathanhall/arx-internal-crm
call MCP move_agent_to_root → /Users/nathanhall/arx-internal-crm
npm run roof-measure:prelaunch
npm run build
git status  # ensure lib/roof-measure-edge-classification.ts etc. are committed
```

Assign Wave 1 agents. Merge in order: L2 → L1 → L3 → L4 → L5 → L6. Re-run prelaunch after each merge.

---

## Wave 1 — Parallel agents

### Agent L1 — CI & preflight `PARALLEL`

**Goal:** One command proves deploy safety.

**Tasks:**
1. Ensure `scripts/roof-measure-prelaunch.ts` runs tsc + roof jest pattern + `roof-measure:classify`.
2. Add `package.json`: `"roof-measure:prelaunch": "tsx scripts/roof-measure-prelaunch.ts"`.
3. Add `lib/__tests__/roof-measure-launch-smoke.test.ts` if missing.
4. Fix any `npm run build` errors touching roof-measure.
5. Document in `docs/roof-measure-accuracy-report.md` the prelaunch command.

**Acceptance:** `npm run roof-measure:prelaunch` and `npm run build` exit 0.

---

### Agent L2 — Save / load / proposal roundtrip `PARALLEL`

**Goal:** Nothing lost from map → DB → proposal builder.

**Tasks:**
1. Verify `POST /api/measurements` stores full `raw_data` including `facets[].facing_azimuth_degrees`, `suggested_azimuth_degrees`, `solar_segment_index`.
2. If proposal builder loads measurement by `measurement_id`, confirm `ridges_lf`, `hips_lf`, `valleys_lf` columns populated from save.
3. Add test or script `scripts/roof-measure-roundtrip-fixture.json` — minimal measurement payload → classify → expected LF fields.
4. Confirm `calculateWasteFactorDetailed` receives live `hips`/`valleys` from `updateMeasurements` (grep only; add test if gap).

**Acceptance:** Documented roundtrip path; no missing fields in `raw_data`.

---

### Agent L3 — UI & operator clarity `PARALLEL`

**Goal:** Production user cannot confuse facing vs drain or miss manual ridge.

**Files:** `app/tools/roof-measure/page.tsx`

**Tasks:**
1. **Selected section overlay** (map): show Facing + pitch like sidebar list.
2. Linear LF panel: when `hips_lf > 0`, show one-line note “Hip length drives waste % and hip cap bundles.”
3. When `measurement_confidence !== 'high'`, make validation notes visible without scroll if possible.
4. Ridge/valley draw buttons: verify labels visible (grep `ridge` drawing mode).
5. Do not change save gating rules (pitch manual, geometry reviewed).

**Acceptance:** Screenshot-level clarity; no new blockers for save.

---

### Agent L4 — EagleView / Roofr calibration `PARALLEL`

**Goal:** Prove real-world LF accuracy, not only synthetic golden.

**Files:**
- `scripts/roof-measure-eval-fixtures.json` (targets)
- `scripts/roof-measure-classify-fixtures.json` (NEW — polygon inputs)
- `scripts/roof-measure-classify-eval.ts` (extend to load second file)

**Tasks:**
1. Create `scripts/roof-measure-classify-fixtures.json` with at least:
   - `florida-ave-eagleview-gable` — 2-facet polygons approximating 101 LF ridge (from report or manual trace)
   - `kison-court-roofr-partial` — optional simplified 3–4 facet subset with ridge/valley targets
2. Extend classify eval: `npm run roof-measure:classify -- --fixtures classify` 
3. Update `docs/roof-measure-accuracy-report.md` with actual % error table.
4. If ridge error > 15%, tune `SHARED_EDGE_TOLERANCE_DEG` or document operator must snap shared edges.

**Acceptance:** At least one EagleView fixture within ±15% ridge LF OR documented operator snap requirement with UI note.

---

### Agent L5 — Browser QA (MCP) `PARALLEL`

**Goal:** Execute human checklist with browser MCP.

**Prereq:** `npm run dev` on port 3000, logged-in session.

**Tasks:**
1. `browser_navigate` → `http://localhost:3000/tools/roof-measure?address=...` (use Florida or Kison fixture address).
2. Run Solar load; verify facets + facing text.
3. Assign pitch on all sections; confirm measurements panel ridge/hip LF.
4. Optional: save → builder cap lines (if auth works).
5. Fill `docs/roof-measure-launch-checklist.md` checkboxes in a short **QA report** `docs/roof-measure-qa-YYYY-MM-DD.md`.

**Acceptance:** QA report with pass/fail per checklist row; file blockers only.

---

### Agent L6 — API & detect-roof hardening `PARALLEL`

**Goal:** Solar path always passes azimuth; mask preferred over bbox.

**Files:**
- `app/api/ai/detect-roof/route.ts`
- `lib/solar-roof-mask-facets.ts`

**Tasks:**
1. Audit all facet payload builders set `suggested_azimuth_degrees` when segment has `azimuth_degrees`.
2. Prefer `solar_mask_plane` over `solar_bbox` when mask quality threshold met (log `facet_source` in eval).
3. Add/extend test in `solar-roof-mask-facets.test.ts`.
4. No new env vars without documenting in README or internal doc.

**Acceptance:** Tests pass; detect response always includes azimuth when Solar has it.

---

### Agent L7 — Docs & commit hygiene `PARALLEL`

**Goal:** Next engineer can launch without this chat.

**Tasks:**
1. Ensure all `docs/roof-measure*.md` cross-link.
2. Add `docs/roof-measure-README.md` — 1-page: run tool, prelaunch, classify, provider model.
3. List **untracked files that must be committed** before deploy.
4. Suggested commit split:
   - `feat(roof): edge classification and facing alignment`
   - `feat(roof): prelaunch gate and calibration fixtures`
   - `fix(admin): Solo → gosolo.io` (if not committed)

**Acceptance:** README exists; git status clean for roof files after commit.

---

## Wave 2 — Gate (Orchestrator)

```bash
npm run roof-measure:prelaunch
npm run build
npm test
```

Update `docs/roof-measure-accuracy-report.md` with:
- Prelaunch: PASS/FAIL + date
- EagleView calibration table
- Known limitations (2D vs 3D)

---

## Wave 3 — Production deploy criteria

Ship only if ALL true:

| # | Criterion |
|---|-----------|
| 1 | Prelaunch + build green |
| 2 | Launch checklist 100% checked |
| 3 | EagleView ridge within ±15% OR ops sign-off on snap workflow |
| 4 | P-00093 scenario: 80+ hip LF → waste ≥ 15% → cap bundles > 0 |
| 5 | Code committed; no `??` roof libs on deploy branch |

---

## Agent spawn template (copy per agent)

```text
You are Agent L[N] for ARX roof measure LAUNCH.
Workspace: /Users/nathanhall/arx-internal-crm
Read: docs/roof-measure-launch-prompt.md (section L[N]) and docs/roof-measurement-providers.md
Rules: No webhooks. Minimal diff. Tests for logic changes. Run npm run roof-measure:prelaunch when done.
Return: files changed, commands run, pass/fail, blockers.
```

---

## Reference: industry face model (do not confuse)

| | Aurora / Google Solar | ARX |
|--|----------------------|-----|
| Face | 3D plane | Drawn polygon + pitch |
| Azimuth | Panel-facing ° | `facing_azimuth_degrees` |
| Edges | Typed in 3D | `classifyRoofEdges` + manual lines |
| LF source | Model edges | 2D inference |

**Solo (gosolo.io):** DSM → 3D → pitch/azimuth inside app; no public LF API — reference only.

---

## One-line mission

> Ship `/tools/roof-measure` so production jobs get **correct hip/ridge LF, waste %, and cap orders** — proven by automated preflight, browser checklist, and at least one EagleView-calibrated fixture.
