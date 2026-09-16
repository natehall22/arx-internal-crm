/**
 * /api/canvass/solar
 *
 * Permitted solar installs in the current canvass viewport, as GeoJSON points
 * colored by whether the installing company is still in business.
 *
 * Unlike /api/canvass/roof-age, this reads our own `solar_installs` table rather
 * than a live county ArcGIS service. That data arrives via NC Public Records Act
 * requests (docs/solar-permit-records-request.md) — the county portals are NOT
 * scraped: Mecklenburg's robots.txt refuses crawlers by name and NC GS 132-10
 * restricts commercial use of bulk extracts.
 */

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { clampQueryBbox } from '@/lib/weather-footprint'
import { dedupeByProperty, toFeature, type InstallRow } from '@/lib/solar-installs'
import {
  type SolarEmptyReason,
  type SolarFeature,
} from '@/app/(canvass-app)/canvass/lib/solar-overlay'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Street-zoom guard, matching the roof-age layer — per-house data. */
const MAX_BBOX_SPAN_DEGREES = 0.06

/**
 * Permits barely change, but candidates expire — a long cache could serve a
 * candidate past its expires_at. One hour keeps the read cheap without letting
 * the 30-day limit drift.
 */
const CACHE_MS = 1000 * 60 * 60

/** Hard ceiling on rows pulled for one viewport. */
const MAX_ROWS = 2000

type Bbox = { n: number; s: number; e: number; w: number }

type SolarResponse = {
  type: 'FeatureCollection'
  features: SolarFeature[]
  degraded?: boolean
  emptyReason?: SolarEmptyReason
}

const responseCache = new Map<string, { expiresAt: number; body: SolarResponse }>()

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const clamped = clampQueryBbox({
    n: Number(searchParams.get('n')),
    s: Number(searchParams.get('s')),
    e: Number(searchParams.get('e')),
    w: Number(searchParams.get('w')),
  })
  if (!clamped) return null
  if (
    clamped.n - clamped.s > MAX_BBOX_SPAN_DEGREES ||
    clamped.e - clamped.w > MAX_BBOX_SPAN_DEGREES
  ) {
    return null
  }
  return clamped
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bbox = parseBbox(request.nextUrl.searchParams)
  if (!bbox) {
    return NextResponse.json({ error: 'Invalid or too-large bbox' }, { status: 400 })
  }

  const k = (v: number) => v.toFixed(3)
  const cacheKey = `${k(bbox.n)}|${k(bbox.s)}|${k(bbox.e)}|${k(bbox.w)}`
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.body)
  }

  try {
    const admin = createServiceClient()
    const { data, error } = await admin
      .from('solar_installs')
      .select(
        'pin, address, lat, lng, issued_on, installer_name_raw, owner_is_original, solar_installers(status, display_name)'
      )
      .gte('lat', bbox.s)
      .lte('lat', bbox.n)
      .gte('lng', bbox.w)
      .lte('lng', bbox.e)
      .limit(MAX_ROWS)

    if (error) {
      // Never cached, so recovery is immediate once the read succeeds.
      return NextResponse.json({ type: 'FeatureCollection', features: [], degraded: true })
    }

    const rows = (data ?? []) as unknown as InstallRow[]
    const currentYear = new Date().getFullYear()
    const features = dedupeByProperty(rows)
      .map((row) => toFeature(row, currentYear))
      .filter((f): f is SolarFeature => f !== null)

    // Imagery-detected candidates awaiting a rep's eyes. Filtered on expires_at
    // at READ time, so Google's 30-day cache limit holds even if a purge job
    // never runs. Unverified rows only — once a rep answers, the candidate stops
    // being a question and is promoted separately.
    const { data: candidates } = await admin
      .from('solar_candidates')
      .select('id, lat, lng, owner_name, verified_has_solar')
      .gte('lat', bbox.s)
      .lte('lat', bbox.n)
      .gte('lng', bbox.w)
      .lte('lng', bbox.e)
      .or(`and(verified_has_solar.is.null,expires_at.gt.${new Date().toISOString()}),verified_has_solar.is.true`)
      .limit(MAX_ROWS)

    for (const c of candidates ?? []) {
      if (c.lat == null || c.lng == null) continue
      // A rep already said yes: render it as a confirmed marker, not a question.
      if (c.verified_has_solar === true) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lng as number, c.lat as number] },
          properties: { kind: 'permit', installerStatus: 'unknown', installerName: null },
        })
        continue
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng as number, c.lat as number] },
        properties: {
          kind: 'candidate',
          candidateId: String(c.id),
          ownerName: (c.owner_name as string | null) ?? null,
          installerStatus: 'unknown',
          installerName: null,
        },
      })
    }

    const body: SolarResponse = { type: 'FeatureCollection', features }
    if (!features.length) {
      // Distinguish "we have no data for this county yet" from "this block has
      // no solar" — the rep should know which one they're looking at.
      const { count } = await admin
        .from('solar_installs')
        .select('id', { count: 'exact', head: true })
      body.emptyReason = count && count > 0 ? 'none_in_view' : 'no_permits_loaded'
    }

    if (responseCache.size > 300) {
      const now = Date.now()
      responseCache.forEach((val, key) => {
        if (val.expiresAt <= now) responseCache.delete(key)
      })
    }
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, body })
    return NextResponse.json(body)
  } catch {
    return NextResponse.json({ type: 'FeatureCollection', features: [], degraded: true })
  }
}
