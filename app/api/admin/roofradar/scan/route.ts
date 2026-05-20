import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeRoofRadarProperty, type RoofRadarProperty } from '@/lib/roofradar'
import { enrichPropertiesWithOpenData } from '@/lib/roofradar-open-data'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const ADMIN_TOOL_ROLES = new Set([
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
])

async function requireAdminToolAccess() {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return false

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  return Boolean(profile?.role && ADMIN_TOOL_ROLES.has(profile.role))
}

function pickRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const data = payload as Record<string, unknown>
  for (const key of ['properties', 'listings', 'results', 'data']) {
    const value = data[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function authHeaders(providerKey: string) {
  return {
    Authorization: `Bearer ${providerKey}`,
    'Content-Type': 'application/json',
  }
}

function listHubStatus(status: string) {
  switch (status) {
    case 'pending':
      return "StandardStatus eq 'Pending'"
    case 'contingent':
      return "StandardStatus eq 'ActiveUnderContract'"
    case 'sold':
      return "StandardStatus eq 'Closed'"
    default:
      return "StandardStatus eq 'Active'"
  }
}

function buildListHubUrl(baseUrl: string, query: string) {
  const trimmedBase = baseUrl.replace(/\/$/, '')
  const statuses = ['active', 'pending', 'contingent']
  const statusFilter = statuses.map(listHubStatus).join(' or ')
  const queryParts = [`(${statusFilter})`]
  if (/^\d{5}$/.test(query)) {
    queryParts.push(`PostalCode eq '${query}'`)
  }
  const params = new URLSearchParams({
    $top: '100',
    $filter: queryParts.join(' and '),
    $select:
      'ListingKey,ListingId,UnparsedAddress,City,PostalCode,StandardStatus,ListPrice,LivingArea,YearBuilt,ModificationTimestamp,SourceSystemID,SourceSystemName',
  })
  return `${trimmedBase}/odata/Property?${params.toString()}`
}

export async function POST(request: NextRequest) {
  if (!(await requireAdminToolAccess())) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const query = String((body as { query?: unknown }).query || '').trim()
  if (!query) {
    return NextResponse.json({ error: 'Search query is required' }, { status: 400 })
  }

  const provider = (process.env.ROOFRADAR_LISTINGS_PROVIDER || 'generic').toLowerCase()
  const providerUrl = process.env.ROOFRADAR_LISTINGS_API_URL
  const providerKey = process.env.ROOFRADAR_LISTINGS_API_KEY

  if (!providerUrl || !providerKey) {
    return NextResponse.json(
      {
        error: 'Live listing provider is not configured',
        details:
          'Free/open storm and geocoding adapters are available, but live listing rows still require an approved listings feed. Set ROOFRADAR_LISTINGS_API_URL and ROOFRADAR_LISTINGS_API_KEY.',
        openData: {
          storm: {
            provider: 'NOAA/SPC public storm reports',
            enabled: process.env.ROOFRADAR_OPEN_STORM_ENABLED !== 'false',
          },
          geocoder: {
            provider: 'US Census Geocoder',
            enabled: process.env.ROOFRADAR_CENSUS_GEOCODER_ENABLED !== 'false',
          },
          permits: {
            provider: process.env.ROOFRADAR_PERMITS_PROVIDER || 'county open-data endpoint',
            configured: Boolean(process.env.ROOFRADAR_PERMITS_SOCRATA_URL || process.env.ROOFRADAR_PERMITS_ARCGIS_URL),
          },
        },
      },
      { status: 501 }
    )
  }

  const response =
    provider === 'listhub'
      ? await fetch(buildListHubUrl(providerUrl, query), {
          method: 'GET',
          headers: authHeaders(providerKey),
          cache: 'no-store',
        })
      : await fetch(providerUrl, {
          method: 'POST',
          headers: authHeaders(providerKey),
          body: JSON.stringify({
            query,
            sources: ['zillow', 'redfin', 'mls'],
            listing_statuses: ['sold', 'pending', 'active', 'contingent'],
          }),
          cache: 'no-store',
        })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    return NextResponse.json(
      {
        error: 'Live listing provider failed',
        details: payload && typeof payload === 'object' ? payload : response.statusText,
      },
      { status: 502 }
    )
  }

  const normalizedProperties = pickRows(payload)
    .map((row, index) => normalizeRoofRadarProperty(row, index))
    .filter((property): property is RoofRadarProperty => Boolean(property))
  const { properties, openData } = await enrichPropertiesWithOpenData(normalizedProperties)

  return NextResponse.json({
    mode: 'live',
    provider,
    count: properties.length,
    openData,
    properties,
  })
}
