import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { CANCELLED_JOB_STATUS } from '@/lib/job-status'
import { resolveIsFieldRole } from '@/lib/effective-permissions'
import { resolveOpsAccess } from '@/lib/ops-access'
import { orgTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    // Production counts: field roles never (CLAUDE.md), and only with the ops dashboard permission — same gate as /api/dashboard/ops.
    if (await resolveIsFieldRole(supabase, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!(await resolveOpsAccess(supabase, profile.id, profile)).canOpsDashboard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Period boundaries on the company's own clock (orgs.timezone).
    const { data: orgRow } = await supabase.from('orgs').select('timezone').eq('id', profile.org_id).maybeSingle()
    const zone = orgTimeZone(orgRow?.timezone)

    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get('timeframe') || 'week'

    const { start, end } = getDateRangeForTimeFrame(timeframe, zone, false)
    const startIso = start.toISOString()
    const endIso = end.toISOString()

    const startLocal = toZonedTime(start, zone)
    const endExclusive = new Date(end.getTime() - 1)
    const endLocal = toZonedTime(endExclusive, zone)
    const saleDateStart = format(startLocal, 'yyyy-MM-dd')
    const saleDateEnd = format(endLocal, 'yyyy-MM-dd')

    const [soldRes, installRes, cancelRes] = await Promise.all([
      supabase
        .from('production_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .neq('status', CANCELLED_JOB_STATUS)
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
      // Sold jobs that fell through. This used to count declined proposals,
      // which are customers who never bought — not cancellations.
      supabase
        .from('production_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .eq('status', CANCELLED_JOB_STATUS)
        .gte('cancelled_at', startIso)
        .lt('cancelled_at', endIso),
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
