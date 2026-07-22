/**
 * Capture live Google Solar segments + mask facets into topology eval fixtures.
 * Usage: npx tsx scripts/roof-topology-capture.ts [fixture-id-or-address ...]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyFootprint } from '../lib/roof-topology-graph'
import { localMetersPerDegLng } from '../lib/roof-plane-reconstruction'
import type { ReconPoint } from '../lib/roof-plane-reconstruction'
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

type CaptureDiagnostic = {
  id: string
  geocodeLat: number
  geocodeLng: number
  insightsLat: number | null
  insightsLng: number | null
  geocodeToInsightsM: number | null
  footprintFlatSqft: number | null
  vertexCount: number
  segmentCount: number
  footprintMethod: string
}

const FIXTURE_PATH = resolve(process.cwd(), 'scripts/roof-topology-eval-fixtures.json')
const CAPTURE_IDS = ['randy-hart-arx-reviewed', 'kison-court-roofr'] as const
const CONVEX_HULL_MAX_INFLATION = 1.12
const M_PER_DEG_LAT = 111320
const MASK_UNDERCOVER_RATIO = 0.85
const MASK_UNDEREXTENT_RATIO = 0.9
const MASK_OVER_GROUND_RATIO = 1.12

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

function distanceMeters(a: LatLng, b: LatLng): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusMeters = 6371000
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
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
): Promise<{ segments: SolarMaskSegment[]; status: number; insightsCenter: LatLng | null }> {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${key}`
  const response = await fetch(url)
  if (!response.ok) {
    return { segments: [], status: response.status, insightsCenter: null }
  }
  const data = await response.json()
  const insightsCenter =
    data?.center &&
    typeof data.center.latitude === 'number' &&
    typeof data.center.longitude === 'number'
      ? { lat: data.center.latitude as number, lng: data.center.longitude as number }
      : null
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
  return { segments, status: 200, insightsCenter }
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

function segmentGroundSqftSum(segments: SolarMaskSegment[]): number {
  return segments.reduce((s, seg) => s + (seg.ground_area_m2 ?? 0) * 10.7639104, 0)
}

function segmentSlopedSqftSum(segments: SolarMaskSegment[]): number {
  return segments.reduce((s, seg) => s + (seg.area_m2 ?? 0) * 10.7639104, 0)
}

function segmentHullPoints(seg: SolarMaskSegment): LatLng[] {
  const points: LatLng[] = []
  if (seg.center) points.push(seg.center)
  if (seg.bounding_box) {
    const { ne, sw } = seg.bounding_box
    points.push(
      { lat: ne.lat, lng: sw.lng },
      { lat: ne.lat, lng: ne.lng },
      { lat: sw.lat, lng: ne.lng },
      { lat: sw.lat, lng: sw.lng }
    )
  }
  return points
}

function collectSegmentHullPoints(segments: SolarMaskSegment[]): LatLng[] {
  const points: LatLng[] = []
  for (const s of segments) {
    points.push(...segmentHullPoints(s))
  }
  return points
}

function progressiveSegmentHullCandidates(
  segments: SolarMaskSegment[]
): Array<{ ring: LatLng[]; method: string }> {
  const sorted = [...segments].sort(
    (a, b) => (b.ground_area_m2 ?? 0) - (a.ground_area_m2 ?? 0)
  )
  const points: LatLng[] = []
  const out: Array<{ ring: LatLng[]; method: string }> = []
  let lastArea = 0
  for (const seg of sorted) {
    points.push(...segmentHullPoints(seg))
    if (points.length < 3) continue
    const hull = convexHullLatLng(points)
    if (hull.length < 3) continue
    const area = planarPolygonAreaSqFt(hull)
    if (Math.abs(area - lastArea) < 1) continue
    lastArea = area
    out.push({ ring: hull, method: 'segment_progressive_hull' })
  }
  return out
}

function bboxRingFromSegments(segments: SolarMaskSegment[]): LatLng[] | null {
  const points = collectSegmentHullPoints(segments)
  if (points.length === 0) return null
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) }
  const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) }
  return [
    { lat: sw.lat, lng: sw.lng },
    { lat: ne.lat, lng: sw.lng },
    { lat: ne.lat, lng: ne.lng },
    { lat: sw.lat, lng: ne.lng },
  ]
}

function latLngRingToRecon(ring: LatLng[], origin: LatLng): ReconPoint[] {
  const mLng = localMetersPerDegLng(origin.lat)
  return ring.map((p) => ({
    x: (p.lng - origin.lng) * mLng,
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  }))
}

function passesVerifyFootprint(ring: LatLng[], origin: LatLng): boolean {
  return verifyFootprint(latLngRingToRecon(ring, origin)).ok
}

function applySegmentCoverageFallback(
  ring: LatLng[] | null,
  method: string,
  segments: SolarMaskSegment[],
  origin: LatLng
): { ring: LatLng[] | null; method: string } {
  if (!ring || segments.length === 0) return { ring, method }

  const maskArea = planarPolygonAreaSqFt(ring)
  const segmentGround = segmentGroundSqftSum(segments)
  const segmentSloped = segmentSlopedSqftSum(segments)

  const candidates: Array<{ ring: LatLng[]; method: string }> = []
  const hullPoints = collectSegmentHullPoints(segments)
  if (hullPoints.length >= 3) {
    const hull = convexHullLatLng(hullPoints)
    if (hull.length >= 3) candidates.push({ ring: hull, method: 'segment_convex_hull' })
  }
  const bbox = bboxRingFromSegments(segments)
  if (bbox && bbox.length >= 3) {
    candidates.push({ ring: bbox, method: 'segment_bbox_ring' })
  }
  candidates.push(...progressiveSegmentHullCandidates(segments))

  const verified = candidates.filter((c) => passesVerifyFootprint(c.ring, origin))
  if (verified.length === 0) return { ring, method }

  const extentArea = Math.max(
    ...verified.map((c) => planarPolygonAreaSqFt(c.ring)),
    0
  )
  const extentExceedsGround =
    segmentGround > 0 && extentArea > segmentGround * 1.25
  const maskOverextends =
    segmentGround > 0 &&
    maskArea > segmentGround * MASK_OVER_GROUND_RATIO &&
    (segmentSloped <= 0 || maskArea > segmentSloped * 0.98)
  const maskUndercovers =
    !maskOverextends &&
    ((segmentGround > 0 && maskArea < segmentGround * MASK_UNDERCOVER_RATIO) ||
      (extentExceedsGround &&
        extentArea > 0 &&
        maskArea < extentArea * MASK_UNDEREXTENT_RATIO))

  if (maskUndercovers) {
    verified.sort(
      (a, b) => planarPolygonAreaSqFt(b.ring) - planarPolygonAreaSqFt(a.ring)
    )
    const best = verified[0]
    return {
      ring: best.ring,
      method: `${method}+${best.method}(mask=${Math.round(maskArea)}sqft<extent=${Math.round(extentArea)}sqft)`,
    }
  }

  if (maskOverextends) {
    const underMask = verified.filter((c) => planarPolygonAreaSqFt(c.ring) < maskArea)
    const pool = underMask.length > 0 ? underMask : verified
    pool.sort((a, b) => {
      const aArea = planarPolygonAreaSqFt(a.ring)
      const bArea = planarPolygonAreaSqFt(b.ring)
      return Math.abs(aArea - segmentGround) - Math.abs(bArea - segmentGround)
    })
    const best = pool[0]
    if (best && planarPolygonAreaSqFt(best.ring) < maskArea) {
      return {
        ring: best.ring,
        method: `${method}+${best.method}(mask=${Math.round(maskArea)}sqft>seg=${Math.round(segmentGround)}sqft)`,
      }
    }
  }

  return { ring, method }
}

function deriveFootprint(
  primaryFacets: SolarMaskFacetPayload[] | null,
  wholeFacets: SolarMaskFacetPayload[] | null,
  segments: SolarMaskSegment[],
  origin: LatLng
): { ring: LatLng[] | null; method: string } {
  const wholeRing = largestWholeContour(primaryFacets)
  if (wholeRing && primaryFacets?.some((f) => f.facet_source === 'solar_mask_whole')) {
    return applySegmentCoverageFallback(wholeRing, 'whole_mask_contour', segments, origin)
  }

  const split = splitPlaneFacets(primaryFacets)
  if (split.length > 0) {
    const ratio = hullInflationRatio(split)
    if (ratio != null && ratio <= CONVEX_HULL_MAX_INFLATION) {
      const hull = convexHullLatLng(collectFacetVertices(split))
      if (hull.length >= 3) {
        return applySegmentCoverageFallback(
          hull,
          `split_facet_convex_hull(ratio=${ratio.toFixed(3)})`,
          segments,
          origin
        )
      }
    }
    const wholeFallback = largestWholeContour(wholeFacets)
    if (wholeFallback) {
      return applySegmentCoverageFallback(
        wholeFallback,
        `whole_mask_contour_fallback(ratio=${ratio?.toFixed(3) ?? 'n/a'})`,
        segments,
        origin
      )
    }
    const hull = convexHullLatLng(collectFacetVertices(split))
    if (hull.length >= 3) {
      return applySegmentCoverageFallback(
        hull,
        `split_facet_convex_hull_forced(ratio=${ratio?.toFixed(3) ?? 'n/a'})`,
        segments,
        origin
      )
    }
  }

  const anyWhole = largestWholeContour(wholeFacets) ?? largestWholeContour(primaryFacets)
  if (anyWhole) {
    return applySegmentCoverageFallback(anyWhole, 'whole_mask_contour_only', segments, origin)
  }
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

function printDiagnosticTable(rows: CaptureDiagnostic[]) {
  if (rows.length === 0) return
  console.log('\nCapture diagnostic summary')
  console.log(
    'id'.padEnd(28) +
      'geocode'.padEnd(22) +
      'insights'.padEnd(22) +
      'dist_m'.padStart(7) +
      'flat_sqft'.padStart(10) +
      'verts'.padStart(6) +
      'segs'.padStart(5) +
      '  method'
  )
  for (const row of rows) {
    const geocode = `${row.geocodeLat.toFixed(5)},${row.geocodeLng.toFixed(5)}`
    const insights =
      row.insightsLat != null && row.insightsLng != null
        ? `${row.insightsLat.toFixed(5)},${row.insightsLng.toFixed(5)}`
        : 'n/a'
    const dist =
      row.geocodeToInsightsM != null ? row.geocodeToInsightsM.toFixed(1) : 'n/a'
    const flat =
      row.footprintFlatSqft != null ? Math.round(row.footprintFlatSqft).toString() : 'n/a'
    console.log(
      row.id.padEnd(28) +
        geocode.padEnd(22) +
        insights.padEnd(22) +
        dist.padStart(7) +
        flat.padStart(10) +
        String(row.vertexCount).padStart(6) +
        String(row.segmentCount).padStart(5) +
        `  ${row.footprintMethod}`
    )
  }
}

async function captureFixture(
  fixture: EvalFixture,
  key: string
): Promise<{ fixture: EvalFixture; diagnostic: CaptureDiagnostic }> {
  const address = fixture.address
  if (!address) throw new Error(`Fixture ${fixture.id} missing address`)

  console.log(`\nCapturing ${fixture.id}`)
  console.log(`  ${address}`)

  const origin = await geocode(address, key)
  const { segments, status: insightsStatus, insightsCenter } = await fetchSolarSegments(
    origin.lat,
    origin.lng,
    key
  )

  const buildingCenter = insightsCenter
  const maskQuery = buildingCenter ?? origin

  const maskAttempt = await tryFacetPayloadsFromSolarRoofMask({
    lat: maskQuery.lat,
    lng: maskQuery.lng,
    apiKey: key,
    referenceLat: origin.lat,
    referenceLng: origin.lng,
    segments,
    buildingCenter,
    querySource: 'topology_capture',
  })

  const wholeAttempt = await tryFacetPayloadsFromSolarRoofMask({
    lat: maskQuery.lat,
    lng: maskQuery.lng,
    apiKey: key,
    referenceLat: origin.lat,
    referenceLng: origin.lng,
    segments,
    buildingCenter,
    querySource: 'topology_capture_whole_contour',
  })

  const facetsForTopology = splitPlaneFacets(maskAttempt.facets)
  const maskFacets =
    facetsForTopology.length > 0
      ? facetsForTopology
      : maskAttempt.facets ?? wholeAttempt.facets ?? []

  const { ring: footprintLatLng, method: footprintMethod } = deriveFootprint(
    maskAttempt.facets,
    wholeAttempt.facets,
    segments,
    origin
  )

  const captureStatus: 'ok' | 'degraded' =
    maskAttempt.reason === 'ok' && footprintLatLng && segments.length > 0 ? 'ok' : 'degraded'

  const geocodeToInsightsM =
    insightsCenter != null ? distanceMeters(origin, insightsCenter) : null
  const footprintFlatSqft = footprintLatLng ? planarPolygonAreaSqFt(footprintLatLng) : null
  const segmentGroundSqft = segmentGroundSqftSum(segments)

  const diagnostic: CaptureDiagnostic = {
    id: fixture.id,
    geocodeLat: origin.lat,
    geocodeLng: origin.lng,
    insightsLat: insightsCenter?.lat ?? null,
    insightsLng: insightsCenter?.lng ?? null,
    geocodeToInsightsM,
    footprintFlatSqft,
    vertexCount: footprintLatLng?.length ?? 0,
    segmentCount: segments.length,
    footprintMethod,
  }

  console.log(
    `  diag: geocode=${origin.lat.toFixed(6)},${origin.lng.toFixed(6)} ` +
      `insights=${insightsCenter ? `${insightsCenter.lat.toFixed(6)},${insightsCenter.lng.toFixed(6)}` : 'n/a'} ` +
      `dist=${geocodeToInsightsM != null ? `${geocodeToInsightsM.toFixed(1)}m` : 'n/a'} ` +
      `flat=${footprintFlatSqft != null ? Math.round(footprintFlatSqft) : 'n/a'}sqft ` +
      `verts=${footprintLatLng?.length ?? 0} segs=${segments.length}`
  )

  const notes: string[] = []
  if (insightsStatus !== 200) notes.push(`buildingInsights status=${insightsStatus}`)
  if (geocodeToInsightsM != null && geocodeToInsightsM > 15) {
    notes.push(`geocode_to_insights=${geocodeToInsightsM.toFixed(1)}m`)
  }
  if (maskAttempt.reason !== 'ok') notes.push(`mask reason=${maskAttempt.reason}`)
  if (!footprintLatLng) notes.push('no footprint ring extracted')
  else notes.push(`footprint=${footprintMethod}`)
  if (segmentGroundSqft > 0 && footprintFlatSqft != null) {
    notes.push(
      `mask_vs_segment_ground=${Math.round(footprintFlatSqft)}/${Math.round(segmentGroundSqft)}sqft`
    )
  }
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
      diagnostic,
      fixture: {
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
      },
    }
  }

  return {
    diagnostic,
    fixture: {
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
    },
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
  const diagnostics: CaptureDiagnostic[] = []

  for (const fixture of targets) {
    try {
      const { fixture: captured, diagnostic } = await captureFixture(fixture, key)
      updatedById.set(fixture.id, captured)
      diagnostics.push(diagnostic)
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

  printDiagnosticTable(diagnostics)

  const merged = fixtures.map((f) => updatedById.get(f.id) ?? f)
  writeFixtures(merged)
  console.log(`\nUpdated ${FIXTURE_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
