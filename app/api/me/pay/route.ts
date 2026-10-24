/** GET /api/me/pay — the signed-in person's own pay (this week, coming, paid). Never anyone else's. */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { canSeeMyPay, loadMyPay } from '@/lib/my-pay'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isPayWeekEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createServiceClient()
    if (!(await canSeeMyPay(admin, ctx.profile.org_id, ctx.profile.id, ctx.profile.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json(await loadMyPay(admin, ctx.profile.org_id, ctx.profile.id, new Date()))
  } catch (e) {
    console.error('GET /api/me/pay', e)
    return NextResponse.json({ error: 'Could not load your pay' }, { status: 500 })
  }
}
