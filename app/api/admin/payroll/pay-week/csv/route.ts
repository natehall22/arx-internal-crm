/** GET /api/admin/payroll/pay-week/csv[?period=id] — one total per person, for the payroll processor. */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { loadPayWeek, payWeekCsv } from '@/lib/payroll-pay-week'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const periodId = request.nextUrl.searchParams.get('period')
  if (periodId && !/^[0-9a-f-]{36}$/i.test(periodId)) return NextResponse.json({ error: 'Bad period' }, { status: 400 })
  try {
    const week = await loadPayWeek(a.admin, a.profile.org_id, new Date(), periodId)
    return new NextResponse(payWeekCsv(week), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pay-week-ending-${week.period.weekEnding}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('GET pay-week csv', e)
    return NextResponse.json({ error: 'Could not build the file' }, { status: 500 })
  }
}
