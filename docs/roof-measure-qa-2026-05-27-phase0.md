# Roof measure QA — Phase 0 satellite polygons (2026-05-27)

**Date:** 2026-05-27  
**Tester:** Head Coder (browser MCP on production)  
**Commit:** `b4b6b4d` — `fix(roof): show satellite bbox quads when mask split unavailable`  
**URL:** https://arx-internal-crm.vercel.app/tools/roof-measure  
**Gates:** `npm run roof-measure:prelaunch` PASS · `npm run build` PASS · `solar-bbox-facet-payloads.test.ts` PASS

## Root cause (fixed)

When Google Solar mask split failed but `roofSegmentStats[].boundingBox` existed, `/api/ai/detect-roof` built bbox quads via `buildSolarPlaneFacetPayloads` but returned **`facets: []`** with a “rough boxes” note. Client auto-accept had nothing to draw → blank map + sidebar text only.

## Fix summary

| Layer | Change |
|-------|--------|
| API | Return filtered/deduped `solar_bbox` facets instead of empty array; second fallback when mask facets filtered to zero |
| Client | Synthesize bbox drafts from `solar_segments` if `facets` empty; normalize rough-outline notes |
| Lib | `lib/solar-bbox-facet-payloads.ts` + regression test |

## Production repro matrix (logged-in session)

| # | Address | Polygons on map | Sections | Notes |
|---|---------|-----------------|----------|-------|
| A | 1361 Kison Ct NW, Concord NC 28027 | **PASS** | 3 | Colored semi-transparent quads on target roof after Reload (~30s). Solar bbox note + overlap warning. |
| B | 304 Greenway Dr, Huntersville NC 28078 | **PASS** | 7 | Mask/bbox facets visible (multi-color overlays on hip roof). Regression OK. |
| C | Reload outline (Concord) | **PASS** | 3 | Button “Loading…” → sections populated within ~30s |
| D | Auto-detect on fresh URL | **PASS** | — | Outlines load without manual draw |

## Screenshots

Captured during QA (browser MCP):

- **Concord:** 3 bbox quads (purple/green/blue) on 1361 Kison Ct NW; Section 1 popup visible; sidebar “Roof Sections (3)”.
- **Greenway:** 7 facets with numbered labels on 304 Greenway Dr; complex hip layout visible.

Screenshot files: `page-2026-05-28T02-54-49-855Z.png` (Concord), Greenway snapshot same session.

## Phase 0 sign-off

- [x] Concord polygons visible (rough bbox OK)
- [x] Greenway polygons visible (regression)
- [x] Reload outline shows overlays
- [x] Prelaunch + build green
- [x] Pushed to `main` (`b4b6b4d`)

**Phase 1 (2.5D plane metadata) may proceed.**
