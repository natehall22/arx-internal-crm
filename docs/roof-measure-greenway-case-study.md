# Case study: 304 Greenway Dr (May 2026)

**Why this job drove roof-measure hardening.**

## What happened in the field

- First order: **26 squares** (field shingles).
- Reorder: **10 more bundles** to cover total area + waste (and/or caps).

## Re-measure in `/tools/roof-measure` (today)

| Metric | Value |
|--------|--------|
| Sections | 7 @ 4/12 |
| Squares (actual) | **28.13** |
| Suggested waste | **17%** |
| Ridge LF (drawn) | 112 |
| Hip LF | 109 |
| Valley LF | 68 |

## What the tool says you should order

### Field shingles (3 bundles / square)

| Step | Amount |
|------|--------|
| Measured | 28.13 sq |
| + 17% waste (granular: valleys + hips + base cuts) | 32.91 sq |
| Bundles (ceil) | **99** |
| Bundle-rounded order | **33 squares** |

Ordering **26** was short by **~7 squares** (~21 bundles) vs this re-measure with waste — not just the 2.13 sq area gap.

### Ridge / hip caps — order in **cap squares** (÷100 LF/sq), not field LF

| Line | LF measured | Cap sq to order |
|------|-------------|-----------------|
| Ridge | 112 | **1.12 sq** |
| Hip | 109 | **1.09 sq** |
| **Combined** | 221 | **2.21 sq** |

Warehouse often still buys **bundles** (25 LF/bundle → 10 bundles total). UI shows **sq first**, LF as “measured.”

**10 extra bundles** on the job matches **cap bundles exactly** if caps were missed on the first PO — confirm with warehouse whether the reorder was field or cap stock.

## Tool status

- **Math:** PASS — hips/valleys justify 17% waste; drawn ridges replace geometric ridge LF.
- **UX fix:** Sidebar now shows **Material order (field + caps)** so “28.13 squares” is not confused with order quantity.
- **Builder fix:** Auto-populate uses squares **including** suggested waste when measurement loads.

## Regression tests

`lib/__tests__/roof-material-order.test.ts` — Greenway numbers frozen.

## Industry cross-check

See `docs/roof-measure-accuracy-sources.md` (GAF cap coverage, 3 bundles/sq, 15–20% complex waste).
