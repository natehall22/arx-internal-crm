# Instant Estimate accuracy loop

Website leads alone don't tell us how accurate the Instant Estimate is. Real jobs do, so every one becomes a test case.
Each night, for properties where ARX has **trusted squares**, the estimate is run again for that address and its answer is
stored next to the trusted number.

## How it works

1. **Cron** `GET /api/cron/instant-estimate-accuracy` runs nightly at 07:17 UTC (`vercel.json`), secured by `CRON_SECRET`.
   It runs for the org in `PUBLIC_ESTIMATE_ORG_ID`.
2. **Candidates** (`findTruthCandidates`, `lib/instant-estimate-accuracy.ts`): `roof_measurements` rows that are
   `status = 'completed'`, have `total_squares > 0` and are linked to an opportunity, not yet checked for the current
   `INSTANT_ESTIMATE_VERSION`. Opportunities whose only job is **cancelled** are skipped. The best truth per property wins:

   | Truth source | What it is | Used for calibration |
   |---|---|---|
   | `carrier_report` | EagleView / Roofr / Hover / … report | yes |
   | `manual` | measurement typed in by hand | yes |
   | `in_house_manual` | our measure tool, saved quote-ready, with sections hand-drawn or corrected | yes |
   | `lidar_reviewed` | our measure tool, saved quote-ready, every section an unedited lidar plane | yes |
   | `in_house_reviewed` | our measure tool, saved quote-ready, Solar outline a rep only reviewed | **no** — shares the estimate's own Solar error |

   Truth is **base squares (no waste)** = `roof_measurements.total_squares` (sloped area / 100). We also record
   **sold squares** (waste included, from the job's proposal via `lib/job-sold-scope.ts`) and **ordered squares**
   (when ops edited the field-shingle line on the materials order). `data/measure-tool-memory/installs.csv` stays manual.
3. **Check** (`runAccuracyChecks`): calls `measurePublicRoofEstimate(address, { shadow: true, lat, lng })` one property at
   a time (default 15 a night). Shadow mode skips the satellite picture and creates no lead. The result is saved in
   `instant_estimate_checks`, one row per property per estimate version. A new estimate version re-scores every property.

## Reading the report

Reports → Explore → **Instant Estimate accuracy**. Owners/company-wide viewers only (no money in it).

- **Error %** = (estimate − measured) / measured, on base squares. Positive = the estimate read **high**.
- **Abs error %** — size of the miss, either way. Group by *Estimate source* to see lidar vs Solar.
- **Error vs sold %** compares the priced squares (with waste) with what was actually sold — this is the one that hits
  the customer's price.
- **Flags** / **Confidence** show what the estimate itself thought of the roof; use them to find patterns
  (e.g. low-confidence roofs that were actually fine).
- Filter **Truth source** to the trusted ones when judging accuracy; `in_house_reviewed` rows are only a rough guide.

`summarizeAccuracy(rows)` gives the same headline numbers in code: per source n, median signed error, median abs error,
share within ±5% and ±10%.

## Calibration

View `instant_estimate_calibration`: per measure source, over the last 365 days, the median of
measured ÷ raw estimate (newest check per property, trusted truth only). "Raw" divides out the calibration factor the
estimate already applied, so calibration never chases its own tail.

`loadInstantEstimateCalibration` (`lib/instant-estimate-calibration.ts`) turns that into a factor the estimate multiplies
base squares by:

- applies only when a source has **8 or more** checks — otherwise 1;
- clamped to **0.85 – 1.15**, so a few odd roofs can't swing prices far;
- any error reading it → no calibration (the estimate never fails because of it).

## Switches

| Env | Effect |
|---|---|
| `INSTANT_ESTIMATE_ACCURACY_CRON=false` | stop the nightly checks |
| `INSTANT_ESTIMATE_ACCURACY_LIMIT` | checks per night (default 15, max 50) |
| `INSTANT_ESTIMATE_CALIBRATION=false` | estimate ignores calibration (factor 1) |

## Cost per check

Shadow checks geocode the address text exactly like the website (saved coordinates are only a fallback when a row has no address) and skip the satellite still. What's left is the Google Solar
calls the estimate makes: Building Insights, plus Data Layers when the Solar mask path runs (lidar measurement uses our
own stored tiles and is free). At Google's list prices that is roughly **$0.01–$0.09 per check**, so 15 a night is at
most about **$1.35/night (~$40/month)**, and usually less. Check current Google Maps Platform pricing before raising the
limit. Properties already checked for the current version are never re-billed; a transient failure is retried the next
night, a permanent one is recorded and not retried.

## Not done yet

- Measurements saved without an opportunity aren't used (nothing to tie a check to).
- No dedicated screen — the report is the screen.


## Guard rails added in review (2026-11-03)
- `lidar_reviewed` truth never grades a `lidar` estimate (same data, same error) — excluded in the view and `countsForCalibration`.
- Two opportunities resolving to one production job no longer get re-checked (and re-billed) nightly: the second row is kept without the job link.
- The public estimate is unaffected by any calibration error: a failed read means factor 1.
