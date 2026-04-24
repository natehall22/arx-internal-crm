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

async function fetchStaticMapBase64(lat: number, lng: number, zoom: number): Promise<string> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) {
    throw new Error('Google Maps API key missing on server')
  }

  const normalizedZoom = Math.round(zoom)

  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=${normalizedZoom}&size=640x640&maptype=satellite&key=${mapsKey}`

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

async function fetchGoogleSolarSegments(lat: number, lng: number): Promise<SolarRoofSegment[]> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) return []

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
    return []
  }

  const data = await response.json().catch(() => null)
  const roofSegments = Array.isArray(data?.solarPotential?.roofSegmentStats)
    ? data.solarPotential.roofSegmentStats
    : []

  return roofSegments.map((segment: any, index: number) => ({
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
}

function buildSolarPrompt(segments: SolarRoofSegment[]): string {
  if (segments.length === 0) return 'No Google Solar roof-segment data available.'

  const simplified = segments.slice(0, 20).map((segment) => ({
    segment_index: segment.segment_index,
    pitch_degrees: segment.pitch_degrees,
    azimuth_degrees: segment.azimuth_degrees,
    area_m2: segment.area_m2,
    ground_area_m2: segment.ground_area_m2,
    center: segment.center,
    bounding_box: segment.bounding_box,
  }))

  return `Google Solar roof segment metadata is available. Use it as a geometry prior and consistency check, but still infer polygon edges from imagery.
Prioritize:
- similar segment count when imagery supports it
- pitch/orientation consistency with Solar segments
- roof planes that align with Solar segment centers/bounds
Solar segments:
${JSON.stringify(simplified)}`
}

async function callDetectionModel(imageBase64: string, solarSegments: SolarRoofSegment[]): Promise<RawDetection> {
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
- Coordinates are pixels (0,0 top-left)
- Focus on primary structure only
- Include low confidence items (<0.65)`

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
                ? `Return strictly valid JSON only.\n\n${buildSolarPrompt(solarSegments)}`
                : `Analyze this roof image.\n\n${buildSolarPrompt(solarSegments)}`,
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

export async function POST(request: Request) {
  try {
    await requireAuthApi()

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const { imageBase64, lat, lng, zoom, opportunityId } = body as {
      imageBase64?: string
      lat?: number
      lng?: number
      zoom?: number
      opportunityId?: string
    }

    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof zoom !== 'number') {
      return NextResponse.json({ error: 'lat, lng, zoom required' }, { status: 400 })
    }
    if (typeof opportunityId !== 'string') {
      return NextResponse.json({ error: 'opportunityId required' }, { status: 400 })
    }

    const normalizedZoom = Math.round(zoom)

    const resolvedImageBase64 =
      typeof imageBase64 === 'string' && imageBase64.trim().length > 0
        ? imageBase64
        : await fetchStaticMapBase64(lat, lng, normalizedZoom)

    const solarSegments = await fetchGoogleSolarSegments(lat, lng)
    const raw = await callDetectionModel(resolvedImageBase64, solarSegments)

    const imageWidth = 640
    const imageHeight = 640

    const facets = (raw.facets || []).map((facet, idx) => {
      const vertices = Array.isArray(facet.vertices) ? facet.vertices : []
      const latLngVertices = vertices.map(([x, y]) =>
        pixelToLatLng(Number(x), Number(y), lat, lng, normalizedZoom, imageWidth, imageHeight)
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

    const normalizeLineGroup = (lines: RawLine[] | undefined, prefix: string) =>
      (lines || []).map((line, idx) => {
        const points = Array.isArray(line.points) ? line.points : []
        const latLngPoints = points.map(([x, y]) =>
          pixelToLatLng(Number(x), Number(y), lat, lng, normalizedZoom, imageWidth, imageHeight)
        )
        return {
          id: line.id || `${prefix}_${idx + 1}`,
          points,
          lat_lng_points: latLngPoints,
          confidence: Number(line.confidence) || 0,
        }
      })

    return NextResponse.json({
      facets,
      ridges: normalizeLineGroup(raw.ridges, 'ridge'),
      valleys: normalizeLineGroup(raw.valleys, 'valley'),
      step_flashing: normalizeLineGroup(raw.step_flashing, 'step_flash'),
      wall_flashing: normalizeLineGroup(raw.wall_flashing, 'wall_flash'),
      notes: raw.notes || '',
      solar_segments: solarSegments,
    })
  } catch (error) {
    console.error('AI roof detect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to detect roof'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
