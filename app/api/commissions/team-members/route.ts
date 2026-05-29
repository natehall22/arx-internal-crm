import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canUseManagerStatementView } from '@/lib/payroll-statement-access'

export const dynamic = 'force-dynamic'

/** Direct reports for manager team statement picker. */
export async function GET() {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!canUseManagerStatementView(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile.org_id)
      .eq('manager_user_id', profile.id)
      .eq('active', true)
      .order('full_name')

    if (error) {
      console.error('team-members', error)
      return NextResponse.json({ error: 'Failed to load team' }, { status: 500 })
    }

    return NextResponse.json({ members: data || [] })
  } catch (e) {
    console.error('GET commissions/team-members', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
