# Canvass Weather Overlay — Documentation Package

Design/research collateral for adding a hail/wind weather overlay to the ARX canvassing app. **No application code has been changed by any of these docs.** They are a complete, build-ready package for a Phase 1 trial.

## Start here
- **Building it?** Read `prompts/canvass-weather-overlay-implementation.md` — it is self-contained and is the single source of truth for the trial build. Everything else is background.
- **Deciding whether/how to build it?** Read the design doc, then the risks doc.

## The documents

| Doc | What it is | Read if you want… |
|---|---|---|
| `canvass-weather-overlay-design.md` | Architecture + free data sources (NWS Alerts API, SPC reports, MRMS MESH); additive integration plan; non-breaking guardrails. | The high-level "what and how." |
| `canvass-weather-overlay-ui-spec.md` | Full UI spec: components, states, motion, accessibility, color ramps, bottom sheet. | The detailed UX. (⚠️ its §6.1 color values are superseded — see implementation prompt §7.1.) |
| `canvass-weather-refresh-job-spec.md` | Server-side daily morning refresh job (Vercel Cron, `CRON_SECRET`, durable cache table). | The data-freshness/backend plan. (Mostly Phase 2 / optional for the trial.) |
| `canvass-weather-overlay-risks-and-mitigations.md` | Pre-mortem: every issue + concrete fix, severity matrix, decision checklist. | The "what could go wrong" with answers. |
| `canvass-weather-overlay-field-readiness.md` | In-field rep stress test, offline behavior, at-the-door value, walkthroughs. | Whether it works for reps in the sun. |
| `canvass-weather-overlay-competitive-analysis.md` | SalesRabbit, SpotIO, HailTrace, HailRecon, Terros — patterns to copy, mistakes to avoid. | How competitors do it. |
| `prompts/canvass-weather-overlay-implementation.md` | **The build brief.** Self-contained Cursor task for the Phase 1 trial. | To actually build the trial. |

## The decisions that are locked (so you don't relitigate them)
- **Scope:** Phase 1 (recent storm points from free **IEM Local Storm Reports** + live NWS Alerts polygons) is **merged to `main`**. Phase 2 (**MRMS MESH hail swaths** via a GitHub Action GDAL worker → `weather_swaths` table, durable cache + daily refresh cron) is **built on `feat/canvass-weather-overlay-phase2`** and verified — see `canvass-weather-overlay-phase2-verification.md`. Pending: `npm run build`, merge, and GitHub/Vercel config to run the pipeline.
- **Additive & feature-flagged OFF** (`NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY`). Flag off ⇒ app byte-for-byte identical to today.
- **Separate `google.maps.Data` layer**, `zIndex 1`, `clickable: false`. Pins always on top and tappable. Never touch existing marker/clusterer/territory/user refs.
- **Auth:** rep route uses `requireAuthApi()` (it *throws* → try/catch → 401). Never raw `supabase.auth.getUser()`. Cron uses `CRON_SECRET` bearer.
- **Color/opacity:** final ramp = implementation prompt §7.1 (saturated, floor 0.35 / ceiling 0.40, stroke as primary read).
- **Default:** layer Hail, window **730 days (2 years)**, remember last-used. Control collapses to one button when Off.
- **Claims-safe copy:** "may have been impacted — free inspection," never "you have damage / file a claim."
- **Cherry-picking / knock-volume:** product owner is **not** concerned — not a build requirement (analysis docs still discuss it; that's historical).

## Two human decisions still open (neither blocks writing code)
1. Counsel sign-off on claims-safe copy + NC solicitation rules (before field use).
2. Counsel sign-off on claims-safe copy + NC solicitation rules (before field use); validate the color ramp on a cheap Android outdoors.

See `canvass-weather-overlay-sweep-report.md` for the consistency-check results across this package.
