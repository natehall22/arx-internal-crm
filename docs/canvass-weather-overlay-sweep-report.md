# Canvass Weather Overlay — Collateral Sweep Report

Date: 2026-06-19. Scope: consistency/accuracy sweep across all 7 weather-overlay docs (~1,800 lines) plus the build brief. No application code touched. Verdict: **package is consistent and build-ready for a Phase 1 trial.** One inconsistency was found and fixed; the rest are notes.

## Documents swept
1. `canvass-weather-overlay-design.md`
2. `canvass-weather-overlay-ui-spec.md`
3. `canvass-weather-refresh-job-spec.md`
4. `canvass-weather-overlay-risks-and-mitigations.md`
5. `canvass-weather-overlay-field-readiness.md`
6. `canvass-weather-overlay-competitive-analysis.md`
7. `prompts/canvass-weather-overlay-implementation.md` (build brief — source of truth)

## Consistency checks — results

| Dimension | Result |
|---|---|
| Auth (`requireAuthApi()` rep route; `CRON_SECRET` cron; never raw `getUser()`) | ✅ Consistent across all docs. Build brief correctly notes `requireAuthApi()` *throws*. |
| Z-order (weather `zIndex 1`; territories `0`; sold `700`; user `1000`; pins above) | ✅ Consistent across design, UI spec, build brief. |
| Layer is separate `google.maps.Data`, `clickable:false`, pins on top | ✅ Consistent. |
| Scope = Phase 1 trial; MRMS/GRIB2 = Phase 2; no new tables in trial | ✅ Consistent. |
| Default layer Hail, window 365d, collapse-when-off, claims-safe one-line sheet | ✅ Present and consistent in build brief; matches UI spec intent. |
| File/function references real (`lib/roofradar-open-data.ts`, `lib/auth.ts`, `public/canvass-sw.js:46`, `vercel.json`, `app/api/cron/sync-444`) | ✅ Verified against the codebase in the QA pass. |
| `getSpcReportsInBbox` new-export approach (SPC helpers are private) | ✅ Build brief correct. ⚠️ see Note B. |
| Color/opacity ramp | ❌ → ✅ **Fixed** (see Finding 1). |

## Finding 1 — Color/opacity ramp conflict (FIXED)
The build brief (§7.1) uses the **final saturated ramp** (teal `#2DD4BF`, indigo `#6366F1`, violet `#A855F7`, magenta `#E11D74`; opacity floor 0.35 / ceiling 0.40; stroke as primary read). The **UI spec §6.1/§6.5 still carried the earlier pastel ramp** (`#5EEAD4` etc., ceiling 0.34) that the field-readiness review showed vanishes in sunlight. The design doc's loose "≈0.25–0.35" also predates the decision.

**Fix applied:** annotated UI spec §6.1 and §6.5 with a "SUPERSEDED — build from implementation prompt §7.1" note (kept the colorblind hue-family rationale, flagged the exact values as superseded). The build brief was already correct and unchanged. The build brief is the declared source of truth, so a builder following the README cannot pick up the wrong values.

## Notes (no fix required)

**Note A — Cherry-picking still discussed in analysis docs.** The field-readiness and risks docs treat knock-volume/cherry-picking as a meaningful risk. The product owner has since said this is **not** a concern, and the build brief correctly down-ranks it to a one-line "monitor later." The analysis docs are left as historical record; they add no build steps. No action needed unless you want them annotated.

**Note B — Refresh-job spec references private `fetchSpcReports` directly.** `canvass-weather-refresh-job-spec.md` (§2.2/§3) calls `fetchSpcReports(year, type)` as if importable, but it's private in `lib/roofradar-open-data.ts`. Since the cron/refresh job is **Phase 2 / optional** and out of the trial scope, this is not a trial blocker — but when Phase 2 is built it should reuse the same new `getSpcReportsInBbox` export rather than re-exposing internals. (Flag for Phase 2.)

**Note C — `weather_cache` vs `weather_swaths`.** Naming is consistent: `weather_cache` = Phase 1 SPC points / NWS snapshots; `weather_swaths` = Phase 2 MRMS MESH. The trial creates **neither** (no tables). Consistent.

## Overall verdict
The package is internally consistent after the one fix, every code reference checks out, and the build brief is self-contained. **Ready to hand to Cursor for the Phase 1 trial.** The only true gates remain the two human decisions (claims-safe copy + legal review; confirm 365-day window / validate ramp on a real Android) — neither blocks writing code.
