/** GET /api/admin/payroll/pay-week[?period=id] — everything the "Pay this week" screen shows (payroll admins only). */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { isUuid, loadPayWeek } from '@/lib/payroll-pay-week'
import { readExportProvider } from '@/lib/payroll-provider-export'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const periodId = request.nextUrl.searchParams.get('period')
  if (periodId && !isUuid(periodId)) return NextResponse.json({ error: 'Bad period' }, { status: 400 })
  try {
    const week = await loadPayWeek(a.admin, a.profile.org_id, new Date(), periodId)
    // Office staff prepare the week; only an owner (super admin) sees the Approve button and can change the pay week.
    const { data: org } = await a.admin.from('orgs').select('settings').eq('id', a.profile.org_id).maybeSingle()
    return NextResponse.json({ ...week, viewer: { canApprove: isSuperAdmin(a.profile), canEditSchedule: isSuperAdmin(a.profile), exportProvider: readExportProvider((org as { settings?: unknown } | null)?.settings) } })
  } catch (e) {
    console.error('GET pay-week', e)
    return NextResponse.json({ error: 'Could not load this week' }, { status: 500 })
  }
}
