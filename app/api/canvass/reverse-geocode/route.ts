import { requireAuthApi } from '@/lib/auth'
import {
  parseReverseGeocodeQuery,
  reverseGeocodeLatLng,
  type ReverseGeocodeResult,
} from '@/lib/canvass-reverse-geocode'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Body = { lat?: unknown; lng?: unknown }

function bodyCoords(body: Body): { lat: number; lng: number } | null {
  const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat)
  const lng = typeof body.lng === 'number' ? body.lng : Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function jsonFromResult(result: ReverseGeocodeResult, status: number) {
  if (result.ok) {
    return NextResponse.json({ ok: true, address: result.address }, { status })
  }
  return NextResponse.json({ ok: false, reason: result.reason }, { status })
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const coords = parseReverseGeocodeQuery(request.nextUrl.searchParams)
  if (!coords) {
    return NextResponse.json({ ok: false, reason: 'invalid_coordinates' }, { status: 400 })
  }

  const result = await reverseGeocodeLatLng(coords.lat, coords.lng)
  if (!result.ok && result.reason === 'invalid_coordinates') {
    return NextResponse.json(result, { status: 400 })
  }
  if (!result.ok) {
    return jsonFromResult(result, 502)
  }
  return jsonFromResult(result, 200)
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_coordinates' }, { status: 400 })
  }

  const coords = bodyCoords(body)
  if (!coords) {
    return NextResponse.json({ ok: false, reason: 'invalid_coordinates' }, { status: 400 })
  }

  const result = await reverseGeocodeLatLng(coords.lat, coords.lng)
  if (!result.ok) {
    return jsonFromResult(result, result.reason === 'invalid_coordinates' ? 400 : 502)
  }
  return jsonFromResult(result, 200)
}
