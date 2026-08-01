/**
 * Server-side reverse geocode for canvass (iOS + web parity via Google Geocoding API).
 */

export type ReverseGeocodeResult =
  | { ok: true; address: string }
  | { ok: false; reason: 'missing_api_key' | 'invalid_coordinates' | 'geocode_failed' }

function parseCoord(value: string | null): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseReverseGeocodeQuery(searchParams: URLSearchParams): { lat: number; lng: number } | null {
  const lat = parseCoord(searchParams.get('lat'))
  const lng = parseCoord(searchParams.get('lng'))
  if (lat == null || lng == null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export async function reverseGeocodeLatLng(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'invalid_coordinates' }
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key' }
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('latlng', `${lat},${lng}`)
    url.searchParams.set('key', apiKey)

    const response = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(12000) })
    if (!response.ok) {
      return { ok: false, reason: 'geocode_failed' }
    }

    const data = (await response.json()) as {
      status?: string
      results?: Array<{ formatted_address?: string }>
      error_message?: string
    }

    if (data.status !== 'OK' || !data.results?.length) {
      return { ok: false, reason: 'geocode_failed' }
    }

    const formatted = (data.results[0]?.formatted_address ?? '').trim()
    if (!formatted) {
      return { ok: false, reason: 'geocode_failed' }
    }

    return { ok: true, address: formatted }
  } catch {
    return { ok: false, reason: 'geocode_failed' }
  }
}
