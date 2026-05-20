import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

export async function GET() {
  if (!(await requireAdminToolAccess())) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const listingProvider = process.env.ROOFRADAR_LISTINGS_PROVIDER || 'generic'
  const listingConfigured = Boolean(process.env.ROOFRADAR_LISTINGS_API_URL && process.env.ROOFRADAR_LISTINGS_API_KEY)

  return NextResponse.json({
    sources: [
      {
        key: 'listings',
        label: 'Listing Feed',
        provider: listingProvider,
        configured: listingConfigured,
        cadence: listingProvider.toLowerCase() === 'listhub' ? 'sync-oriented, hourly cache recommended' : 'provider-dependent',
        note:
          listingProvider.toLowerCase() === 'listhub'
            ? 'ListHub supports active/pending-style syndication data; sold/off-market is restricted.'
            : 'Generic provider should return Zillow/Redfin/MLS-like listing rows.',
      },
      {
        key: 'public-records',
        label: 'Public Records',
        provider: process.env.ROOFRADAR_PUBLIC_RECORDS_PROVIDER || 'county assessor/open-data endpoint',
        configured: Boolean(
          process.env.ROOFRADAR_PUBLIC_RECORDS_API_URL ||
            process.env.ROOFRADAR_PUBLIC_RECORDS_SOCRATA_URL ||
            process.env.ROOFRADAR_PUBLIC_RECORDS_ARCGIS_URL
        ),
        cadence: 'daily/weekly by county source',
        note: 'Free county assessor, parcel, and tax portals are market-by-market. Configure the local Socrata or ArcGIS endpoint when available.',
      },
      {
        key: 'permits',
        label: 'Roof Permits',
        provider: process.env.ROOFRADAR_PERMITS_PROVIDER || 'county permit/open-data endpoint',
        configured: Boolean(
          process.env.ROOFRADAR_PERMITS_API_URL ||
            process.env.ROOFRADAR_PERMITS_SOCRATA_URL ||
            process.env.ROOFRADAR_PERMITS_ARCGIS_URL
        ),
        cadence: 'county/provider-dependent',
        note: 'Free permit data is usually city/county-specific. Use Socrata or ArcGIS open-data APIs when the target county publishes permits.',
      },
      {
        key: 'storm',
        label: 'Storm History',
        provider: process.env.ROOFRADAR_STORM_PROVIDER || 'NOAA/SPC public storm reports',
        configured: process.env.ROOFRADAR_OPEN_STORM_ENABLED !== 'false',
        cadence: 'daily plus post-event refresh',
        note: 'Free hail and damaging wind reports are matched to property geocodes by radius and event date.',
      },
      {
        key: 'geocoder',
        label: 'Geocoder',
        provider: 'US Census Geocoder',
        configured: process.env.ROOFRADAR_CENSUS_GEOCODER_ENABLED !== 'false',
        cadence: 'on demand',
        note: 'Free address-to-coordinate fallback for storm matching when the listing provider does not return latitude/longitude.',
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
