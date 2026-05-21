/**
 * /api/admin/roofradar/storm-lookup
 *
 * On-demand storm history for a single address or coordinate.
 * Used by the RoofRadar property detail modal "Full Storm History" button.
 *
 * POST { address: string }             — geocodes via US Census then queries SPC
 * POST { lat: number, lng: number }    — skips geocode, queries SPC directly
 *
 * Data sources (all free, no API key):
 *   - NOAA/SPC Storm Reports: https://www.spc.noaa.gov/wcm/data/{year}_{hail|wind}.csv
 *   - US Census Geocoder:     https://geocoding.geo.census.gov/geocoder/
 *
 * Future paid enrichment to wire here:
 *   - Tomorrow.io Historical: https://api.tomorrow.io/v4/historical (storm intelligence, $0 free tier)
 *   - CoreLogic Hazard HQ:    https://developer.corelogic.com  (insurance-grade hail/wind, enterprise)
 *   - WeatherAPI.com:         https://www.weatherapi.com/docs  ($0 for 1M calls/mo, history endpoint)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { RoofRadarStormEvent } from '@/lib/roofradar'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ADMIN_TOOL_ROLES = new Set([
  'admin', 'owner', 'regional_manager', 'regional_setter_manager',
  'sales_manager', 'setter_manager', 'manager', 'operations',
])

const DAY_MS = 86_400_000
const DEFAULT_RADIUS_MILES = 8
const CACHE_MS = 30 * 60 * 1000

type SpcRow = { type: 'hail' | 'wind'; date: Date; magnitude: number; lat: number; lng: number }
const spcCache = new Map<string, { expiresAt: number; rows: SpcRow[] }>()
const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

function toNum(v: unknown, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseSpcCsv(csv: string, type: 'hail' | 'wind'): SpcRow[] {
  const lines = csv.split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const rows: SpcRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cells.length < headers.length) continue
    const row = Object.fromEntries(headers.map((h, idx) => [h, cells[idx] || '']))
    const yr = toNum(row.yr || row.year)
    const mo = toNum(row.mo || row.month)
    const dy = toNum(row.dy || row.day)
    if (!yr || !mo || !dy) continue
    const date = new Date(Date.UTC(yr, mo - 1, dy))
    if (isNaN(date.getTime())) continue
    const lat = toNum(row.slat || row.lat)
    const lng = toNum(row.slon || row.lon)
    if (!lat || !lng) continue
    rows.push({ type, date, magnitude: toNum(row.mag || row.magnitude), lat, lng })
  }
  return rows
}

async function fetchSpcYear(year: number, type: 'hail' | 'wind'): Promise<SpcRow[]> {
  const key = `${year}-${type}`
  const hit = spcCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.rows
  try {
    const res = await fetch(`https://www.spc.noaa.gov/wcm/data/${year}_${type}.csv`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) { spcCache.set(key, { expiresAt: Date.now() + CACHE_MS, rows: [] }); return [] }
    const rows = parseSpcCsv(await res.text(), type)
    spcCache.set(key, { expiresAt: Date.now() + CACHE_MS, rows })
    return rows
  } catch {
    return []
  }
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const cacheKey = address.toLowerCase().trim()
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) ?? null
  try {
    const params = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' })
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,
      { cache: 'no-store', signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) { geocodeCache.set(cacheKey, null); return null }
    const data = await res.json().catch(() => null)
    const coords = data?.result?.addressMatches?.[0]?.coordinates
    const result =
      coords && Number.isFinite(Number(coords.y)) && Number.isFinite(Number(coords.x))
        ? { lat: Number(coords.y), lng: Number(coords.x) }
        : null
    geocodeCache.set(cacheKey, result)
    return result
  } catch {
    geocodeCache.set(cacheKey, null)
    return null
  }
}

export async function POST(request: NextRequest) {
  // Auth
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile?.role || !ADMIN_TOOL_ROLES.has(profile.role))
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  // Parse body
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const bodyLat = toNum(body.lat, NaN)
  const bodyLng = toNum(body.lng, NaN)
  const radiusMiles = toNum(body.radiusMiles, DEFAULT_RADIUS_MILES)

  // Resolve coordinates
  let coords: { lat: number; lng: number } | null = null
  let geocodedAddress: string | null = null

  if (Number.isFinite(bodyLat) && Number.isFinite(bodyLng)) {
    coords = { lat: bodyLat, lng: bodyLng }
  } else if (address) {
    coords = await geocodeAddress(address)
    geocodedAddress = address
  }

  if (!coords) {
    return NextResponse.json({ error: 'Could not resolve coordinates for this address' }, { status: 422 })
  }

  // Fetch SPC data — current year + 4 previous
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)
  const allRows = (
    await Promise.all(
      years.flatMap((yr) => [
        fetchSpcYear(yr, 'hail').catch(() => []),
        fetchSpcYear(yr, 'wind').catch(() => []),
      ])
    )
  ).flat()

  // Filter to radius
  const nearby = allRows
    .filter((r) => haversine(coords!.lat, coords!.lng, r.lat, r.lng) <= radiusMiles)
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  const hailRows = nearby.filter((r) => r.type === 'hail')
  const windRows = nearby.filter((r) => r.type === 'wind')
  const mostRecent = nearby[0]

  const events: RoofRadarStormEvent[] = nearby.slice(0, 20).map((r) => ({
    type: r.type,
    date: r.date.toISOString().slice(0, 10),
    magnitude: r.magnitude,
    distanceMiles: Math.round(haversine(coords!.lat, coords!.lng, r.lat, r.lng) * 10) / 10,
  }))

  return NextResponse.json({
    address: geocodedAddress,
    coordinates: coords,
    radiusMiles,
    yearsSearched: years,
    summary: {
      totalEvents: nearby.length,
      hailEvents: hailRows.length,
      maxHailInches: hailRows.length > 0 ? Math.max(...hailRows.map((r) => r.magnitude)) : 0,
      windEvents: windRows.length,
      maxWindMph: windRows.length > 0 ? Math.max(...windRows.map((r) => r.magnitude)) : 0,
      lastEventDate: mostRecent ? mostRecent.date.toISOString().slice(0, 10) : null,
      lastEventDaysAgo: mostRecent
        ? Math.round((Date.now() - mostRecent.date.getTime()) / DAY_MS)
        : null,
      confidence:
        nearby.length >= 3 ||
        hailRows.some((r) => r.magnitude >= 1) ||
        windRows.some((r) => r.magnitude >= 58)
          ? 'High'
          : nearby.length > 0
            ? 'Medium'
            : 'None',
    },
    events,
    source: 'NOAA/SPC public storm reports',
    note: 'Events matched within ' + radiusMiles + ' miles of the address coordinates.',
  })
}
