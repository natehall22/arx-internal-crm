#!/usr/bin/env python3
"""
Backfill MRMS MESH hail swaths for a date range (default: last 730 days).

Wraps contour_mesh.py once per UTC day. Respects the worker's ingest size guards
and atomic swath-replace (final batch per day). Skips days with no MRMS files.

Usage:
  export CRON_SECRET=...
  export WEATHER_SWATHS_INGEST_URL=https://arx-internal-crm.vercel.app/api/cron/weather-swaths-ingest
  export WEATHER_FOOTPRINT_N=35.60 WEATHER_FOOTPRINT_S=35.00 WEATHER_FOOTPRINT_E=-80.30 WEATHER_FOOTPRINT_W=-81.10
  python3 scripts/weather-mrms-worker/backfill_swaths.py --days 730

Dry-run first day only:
  python3 scripts/weather-mrms-worker/backfill_swaths.py --days 730 --dry-run --limit 1
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

WORKER = Path(__file__).resolve().parent / "contour_mesh.py"
MAX_BACKFILL_DAYS = 730


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill MRMS MESH hail swaths")
    parser.add_argument(
        "--days",
        type=int,
        default=MAX_BACKFILL_DAYS,
        help=f"How many prior UTC days to process (max {MAX_BACKFILL_DAYS})",
    )
    parser.add_argument(
        "--end-date",
        help="Last event date YYYY-MM-DD (default: yesterday UTC)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Pass --dry-run to contour_mesh")
    parser.add_argument(
        "--limit",
        type=int,
        help="Process at most N days (for smoke tests)",
    )
    parser.add_argument(
        "--skip-errors",
        action="store_true",
        help="Continue after a day fails (log and move on)",
    )
    args = parser.parse_args()

    days = min(max(1, args.days), MAX_BACKFILL_DAYS)
    if args.end_date:
        end = datetime.strptime(args.end_date, "%Y-%m-%d").date()
    else:
        end = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    start = end - timedelta(days=days - 1)

    dates: list[date] = []
    cursor = start
    while cursor <= end:
        dates.append(cursor)
        cursor += timedelta(days=1)
    if args.limit:
        dates = dates[: args.limit]

    ok = 0
    skipped = 0
    failed = 0
    summary: list[dict] = []

    for event_date in dates:
        cmd = [sys.executable, str(WORKER), "--event-date", event_date.isoformat()]
        if args.dry_run:
            cmd.append("--dry-run")
        proc = subprocess.run(cmd, capture_output=True, text=True)
        line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
        try:
            day_summary = json.loads(line) if line.startswith("{") else {"raw": line}
        except json.JSONDecodeError:
            day_summary = {"raw": line}

        entry = {
            "eventDate": event_date.isoformat(),
            "exitCode": proc.returncode,
            "featureCount": day_summary.get("featureCount"),
        }
        summary.append(entry)

        if proc.returncode == 0:
            ok += 1
            print(f"OK {event_date.isoformat()} features={day_summary.get('featureCount', '?')}")
        elif proc.returncode == 6:
            skipped += 1
            print(f"SKIP {event_date.isoformat()} (empty crop / no data)", file=sys.stderr)
        else:
            failed += 1
            err = proc.stderr.strip() or proc.stdout.strip()
            print(f"FAIL {event_date.isoformat()} code={proc.returncode}: {err}", file=sys.stderr)
            if not args.skip_errors:
                print(json.dumps({"ok": ok, "skipped": skipped, "failed": failed, "days": summary}))
                return proc.returncode

    print(
        json.dumps(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "processed": len(dates),
                "ok": ok,
                "skipped": skipped,
                "failed": failed,
            }
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
