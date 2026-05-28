# Roof measure QA — Phases 2–4 + agent verification (2026-05-27)

**Commits:** Phase 0 `b4b6b4d` · Phase 1 `5022101` · Phases 2–4 + collateral fix (pending push)

## Agent verification summary

| Agent | Scope | Result |
|-------|--------|--------|
| Collateral damage | CRM-wide impact of Phase 0–1 | **FIXED** — `POST /api/measurements` now accepts `solar_auto` via `isConfirmedPitchSource` |
| Desire paths | Capability doc paths 1–10 | **PASS/PARTIAL** — outline visible (P0); save roundtrip unblocked after pitch gate fix; bbox-only still rough for hips/LF |
| Functionality | Jest + flow trace | **PASS** — 40+ roof tests green; detect → accept → polygon path verified |
| Phase 0 code audit | Bbox never empty when built | **PASS** with known holes (vision mode, validBounds strip) |

## Phase 2 — DSM assist

- `lib/solar-dsm.ts`: fetch `dsmUrl` from [dataLayers:get](https://developers.google.com/maps/documentation/solar/data-layers), sample elevation at facet vertices
- Per-facet: `dsm_median_height_m`, `pitch_suggested_from_dsm`, `dsm_available`
- API response: `dsm_coverage: ok | unavailable`
- Failures graceful (no mask regression)

## Phase 3 — Plane-intersection LF

- `lib/roof-plane-edge-classification.ts` + tests
- `USE_PLANE_INTERSECTION_LF = false` in `lib/roof-measure-flags.ts` (default off until Greenway calibration)
- Wired via `classifyRoofEdgesWithOptionalPlanes` in `updateMeasurements`

## Phase 4 — UI / ops

- Sidebar badge: facet `geometry_source` label per section
- Yellow note when DSM pitch differs from Solar by >3°
- Capability doc updated: `solar_auto` counts as confirmed pitch when applied on load

## Gates

- `npm run roof-measure:prelaunch` — PASS
- `npm run build` — PASS
