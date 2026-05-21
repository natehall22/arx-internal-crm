import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const ADMIN_TOOL_ROLES = new Set([
  'admin', 'owner', 'regional_manager', 'regional_setter_manager',
  'sales_manager', 'setter_manager', 'manager', 'operations',
])

async function requireAdminToolAccess() {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return false
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  return Boolean(profile?.role && ADMIN_TOOL_ROLES.has(profile.role))
}

export async function GET() {
  if (!(await requireAdminToolAccess())) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const rentcastConfigured = Boolean(process.env.ROOFRADAR_RENTCAST_KEY)
  const listingConfigured = Boolean(process.env.ROOFRADAR_LISTINGS_API_URL && process.env.ROOFRADAR_LISTINGS_API_KEY)
  const listingProvider = process.env.ROOFRADAR_LISTINGS_PROVIDER ?? 'generic'
  const arcgisConfigured = Boolean(process.env.ROOFRADAR_ARCGIS_PARCEL_URL)

  // Determine which listing source is active
  let activeListingProvider: string
  let activeListingNote: string
  let activeListingCadence: string
  if (rentcastConfigured) {
    activeListingProvider = 'Rentcast'
    activeListingNote = 'Free tier: 50 calls/month. Returns active and pending for-sale listings with lat/lng, price, sqft, and year built.'
    activeListingCadence = 'live, on demand'
  } else if (listingConfigured) {
    activeListingProvider = listingProvider
    activeListingNote =
      listingProvider.toLowerCase() === 'listhub'
        ? 'ListHub syndication feed. Active/pending listings only; sold/off-market is restricted.'
        : 'Generic provider should return Zillow/Redfin/MLS-like listing rows.'
    activeListingCadence = listingProvider.toLowerCase() === 'listhub' ? 'hourly cache recommended' : 'provider-dependent'
  } else {
    activeListingProvider = 'none'
    activeListingNote =
      'No listing feed configured. Add ROOFRADAR_RENTCAST_KEY to .env.local (free at https://app.rentcast.io). ' +
      'Cabarrus County ZIPs (28025–28088) fall back to the county parcel layer automatically.'
    activeListingCadence = 'n/a'
  }

  return NextResponse.json({
    sources: [
      {
        key: 'listings',
        label: 'Listing Feed',
        provider: activeListingProvider,
        configured: rentcastConfigured || listingConfigured,
        cadence: activeListingCadence,
        note: activeListingNote,
      },
      {
        key: 'parcels',
        label: 'County Parcels',
        provider: arcgisConfigured ? 'Custom ArcGIS parcel layer' : 'Cabarrus County ArcGIS (built-in)',
        configured: true,
        cadence: 'live, on demand',
        note:
          'Free Cabarrus County parcel data (no key required). Returns all residential properties — not just active listings — for proactive roof-age targeting. ' +
          'Active for ZIPs 28025, 28027, 28036, 28081, 28082, 28107, 28124, 28088 when no listing feed is configured.',
      },
      {
        key: 'storm',
        label: 'Storm History',
        provider: process.env.ROOFRADAR_STORM_PROVIDER ?? 'NOAA/SPC public storm reports',
        configured: process.env.ROOFRADAR_OPEN_STORM_ENABLED !== 'false',
        cadence: 'daily + on-demand per address',
        note: 'Free hail and damaging wind reports matched to property geocodes by radius. On-demand full history available per address in the property modal.',
      },
      {
        key: 'geocoder',
        label: 'Geocoder',
        provider: 'US Census Geocoder',
        configured: process.env.ROOFRADAR_CENSUS_GEOCODER_ENABLED !== 'false',
        cadence: 'on demand',
        note: 'Free address-to-coordinate fallback for storm matching when the listing provider does not return lat/lng.',
      },
      {
        key: 'permits',
        label: 'Roof Permits',
        provider: process.env.ROOFRADAR_PERMITS_PROVIDER ?? 'county permit/open-data endpoint',
        configured: Boolean(
          process.env.ROOFRADAR_PERMITS_API_URL ||
          process.env.ROOFRADAR_PERMITS_SOCRATA_URL ||
          process.env.ROOFRADAR_PERMITS_ARCGIS_URL
        ),
        cadence: 'county/provider-dependent',
        note: 'Permit data signals a recent roof replacement — reduces wasted visits. Set ROOFRADAR_PERMITS_ARCGIS_URL when the county publishes permits.',
      },
      {
        key: 'ai-roof',
        label: 'AI Roof Signals',
        provider: 'ARX satellite/photo AI',
        configured: true,
        cadence: 'on demand',
        note: 'Existing roof vision tooling can contribute roof complexity and condition confidence after target selection.',
      },
    ],
  })
}
