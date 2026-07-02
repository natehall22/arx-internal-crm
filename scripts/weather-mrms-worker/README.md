# MRMS MESH hail swath worker (Phase 2)

Contours prior-day NOAA MRMS MESH hail grids for the Cabarrus canvass footprint and POSTs GeoJSON polygons to the CRM ingest route.

## Requirements

- GDAL CLI (`gdal_translate`, `gdal_calc.py`, `gdal_polygonize.py`)
- AWS CLI (public `noaa-mrms-pds` bucket, `--no-sign-request`)
- `CRON_SECRET` matching the CRM deployment

## GitHub Action

`.github/workflows/weather-mrms-ingest.yml` runs daily at 10:00 UTC (after the Vercel `weather-refresh` cron).

## Manual run

```bash
export CRON_SECRET=...
export WEATHER_SWATHS_INGEST_URL=https://your-app.vercel.app/api/cron/weather-swaths-ingest
python3 scripts/weather-mrms-worker/contour_mesh.py --event-date 2026-06-21
```

Dry run (download + contour only, no POST):

```bash
python3 scripts/weather-mrms-worker/contour_mesh.py --dry-run --event-date 2026-06-21
```

## Footprint override

Set on **Vercel** (cron/refresh routes) and **GitHub repo variables** (MRMS workflow):

| Variable | Value |
|---|---|
| `WEATHER_FOOTPRINT_N` | `35.60` |
| `WEATHER_FOOTPRINT_S` | `35.00` |
| `WEATHER_FOOTPRINT_E` | `-80.30` |
| `WEATHER_FOOTPRINT_W` | `-81.10` |

Lat span 0.60°, lng span 0.80° — under the 5° API cap.

## Backfill (730 days)

One-off historical swath load after expanding the footprint:

```bash
export CRON_SECRET=...
export WEATHER_SWATHS_INGEST_URL=https://arx-internal-crm.vercel.app/api/cron/weather-swaths-ingest
export WEATHER_FOOTPRINT_N=35.60 WEATHER_FOOTPRINT_S=35.00 WEATHER_FOOTPRINT_E=-80.30 WEATHER_FOOTPRINT_W=-81.10
python3 scripts/weather-mrms-worker/backfill_swaths.py --days 730 --skip-errors
```

Smoke test (dry-run, one day):

```bash
python3 scripts/weather-mrms-worker/backfill_swaths.py --days 730 --dry-run --limit 1
```

Requires GDAL CLI + AWS CLI (same as daily worker). Expect several hours for a full 730-day run; use `--skip-errors` for missing MRMS archive days.
