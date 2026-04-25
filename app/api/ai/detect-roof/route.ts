import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireAuthApi } from '@/lib/auth'

type PixelPoint = [number, number]

type RawFacet = {
  id: string
  vertices: PixelPoint[]
  confidence: number
  estimated_sq_ft?: number
}

type RawLine = {
  id: string
  points: PixelPoint[]
  confidence: number
}

type RawDetection = {
  facets: RawFacet[]
  ridges: RawLine[]
  valleys: RawLine[]
  step_flashing: RawLine[]
  wall_flashing: RawLine[]
  notes: string
}

type RawLocalization = {
  x1: number
  y1: number
  x2: number
  y2: number
  confidence: number
  notes?: string
}

type SolarRoofSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  area_m2: number | null
  ground_area_m2: number | null
  center: { lat: number; lng: number } | null
  bounding_box: {
    sw: { lat: number; lng: number }
    ne: { lat: number; lng: number }
  } | null
}

type SolarContext = {
  anchor: { lat: number; lng: number } | null
  segments: SolarRoofSegment[]
}

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function latLngToWorldPixel(lat: number, lng: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom)
  const sinLat = clamp(Math.sin((lat * Math.PI) / 180), -0.9999, 0.9999)
  const x = ((lng + 180) / 360) * scale
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  return { x, y }
}

function worldPixelToLatLng(x: number, y: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom)
  const lng = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

function pixelToLatLng(
  px: number,
  py: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
) {
  const centerWorld = latLngToWorldPixel(centerLat, centerLng, zoom)
  const worldX = centerWorld.x + (px - imageWidth / 2)
  const worldY = centerWorld.y + (py - imageHeight / 2)
  return worldPixelToLatLng(worldX, worldY, zoom)
}

type MapBounds = { north: number; south: number; east: number; west: number }

function expandBounds(b: MapBounds, padFraction: number): MapBounds {
  const latPad = (b.north - b.south) * padFraction
  const lngPad = (b.east - b.west) * padFraction
  return {
    north: Math.min(90, b.north + latPad),
    south: Math.max(-90, b.south - latPad),
    east: b.east + lngPad,
    west: b.west - lngPad,
  }
}

function centroidInExpandedBounds(
  lat: number,
  lng: number,
  b: MapBounds,
  padFraction: number
): boolean {
  const e = expandBounds(b, padFraction)
  return lat <= e.north && lat >= e.south && lng <= e.east && lng >= e.west
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith('data:image/')) return imageBase64
  return `data:image/png;base64,${imageBase64}`
}

function extractLatLng(value: any): { lat: number; lng: number } | null {
  if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') return null
  return { lat: value.latitude, lng: value.longitude }
}

function distanceBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const latDiff = a.lat - b.lat
  const lngDiff = a.lng - b.lng
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusMeters = 6371000
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

async function fetchStaticMapBase64(
  lat: number,
  lng: number,
  zoom: number,
  sizeW = 640,
  sizeH = 640
): Promise<string> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) {
    throw new Error('Google Maps API key missing on server')
  }

  const normalizedZoom = Math.round(zoom)
  const w = Math.max(100, Math.min(640, Math.round(sizeW)))
  const h = Math.max(100, Math.min(640, Math.round(sizeH)))

  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=${normalizedZoom}&size=${w}x${h}&scale=2&maptype=satellite&key=${mapsKey}`

  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Static map fetch failed (${response.status}): ${text || 'unknown error'}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/')) {
    const text = await response.text().catch(() => '')
    throw new Error(`Static map returned text response: ${text || 'unknown error'}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return buffer.toString('base64')
}

function getSolarAnchor(segments: SolarRoofSegment[]): { lat: number; lng: number } | null {
  const centers = segments
    .map((segment) => segment.center)
    .filter((center): center is { lat: number; lng: number } => Boolean(center))

  if (centers.length === 0) return null

  return centers.reduce(
    (acc, center) => ({
      lat: acc.lat + center.lat / centers.length,
      lng: acc.lng + center.lng / centers.length,
    }),
    { lat: 0, lng: 0 }
  )
}

async function fetchGoogleSolarContext(lat: number, lng: number): Promise<SolarContext> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) return { anchor: null, segments: [] }

  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${mapsKey}`

  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn(
      '[detect-roof] Google Solar buildingInsights failed:',
      response.status,
      detail?.slice(0, 200) || ''
    )
    return { anchor: null, segments: [] }
  }

  const data = await response.json().catch(() => null)
  const buildingCenter = extractLatLng(data?.center)
  const roofSegments = Array.isArray(data?.solarPotential?.roofSegmentStats)
    ? data.solarPotential.roofSegmentStats
    : []

  const segments = roofSegments.map((segment: any, index: number) => ({
    segment_index: index,
    pitch_degrees: typeof segment.pitchDegrees === 'number' ? segment.pitchDegrees : null,
    azimuth_degrees: typeof segment.azimuthDegrees === 'number' ? segment.azimuthDegrees : null,
    area_m2: typeof segment?.stats?.areaMeters2 === 'number' ? segment.stats.areaMeters2 : null,
    ground_area_m2: typeof segment?.stats?.groundAreaMeters2 === 'number' ? segment.stats.groundAreaMeters2 : null,
    center: extractLatLng(segment.center),
    bounding_box:
      segment?.boundingBox?.sw &&
      segment?.boundingBox?.ne &&
      extractLatLng(segment.boundingBox.sw) &&
      extractLatLng(segment.boundingBox.ne)
        ? {
            sw: extractLatLng(segment.boundingBox.sw) as { lat: number; lng: number },
            ne: extractLatLng(segment.boundingBox.ne) as { lat: number; lng: number },
          }
        : null,
  }))

  return {
    anchor: buildingCenter || getSolarAnchor(segments),
    segments,
  }
}

function buildSolarPrompt(segments: SolarRoofSegment[]): string {
  if (segments.length === 0) {
    return 'No Google Solar roof-segment data available. Infer polygons only from the visible roof edges in the image.'
  }

  const simplified = segments.slice(0, 20).map((segment) => ({
    segment_index: segment.segment_index,
    pitch_degrees: segment.pitch_degrees,
    azimuth_degrees: segment.azimuth_degrees,
    area_m2: segment.area_m2,
    ground_area_m2: segment.ground_area_m2,
    center: segment.center,
    bounding_box: segment.bounding_box,
  }))

  return `Google Solar roof segment metadata is available.
Use Solar only as a secondary hint for pitch/orientation and rough segment count.
Do NOT place polygons from Solar centers or bounding boxes alone.
Polygon coordinates must follow the visible roof edges in the satellite image first.
If Solar and imagery disagree, trust the visible roof edges.
Solar segments:
${JSON.stringify(simplified)}`
}

async function callDetectionModel(
  imageBase64: string,
  solarSegments: SolarRoofSegment[],
  imagePixelDesc: string,
  targetingNote: string
): Promise<RawDetection> {
  const systemPrompt = `You are a roofing measurement AI.
Analyze a satellite image and identify:
- roof facets (polygons)
- ridges (lines)
- valleys (lines)
- flashing where visible

Return ONLY JSON:
{
  "facets": [
    {
      "id": "facet_1",
      "vertices": [[x,y],[x,y],[x,y],[x,y]],
      "confidence": 0.92,
      "estimated_sq_ft": 310
    }
  ],
  "ridges": [{ "id": "r1", "points": [[x,y],[x,y]], "confidence": 0.9 }],
  "valleys": [{ "id": "v1", "points": [[x,y],[x,y]], "confidence": 0.85 }],
  "step_flashing": [],
  "wall_flashing": [],
  "notes": ""
}

Rules:
- The image is high-DPI satellite (logical size given in the user message). x is 0..width-1, y is 0..height-1, (0,0) top-left.
- Draw roof facets only over actual shingle/metal roof surfaces you can see. Do not output placeholder grids, squares on lawns, or “default” shapes in empty areas.
- Trace only real roof planes and edges visible in the image; do not invent roofs over trees, driveways, or lawns.
- Focus on the main residence roof(s); ignore wooded areas unless a roof is clearly visible there.
- Include low confidence items (<0.65) only when you still see a plausible roof edge.`

  const dataUrl = toDataUrl(imageBase64)
  const openai = getOpenAI()

  const attempt = async (retry = false) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: retry
                ? `Return strictly valid JSON only. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${buildSolarPrompt(solarSegments)}`
                : `Analyze this roof satellite image. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${buildSolarPrompt(solarSegments)}`,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 1800,
    })

    const content = completion.choices?.[0]?.message?.content || ''
    const parsed = safeJsonParse<RawDetection>(content)
    if (!parsed) throw new Error('Invalid JSON from model')
    return parsed
  }

  try {
    return await attempt(false)
  } catch {
    return await attempt(true)
  }
}

async function callLocalizationModel(
  imageBase64: string,
  solarSegments: SolarRoofSegment[],
  imagePixelDesc: string,
  targetingNote: string
): Promise<RawLocalization | null> {
  const systemPrompt = `You are a roofing measurement AI.
Find the single target residential structure in a satellite image before roof measurement begins.

Return ONLY JSON:
{
  "x1": 100,
  "y1": 120,
  "x2": 340,
  "y2": 360,
  "confidence": 0.93,
  "notes": ""
}

Rules:
- Return one bounding box for the full target house roof footprint only.
- The target should be the main residential structure nearest the image center unless the user guidance says it is centered already.
- Ignore roads, lawns, trees, detached sheds, neighboring homes, and commercial buildings.
- Coordinates are pixels in the image.`

  const dataUrl = toDataUrl(imageBase64)
  const openai = getOpenAI()

  const attempt = async (retry = false) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: retry
                ? `Return strictly valid JSON only. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${buildSolarPrompt(solarSegments)}`
                : `Find the target house in this satellite image. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${buildSolarPrompt(solarSegments)}`,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 400,
    })

    const content = completion.choices?.[0]?.message?.content || ''
    return safeJsonParse<RawLocalization>(content)
  }

  try {
    return await attempt(false)
  } catch {
    return await attempt(true)
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthApi()

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const { imageBase64, lat, lng, zoom, opportunityId, mapBounds, mapWidthPx, mapHeightPx } = body as {
      imageBase64?: string
      lat?: number
      lng?: number
      zoom?: number
      opportunityId?: string
      mapBounds?: { north: number; south: number; east: number; west: number }
      mapWidthPx?: number
      mapHeightPx?: number
    }

    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof zoom !== 'number') {
      return NextResponse.json({ error: 'lat, lng, zoom required' }, { status: 400 })
    }
    if (typeof opportunityId !== 'string') {
      return NextResponse.json({ error: 'opportunityId required' }, { status: 400 })
    }

    const normalizedZoom = Math.round(zoom)

    const requestedCenter = { lat, lng }
    const solarContext = await fetchGoogleSolarContext(lat, lng)
    const validBounds =
      mapBounds &&
      typeof mapBounds.north === 'number' &&
      typeof mapBounds.south === 'number' &&
      typeof mapBounds.east === 'number' &&
      typeof mapBounds.west === 'number' &&
      mapBounds.north > mapBounds.south
        ? (mapBounds as MapBounds)
        : null

    const solarAnchorDistance =
      solarContext.anchor ? distanceMeters(requestedCenter, solarContext.anchor) : null
    const shouldUseSolarAnchor =
      Boolean(
        solarContext.anchor &&
          solarAnchorDistance !== null &&
          solarAnchorDistance <= 120 &&
          (!validBounds || centroidInExpandedBounds(solarContext.anchor.lat, solarContext.anchor.lng, validBounds, 0.1))
      )

    const captureCenter = shouldUseSolarAnchor && solarContext.anchor ? solarContext.anchor : requestedCenter
    const detectionZoom = shouldUseSolarAnchor
      ? Math.min(22, Math.max(21, normalizedZoom + 1))
      : Math.min(22, Math.max(20, normalizedZoom))

    const solarSegments = solarContext.segments
    const logicalImageSize = 640
    const imageWidth = logicalImageSize * 2
    const imageHeight = logicalImageSize * 2
    const imagePixelDesc = `${imageWidth}×${imageHeight} (x: 0–${imageWidth - 1}, y: 0–${imageHeight - 1})`
    const localizationNote = shouldUseSolarAnchor
      ? 'The target house should already be close to the image center. Prefer the centered residence and ignore neighboring structures.'
      : 'Choose the main residence nearest the image center and ignore neighboring structures.'

    const localizationImageBase64 =
      typeof imageBase64 === 'string' && imageBase64.trim().length > 0
        ? imageBase64
        : await fetchStaticMapBase64(
            captureCenter.lat,
            captureCenter.lng,
            detectionZoom,
            logicalImageSize,
            logicalImageSize
          )

    const localization = await callLocalizationModel(
      localizationImageBase64,
      solarSegments,
      imagePixelDesc,
      localizationNote
    )

    let localizedCenter = captureCenter
    let finalZoom = detectionZoom

    if (
      localization &&
      [localization.x1, localization.y1, localization.x2, localization.y2].every((value) => typeof value === 'number')
    ) {
      const x1 = clamp(Math.min(localization.x1, localization.x2), 0, imageWidth)
      const y1 = clamp(Math.min(localization.y1, localization.y2), 0, imageHeight)
      const x2 = clamp(Math.max(localization.x1, localization.x2), 0, imageWidth)
      const y2 = clamp(Math.max(localization.y1, localization.y2), 0, imageHeight)
      const localizedPixelCenterX = (x1 + x2) / 2
      const localizedPixelCenterY = (y1 + y2) / 2
      const localizedWidth = Math.max(1, x2 - x1)
      const localizedHeight = Math.max(1, y2 - y1)

      localizedCenter = pixelToLatLng(
        localizedPixelCenterX,
        localizedPixelCenterY,
        captureCenter.lat,
        captureCenter.lng,
        detectionZoom,
        imageWidth,
        imageHeight
      )

      const structureFillRatio = Math.max(localizedWidth, localizedHeight) / Math.min(imageWidth, imageHeight)
      if (structureFillRatio < 0.42) {
        finalZoom = Math.min(22, detectionZoom + 1)
      } else if (structureFillRatio > 0.8) {
        finalZoom = Math.max(20, detectionZoom - 1)
      }
    }

    const targetingNote =
      'The target house roof should be centered in this image. Trace only the centered residence roof and ignore neighboring roofs, roads, trees, and detached structures.'
    const detectionImageBase64 =
      typeof imageBase64 === 'string' && imageBase64.trim().length > 0
        ? localizationImageBase64
        : await fetchStaticMapBase64(
            localizedCenter.lat,
            localizedCenter.lng,
            finalZoom,
            logicalImageSize,
            logicalImageSize
          )
    const raw = await callDetectionModel(detectionImageBase64, solarSegments, imagePixelDesc, targetingNote)

    const imageCenterX = imageWidth / 2
    const imageCenterY = imageHeight / 2
    const centerRadiusPx = Math.min(imageWidth, imageHeight) * 0.32
    const isNearImageCenter = (points: PixelPoint[]) => {
      if (!points.length) return false
      const centroid = points.reduce(
        (acc, [x, y]) => ({ x: acc.x + Number(x) / points.length, y: acc.y + Number(y) / points.length }),
        { x: 0, y: 0 }
      )
      const dx = centroid.x - imageCenterX
      const dy = centroid.y - imageCenterY
      return Math.sqrt(dx * dx + dy * dy) <= centerRadiusPx
    }

    const facets = (raw.facets || [])
      .filter((facet) => isNearImageCenter(Array.isArray(facet.vertices) ? facet.vertices : []))
      .map((facet, idx) => {
      const vertices = Array.isArray(facet.vertices) ? facet.vertices : []
      const latLngVertices = vertices.map(([x, y]) =>
        pixelToLatLng(
          Number(x),
          Number(y),
          localizedCenter.lat,
          localizedCenter.lng,
          finalZoom,
          imageWidth,
          imageHeight
        )
      )
      const center =
        latLngVertices.length > 0
          ? latLngVertices.reduce(
              (acc, point) => ({
                lat: acc.lat + point.lat / latLngVertices.length,
                lng: acc.lng + point.lng / latLngVertices.length,
              }),
              { lat: 0, lng: 0 }
            )
          : null
      const nearestSolarSegment =
        center && solarSegments.length > 0
          ? solarSegments.reduce<SolarRoofSegment | null>((best, segment) => {
              if (!segment.center) return best
              if (!best || !best.center) return segment
              return distanceBetween(center, segment.center) < distanceBetween(center, best.center) ? segment : best
            }, null)
          : null

      return {
        id: facet.id || `facet_${idx + 1}`,
        vertices,
        lat_lng_vertices: latLngVertices,
        confidence: Number(facet.confidence) || 0,
        estimated_sq_ft: typeof facet.estimated_sq_ft === 'number' ? facet.estimated_sq_ft : null,
        solar_segment_index: nearestSolarSegment?.segment_index ?? null,
        suggested_pitch_degrees: nearestSolarSegment?.pitch_degrees ?? null,
        suggested_azimuth_degrees: nearestSolarSegment?.azimuth_degrees ?? null,
        suggested_ground_area_sqft:
          typeof nearestSolarSegment?.ground_area_m2 === 'number'
            ? nearestSolarSegment.ground_area_m2 * 10.7639
            : null,
      }
    })

    const facetsFiltered = validBounds
      ? facets.filter((facet) => {
          const vs = facet.lat_lng_vertices
          if (!vs || vs.length === 0) return false
          const cLat = vs.reduce((s, p) => s + p.lat, 0) / vs.length
          const cLng = vs.reduce((s, p) => s + p.lng, 0) / vs.length
          return centroidInExpandedBounds(cLat, cLng, validBounds, 0.12)
        })
      : facets

    const normalizeLineGroup = (lines: RawLine[] | undefined, prefix: string) =>
      (lines || [])
        .filter((line) => isNearImageCenter(Array.isArray(line.points) ? line.points : []))
        .map((line, idx) => {
        const points = Array.isArray(line.points) ? line.points : []
        const latLngPoints = points.map(([x, y]) =>
          pixelToLatLng(
            Number(x),
            Number(y),
            localizedCenter.lat,
            localizedCenter.lng,
            finalZoom,
            imageWidth,
            imageHeight
          )
        )
        return {
          id: line.id || `${prefix}_${idx + 1}`,
          points,
          lat_lng_points: latLngPoints,
          confidence: Number(line.confidence) || 0,
        }
      })

    const lineInBounds = (latLngs: { lat: number; lng: number }[]) => {
      if (!validBounds || latLngs.length === 0) return true
      const cLat = latLngs.reduce((s, p) => s + p.lat, 0) / latLngs.length
      const cLng = latLngs.reduce((s, p) => s + p.lng, 0) / latLngs.length
      return centroidInExpandedBounds(cLat, cLng, validBounds, 0.12)
    }

    const filterLines = (lines: ReturnType<typeof normalizeLineGroup>) =>
      validBounds ? lines.filter((line) => lineInBounds(line.lat_lng_points)) : lines

    const ridges = filterLines(normalizeLineGroup(raw.ridges, 'ridge'))
    const valleys = filterLines(normalizeLineGroup(raw.valleys, 'valley'))
    const stepFlashing = filterLines(normalizeLineGroup(raw.step_flashing, 'step_flash'))
    const wallFlashing = filterLines(normalizeLineGroup(raw.wall_flashing, 'wall_flash'))

    return NextResponse.json({
      facets: facetsFiltered,
      ridges,
      valleys,
      step_flashing: stepFlashing,
      wall_flashing: wallFlashing,
      notes: raw.notes || '',
      solar_segments: solarSegments,
      requested_center: requestedCenter,
      capture_center: localizedCenter,
      capture_center_source: shouldUseSolarAnchor ? 'solar_anchor' : 'requested_center',
      detection_zoom: finalZoom,
      localization,
      static_map_size: { width: imageWidth, height: imageHeight, logical: `${logicalImageSize}x${logicalImageSize}` },
    })
  } catch (error) {
    console.error('AI roof detect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to detect roof'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
