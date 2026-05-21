/**
 * /api/admin/roofradar/scan
 *
 * Listing + parcel data for a ZIP code or city search.
 *
 * Provider priority (first configured wins):
 *   1. Rentcast free tier  — set ROOFRADAR_RENTCAST_KEY
 *      Sign up free (50 calls/mo) at https://app.rentcast.io
 *   2. ListHub / generic   — set ROOFRADAR_LISTINGS_API_URL + ROOFRADAR_LISTINGS_API_KEY
 *   3. Cabarrus County ArcGIS parcel layer (no key, auto-enabled for ZIPs
 *      28025 28027 28036 28081 28082 28107 28124 28088)
 *
 * All results are enriched with NOAA/SPC storm data and Census geocodes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeRoofRadarProperty, type RoofRadarProperty } from '@/lib/roofradar'
import { enrichPropertiesWithOpenData } from '@/lib/roofradar-open-data'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const ADMIN_TOOL_ROLES = new Set([
  'admin', 'owner', 'regional_manager', 'regional_setter_manager',
  'sales_manager', 'setter_manager', 'manager', 'operations',
])

/** Cabarrus County ZIP codes — use the free ArcGIS parcel layer automatically */
const CABARRUS_ZIPS = new Set(['28025', '28027', '28036', '28081', '28082', '28107', '28124', '28088'])

/** Cabarrus County ArcGIS REST — parcel/landrecords layer, no key required */
const CABARRUS_ARCGIS_URL =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/views/landrecords_view/MapServer/4/query'

async function requireAdminToolAccess() {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return false
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  return Boolean(profile?.role && ADMIN_TOOL_ROLES.has(profile.role))
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pickRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const data = payload as Record<string, unknown>
  for (const key of ['properties', 'listings', 'results', 'data', 'value']) {
    const value = data[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function authHeaders(key: string) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

function listHubStatus(status: string) {
  switch (status) {
    case 'pending': return "StandardStatus eq 'Pending'"
    case 'contingent': return "StandardStatus eq 'ActiveUnderContract'"
    case 'sold': return "StandardStatus eq 'Closed'"
    default: return "StandardStatus eq 'Active'"
  }
}

function buildListHubUrl(baseUrl: string, query: string) {
  const base = baseUrl.replace(/\/$/, '')
  const statusFilter = ['active', 'pending', 'contingent'].map(listHubStatus).join(' or ')
  const filters = [`(${statusFilter})`]
  if (/^\d{5}$/.test(query)) filters.push(`PostalCode eq '${query}'`)
  const params = new URLSearchParams({
    $top: '100',
    $filter: filters.join(' and '),
    $select: [
      'ListingKey', 'ListingId', 'UnparsedAddress', 'City', 'PostalCode',
      'StandardStatus', 'ListPrice', 'LivingArea', 'YearBuilt',
      'ModificationTimestamp', 'SourceSystemID', 'SourceSystemName',
    ].join(','),
  })
  return `${base}/odata/Property?${params}`
}

// ---------------------------------------------------------------------------
// Rentcast adapter
// Free tier: 50 calls/month, no credit card. Sign up at https://app.rentcast.io
// Returns real for-sale + pending listings with lat/lng, price, sqft, yearBuilt.
// ---------------------------------------------------------------------------
async function fetchRentcast(query: string, apiKey: string): Promise<unknown[]> {
  const isZip = /^\d{5}$/.test(query)
  const params = new URLSearchParams({
    ...(isZip ? { zipCode: query } : { city: query, state: 'NC' }),
    limit: '200',
  })
  try {
    const res = await fetch(`https://api.rentcast.io/v1/listings/sale?${params}`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data)) return []
    return data.map((p: Record<string, unknown>) => ({
      id: p.id,
      // address aliases normalizeRoofRadarProperty understands
      street: p.addressLine1 || p.formattedAddress,
      address: p.addressLine1 || p.formattedAddress,
      formattedAddress: p.formattedAddress,
      city: p.city,
      zip: p.zipCode,
      zipCode: p.zipCode,
      lat: p.latitude,
      lng: p.longitude,
      latitude: p.latitude,
      longitude: p.longitude,
      value: p.price,
      price: p.price,
      sqft: p.squareFootage,
      squareFootage: p.squareFootage,
      yearBuilt: p.yearBuilt,
      status: p.status,
      listingStatus: p.status,
      daysAgo: p.daysOnMarket,
      daysOnMarket: p.daysOnMarket,
      source: 'Rentcast',
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
    }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Cabarrus County ArcGIS parcel adapter
// Free, no key. Parcel/landrecords layer: tax-assessed properties, not active
// listings. All records tagged status='active' (homeowner = potential lead).
// lat/lng from centroid when the server supports it, Census geocoder fills gaps.
// ---------------------------------------------------------------------------
async function fetchCabarrusParcelsByZip(zip: string): Promise<unknown[]> {
  const arcgisUrl = process.env.ROOFRADAR_ARCGIS_PARCEL_URL || CABARRUS_ARCGIS_URL
  const params = new URLSearchParams({
    where: `MailZipCode='${zip}'`,
    outFields: 'MailAddr1,MailCity,MailZipCode,YEAR_,MarketValue,AssessedValue,SalePrice',
    returnCentroid: 'true',
    returnGeometry: 'false',
    f: 'json',
    resultRecordCount: '250',
  })
  try {
    const res = await fetch(`${arcgisUrl}?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data?.features)) return []

    const currentYear = new Date().getFullYear()
    type ArcGisFeature = {
      attributes: Record<string, unknown>
      centroid?: { x: number; y: number }
    }
    return (data.features as ArcGisFeature[])
      .filter((f) => f.attributes?.MailAddr1)
      .map((f) => {
        const a = f.attributes
        const yearBuilt = toNum(String(a.YEAR_ ?? '').trim()) || null
        const value = toNum(String(a.MarketValue ?? a.AssessedValue ?? a.SalePrice ?? '0'))
        const roofAge = yearBuilt ? currentYear - yearBuilt : 0
        return {
          street: String(a.MailAddr1 ?? '').trim(),
          address: String(a.MailAddr1 ?? '').trim(),
          city: String(a.MailCity ?? '').trim(),
          zip: String(a.MailZipCode ?? zip).trim(),
          zipCode: String(a.MailZipCode ?? zip).trim(),
          yearBuilt: yearBuilt ?? currentYear - 20,
          roofAge,
          value,
          price: value,
          sqft: 0,
          status: 'active',
          source: 'Cabarrus County',
          ...(f.centroid
            ? { lat: f.centroid.y, lng: f.centroid.x, latitude: f.centroid.y, longitude: f.centroid.x }
            : {}),
        }
      })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!(await requireAdminToolAccess())) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const query = String((body as { query?: unknown }).query ?? '').trim()
  if (!query) {
    return NextResponse.json({ error: 'Search query is required' }, { status: 400 })
  }

  const rentcastKey = process.env.ROOFRADAR_RENTCAST_KEY
  const listingUrl = process.env.ROOFRADAR_LISTINGS_API_URL
  const listingKey = process.env.ROOFRADAR_LISTINGS_API_KEY
  const listingProvider = (process.env.ROOFRADAR_LISTINGS_PROVIDER ?? 'generic').toLowerCase()
  const isZip = /^\d{5}$/.test(query)
  const isCabarrusZip = CABARRUS_ZIPS.has(query)
  const hasCustomArcGis = Boolean(process.env.ROOFRADAR_ARCGIS_PARCEL_URL)

  let rawRows: unknown[] = []
  let providerName = 'unknown'
  let dataType: 'listings' | 'parcels' = 'listings'

  if (rentcastKey) {
    // ---- Rentcast -------------------------------------------------------
    providerName = 'Rentcast'
    rawRows = await fetchRentcast(query, rentcastKey)

  } else if (listingUrl && listingKey) {
    // ---- ListHub / generic POST -----------------------------------------
    providerName = listingProvider
    const response =
      listingProvider === 'listhub'
        ? await fetch(buildListHubUrl(listingUrl, query), {
            method: 'GET',
            headers: authHeaders(listingKey),
            cache: 'no-store',
          })
        : await fetch(listingUrl, {
            method: 'POST',
            headers: authHeaders(listingKey),
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
        { error: 'Live listing provider failed', details: payload ?? response.statusText },
        { status: 502 }
      )
    }
    rawRows = pickRows(payload)

  } else if (isCabarrusZip || (isZip && hasCustomArcGis)) {
    // ---- Cabarrus County ArcGIS parcel layer (free fallback) ------------
    providerName = 'Cabarrus County Parcels'
    dataType = 'parcels'
    rawRows = await fetchCabarrusParcelsByZip(query)

  } else {
    // ---- No provider configured -----------------------------------------
    return NextResponse.json(
      {
        error: 'No listing provider configured',
        details:
          'Add ROOFRADAR_RENTCAST_KEY to .env.local (free at https://app.rentcast.io) for live listings. ' +
          'For Cabarrus County ZIPs (28025 28027 28036 28081 28082 28107 28124 28088) the county ArcGIS ' +
          'parcel layer is used automatically at no cost — no key required.',
        openData: {
          storm: {
            provider: 'NOAA/SPC public storm reports',
            enabled: process.env.ROOFRADAR_OPEN_STORM_ENABLED !== 'false',
          },
          geocoder: {
            provider: 'US Census Geocoder',
            enabled: process.env.ROOFRADAR_CENSUS_GEOCODER_ENABLED !== 'false',
          },
        },
      },
      { status: 501 }
    )
  }

  const normalizedProperties = rawRows
    .map((row, index) => normalizeRoofRadarProperty(row, index))
    .filter((p): p is RoofRadarProperty => Boolean(p))

  const { properties, openData } = await enrichPropertiesWithOpenData(normalizedProperties)

  return NextResponse.json({
    mode: 'live',
    dataType,
    provider: providerName,
    count: properties.length,
    openData,
    properties,
  })
}
