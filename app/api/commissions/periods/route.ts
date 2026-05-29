import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Period picker for rep/manager statement views (non-cancelled). */
export async function GET() {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('id, period_label, cutoff_at, scheduled_pay_date, status')
      .eq('org_id', profile.org_id)
      .neq('status', 'cancelled')
      .order('cutoff_at', { ascending: false })
      .limit(24)

    if (error) {
      console.error('commissions periods', error)
      return NextResponse.json({ error: 'Failed to load periods' }, { status: 500 })
    }

    return NextResponse.json({ periods: data || [] })
  } catch (e) {
    console.error('GET commissions/periods', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
