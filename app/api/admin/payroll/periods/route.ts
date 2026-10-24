import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export const dynamic = 'force-dynamic'

export async function GET() {
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
    const { data, error } = await supabase
      .from('payroll_periods')
      .select(
        'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
      )
      .eq('org_id', profile.org_id)
      .order('cutoff_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('payroll periods list', error)
      return NextResponse.json({ error: 'Failed to load periods' }, { status: 500 })
    }

    return NextResponse.json({ periods: data || [] })
  } catch (e) {
    console.error('GET payroll periods', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as {
      period_label?: string
      cutoff_at?: string
      lock_at?: string
      scheduled_pay_date?: string
    }

    if (!body.period_label?.trim() || !body.cutoff_at || !body.scheduled_pay_date) {
      return NextResponse.json(
        { error: 'period_label, cutoff_at, and scheduled_pay_date are required' },
        { status: 400 }
      )
    }

    const lockAt = body.lock_at || body.cutoff_at

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('payroll_periods')
      .insert({
        org_id: profile.org_id,
        period_label: body.period_label.trim(),
        cutoff_at: body.cutoff_at,
        lock_at: lockAt,
        scheduled_pay_date: body.scheduled_pay_date,
        status: 'open',
      })
      .select(
        'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
      )
      .single()

    if (error) {
      console.error('payroll period create', error)
      return NextResponse.json({ error: error.message || 'Failed to create period' }, { status: 500 })
    }

    return NextResponse.json({ period: data })
  } catch (e) {
    console.error('POST payroll periods', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
