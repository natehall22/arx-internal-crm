import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'

export const dynamic = 'force-dynamic'

const TZ = 'America/New_York'

export async function GET(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get('timeframe') || 'week'

    const { start, end } = getDateRangeForTimeFrame(timeframe, TZ, false)
    const startIso = start.toISOString()
    const endIso = end.toISOString()

    const startLocal = toZonedTime(start, TZ)
    const endExclusive = new Date(end.getTime() - 1)
    const endLocal = toZonedTime(endExclusive, TZ)
    const saleDateStart = format(startLocal, 'yyyy-MM-dd')
    const saleDateEnd = format(endLocal, 'yyyy-MM-dd')

    const [soldRes, installRes, cancelRes] = await Promise.all([
      supabase
        .from('production_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .not('sale_date', 'is', null)
        .gte('sale_date', saleDateStart)
        .lte('sale_date', saleDateEnd),
      supabase
        .from('production_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .not('completed_at', 'is', null)
        .gte('completed_at', startIso)
        .lt('completed_at', endIso),
      supabase
        .from('proposals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .eq('status', 'declined')
        .not('declined_at', 'is', null)
        .gte('declined_at', startIso)
        .lt('declined_at', endIso),
    ])

    if (soldRes.error) console.error('ops-metrics jobs sold:', soldRes.error)
    if (installRes.error) console.error('ops-metrics installations:', installRes.error)
    if (cancelRes.error) console.error('ops-metrics cancellations:', cancelRes.error)

    return NextResponse.json({
      timeframe,
      jobsSold: soldRes.count ?? 0,
      installations: installRes.count ?? 0,
      cancellations: cancelRes.count ?? 0,
    })
  } catch (e) {
    console.error('ops-metrics GET:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
