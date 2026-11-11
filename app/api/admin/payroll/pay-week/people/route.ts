/**
 * PATCH { userId, employeeId?, payrollState? } — a person's payroll provider employee / file number and the state they are paid in.
 * Both feed only the provider export and the multi-state warning (no tax math). Payroll admins; blank clears.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { isUuid } from '@/lib/payroll-pay-week'
import { parseStateCode } from '@/lib/us-state'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const b = (await request.json().catch(() => null)) as { userId?: unknown; employeeId?: unknown; payrollState?: unknown } | null
  if (!b || !isUuid(b.userId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const patch: Record<string, string | null> = {}
  if ('employeeId' in b) {
    const v = String(b.employeeId ?? '').trim()
    if (v.length > 40 || /[\r\n,"]/.test(v)) return NextResponse.json({ error: 'Use up to 40 letters or numbers' }, { status: 400 })
    patch.payroll_employee_id = v || null
  }
  if ('payrollState' in b) {
    const raw = String(b.payrollState ?? '').trim()
    const st = raw ? parseStateCode(raw) : null
    if (raw && !st) return NextResponse.json({ error: 'Use the two-letter state, like NC' }, { status: 400 })
    patch.payroll_state = st
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  const { data, error } = await a.admin.from('users').update(patch).eq('id', b.userId as string).eq('org_id', a.profile.org_id).select('id').maybeSingle()
  if (error) {
    console.error('pay-week people', error)
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
