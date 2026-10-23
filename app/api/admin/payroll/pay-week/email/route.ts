/** POST { periodId } — email each paid person their statement for an approved week (also the "send again" button). */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { emailWeekStatements } from '@/lib/payroll-approve'
import { isUuid } from '@/lib/payroll-pay-week'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown } | null
  if (!isUuid(body?.periodId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    const res = await emailWeekStatements(a.admin, a.profile.org_id, body.periodId as string)
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    console.error('POST pay-week email', e)
    return NextResponse.json({ error: 'Could not send the statements' }, { status: 500 })
  }
}
