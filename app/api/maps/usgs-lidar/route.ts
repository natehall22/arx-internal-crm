import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchUsgsLidarAvailability } from '@/lib/usgs-3dep'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authContext = await requireAuthApi()
    const roofMeasureOff = await orgFeatureOffResponse(authContext.profile.org_id, 'roofMeasure')
    if (roofMeasureOff) return roofMeasureOff
    const admin = createServiceClient()
    if (await resolveSalesDocAccessBarred(admin, authContext.authUser.id, authContext.profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const lat = Number(searchParams.get('lat'))
    const lng = Number(searchParams.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'Valid lat, lng required' }, { status: 400 })
    }

    return NextResponse.json(await fetchUsgsLidarAvailability(lat, lng))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'USGS lidar lookup failed'
    const status = message === 'Unauthorized' || message === 'Account disabled' ? 401 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
