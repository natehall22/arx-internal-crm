#!/usr/bin/env python3
"""
Fetch prior-day MRMS MESH hail GRIB2 for the Cabarrus footprint, contour by size band,
and POST GeoJSON polygons to the CRM swaths ingest endpoint.

Requires GDAL CLI tools (gdal_translate, gdal_calc.py, gdal_polygonize.py).
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Hail-size contour bands (inches). The overlay groups these into 5 color buckets
# (HAIL_LEGEND in app/(canvass-app)/canvass/lib/weather-overlay.ts):
#   [0.75,1.0) penny · [1.0,1.25) quarter · [1.25,1.75) half-dollar ·
#   [1.75,2.5) golf ball · [2.5,inf) tennis ball.
# 1.5 folds into the half-dollar bucket; 2.0 folds into the golf-ball bucket.
HAIL_BANDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]

# MRMS MESH rasters are in millimeters; our bands, legend, and homeowner-facing
# copy are all in inches. Convert at the contour threshold (see contour_band).
MM_PER_INCH = 25.4

# Physical ceiling for plausible MESH hail. Matches MAX_MAGNITUDE (8 in) in the
# ingest route. Used to reject NoData/sentinel fill values that would otherwise be
# contoured as enormous (fake) hail and shown to homeowners.
MESH_MAX_MM = 8 * MM_PER_INCH

# Stay strictly UNDER the route's MAX_FEATURES (1000) so a full batch can never trip
# the `> MAX_FEATURES` 413. Margin guards against future drift on either side.
MAX_FEATURES_PER_BATCH = 900

# NOAA MRMS "Maximum Estimated Size of Hail", 24-hour-max product (1440 min) at
# 0.5 km, from the public no-sign-request bucket. Layout verified against the live
# bucket (2026-06):
#   s3://noaa-mrms-pds/CONUS/MESH_Max_1440min_00.50/YYYYMMDD/
#     MRMS_MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz
# Because it is already a 24h-max product, the last file of the UTC day is a sound
# daily-max proxy for storm-swath canvassing.
MRMS_PRODUCT = "MESH_Max_1440min_00.50"
MRMS_S3_BASE = f"s3://noaa-mrms-pds/CONUS/{MRMS_PRODUCT}"


def footprint_bbox() -> dict[str, float]:
    return {
        "n": float(os.environ.get("WEATHER_FOOTPRINT_N", "35.58")),
        "s": float(os.environ.get("WEATHER_FOOTPRINT_S", "35.12")),
        "e": float(os.environ.get("WEATHER_FOOTPRINT_E", "-80.32")),
        "w": float(os.environ.get("WEATHER_FOOTPRINT_W", "-80.82")),
    }


def prior_day(value: str | None) -> date:
    if value:
        return datetime.strptime(value, "%Y-%m-%d").date()
    return (datetime.now(timezone.utc) - timedelta(days=1)).date()


def s3_prefix(event_date: date) -> str:
    # Bucket uses a compact YYYYMMDD day folder (not /YYYY/MM/DD/).
    return f"{MRMS_S3_BASE}/{event_date.strftime('%Y%m%d')}/"


def list_mrms_files(event_date: date) -> list[str]:
    prefix = s3_prefix(event_date)
    proc = subprocess.run(
        ["aws", "s3", "ls", prefix, "--no-sign-request"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Unable to list MRMS objects at {prefix}: {proc.stderr.strip()}")

    names: list[str] = []
    for line in proc.stdout.splitlines():
        parts = line.split()
        if not parts:
            continue
        name = parts[-1]
        if name.endswith(".grib2") or name.endswith(".grib2.gz"):
            names.append(name)
    if not names:
        raise RuntimeError(f"No MRMS MESH files found for {event_date.isoformat()}")
    names.sort()
    return names


def download_mrms_grib(event_date: date, dest: Path) -> Path:
    files = list_mrms_files(event_date)
    # Use the last snapshot of the day as a practical daily swath proxy.
    chosen = files[-1]
    s3_uri = f"{s3_prefix(event_date)}{chosen}"
    gz_path = dest / chosen
    subprocess.run(
        ["aws", "s3", "cp", s3_uri, str(gz_path), "--no-sign-request"],
        check=True,
    )
    if gz_path.suffix == ".gz":
        out = dest / gz_path.stem
        with gzip.open(gz_path, "rb") as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst)
        return out
    return gz_path


def crop_grib(src: Path, dest: Path, bbox: dict[str, float]) -> None:
    # gdal_translate -projwin ulx uly lrx lry. Output is GTiff (explicit) — the crop
    # is a GeoTIFF, so the dest is named .tif, not .grib2, to avoid a latent footgun.
    subprocess.run(
        [
            "gdal_translate",
            "-of",
            "GTiff",
            "-projwin",
            str(bbox["w"]),
            str(bbox["n"]),
            str(bbox["e"]),
            str(bbox["s"]),
            str(src),
            str(dest),
        ],
        check=True,
    )


def cropped_raster_has_valid_pixels(path: Path) -> bool:
    """True if the crop contains at least one non-NoData pixel (config sanity check)."""
    proc = subprocess.run(
        ["gdalinfo", "-json", "-stats", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gdalinfo failed on cropped raster: {proc.stderr.strip()}")

    info = json.loads(proc.stdout)
    size = info.get("size") or [0, 0]
    if len(size) < 2 or size[0] <= 0 or size[1] <= 0:
        return False

    for band in info.get("bands") or []:
        meta = (band.get("metadata") or {}).get("", {})
        valid_pct = meta.get("STATISTICS_VALID_PERCENT")
        if valid_pct is not None and float(valid_pct) > 0:
            return True

        cmin = band.get("computedMin")
        cmax = band.get("computedMax")
        nodata = band.get("noDataValue")
        if cmin is None and cmax is None:
            continue
        if nodata is not None:
            if cmin != nodata or cmax != nodata:
                return True
        else:
            # No declared NoData: only trust the crop if it holds a physically
            # plausible hail value (0..8in mm). An all-negative-sentinel crop is
            # either a clear day or a footprint/CRS misconfig — don't auto-pass.
            if cmax is not None and 0 <= float(cmax) <= MESH_MAX_MM:
                return True

    return False


def raster_stats_mm(path: Path) -> dict[str, Any]:
    """Cropped-raster min/max in mm — used by --dry-run to prove the unit assumption.

    A real hail day should show a max in the tens of mm (e.g. ~25mm = 1in, ~45mm =
    ~1.75in). A max in single digits would mean the raster is already in inches and
    the mm conversion in contour_band is wrong — surface it before going live.
    """
    proc = subprocess.run(
        ["gdalinfo", "-json", "-stats", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return {"error": proc.stderr.strip()[:200]}
    info = json.loads(proc.stdout)
    bands = info.get("bands") or []
    if not bands:
        return {}
    band = bands[0]
    cmax = band.get("computedMax")
    cmin = band.get("computedMin")
    return {
        "min_mm": cmin,
        "max_mm": cmax,
        "max_inches": round(cmax / MM_PER_INCH, 2)
        if isinstance(cmax, (int, float))
        else None,
        "noDataValue": band.get("noDataValue"),
        "unit": (band.get("metadata") or {}).get("", {}).get("GRIB_UNIT"),
    }


def contour_band(src: Path, work: Path, threshold: float) -> dict[str, Any] | None:
    mask_tif = work / f"mask_{threshold:.2f}.tif"
    mask_geojson = work / f"mask_{threshold:.2f}.geojson"

    # MESH raster values are millimeters; HAIL_BANDS are inches. Compare in mm so
    # the mask is correct, but keep the stored magnitude in inches (claims copy).
    # Bound BOTH sides: MESH no-coverage/missing pixels can be negative sentinels OR
    # (when GDAL exposes no noDataValue) large positive fills. The `<= MESH_MAX_MM`
    # guard ensures neither a sentinel nor a fill value is ever painted as hail in
    # front of a homeowner.
    threshold_mm = threshold * MM_PER_INCH
    calc = f"((A>={threshold_mm})*(A<={MESH_MAX_MM}))*1"
    subprocess.run(
        [
            "gdal_calc.py",
            "-A",
            str(src),
            "--outfile",
            str(mask_tif),
            "--calc",
            calc,
            # Honor any source NoData so missing pixels are never evaluated as data.
            "--hideNoData",
            "--NoDataValue=0",
            "--type",
            "Byte",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )

    subprocess.run(
        [
            "gdal_polygonize.py",
            str(mask_tif),
            "-f",
            "GeoJSON",
            str(mask_geojson),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )

    payload = json.loads(mask_geojson.read_text())
    features = payload.get("features") or []
    polys: list[dict[str, Any]] = []
    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        value = feature.get("properties", {}).get("DN", 0)
        if value != 1:
            continue
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        polys.append({"magnitude": threshold, "geometry": geom})

    return polys or None


def build_features(grib: Path, work: Path) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for threshold in HAIL_BANDS:
        polys = contour_band(grib, work, threshold)
        if not polys:
            continue
        features.extend(polys)
    return features


def _post_json(
    ingest_url: str,
    cron_secret: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    req = urllib.request.Request(
        ingest_url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cron_secret}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_clear_day(
    event_date: date,
    ingest_url: str,
    cron_secret: str,
) -> dict[str, Any]:
    body = {
        "eventDate": event_date.isoformat(),
        "layer": "hail",
        "source": "mrms_mesh",
        "features": [],
        "clear": True,
    }
    return _post_json(ingest_url, cron_secret, body)


def post_ingest(
    event_date: date,
    features: list[dict[str, Any]],
    ingest_url: str,
    cron_secret: str,
) -> dict[str, Any]:
    batches = [
        features[i : i + MAX_FEATURES_PER_BATCH]
        for i in range(0, len(features), MAX_FEATURES_PER_BATCH)
    ]
    # One timestamp for the whole run, sent with every batch. The ingest route's
    # delete-older step keys off this value, so sharing it stops batch N+1 from
    # deleting the rows batch N just inserted (which would silently truncate the
    # swath to the last <=900 features).
    refreshed_at = datetime.now(timezone.utc).isoformat()
    total_upserted = 0
    last_result: dict[str, Any] = {"ok": True, "upserted": 0, "skipped": 0}
    for index, batch in enumerate(batches):
        # Only the FINAL batch authorizes the route to delete the prior run's rows.
        # So if an earlier batch fails mid-run, the previous good swath stays intact
        # rather than being half-replaced by a truncated, authoritative-looking one.
        is_final = index == len(batches) - 1
        body = {
            "eventDate": event_date.isoformat(),
            "layer": "hail",
            "source": "mrms_mesh",
            "refreshedAt": refreshed_at,
            "final": is_final,
            "features": batch,
        }
        last_result = _post_json(ingest_url, cron_secret, body)
        if not last_result.get("ok"):
            last_result["partial"] = index > 0
            return last_result
        total_upserted += int(last_result.get("upserted", 0) or 0)
    # Report the run total, not just the final batch, so logs reflect all rows.
    return {**last_result, "upserted": total_upserted, "batches": len(batches)}


def main() -> int:
    parser = argparse.ArgumentParser(description="MRMS MESH hail swath worker")
    parser.add_argument("--event-date", help="YYYY-MM-DD (default: yesterday UTC)")
    parser.add_argument(
        "--ingest-url",
        default=os.environ.get(
            "WEATHER_SWATHS_INGEST_URL",
            "https://arx-internal-crm.vercel.app/api/cron/weather-swaths-ingest",
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cron_secret = os.environ.get("CRON_SECRET", "")
    if not args.dry_run and not cron_secret:
        print("CRON_SECRET is required unless --dry-run", file=sys.stderr)
        return 1

    event_date = prior_day(args.event_date)
    bbox = footprint_bbox()

    with tempfile.TemporaryDirectory(prefix="mrms-mesh-") as tmp:
        work = Path(tmp)
        raw = download_mrms_grib(event_date, work)
        cropped = work / "cropped.tif"
        crop_grib(raw, cropped, bbox)
        if not cropped_raster_has_valid_pixels(cropped):
            print(
                "ERROR: cropped MRMS raster is empty or all NoData — "
                "check WEATHER_FOOTPRINT_N/S/E/W and lon convention (likely CRS misconfig, not a clear day)",
                file=sys.stderr,
            )
            return 6

        # Unit sanity on EVERY run (incl. the scheduled POST path, not just dry-run):
        # a cropped MESH max implying >8 in of hail means the raster isn't the mm we
        # assume (unit drift, or a sentinel fill leaked through). Refuse to publish
        # claims-critical magnitudes blindly.
        stats = raster_stats_mm(cropped)
        max_mm = stats.get("max_mm")
        if isinstance(max_mm, (int, float)) and max_mm > MESH_MAX_MM:
            print(
                f"ERROR: cropped MESH max {max_mm} mm (~{max_mm / MM_PER_INCH:.1f} in) "
                "exceeds the 8-in ceiling — unit drift or sentinel fill; refusing to POST",
                file=sys.stderr,
            )
            return 7

        features = build_features(cropped, work)

        band_counts: dict[str, int] = {}
        for feat in features:
            key = f"{float(feat['magnitude']):.2f}"
            band_counts[key] = band_counts.get(key, 0) + 1

        summary: dict[str, Any] = {
            "eventDate": event_date.isoformat(),
            "featureCount": len(features),
            "bandCountsInches": band_counts,
            "bands": HAIL_BANDS,
            "footprint": bbox,
            "rasterStatsMm": stats,
        }
        if args.dry_run:
            # GRIB_UNIT survives only on the raw GRIB2; the crop is a GTiff and loses
            # it. Report the source's declared unit so we can prove the mm assumption.
            summary["sourceUnit"] = raster_stats_mm(raw).get("unit")
        print(json.dumps(summary))

        if args.dry_run:
            return 0

        if not features:
            print(
                "No hail swath polygons for this day — posting clear to remove stale swaths",
                file=sys.stderr,
            )
            result = post_clear_day(event_date, args.ingest_url, cron_secret)
            print(json.dumps(result))
            return 0 if result.get("ok") else 3

        result = post_ingest(event_date, features, args.ingest_url, cron_secret)
        print(json.dumps(result))
        return 0 if result.get("ok") else 3


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        print(f"HTTP {err.code}: {body}", file=sys.stderr)
        raise SystemExit(4)
    except subprocess.CalledProcessError as err:
        print(f"GDAL/AWS command failed: {err}", file=sys.stderr)
        raise SystemExit(5)
