import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const M2_TO_SQFT = 10.7639
/** Google's building must sit this close to the drawn roof, or it's a different building. */
const MAX_BUILDING_OFFSET_M = 40

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111_320
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

/**
 * GET /api/measurements/solar-footprint?lat=&lng=
 *
 * Google Solar's ground footprint (sum of roof-segment ground areas) for the building
 * at a point — the reference the roof-measure tool compares a drawn roof against to
 * catch an unmeasured section. One buildingInsights call; returns sqft null when
 * Google has no building there or picks one too far from the point.
 */
export async function GET(request: Request) {
  try {
    await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const lat = Number(url.searchParams.get('lat'))
  const lng = Number(url.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_SOLAR_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  if (!apiKey) return NextResponse.json({ ground_sqft: null, reason: 'not_configured' })

  const params = new URLSearchParams({
    'location.latitude': lat.toFixed(6),
    'location.longitude': lng.toFixed(6),
    // Best available quality; BASE is the floor, not a cap.
    requiredQuality: 'BASE',
    key: apiKey,
  })
  const res = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?${params}`)
  if (!res.ok) return NextResponse.json({ ground_sqft: null, reason: `solar_${res.status}` })

  const data = await res.json().catch(() => null)
  const center = data?.center
  if (
    typeof center?.latitude !== 'number' ||
    typeof center?.longitude !== 'number' ||
    distanceM(lat, lng, center.latitude, center.longitude) > MAX_BUILDING_OFFSET_M
  ) {
    return NextResponse.json({ ground_sqft: null, reason: 'no_building_here' })
  }

  const segments: { stats?: { groundAreaMeters2?: number } }[] = Array.isArray(data?.solarPotential?.roofSegmentStats)
    ? data.solarPotential.roofSegmentStats
    : []
  const groundM2 = segments.reduce((sum, s) => sum + (Number(s?.stats?.groundAreaMeters2) || 0), 0)

  return NextResponse.json({
    ground_sqft: groundM2 > 0 ? Math.round(groundM2 * M2_TO_SQFT) : null,
    imagery_quality: typeof data?.imageryQuality === 'string' ? data.imageryQuality : null,
  })
}
