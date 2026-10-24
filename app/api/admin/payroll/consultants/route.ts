import { NextResponse } from 'next/server'
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
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('full_name')

    if (error) {
      return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
    }

    return NextResponse.json({ consultants: data || [] })
  } catch (e) {
    console.error('GET payroll consultants', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
