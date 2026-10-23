/** GET /api/admin/payroll/pay-week[?period=id] — everything the "Pay this week" screen shows (payroll admins only). */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { loadPayWeek } from '@/lib/payroll-pay-week'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const periodId = request.nextUrl.searchParams.get('period')
  if (periodId && !/^[0-9a-f-]{36}$/i.test(periodId)) return NextResponse.json({ error: 'Bad period' }, { status: 400 })
  try {
    return NextResponse.json(await loadPayWeek(a.admin, a.profile.org_id, new Date(), periodId))
  } catch (e) {
    console.error('GET pay-week', e)
    return NextResponse.json({ error: 'Could not load this week' }, { status: 500 })
  }
}
