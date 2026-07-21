import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { fetchStaticSatelliteMapBase64, staticMapImageBounds } from '../lib/static-satellite-map'
import { tryFacetPayloadsFromSolarRoofMask, type SolarMaskSegment } from '../lib/solar-roof-mask-facets'
import { fetchSolarRgbOverlayPayload } from '../lib/solar-rgb-overlay'

for (const filename of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), filename)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]] != null) continue
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
}

const address = process.argv.slice(2).join(' ') || '2271 Helen Dr, Concord, NC'
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
if (!apiKey) throw new Error('Google Maps API key missing')

async function main() {
  const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  geocodeUrl.searchParams.set('address', address)
  geocodeUrl.searchParams.set('key', apiKey)
  const geocode = await (await fetch(geocodeUrl)).json()
  const loc = geocode.results?.[0]?.geometry?.location
  if (!loc) throw new Error(`Geocode failed: ${geocode.status}`)

  const solarUrl = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest')
  solarUrl.searchParams.set('location.latitude', String(loc.lat))
  solarUrl.searchParams.set('location.longitude', String(loc.lng))
  solarUrl.searchParams.set('requiredQuality', 'HIGH')
  solarUrl.searchParams.set('key', apiKey)
  const solar = await (await fetch(solarUrl)).json()
  const segments: SolarMaskSegment[] = (solar?.solarPotential?.roofSegmentStats ?? []).map(
    (segment: any, index: number) => ({
      segment_index: index,
      pitch_degrees: segment.pitchDegrees ?? null,
      azimuth_degrees: segment.azimuthDegrees ?? null,
      area_m2: segment?.stats?.areaMeters2 ?? null,
      ground_area_m2: segment?.stats?.groundAreaMeters2 ?? null,
      plane_height_at_center_meters: segment.planeHeightAtCenterMeters ?? null,
      center: segment.center
        ? { lat: segment.center.latitude, lng: segment.center.longitude }
        : null,
      bounding_box:
        segment?.boundingBox?.sw && segment?.boundingBox?.ne
          ? {
              sw: { lat: segment.boundingBox.sw.latitude, lng: segment.boundingBox.sw.longitude },
              ne: { lat: segment.boundingBox.ne.latitude, lng: segment.boundingBox.ne.longitude },
            }
          : null,
    })
  )

  const attempt = await tryFacetPayloadsFromSolarRoofMask({
    lat: loc.lat,
    lng: loc.lng,
    apiKey,
    referenceLat: loc.lat,
    referenceLng: loc.lng,
    segments,
    querySource: 'render_diagnose',
  })
  if (!attempt.facets?.length) throw new Error(`No facets: ${attempt.reason}`)

  const rgbOverlay = await fetchSolarRgbOverlayPayload(loc.lat, loc.lng, apiKey)
  const rgbImage = sharp(Buffer.from(rgbOverlay.imageBase64, 'base64')).removeAlpha()
  const rgbInfo = await rgbImage.metadata()
  const rgbWidth = rgbInfo.width ?? rgbOverlay.width
  const rgbHeight = rgbInfo.height ?? rgbOverlay.height
  const rgbRaw = await rgbImage.raw().toBuffer()
  const sampleCenterRgb = (center: SolarMaskSegment['center']) => {
    if (!center) return null
    const cx = Math.round(((center.lng - rgbOverlay.bounds.west) / (rgbOverlay.bounds.east - rgbOverlay.bounds.west)) * (rgbWidth - 1))
    const cy = Math.round(((rgbOverlay.bounds.north - center.lat) / (rgbOverlay.bounds.north - rgbOverlay.bounds.south)) * (rgbHeight - 1))
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= rgbWidth || y >= rgbHeight) continue
        const offset = (y * rgbWidth + x) * 3
        r += rgbRaw[offset]
        g += rgbRaw[offset + 1]
        b += rgbRaw[offset + 2]
        count++
      }
    }
    return count > 0 ? [r, g, b].map((value) => Math.round(value / count)) : null
  }

  const zoom = 21
  const width = 1280
  const height = 1280
  const satellite = Buffer.from(
    await fetchStaticSatelliteMapBase64({ lat: loc.lat, lng: loc.lng, zoom, sizeW: 640, sizeH: 640 }),
    'base64'
  )
  // Static Maps scale=2 doubles bitmap density, not geographic coverage.
  const bounds = staticMapImageBounds(loc.lat, loc.lng, zoom, width / 2, height / 2)
  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']
  const toPixel = (point: { lat: number; lng: number }) => ({
    x: ((point.lng - bounds.west) / (bounds.east - bounds.west)) * width,
    y: ((bounds.north - point.lat) / (bounds.north - bounds.south)) * height,
  })
  const segmentGuides = segments
    .map((segment) => {
      if (!segment.bounding_box || !segment.center) return ''
      const sw = toPixel(segment.bounding_box.sw)
      const ne = toPixel(segment.bounding_box.ne)
      const center = toPixel(segment.center)
      return `<rect x="${sw.x.toFixed(1)}" y="${ne.y.toFixed(1)}" width="${(ne.x - sw.x).toFixed(1)}" height="${(sw.y - ne.y).toFixed(1)}" fill="none" stroke="#FDE047" stroke-width="2" stroke-dasharray="8 6"/><circle cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" r="5" fill="#FDE047"/><text x="${(center.x + 7).toFixed(1)}" y="${(center.y - 7).toFixed(1)}" fill="#FDE047" font-size="22">${segment.segment_index}</text>`
    })
    .join('')
  const polygons = attempt.facets
    .map((facet, index) => {
      const points = facet.lat_lng_vertices
        .map((point) => {
          const { x, y } = toPixel(point)
          return `${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' ')
      return `<polygon points="${points}" fill="${colors[index % colors.length]}" fill-opacity="0.42" stroke="white" stroke-width="5"/>`
    })
    .join('')
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${segmentGuides}${polygons}</svg>`)
  const threshold = process.env.ROOF_MEASURE_DSM_MAX_PLANE_ERROR_M ?? 'default'
  const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  const output = `/private/tmp/roof-${slug}-${threshold}.png`
  writeFileSync(output, await sharp(satellite).composite([{ input: svg }]).png().toBuffer())
  console.log(JSON.stringify({
    output,
    reason: attempt.reason,
    details: attempt.details,
    areas: attempt.facets.map((f) => f.estimated_sq_ft),
    segment_ground_areas_sqft: segments.map((segment) => Math.round((segment.ground_area_m2 ?? 0) * 10.7639)),
    segment_sloped_areas_sqft: segments.map((segment) => Math.round((segment.area_m2 ?? 0) * 10.7639)),
    segment_pitch_degrees: segments.map((segment) => segment.pitch_degrees),
    segment_azimuth_degrees: segments.map((segment) => segment.azimuth_degrees),
    segment_center_heights_m: segments.map((segment) => segment.plane_height_at_center_meters),
    rgb_source: rgbOverlay.source,
    segment_center_rgb: segments.map((segment) => sampleCenterRgb(segment.center)),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
