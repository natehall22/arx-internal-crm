type LeadPinSource = {
  id: string
  org_id: string
  address_text?: string | null
  lat?: number | string | null
  lng?: number | string | null
}

type LatLng = {
  lat: number
  lng: number
}

type LeadMapPinResult =
  | { ok: true; coords: LatLng }
  | {
      ok: false
      reason:
        | 'missing_coordinates'
        | 'missing_address'
        | 'missing_api_key'
        | 'geocode_failed'
        | 'persist_failed'
    }

function parseCoordinate(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function geocodeAddressToLatLng(address: string): Promise<LatLng | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey || !address.trim()) return null

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('key', apiKey)

    const response = await fetch(url.toString(), {
      cache: 'no-store',
    })

    if (!response.ok) {
      console.error('Lead pin geocode HTTP error:', response.status)
      return null
    }

    const data = (await response.json()) as {
      status?: string
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>
      error_message?: string
    }

    if (data.status !== 'OK') {
      console.error('Lead pin geocode API error:', data.status, data.error_message || '')
      return null
    }

    const location = data.results?.[0]?.geometry?.location
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return null
    }

    return { lat: location.lat, lng: location.lng }
  } catch (error) {
    console.error('Lead pin geocode failed:', error)
    return null
  }
}

async function getLeadMapPinResult(
  supabase: any,
  lead: LeadPinSource
): Promise<LeadMapPinResult> {
  const currentLat = parseCoordinate(lead.lat)
  const currentLng = parseCoordinate(lead.lng)
  if (currentLat != null && currentLng != null) {
    return { ok: true, coords: { lat: currentLat, lng: currentLng } }
  }

  const address = lead.address_text?.trim()
  if (!address) return { ok: false, reason: 'missing_address' }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) return { ok: false, reason: 'missing_api_key' }

  const coords = await geocodeAddressToLatLng(address)
  if (!coords) return { ok: false, reason: 'geocode_failed' }

  const { error } = await supabase
    .from('leads')
    .update({
      lat: coords.lat,
      lng: coords.lng,
    })
    .eq('id', lead.id)
    .eq('org_id', lead.org_id)

  if (error) {
    console.error('Failed to persist lead map pin:', error.message || error)
    return { ok: false, reason: 'persist_failed' }
  }

  return { ok: true, coords }
}

export async function ensureLeadHasMapPin(
  supabase: any,
  lead: LeadPinSource
): Promise<LatLng | null> {
  const result = await getLeadMapPinResult(supabase, lead)
  return result.ok ? result.coords : null
}

export async function ensureLeadHasMapPinOrThrow(
  supabase: any,
  lead: LeadPinSource
): Promise<LatLng> {
  const result = await getLeadMapPinResult(supabase, lead)
  if (result.ok) return result.coords

  if (result.reason === 'missing_address') {
    throw new Error('Cannot schedule inspection without a mappable address. Add the address and try again.')
  }

  if (result.reason === 'missing_api_key') {
    throw new Error('Cannot create the canvass map pin because Google Maps is not configured.')
  }

  if (result.reason === 'persist_failed') {
    throw new Error('Could not save the house pin for this inspection. Please try again.')
  }

  throw new Error('Could not place a house pin for this inspection. Verify the address and try again.')
}
