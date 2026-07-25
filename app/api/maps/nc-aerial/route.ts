import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { fetchNcOneMapOverlay } from '@/lib/nc-onemap-imagery'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const authContext = await requireAuthApi()
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
    if (lat < 33.7 || lat > 36.7 || lng < -84.5 || lng > -75.2) {
      return NextResponse.json({ error: 'NC aerial imagery is available only in North Carolina' }, { status: 404 })
    }

    return NextResponse.json(await fetchNcOneMapOverlay(lat, lng))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'NC aerial imagery failed'
    const status = message === 'Unauthorized' || message === 'Account disabled' ? 401 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
