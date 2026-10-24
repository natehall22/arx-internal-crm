/** POST { label, message, periodId?, jobId? } — "Something's wrong?" on one of my pay lines. */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { fileDispute } from '@/lib/my-pay'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isPayWeekEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // ships OFF (PAYROLL_PAY_WEEK_ENABLED)
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { label?: unknown; message?: unknown; periodId?: unknown; jobId?: unknown } | null
  const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
  const res = await fileDispute(createServiceClient(), {
    orgId: ctx.profile.org_id,
    userId: ctx.profile.id, // always the caller: a rep can only ask about their own pay
    label: typeof body?.label === 'string' ? body.label : '',
    message: typeof body?.message === 'string' ? body.message : '',
    periodId: uuid(body?.periodId),
    jobId: uuid(body?.jobId),
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
