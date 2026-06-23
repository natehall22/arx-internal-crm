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

Optional env vars: `WEATHER_FOOTPRINT_N`, `WEATHER_FOOTPRINT_S`, `WEATHER_FOOTPRINT_E`, `WEATHER_FOOTPRINT_W`.
