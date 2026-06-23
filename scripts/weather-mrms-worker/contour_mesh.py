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

# Hail-size contour bands (inches) — matches overlay legend buckets.
HAIL_BANDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]

MRMS_PRODUCT = "MESH/maximum_estimated_size_of_hail"
MRMS_HTTPS_BASE = "https://mrms.ncep.noaa.gov/data/2D"
MRMS_S3_BASE = "s3://noaa-mrms-pds/MESH/maximum_estimated_size_of_hail"


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


def list_mrms_files(event_date: date) -> list[str]:
    prefix = f"{MRMS_S3_BASE}/{event_date.year:04d}/{event_date.month:02d}/{event_date.day:02d}/"
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
    prefix = f"{MRMS_S3_BASE}/{event_date.year:04d}/{event_date.month:02d}/{event_date.day:02d}/"
    s3_uri = f"{prefix}{chosen}"
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
    # gdal_translate -projwin ulx uly lrx lry
    subprocess.run(
        [
            "gdal_translate",
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
            return True

    return False


def contour_band(src: Path, work: Path, threshold: float) -> dict[str, Any] | None:
    mask_tif = work / f"mask_{threshold:.2f}.tif"
    mask_geojson = work / f"mask_{threshold:.2f}.geojson"

    calc = f"(A>={threshold})*1"
    subprocess.run(
        [
            "gdal_calc.py",
            "-A",
            str(src),
            "--outfile",
            str(mask_tif),
            "--calc",
            calc,
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


def post_ingest(
    event_date: date,
    features: list[dict[str, Any]],
    ingest_url: str,
    cron_secret: str,
) -> dict[str, Any]:
    body = {
        "eventDate": event_date.isoformat(),
        "layer": "hail",
        "source": "mrms_mesh",
        "features": features,
    }
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
        cropped = work / "cropped.grib2"
        crop_grib(raw, cropped, bbox)
        if not cropped_raster_has_valid_pixels(cropped):
            print(
                "ERROR: cropped MRMS raster is empty or all NoData — "
                "check WEATHER_FOOTPRINT_N/S/E/W and lon convention (likely CRS misconfig, not a clear day)",
                file=sys.stderr,
            )
            return 6

        features = build_features(cropped, work)

        print(
            json.dumps(
                {
                    "eventDate": event_date.isoformat(),
                    "featureCount": len(features),
                    "bands": HAIL_BANDS,
                    "footprint": bbox,
                }
            )
        )

        if args.dry_run:
            return 0

        if not features:
            print("No hail swath polygons for this day — clear day, skipping ingest", file=sys.stderr)
            return 0

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
