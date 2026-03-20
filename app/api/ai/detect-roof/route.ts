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

async function fetchStaticMapBase64(lat: number, lng: number, zoom: number): Promise<string> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) {
    throw new Error('Google Maps API key missing on server')
  }

  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=${zoom}&size=640x640&maptype=satellite&key=${mapsKey}`

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

async function callDetectionModel(imageBase64: string): Promise<RawDetection> {
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
            { type: 'text', text: retry ? 'Return strictly valid JSON only.' : 'Analyze this roof image.' },
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

    const resolvedImageBase64 =
      typeof imageBase64 === 'string' && imageBase64.trim().length > 0
        ? imageBase64
        : await fetchStaticMapBase64(lat, lng, zoom)

    const raw = await callDetectionModel(resolvedImageBase64)

    const imageWidth = 640
    const imageHeight = 640

    const facets = (raw.facets || []).map((facet, idx) => {
      const vertices = Array.isArray(facet.vertices) ? facet.vertices : []
      const latLngVertices = vertices.map(([x, y]) =>
        pixelToLatLng(Number(x), Number(y), lat, lng, zoom, imageWidth, imageHeight)
      )
      return {
        id: facet.id || `facet_${idx + 1}`,
        vertices,
        lat_lng_vertices: latLngVertices,
        confidence: Number(facet.confidence) || 0,
        estimated_sq_ft: typeof facet.estimated_sq_ft === 'number' ? facet.estimated_sq_ft : null,
      }
    })

    const normalizeLineGroup = (lines: RawLine[] | undefined, prefix: string) =>
      (lines || []).map((line, idx) => {
        const points = Array.isArray(line.points) ? line.points : []
        const latLngPoints = points.map(([x, y]) =>
          pixelToLatLng(Number(x), Number(y), lat, lng, zoom, imageWidth, imageHeight)
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
    })
  } catch (error) {
    console.error('AI roof detect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to detect roof'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
