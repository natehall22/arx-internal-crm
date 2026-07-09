/**
 * /api/canvass/roof-age
 *
 * Parcel year-built for the current canvass viewport. Returns GeoJSON points
 * (parcel centroids) with est. roof age = years since construction. Only ages
 * >= MIN_ROOF_AGE_YEARS are returned — younger homes aren't knock-worthy on age
 * alone and would bloat the payload.
 *
 * Two sources, tried in order:
 *  1. NC OneMap statewide parcels (`structyear`) — free, no key. Coverage is
 *     per-county (verified live 2026-07-08): Mecklenburg ~99%, Iredell ~91%,
 *     Cabarrus 0% (doesn't submit year-built; its own GIS has no year-built
 *     field either — the county `YEAR_` column is legacy PIN numbering, NOT
 *     construction year).
 *  2. Cabarrus fallback: county parcel geometry (ArcGIS, PIN14) joined to the
 *     `canvass_parcel_years` Supabase table, which is bulk-loaded from the
 *     county's "Real Property Building" CAMA open-data export
 *     (ActualYearBuilt of the largest-heated-area building per parcel;
 *     84k parcels loaded 2026-07-08).
 *
 * Point CANVASS_PARCEL_ARCGIS_URL at another state's parcel MapServer/
 * FeatureServer query endpoint to change markets (set CANVASS_PARCEL_YEAR_FIELD
 * if the year-built column isn't `structyear`).
 */

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { clampQueryBbox } from '@/lib/weather-footprint'
import {
  MIN_ROOF_AGE_YEARS,
  type RoofAgeEmptyReason,
  type RoofAgeFeature,
} from '@/app/(canvass-app)/canvass/lib/roof-age-overlay'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Street-zoom guard: reject viewport pulls wider than ~5km so a zoomed-out map
 * can't request tens of thousands of parcels. Client also gates by zoom. */
const MAX_BBOX_SPAN_DEGREES = 0.06

/** Parcels change ~never; cache viewport responses for 6h. */
const CACHE_MS = 1000 * 60 * 60 * 6

const NC_ONEMAP_PARCELS_URL =
  'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1/query'

/** Cabarrus County parcel geometry (PIN14 + rings; no year data on this layer). */
const CABARRUS_PARCELS_URL =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/views/landrecords_view/MapServer/4/query'

type Bbox = { n: number; s: number; e: number; w: number }

type RoofAgeResponse = {
  type: 'FeatureCollection'
  features: RoofAgeFeature[]
  degraded?: boolean
  emptyReason?: RoofAgeEmptyReason
  county?: string
}

const responseCache = new Map<string, { expiresAt: number; body: RoofAgeResponse }>()

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const clamped = clampQueryBbox({
    n: Number(searchParams.get('n')),
    s: Number(searchParams.get('s')),
    e: Number(searchParams.get('e')),
    w: Number(searchParams.get('w')),
  })
  if (!clamped) return null
  // Much tighter span cap than the weather overlay's — parcels are per-house data.
  if (clamped.n - clamped.s > MAX_BBOX_SPAN_DEGREES || clamped.e - clamped.w > MAX_BBOX_SPAN_DEGREES) {
    return null
  }
  return clamped
}

function envelopeParams(bbox: Bbox, outFields: string) {
  return new URLSearchParams({
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
    outFields,
    // MapServer layers don't support returnCentroid (verified live), so pull
    // simplified ring geometry and compute the centroid ourselves.
    returnGeometry: 'true',
    maxAllowableOffset: '0.0001', // ~10m ring simplification — we only need a centroid
    geometryPrecision: '5',
    resultRecordCount: '1500',
    f: 'json',
  })
}

type ArcGisFeature = {
  attributes?: Record<string, unknown>
  geometry?: { rings?: number[][][] }
}

async function fetchArcGisFeatures(url: string, bbox: Bbox, outFields: string) {
  const res = await fetch(`${url}?${envelopeParams(bbox, outFields).toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  // ArcGIS reports errors as 200 + {error} — treat as a failed read, not "no parcels".
  if (!data || data.error || !Array.isArray(data.features)) return null
  return data.features as ArcGisFeature[]
}

/** Centroid = midpoint of the outer ring's bounding box. Parcels are compact
 * near-rectangles, so this lands inside the lot — good enough for a map dot. */
function ringCentroid(raw: ArcGisFeature): [number, number] | null {
  const ring = raw.geometry?.rings?.[0]
  if (!ring?.length) return null
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
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}

function toFeature(lng: number, lat: number, yearBuilt: number, currentYear: number): RoofAgeFeature | null {
  const roofAge = currentYear - yearBuilt
  if (roofAge < MIN_ROOF_AGE_YEARS) return null
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { yearBuilt, roofAge },
  }
}

type SourceResult = {
  /** null = provider failure (degraded) */
  features: RoofAgeFeature[] | null
  parcelCount: number
  /** parcels that carried a usable year (pre age-filter) */
  yearCount: number
  county: string | null
}

async function fetchOneMap(bbox: Bbox): Promise<SourceResult> {
  const arcgisUrl = process.env.CANVASS_PARCEL_ARCGIS_URL || NC_ONEMAP_PARCELS_URL
  const yearField = process.env.CANVASS_PARCEL_YEAR_FIELD || 'structyear'
  const raw = await fetchArcGisFeatures(arcgisUrl, bbox, `${yearField},cntyname`)
  if (!raw) return { features: null, parcelCount: 0, yearCount: 0, county: null }

  const currentYear = new Date().getFullYear()
  let yearCount = 0
  let county: string | null = null
  const features: RoofAgeFeature[] = []
  for (const parcel of raw) {
    if (!county) {
      const name = String(parcel.attributes?.cntyname ?? '').trim()
      if (name) county = name
    }
    const yearBuilt = Number(String(parcel.attributes?.[yearField] ?? '').trim())
    if (!Number.isFinite(yearBuilt) || yearBuilt < 1800 || yearBuilt > currentYear) continue
    yearCount += 1
    const centroid = ringCentroid(parcel)
    if (!centroid) continue
    const feature = toFeature(centroid[0], centroid[1], yearBuilt, currentYear)
    if (feature) features.push(feature)
  }
  return { features, parcelCount: raw.length, yearCount, county }
}

/** Cabarrus: county parcel geometry + year_built from canvass_parcel_years
 * (bulk-loaded CAMA data). Returns zero parcels outside Cabarrus, so it's safe
 * to try whenever OneMap has no year data for the viewport. */
async function fetchCabarrusFallback(bbox: Bbox): Promise<SourceResult> {
  const raw = await fetchArcGisFeatures(CABARRUS_PARCELS_URL, bbox, 'PIN14')
  if (!raw) return { features: null, parcelCount: 0, yearCount: 0, county: 'Cabarrus' }
  if (!raw.length) return { features: [], parcelCount: 0, yearCount: 0, county: 'Cabarrus' }

  const parcels: Array<{ pin: string; centroid: [number, number] }> = []
  for (const parcel of raw) {
    const pin = String(parcel.attributes?.PIN14 ?? '').trim()
    if (!/^\d{10,14}$/.test(pin)) continue
    const centroid = ringCentroid(parcel)
    if (!centroid) continue
    parcels.push({ pin, centroid })
  }

  const yearByPin = new Map<string, number>()
  const admin = createServiceClient()
  // .in() builds a GET URL — chunk the pin list so it can't blow the URL limit.
  const CHUNK = 300
  for (let i = 0; i < parcels.length; i += CHUNK) {
    const pins = parcels.slice(i, i + CHUNK).map((p) => p.pin)
    const { data, error } = await admin
      .from('canvass_parcel_years')
      .select('pin, year_built')
      .eq('county', 'cabarrus')
      .in('pin', pins)
    if (error) return { features: null, parcelCount: raw.length, yearCount: 0, county: 'Cabarrus' }
    for (const row of data ?? []) {
      yearByPin.set(String(row.pin), Number(row.year_built))
    }
  }

  const currentYear = new Date().getFullYear()
  let yearCount = 0
  const features: RoofAgeFeature[] = []
  for (const parcel of parcels) {
    const yearBuilt = yearByPin.get(parcel.pin)
    if (!yearBuilt || yearBuilt < 1800 || yearBuilt > currentYear) continue
    yearCount += 1
    const feature = toFeature(parcel.centroid[0], parcel.centroid[1], yearBuilt, currentYear)
    if (feature) features.push(feature)
  }
  return { features, parcelCount: raw.length, yearCount, county: 'Cabarrus' }
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
    let result = await fetchOneMap(bbox)

    // County gap in OneMap (e.g. Cabarrus): try the CAMA-backed fallback.
    if (result.features !== null && result.yearCount === 0) {
      const fallback = await fetchCabarrusFallback(bbox)
      if (fallback.features === null) {
        // Keep the (empty but valid) OneMap result rather than degrade the
        // whole response on a fallback hiccup — unless OneMap saw no parcels
        // at all, in which case we have nothing trustworthy to report.
        if (result.parcelCount === 0) {
          return NextResponse.json({ type: 'FeatureCollection', features: [], degraded: true })
        }
      } else if (fallback.yearCount > 0 || result.parcelCount === 0) {
        result = fallback
      }
    }

    if (result.features === null) {
      // Provider failure — degraded, and never cached, so recovery is immediate.
      return NextResponse.json({ type: 'FeatureCollection', features: [], degraded: true })
    }

    const body: RoofAgeResponse = { type: 'FeatureCollection', features: result.features }
    if (!result.features.length) {
      body.emptyReason =
        result.yearCount > 0 ? 'all_too_new' : result.parcelCount > 0 ? 'county_gaps' : 'no_parcels'
      if (body.emptyReason === 'county_gaps' && result.county) body.county = result.county
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
