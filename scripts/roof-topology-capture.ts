/**
 * Capture live Google Solar segments + mask facets into topology eval fixtures.
 * Usage: npx tsx scripts/roof-topology-capture.ts [fixture-id-or-address ...]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  tryFacetPayloadsFromSolarRoofMask,
  type SolarMaskFacetPayload,
  type SolarMaskSegment,
} from '../lib/solar-roof-mask-facets'

type LatLng = { lat: number; lng: number }

type FixtureTargets = {
  status?: 'ship' | 'force_manual'
  facetCount?: number
  ridgeLf?: number
  hipLf?: number
  valleyLf?: number
  valleysLf?: number
  eavesLf?: number
  rakesLf?: number
  groundSqft?: number
}

type EvalFixture = {
  id: string
  skip?: boolean
  description?: string
  address?: string
  capturedAt?: string
  captureStatus?: 'ok' | 'degraded'
  captureNotes?: string
  origin?: LatLng
  segments?: Array<{
    segment_index: number
    pitch_degrees: number | null
    azimuth_degrees: number | null
    plane_height_at_center_meters: number | null
    center: LatLng | null
    ground_area_m2?: number | null
    area_m2?: number | null
  }>
  footprintLatLng?: LatLng[]
  maskFacets?: Array<{
    solar_segment_index: number | null
    lat_lng_vertices: LatLng[]
    facet_source: string
  }>
  targets: FixtureTargets
  planes?: unknown
  footprint?: unknown
}

const FIXTURE_PATH = resolve(process.cwd(), 'scripts/roof-topology-eval-fixtures.json')
const CAPTURE_IDS = ['randy-hart-arx-reviewed', 'kison-court-roofr'] as const
const CONVEX_HULL_MAX_INFLATION = 1.12

function loadEnvFile(filename: string) {
  const envPath = resolve(process.cwd(), filename)
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null) process.env[key] = val
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

function loadApiKey(): string {
  const key =
    process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY required in .env.local')
  return key
}

async function geocode(address: string, key: string): Promise<LatLng> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', address)
  url.searchParams.set('key', key)
  const response = await fetch(url)
  const data = await response.json()
  const loc = data.results?.[0]?.geometry?.location
  if (!loc) throw new Error(`Geocode failed: ${address} (${data.status})`)
  return { lat: loc.lat as number, lng: loc.lng as number }
}

async function fetchSolarSegments(
  lat: number,
  lng: number,
  key: string
): Promise<{ segments: SolarMaskSegment[]; status: number }> {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${key}`
  const response = await fetch(url)
  if (!response.ok) {
    return { segments: [], status: response.status }
  }
  const data = await response.json()
  const roofSegments = data?.solarPotential?.roofSegmentStats ?? []
  const segments: SolarMaskSegment[] = roofSegments.map((segment: any, index: number) => ({
    segment_index: index,
    pitch_degrees: typeof segment.pitchDegrees === 'number' ? segment.pitchDegrees : null,
    azimuth_degrees: typeof segment.azimuthDegrees === 'number' ? segment.azimuthDegrees : null,
    area_m2: typeof segment?.stats?.areaMeters2 === 'number' ? segment.stats.areaMeters2 : null,
    ground_area_m2:
      typeof segment?.stats?.groundAreaMeters2 === 'number' ? segment.stats.groundAreaMeters2 : null,
    plane_height_at_center_meters:
      typeof segment?.planeHeightAtCenterMeters === 'number'
        ? segment.planeHeightAtCenterMeters
        : null,
    center: segment?.center
      ? { lat: segment.center.latitude, lng: segment.center.longitude }
      : null,
    bounding_box:
      segment?.boundingBox?.sw && segment?.boundingBox?.ne
        ? {
            sw: { lat: segment.boundingBox.sw.latitude, lng: segment.boundingBox.sw.longitude },
            ne: { lat: segment.boundingBox.ne.latitude, lng: segment.boundingBox.ne.longitude },
          }
        : null,
  }))
  return { segments, status: 200 }
}

function planarPolygonAreaSqFt(vertices: LatLng[]): number {
  if (vertices.length < 3) return 0
  const lat0 = vertices.reduce((s, p) => s + p.lat, 0) / vertices.length
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
  let sum = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % n]
    sum += (a.lng - b.lng) * mPerDegLng * ((a.lat + b.lat) / 2 - lat0) * mPerDegLat
  }
  return Math.abs(sum) * 10.7639104
}

function convexHullLatLng(points: LatLng[]): LatLng[] {
  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  const unique = sorted.filter(
    (p, i) => i === 0 || p.lng !== sorted[i - 1].lng || p.lat !== sorted[i - 1].lat
  )
  if (unique.length < 3) return unique
  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
  const lower: LatLng[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: LatLng[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function collectFacetVertices(facets: SolarMaskFacetPayload[]): LatLng[] {
  const out: LatLng[] = []
  for (const facet of facets) {
    out.push(...facet.lat_lng_vertices)
  }
  return out
}

function largestWholeContour(facets: SolarMaskFacetPayload[] | null | undefined): LatLng[] | null {
  if (!facets?.length) return null
  const whole = facets.filter((f) => f.facet_source === 'solar_mask_whole')
  const pool = whole.length > 0 ? whole : facets
  let best: LatLng[] | null = null
  let bestArea = 0
  for (const facet of pool) {
    const area = planarPolygonAreaSqFt(facet.lat_lng_vertices)
    if (area > bestArea && facet.lat_lng_vertices.length >= 3) {
      bestArea = area
      best = facet.lat_lng_vertices
    }
  }
  return best
}

function splitPlaneFacets(facets: SolarMaskFacetPayload[] | null | undefined): SolarMaskFacetPayload[] {
  if (!facets?.length) return []
  const split = facets.filter((f) => f.facet_source === 'solar_mask_plane')
  return split.length > 0 ? split : facets
}

function hullInflationRatio(facets: SolarMaskFacetPayload[]): number | null {
  const verts = collectFacetVertices(facets)
  if (verts.length < 3) return null
  const hull = convexHullLatLng(verts)
  const hullArea = planarPolygonAreaSqFt(hull)
  const facetArea = facets.reduce(
    (sum, f) => sum + planarPolygonAreaSqFt(f.lat_lng_vertices),
    0
  )
  if (facetArea <= 0 || hullArea <= 0) return null
  return hullArea / facetArea
}

function deriveFootprint(
  primaryFacets: SolarMaskFacetPayload[] | null,
  wholeFacets: SolarMaskFacetPayload[] | null
): { ring: LatLng[] | null; method: string } {
  const wholeRing = largestWholeContour(primaryFacets)
  if (wholeRing && primaryFacets?.some((f) => f.facet_source === 'solar_mask_whole')) {
    return { ring: wholeRing, method: 'whole_mask_contour' }
  }

  const split = splitPlaneFacets(primaryFacets)
  if (split.length > 0) {
    const ratio = hullInflationRatio(split)
    if (ratio != null && ratio <= CONVEX_HULL_MAX_INFLATION) {
      const hull = convexHullLatLng(collectFacetVertices(split))
      if (hull.length >= 3) {
        return { ring: hull, method: `split_facet_convex_hull(ratio=${ratio.toFixed(3)})` }
      }
    }
    const wholeFallback = largestWholeContour(wholeFacets)
    if (wholeFallback) {
      return {
        ring: wholeFallback,
        method: `whole_mask_contour_fallback(ratio=${ratio?.toFixed(3) ?? 'n/a'})`,
      }
    }
    const hull = convexHullLatLng(collectFacetVertices(split))
    if (hull.length >= 3) {
      return { ring: hull, method: `split_facet_convex_hull_forced(ratio=${ratio?.toFixed(3) ?? 'n/a'})` }
    }
  }

  const anyWhole = largestWholeContour(wholeFacets) ?? largestWholeContour(primaryFacets)
  if (anyWhole) return { ring: anyWhole, method: 'whole_mask_contour_only' }
  return { ring: null, method: 'none' }
}

function readFixtures(): EvalFixture[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as EvalFixture[]
}

function writeFixtures(fixtures: EvalFixture[]) {
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8')
}

function roundLatLng(p: LatLng): LatLng {
  return { lat: Number(p.lat.toFixed(7)), lng: Number(p.lng.toFixed(7)) }
}

async function captureFixture(fixture: EvalFixture, key: string): Promise<EvalFixture> {
  const address = fixture.address
  if (!address) throw new Error(`Fixture ${fixture.id} missing address`)

  console.log(`\nCapturing ${fixture.id}`)
  console.log(`  ${address}`)

  const origin = await geocode(address, key)
  const { segments, status: insightsStatus } = await fetchSolarSegments(origin.lat, origin.lng, key)

  const maskAttempt = await tryFacetPayloadsFromSolarRoofMask({
    lat: origin.lat,
    lng: origin.lng,
    apiKey: key,
    referenceLat: origin.lat,
    referenceLng: origin.lng,
    segments,
    querySource: 'topology_capture',
  })

  const wholeAttempt = await tryFacetPayloadsFromSolarRoofMask({
    lat: origin.lat,
    lng: origin.lng,
    apiKey: key,
    referenceLat: origin.lat,
    referenceLng: origin.lng,
    segments: [],
    querySource: 'topology_capture_whole_contour',
  })

  const facetsForTopology = splitPlaneFacets(maskAttempt.facets)
  const maskFacets =
    facetsForTopology.length > 0
      ? facetsForTopology
      : maskAttempt.facets ?? wholeAttempt.facets ?? []

  const { ring: footprintLatLng, method: footprintMethod } = deriveFootprint(
    maskAttempt.facets,
    wholeAttempt.facets
  )

  const captureStatus: 'ok' | 'degraded' =
    maskAttempt.reason === 'ok' && footprintLatLng && segments.length > 0 ? 'ok' : 'degraded'

  const notes: string[] = []
  if (insightsStatus !== 200) notes.push(`buildingInsights status=${insightsStatus}`)
  if (maskAttempt.reason !== 'ok') notes.push(`mask reason=${maskAttempt.reason}`)
  if (!footprintLatLng) notes.push('no footprint ring extracted')
  else notes.push(`footprint=${footprintMethod}`)
  if (maskFacets.length > 0) {
    const sources = Array.from(new Set(maskFacets.map((f) => f.facet_source)))
    notes.push(`facet_sources=${sources.join(',')}`)
  }

  const facetSources = Array.from(new Set(maskFacets.map((f) => f.facet_source)))
  console.log(`  origin: ${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`)
  console.log(`  buildingInsights: ${insightsStatus === 200 ? 'ok' : insightsStatus}`)
  console.log(`  segments: ${segments.length}`)
  console.log(`  mask: reason=${maskAttempt.reason} facets=${maskAttempt.facets?.length ?? 0}`)
  console.log(`  whole contour facets: ${wholeAttempt.facets?.length ?? 0}`)
  console.log(
    `  footprint: ${footprintLatLng?.length ?? 0} verts via ${footprintMethod} captureStatus=${captureStatus}`
  )
  console.log(`  facet_source: ${facetSources.join(', ') || 'none'}`)

  if (!footprintLatLng || segments.length === 0) {
    return {
      ...fixture,
      skip: true,
      capturedAt: new Date().toISOString(),
      captureStatus: 'degraded',
      captureNotes: notes.join('; '),
      origin: roundLatLng(origin),
      segments: segments.map((s) => ({
        segment_index: s.segment_index,
        pitch_degrees: s.pitch_degrees,
        azimuth_degrees: s.azimuth_degrees,
        plane_height_at_center_meters: s.plane_height_at_center_meters,
        center: s.center ? roundLatLng(s.center) : null,
        ground_area_m2: s.ground_area_m2,
        area_m2: s.area_m2,
      })),
      footprintLatLng: footprintLatLng?.map(roundLatLng),
      maskFacets: maskFacets.map((f) => ({
        solar_segment_index: f.solar_segment_index,
        lat_lng_vertices: f.lat_lng_vertices.map(roundLatLng),
        facet_source: f.facet_source,
      })),
    }
  }

  return {
    ...fixture,
    skip: false,
    capturedAt: new Date().toISOString(),
    captureStatus,
    captureNotes: notes.join('; '),
    origin: roundLatLng(origin),
    segments: segments.map((s) => ({
      segment_index: s.segment_index,
      pitch_degrees: s.pitch_degrees,
      azimuth_degrees: s.azimuth_degrees,
      plane_height_at_center_meters: s.plane_height_at_center_meters,
      center: s.center ? roundLatLng(s.center) : null,
      ground_area_m2: s.ground_area_m2,
      area_m2: s.area_m2,
    })),
    footprintLatLng: footprintLatLng.map(roundLatLng),
    maskFacets: maskFacets.map((f) => ({
      solar_segment_index: f.solar_segment_index,
      lat_lng_vertices: f.lat_lng_vertices.map(roundLatLng),
      facet_source: f.facet_source,
    })),
  }
}

async function main() {
  const key = loadApiKey()
  const cliArgs = process.argv.slice(2)
  const fixtures = readFixtures()

  let targets: EvalFixture[]
  if (cliArgs.length === 0) {
    targets = fixtures.filter((f) => (CAPTURE_IDS as readonly string[]).includes(f.id))
  } else {
    targets = fixtures.filter(
      (f) =>
        cliArgs.includes(f.id) ||
        (f.address && cliArgs.some((arg) => f.address!.toLowerCase().includes(arg.toLowerCase())))
    )
  }

  if (targets.length === 0) {
    throw new Error(`No fixtures matched args: ${cliArgs.join(' ') || '(default capture ids)'}`)
  }

  console.log('Roof topology fixture capture')
  const updatedById = new Map<string, EvalFixture>()

  for (const fixture of targets) {
    try {
      updatedById.set(fixture.id, await captureFixture(fixture, key))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  ERROR: ${msg}`)
      updatedById.set(fixture.id, {
        ...fixture,
        skip: true,
        capturedAt: new Date().toISOString(),
        captureStatus: 'degraded',
        captureNotes: `capture failed: ${msg}`,
      })
    }
  }

  const merged = fixtures.map((f) => updatedById.get(f.id) ?? f)
  writeFixtures(merged)
  console.log(`\nUpdated ${FIXTURE_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
