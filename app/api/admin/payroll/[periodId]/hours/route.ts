import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { loadHourlyRoster, saveHoursEntries, type HoursEntry } from '@/lib/payroll-hours'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { periodId: string } }
) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id
    const periodId = params.periodId

    const { data: period, error: periodErr } = await supabase
      .from('payroll_periods')
      .select(
        'id, period_label, cutoff_at, scheduled_pay_date, status, locked_at, paid_at'
      )
      .eq('id', periodId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (periodErr || !period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }

    const rows = await loadHourlyRoster(supabase, orgId, period)

    const readOnly =
      period.status === 'locked' || period.status === 'paid' || Boolean(period.locked_at)

    return NextResponse.json({ period, readOnly, rows })
  } catch (e) {
    console.error('GET admin/payroll hours', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { periodId: string } }
) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const periodId = params.periodId
    const body = (await request.json()) as { entries?: HoursEntry[] }
    const entries = body.entries
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries array is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const { data: period, error: periodErr } = await supabase
      .from('payroll_periods')
      .select('id, status, locked_at')
      .eq('id', periodId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (periodErr || !period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }
    if (period.status === 'locked' || period.status === 'paid' || period.locked_at) {
      return NextResponse.json({ error: 'Period is locked' }, { status: 409 })
    }

    const { data: periodMeta } = await supabase.from('payroll_periods').select('cutoff_at').eq('id', periodId).single()
    const result = await saveHoursEntries(supabase, {
      orgId,
      periodId,
      cutoffAt: (periodMeta?.cutoff_at as string | null) ?? null,
      actorUserId: profile.id,
      entries,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const results = result.saved
    return NextResponse.json({ saved: results })
  } catch (e) {
    console.error('admin/payroll hours', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
