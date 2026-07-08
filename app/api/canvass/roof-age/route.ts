/**
 * /api/canvass/roof-age
 *
 * Parcel year-built for the current canvass viewport, from the free NC OneMap
 * statewide parcel layer (no key). Returns GeoJSON points (parcel centroids)
 * with est. roof age = years since construction. Only ages >= MIN_ROOF_AGE_YEARS
 * are returned — younger homes aren't knock-worthy on age alone and would bloat
 * the payload.
 *
 * Coverage is per-county (verified live 2026-07-08): Mecklenburg ~99% of parcels
 * carry `structyear`, Iredell ~91%, Cabarrus 0% — Cabarrus doesn't submit
 * year-built to NC OneMap and its own county GIS has no year-built field at all
 * (its `YEAR_` column is part of the legacy PIN numbering, NOT construction
 * year). The client shows "no data here" for such areas.
 *
 * Point CANVASS_PARCEL_ARCGIS_URL at another state's parcel MapServer/
 * FeatureServer query endpoint to change markets (set CANVASS_PARCEL_YEAR_FIELD
 * if the year-built column isn't `structyear`).
 */

import { requireAuthApi } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const MIN_ROOF_AGE_YEARS = 10

/** Street-zoom guard: reject viewport pulls wider than ~5km so a zoomed-out map
 * can't request tens of thousands of parcels. Client also gates by zoom. */
const MAX_BBOX_SPAN_DEGREES = 0.06

/** Parcels change ~never; cache viewport responses for 6h. */
const CACHE_MS = 1000 * 60 * 60 * 6

const DEFAULT_ARCGIS_URL =
  'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1/query'

type Bbox = { n: number; s: number; e: number; w: number }

type RoofAgeEmptyReason = 'county_gaps' | 'all_too_new' | 'no_parcels'

type RoofAgeResponse = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { yearBuilt: number; roofAge: number }
  }>
  degraded?: boolean
  emptyReason?: RoofAgeEmptyReason
  county?: string
}

const responseCache = new Map<string, { expiresAt: number; body: RoofAgeResponse }>()

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const bbox = {
    n: Number(searchParams.get('n')),
    s: Number(searchParams.get('s')),
    e: Number(searchParams.get('e')),
    w: Number(searchParams.get('w')),
  }
  const values = [bbox.n, bbox.s, bbox.e, bbox.w]
  if (values.some((v) => !Number.isFinite(v))) return null
  if (bbox.n <= bbox.s || bbox.e <= bbox.w) return null
  if (bbox.n - bbox.s > MAX_BBOX_SPAN_DEGREES || bbox.e - bbox.w > MAX_BBOX_SPAN_DEGREES) {
    return null
  }
  return bbox
}

async function fetchParcelFeatures(
  bbox: Bbox,
): Promise<{ features: RoofAgeResponse['features']; exceededLimit: boolean } | null> {
  const arcgisUrl = process.env.CANVASS_PARCEL_ARCGIS_URL || DEFAULT_ARCGIS_URL
  const yearField = process.env.CANVASS_PARCEL_YEAR_FIELD || 'structyear'
  const currentYear = new Date().getFullYear()
  const maxYearBuilt = currentYear - MIN_ROOF_AGE_YEARS
  // Pre-filter at ArcGIS so dense street viewports stay under the 1500-record
  // transfer cap. Live Jul 2026: Mecklenburg bbox 35.26–35.28/-80.84–-80.80 hit
  // exceededTransferLimit with where=1=1 (1499 parcels) but not with year filter.
  const where = `${yearField} >= 1800 AND ${yearField} <= ${maxYearBuilt}`
  const params = new URLSearchParams({
    where,
    geometry: JSON.stringify({
      xmin: bbox.w,
      ymin: bbox.s,
      xmax: bbox.e,
      ymax: bbox.n,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: yearField,
    // MapServer layers don't support returnCentroid (verified live), so pull
    // simplified ring geometry and compute the centroid ourselves.
    returnGeometry: 'true',
    maxAllowableOffset: '0.0001', // ~10m ring simplification — we only need a centroid
    geometryPrecision: '5',
    resultRecordCount: '1500',
    f: 'json',
  })

  const res = await fetch(`${arcgisUrl}?${params.toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  // ArcGIS reports errors as 200 + {error} — treat as a failed read, not "no parcels".
  if (!data || data.error || !Array.isArray(data.features)) return null

  const exceededLimit = Boolean(data.exceededTransferLimit)

  type ArcGisFeature = {
    attributes?: Record<string, unknown>
    geometry?: { rings?: number[][][] }
  }
  const out: RoofAgeResponse['features'] = []
  for (const raw of data.features as ArcGisFeature[]) {
    const yearBuilt = Number(String(raw.attributes?.[yearField] ?? '').trim())
    if (!Number.isFinite(yearBuilt) || yearBuilt < 1800 || yearBuilt > currentYear) continue
    const roofAge = currentYear - yearBuilt
    if (roofAge < MIN_ROOF_AGE_YEARS) continue
    // Centroid = midpoint of the outer ring's bounding box. Parcels are compact
    // near-rectangles, so this lands inside the lot — good enough for a map dot.
    const ring = raw.geometry?.rings?.[0]
    if (!ring?.length) continue
    let minLng = Infinity
    let maxLng = -Infinity
    let minLat = Infinity
    let maxLat = -Infinity
    for (const vertex of ring) {
      const vLng = Number(vertex?.[0])
      const vLat = Number(vertex?.[1])
      if (!Number.isFinite(vLng) || !Number.isFinite(vLat)) continue
      if (vLng < minLng) minLng = vLng
      if (vLng > maxLng) maxLng = vLng
      if (vLat < minLat) minLat = vLat
      if (vLat > maxLat) maxLat = vLat
    }
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) continue
    const lng = (minLng + maxLng) / 2
    const lat = (minLat + maxLat) / 2
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { yearBuilt, roofAge },
    })
  }
  return { features: out, exceededLimit }
}

/** When the year-filtered pull is empty, sample raw parcels to explain why. */
async function diagnoseEmptyBbox(
  bbox: Bbox,
): Promise<{ emptyReason: RoofAgeEmptyReason; county?: string }> {
  const arcgisUrl = process.env.CANVASS_PARCEL_ARCGIS_URL || DEFAULT_ARCGIS_URL
  const yearField = process.env.CANVASS_PARCEL_YEAR_FIELD || 'structyear'
  const currentYear = new Date().getFullYear()
  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({
      xmin: bbox.w,
      ymin: bbox.s,
      xmax: bbox.e,
      ymax: bbox.n,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: `cntyname,${yearField}`,
    returnGeometry: 'false',
    resultRecordCount: '25',
    f: 'json',
  })

  const res = await fetch(`${arcgisUrl}?${params.toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return { emptyReason: 'no_parcels' }
  const data = await res.json().catch(() => null)
  if (!data || data.error || !Array.isArray(data.features) || data.features.length === 0) {
    return { emptyReason: 'no_parcels' }
  }

  const county =
    String(data.features[0]?.attributes?.cntyname ?? '').trim() || undefined
  let hasValidYear = false
  let hasKnockWorthyAge = false

  for (const raw of data.features) {
    const yearBuilt = Number(String(raw.attributes?.[yearField] ?? '').trim())
    if (!Number.isFinite(yearBuilt) || yearBuilt < 1800 || yearBuilt > currentYear) continue
    hasValidYear = true
    if (currentYear - yearBuilt >= MIN_ROOF_AGE_YEARS) {
      hasKnockWorthyAge = true
      break
    }
  }

  if (!hasValidYear) return { emptyReason: 'county_gaps', county }
  if (!hasKnockWorthyAge) return { emptyReason: 'all_too_new', county }
  return { emptyReason: 'no_parcels', county }
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
    const result = await fetchParcelFeatures(bbox)
    if (!result) {
      // Provider failure — degraded, and never cached, so recovery is immediate.
      return NextResponse.json({ type: 'FeatureCollection', features: [], degraded: true })
    }
    if (result.exceededLimit) {
      // Dense viewport hit the ArcGIS record cap — partial data would mislead reps.
      return NextResponse.json({ type: 'FeatureCollection', features: [], degraded: true })
    }
    const body: RoofAgeResponse = { type: 'FeatureCollection', features: result.features }
    if (result.features.length === 0) {
      const diagnosis = await diagnoseEmptyBbox(bbox)
      body.emptyReason = diagnosis.emptyReason
      if (diagnosis.county) body.county = diagnosis.county
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
