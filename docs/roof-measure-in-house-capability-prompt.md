# Roof measure — what we're building (master)

**For:** anyone measuring roofs in ARX, and anyone coding or testing the tool.  
**Tool:** `/tools/roof-measure` in the CRM.

This doc is organized the way people actually work — not by file names or agent numbers. Technical detail lives at the end.

---

## The point

Production needs **one place inside ARX** to measure a roof and walk away with numbers good enough to **order shingles, waste, and ridge/hip caps** on the proposal — without opening EagleView, Roofr, or any other measurement vendor.

Google Solar helps you **see** the roof on the map. **You** confirm pitch and geometry. ARX does the math and saves it to the job.

---

## Desire paths (how humans use this)

### 1. “I need to quote this job”

**You want:** squares, waste %, and cap quantities on the proposal — today.

**Path:**

1. Open **Roof measure** for the job address (search often loads a **satellite outline** automatically).
2. If sections are missing or stale, click **Reload outline from satellite** (Google Solar — not a third-party measurement vendor).
3. On **every section**, **choose roof pitch** from the dropdown. Satellite suggestions alone do not count — you must pick pitch manually. The save button stays **disabled** until every section has pitch.
4. Tap **Looks good ✓** on each section you accept (especially after Solar load). If you skip this, save will **stop with a message** — the button is not grayed out for geometry, but save will not go through.
5. If save complains about **whole-roof outline only** (`solar_bbox` / `solar_mask_whole`), redraw or split sections until you have proper plane outlines.
6. Watch **Notes** (yellow) for overlap warnings (footprint much larger than Solar’s estimate).
7. Check the sidebar: **ridge / hip / valley** LF, **waste %**, squares (ridge/hip may be 0 until pitches are set or lines are drawn).
8. **Save** → you land in the **proposal builder** with `measurement_id`. **Ridge cap** and **hip cap** lines appear when ridge or hip LF is greater than zero (ordered in **cap squares**, bundles in description).

**Done when:** proposal shows believable squares (with waste), waste %, cap sq, and bundle counts for that address.

---

### 2. “I need to trust these numbers before I order material”

**You want:** confidence you won’t under-order on a hip-heavy job (the P-00093 lesson: low hip LF → low waste → short caps and field shingles).

**Path:**

1. After pitches are set, read **Hips** in the linear footage panel.
2. If hips &gt; 0, read the gray note under Linear Footage: *Hip length affects waste % and hip cap bundle count on the proposal.*
3. On complex roofs, use the **Ridge** / **Valley** draw buttons on the map when the auto estimate isn’t good enough (hips are inferred from section shapes — there is no “draw hip” tool).
4. Read **Notes** (yellow box) when confidence isn’t high — don’t ignore overlap or “draw ridge” warnings.
5. For a nasty hip job, get **ops sign-off** once before you trust it on similar jobs.

**Done when:** waste % moves up on hip-heavy roofs and cap counts are &gt; 0 when hips/ridges are real.

---

### 3. “Simple gable — should be quick”

**You want:** two main sections, one ridge line, sensible LF without drawing every edge by hand.

**Path:**

1. Load Solar → two sections (or draw two planes).
2. Set pitch on both → confirm geometry.
3. Ridge LF should reflect the shared top edge (not zero).
4. Save → builder ridge caps should appear.

**Done when:** ridge LF and cap line look right for a basic gable without manual ridge draw.

---

### 4. “Complex hips — I know the computer will guess”

**You want:** hips counted, waste not naive, option to fix ridges/valleys manually.

**Path:**

1. Split the roof into **one section per plane** (more sections = better LF).
2. Snap shared edges between sections where they meet.
3. Set pitch on all sections; check **Hips** LF &gt; 0 when hip planes exist.
4. Draw ridge/valley lines if validation says so.
5. Compare to a past report or field knowledge if you have it — ARX is **2D inference**, not a flying camera report.

**Done when:** hips and waste feel defensible; caps ordered match what you’d expect in the field.

---

### 5. “What direction does this section face?”

**You want:** solar-facing direction for each plane — not confused with “which way water runs.”

**Path:**

1. After Solar load, each section shows **Facing** (compass + degrees when Google provided it).
2. On the map, select a section — overlay shows **Facing** and pitch like the list.
3. Interior edge math uses **facing** when available; drain direction is internal only.

**Done when:** facing on screen matches what you’d tell a homeowner (“this slope faces south”).

---

### 6. “The outline is wrong”

**You want:** fix geometry without breaking the quote.

**Path:**

1. Drag vertices on the map; re-confirm **Looks good ✓** after big edits.
2. Re-check overlap warnings if total footprint blows past Solar’s estimate.
3. Re-set pitch if you split or merged sections.

**Done when:** outlines match what you’d walk on the roof, and validation notes are quiet or explained.

---

### 7. “We’re not using EagleView — so what was that name about?”

**You want:** clarity that ARX is **in-house**, not another subscription.

**Truth:**

- We **do not** run EagleView, Roofr, Aurora, or Solo software **in the roof measure workflow**. (Admin → Integrations may list vendors for other features — that is separate.)
- Sometimes a **past professional report** on a real address is used **only in automated tests** as a sanity check (“that job’s ridge was about 101 LF — does our math get close?”).
- That is **not** an integration. It’s “does our tool produce the *kind* of numbers a good report would?”

**Done when:** nobody on the team thinks launch means wiring EagleView APIs.

---

## When we're allowed to ship

Think in three layers — same order people feel risk:

| Layer | Question | Ready when |
|-------|----------|------------|
| **Machine checks** | Did we break the math? | `npm run roof-measure:prelaunch` and `npm run build` both pass (re-run after any code/doc-driven change) |
| **Real screen** | Does it work logged in on a real address? | [Launch checklist](./roof-measure-launch-checklist.md) fully checked in the browser |
| **Field trust** | Would ops order from this on a hip job? | One hip-heavy production job signed off (P-00093-class) |

We do **not** need: pixel-perfect match to Aurora 3D, or EagleView orders, or every hip roof perfect without drawing.

---

## For engineers & coding agents

Read the desire paths above first. Your work should make those paths smoother — not add vendor integrations.

### Before you change code

```bash
cd /Users/nathanhall/arx-internal-crm
npm run roof-measure:prelaunch
npm run build
npm run dev   # → /tools/roof-measure
```

### Map human needs → what to verify

| Desire path | What to protect in code |
|-------------|-------------------------|
| Quote the job | Save stores full measurement; builder reads `ridges_lf`, `hips_lf`, `valleys_lf`, waste, caps |
| Trust material | `calculateRoofWaste` gets live hips/valleys; hip note when hips &gt; 0 |
| Simple gable | `classifyRoofEdges` ridge on shared edge; golden tests pass |
| Complex hips | Hip LF &gt; 0 when drawn; manual ridge/valley overrides |
| Facing | Solar azimuth → `suggested_azimuth_degrees` / `facing_azimuth_degrees`; mask over bbox when quality OK |
| Not EagleView in roof measure | No vendor orders/webhooks from this tool; benchmarks in test JSON only |

### Agent brief (copy into a session)

```text
You are helping ARX roof measure — in-house only, Google Solar assist.

Read: docs/roof-measure-in-house-capability-prompt.md (desire paths first)
      docs/roof-measurement-providers.md (why 2D ≠ 3D — plain language)

Pick ONE desire path to improve. Minimal diff. No new EagleView/Roofr/Aurora wiring for `/tools/roof-measure`.
When done: npm run roof-measure:prelaunch

Say which path you helped, what you changed, pass/fail, blockers.
```

### Where the computer keeps truth (reference only)

| Topic | Location |
|-------|----------|
| Edge LF math | `lib/roof-measure-edge-classification.ts` |
| Waste + material order | `lib/roof-waste-model.ts`, `lib/roof-material-order.ts`, `lib/roof-shingle-constants.ts` |
| Cap order (sq) | `lib/hip-ridge-cap-squares.ts` |
| Accuracy rationale | `docs/roof-measure-accuracy-sources.md`, `docs/roof-measure-greenway-case-study.md` |
| Facing from Solar | `lib/roof-face-solar-alignment.ts`, `page.tsx` |
| Solar import | `app/api/ai/detect-roof`, `lib/solar-roof-mask-facets.ts` |
| Operator UI | `app/tools/roof-measure/page.tsx` |
| Automated checks | `npm run roof-measure:prelaunch`, `npm run roof-measure:classify` |
| Test benchmarks (not vendors) | `scripts/roof-measure-classify-fixtures.json` |
| Accuracy log | `docs/roof-measure-accuracy-report.md` |

Legacy orchestration with L1–L7 labels: [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md).

---

## More reading

| Doc | Why open it |
|-----|-------------|
| [roof-measure-README.md](./roof-measure-README.md) | Commands for devs |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Step-by-step browser sign-off |
| [roof-measurement-providers.md](./roof-measurement-providers.md) | How Aurora / Google think about “a face” vs us |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Test pass/fail and % error tables |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Blank QA report for a test day |

---

## One line

**Measure inside ARX, trust the proposal, order the right caps — with Google Solar helping you draw, and no measurement vendor in the loop.**
