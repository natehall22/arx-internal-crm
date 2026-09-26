/**
 * Score the AUTO-DROP (Google Solar mask splitter, the "Load roof" path) on
 * carrier-scored roofs, and render each result over satellite for eyeballing.
 *
 *   npx tsx scripts/roof-measure-auto-eval.ts
 *
 * Read-only: calls Google + the splitter; never touches the CRM database.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { classifyRoofEdges, type FacetInput } from '../lib/roof-measure-edge-classification'
import { slopeCorrectEdgeTotals } from '../lib/roof-edge-slope-correction'
import { approximatePlanarPolygonAreaSqft } from '../lib/roof-measure-geometry'
import { tryFacetPayloadsFromSolarRoofMask, type SolarMaskSegment } from '../lib/solar-roof-mask-facets'
import { fetchStaticSatelliteMapBase64, staticMapImageBounds } from '../lib/static-satellite-map'

for (const filename of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), filename)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] != null) continue
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
}
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
const OUT = process.env.OUT_DIR || '/private/tmp'

// Pins from the saved CRM measurements; truth from scripts/roof-measure-eval-fixtures.json.
const ROOFS: { label: string; lat: number; lng: number; sq: number; ridge?: number; hip?: number; cap?: number; valleys?: number }[] = [
  { label: 'corriher', lat: 35.58678368308799, lng: -80.65420313016108, sq: 74.02, ridge: 135.3, hip: 190.69 },
  { label: 'magnolia', lat: 35.4737195, lng: -80.8817724, sq: 27.99, ridge: 105.95, hip: 8.73 },
  { label: 'nottingham', lat: 0, lng: 0, sq: 37.83, ridge: 123.5, hip: 26.76 },
  { label: 'kaestner', lat: 35.393335094332826, lng: -80.56620571752828, sq: 23.16, cap: 107.72 },
  { label: 'peduto', lat: 35.32260087009757, lng: -80.61937674425458, sq: 34.6, cap: 100.88 },
  { label: 'kison', lat: 0, lng: 0, sq: 17.46, ridge: 64.67, valleys: 40.83 },
  { label: 'morales', lat: 0, lng: 0, sq: 12.6, ridge: 55.75, hip: 0 },
  { label: 'brookgreen', lat: 0, lng: 0, sq: 16.61, ridge: 45.98 },
]
const ADDRESSES: Record<string, string> = {
  nottingham: '11699 Terrill Ridge Dr, Davidson, NC 28036',
  kison: '1361 Kison Ct NW, Concord, NC 28027',
  morales: '635 Bostian Rd, China Grove, NC 28023',
  brookgreen: '364 Brookgreen Pl NW, Concord, NC 28027',
}

async function geocode(address: string) {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  u.searchParams.set('address', address)
  u.searchParams.set('key', apiKey)
  const loc = (await (await fetch(u)).json()).results?.[0]?.geometry?.location
  return loc ? { lat: loc.lat as number, lng: loc.lng as number } : null
}

async function segmentsAt(lat: number, lng: number): Promise<SolarMaskSegment[]> {
  const u = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest')
  u.searchParams.set('location.latitude', String(lat))
  u.searchParams.set('location.longitude', String(lng))
  u.searchParams.set('requiredQuality', 'BASE')
  u.searchParams.set('key', apiKey)
  const solar = await (await fetch(u)).json()
  return (solar?.solarPotential?.roofSegmentStats ?? []).map((s: any, i: number) => ({
    segment_index: i,
    pitch_degrees: s.pitchDegrees ?? null,
    azimuth_degrees: s.azimuthDegrees ?? null,
    area_m2: s?.stats?.areaMeters2 ?? null,
    ground_area_m2: s?.stats?.groundAreaMeters2 ?? null,
    plane_height_at_center_meters: s.planeHeightAtCenterMeters ?? null,
    center: s.center ? { lat: s.center.latitude, lng: s.center.longitude } : null,
    bounding_box:
      s?.boundingBox?.sw && s?.boundingBox?.ne
        ? { sw: { lat: s.boundingBox.sw.latitude, lng: s.boundingBox.sw.longitude }, ne: { lat: s.boundingBox.ne.latitude, lng: s.boundingBox.ne.longitude } }
        : null,
  }))
}

const pct = (got: number, want?: number) => (want == null || want === 0 ? '' : ` (${got >= want ? '+' : ''}${Math.round(((got - want) / want) * 100)}%)`)

async function main() {
  for (const roof of ROOFS) {
    if (!roof.lat) {
      const g = await geocode(ADDRESSES[roof.label])
      if (!g) { console.log(roof.label, 'geocode failed'); continue }
      roof.lat = g.lat; roof.lng = g.lng
    }
    const segments = await segmentsAt(roof.lat, roof.lng)
    const attempt = await tryFacetPayloadsFromSolarRoofMask({
      lat: roof.lat, lng: roof.lng, apiKey, referenceLat: roof.lat, referenceLng: roof.lng, segments, querySource: 'auto_eval',
    })
    const facets = attempt.facets ?? []
    const multOf = (deg: number | null) => (deg == null ? 1 : 1 / Math.cos((deg * Math.PI) / 180))
    const sq = facets.reduce((s, f) => s + approximatePlanarPolygonAreaSqft(f.lat_lng_vertices) * multOf(f.suggested_pitch_degrees), 0) / 100
    const sources = Array.from(new Set(facets.map((f) => f.facet_source))).join(',')

    const toInput = (useSolarAzimuth: boolean): FacetInput[] =>
      facets.map((f) => ({
        id: f.id,
        points: f.lat_lng_vertices,
        plane_height_at_center_meters: f.plane_height_at_center_meters,
        pitch_degrees: f.suggested_pitch_degrees,
        solar_segment_index: f.solar_segment_index,
        ...(useSolarAzimuth && f.suggested_azimuth_degrees != null
          ? { drain_azimuth_degrees: f.suggested_azimuth_degrees, drain_azimuth_source: 'manual' as const }
          : { drain_azimuth_source: 'footprint_auto' as const }),
      }))
    const mult = new Map(facets.map((f) => [f.id, multOf(f.suggested_pitch_degrees)]))
    const today = slopeCorrectEdgeTotals(classifyRoofEdges(toInput(false)), mult)
    const solarAz = slopeCorrectEdgeTotals(classifyRoofEdges(toInput(true)), mult)
    const capTruth = roof.cap ?? (roof.ridge != null && roof.hip != null ? roof.ridge + roof.hip : undefined)

    console.log(`\n${roof.label}: segments=${segments.length} facets=${facets.length} source=${sources || attempt.reason}  squares ${sq.toFixed(1)} vs carrier ${roof.sq}${pct(sq, roof.sq)}`)
    for (const [name, r] of [['today', today], ['solar-az', solarAz]] as const) {
      const cap = r.ridges_lf + r.hips_lf
      console.log(`  ${name.padEnd(8)} R=${r.ridges_lf}${pct(r.ridges_lf, roof.cap == null ? roof.ridge : undefined)} H=${r.hips_lf} cap=${cap}${pct(cap, capTruth)} V=${r.valleys_lf}${pct(r.valleys_lf, roof.valleys)} eaves=${r.eaves_lf} rakes=${r.rakes_lf} unpaired_shared=${r.unclassified_shared_lf}`)
    }

    // Overlay: facets over satellite, interior edges colored by type (solar-az run).
    const zoom = 21, W = 1280, H = 1280
    const sat = Buffer.from(await fetchStaticSatelliteMapBase64({ lat: roof.lat, lng: roof.lng, zoom, sizeW: 640, sizeH: 640 }), 'base64')
    const b = staticMapImageBounds(roof.lat, roof.lng, zoom, W / 2, H / 2)
    const px = (p: { lat: number; lng: number }) => `${(((p.lng - b.west) / (b.east - b.west)) * W).toFixed(1)},${(((b.north - p.lat) / (b.north - b.south)) * H).toFixed(1)}`
    const polys = facets.map((f) => `<polygon points="${f.lat_lng_vertices.map(px).join(' ')}" fill="#3B82F6" fill-opacity="0.25" stroke="white" stroke-width="2"/>`).join('')
    const color: Record<string, string> = { ridge: '#EF4444', hip: '#F59E0B', valley: '#10B981', eave: '#FFFFFF', rake: '#A855F7', unknown: '#000000' }
    const edges = classifyRoofEdges(toInput(true)).classifiedEdges
      .filter((e) => e.p1 && e.p2).map((e) => { const [x1, y1] = px(e.p1!).split(','); const [x2, y2] = px(e.p2!).split(','); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color[e.type]}" stroke-width="${e.facetIdB ? 7 : 3}"/>` })
      .join('')
    const legend = `<rect x="10" y="10" width="470" height="44" fill="#000" fill-opacity="0.7"/><text x="20" y="40" font-size="24" fill="#fff">${roof.label} — <tspan fill="#EF4444">ridge</tspan> <tspan fill="#F59E0B">hip</tspan> <tspan fill="#10B981">valley</tspan> <tspan fill="#A855F7">rake</tspan> eave</text>`
    const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${polys}${edges}${legend}</svg>`)
    const file = `${OUT}/auto-${roof.label}.png`
    writeFileSync(file, await sharp(sat).resize(W, H).composite([{ input: svg }]).png().toBuffer())
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
