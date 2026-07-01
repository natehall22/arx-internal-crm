# Materials Order List — follow-up prompts for Cursor

Context for all prompts: the ops job page (`app/ops/jobs/[id]/`) now has a
`MaterialsOrderCard` (Materials tab) computed by `lib/materials-order-list.ts`
from sold squares + `roof_measurements` linear data. Constants live in
`lib/roof-shingle-constants.ts`. Keep all schema changes nullable/additive and
use `requireAuthApi()` (throws — wrap in try/catch → 401) for any new API route.

---

## 1. Capture penetrations / pipe boots in the measure tool

> In `app/tools/roof-measure/page.tsx`, add a simple counter UI ("Penetrations",
> "Chimneys", "Skylights" steppers in the measurements panel) stored on the
> `MeasurementData` object as `penetration_count`, `chimney_count`,
> `skylight_count`. Persist them in the POST insert in
> `app/api/measurements/route.ts` (columns already exist on `roof_measurements`).
> Then in `app/ops/jobs/[id]/page.tsx` `buildMaterialsExtras`, `penetration_count`
> already flows through — no changes needed there. In
> `lib/materials-order-list.ts` the pipe boots row already renders the count when
> present. Do not make any of the new fields required; older saved measurements
> have none of them.

## 2. Backfill drip edge / step flashing columns for older measurements

> Write a one-off idempotent SQL migration (or admin script) that backfills
> `roof_measurements.drip_edge_lf` and `step_flashing_lf` from
> `raw_data->>'drip_edge_lf'` / `raw_data->>'step_flashing_lf'` where the column
> is NULL and the raw value is a positive number. Read-only on raw_data;
> UPDATE only the two columns. (New saves now write these columns directly.)

## 3. Editable quantities with persisted ops overrides

> Add per-job override support to the Materials Order List. New table
> `job_material_order_overrides` (nullable/additive): `id`, `job_id` FK →
> `production_jobs`, `item_key` text, `qty_text` text, `excluded` boolean,
> `note` text, `updated_by`, timestamps; RLS same pattern as
> `production_job_cost_lines`. API route `app/api/jobs/[jobId]/material-order/route.ts`
> using `requireAuthApi()` (try/catch → 401). In
> `components/ops/MaterialsOrderCard.tsx`, allow inline edit of qty, an exclude
> toggle, and a note; render overridden values with an "edited" badge and keep
> the computed value visible as strikethrough. Never mutate
> `lib/materials-order-list.ts` outputs — overlay overrides at render time.

## 4. Printable / PDF order sheet

> Add a "Print order sheet" button to `MaterialsOrderCard` that opens a clean
> print view (job number, customer, address, proposal number, date, then the
> order table grouped Order / Confirm / Manual with blank "actual qty" and
> "supplier" columns). Follow the existing PDF generation pattern used for
> proposals/contracts (`lib/contracts/generatePdf.ts` style) or a print-styled
> route — whichever is less code. Dark text on white, no low-contrast grays
> (project rule: WCAG AA).

## 5. Org-configurable coverage constants

> Make the coverage constants overridable per org: add nullable columns to
> `orgs` (e.g. `starter_lf_per_bundle`, `cap_lf_per_bundle`,
> `underlayment_sq_per_roll`, `ridge_vent_lf_per_piece`,
> `ridge_vent_end_setback_ft`, `ice_water_lf_per_roll`) defaulting to NULL =
> use constants from `lib/roof-shingle-constants.ts`. Thread an optional
> `overrides` param through `buildMaterialsOrderList` and the existing
> `starterFromLinearFt` / cap helpers (they already accept `lfPerBundle` /
> `lfPerSquare` params). Admin UI in the org settings page.

## 6. Optional starter safety cushion

> `starterFromLinearFt` currently orders ceil(LF / 123.4) with no cushion — a
> 122 LF job gets 1 bundle with ~1.4 LF spare. Add an optional
> `cushionPercent` param (default 0 to preserve current numbers everywhere)
> and enable it only in `lib/materials-order-list.ts` (e.g. 5%). Update
> `lib/__tests__/starter-strip.test.ts` and `materials-order-list.test.ts`.

## 7. Measure tool cleanup (from bug scan)

> In `app/tools/roof-measure/page.tsx`: (a) remove the dead drip-edge variable
> around line 2552 if truly unused (verify `measuredDripEdge` at ~2835 is the
> one used); (b) when a user manually draws ridge lines while geometry also
> classifies ridges (`manualRidges > 0` override at ~2541), add a validation
> note telling the user manual ridge LF replaced the computed value; (c) add a
> `ridge_run_count` to `MeasurementData` derived from distinct classified ridge
> runs so ridge vent end setbacks stop assuming a single run (consumed via
> `buildMaterialsExtras` in `app/ops/jobs/[id]/page.tsx`). Don't change any
> existing measurement math.

## 8. Jest coverage for the ops plumbing

> Add unit tests for `buildMaterialsExtras` in `app/ops/jobs/[id]/page.tsx`
> (export it or move it to `lib/`): low-slope facet detection from `pitch_rise`
> and from parsing `"1/12"` strings, ridge feature counting, penetration count
> flooring, and the all-null → null case. Note: jest must run on the dev
> machine (SWC binary).
