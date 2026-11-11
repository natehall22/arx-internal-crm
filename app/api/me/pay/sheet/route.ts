/** GET ?period=id — the signed-in person's OWN pay sheet for an approved week (PDF). Never anyone else's, never a preview. */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { canSeeMyPay } from '@/lib/my-pay'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { renderPaySheets } from '@/lib/payroll-pay-sheet-server'
import { isUuid, loadPayWeek } from '@/lib/payroll-pay-week'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isPayWeekEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const periodId = request.nextUrl.searchParams.get('period')
  if (!isUuid(periodId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    const admin = createServiceClient()
    if (!(await canSeeMyPay(admin, ctx.profile.org_id, ctx.profile.id, ctx.profile.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const week = await loadPayWeek(admin, ctx.profile.org_id, new Date(), periodId)
    if (week.state !== 'approved') return NextResponse.json({ error: 'Your sheet is ready once the week is approved.' }, { status: 409 })
    const [sheet] = await renderPaySheets(admin, ctx.profile.org_id, week, { userId: ctx.profile.id })
    if (!sheet) return NextResponse.json({ error: 'Nothing on your check that week' }, { status: 404 })
    return new NextResponse(new Uint8Array(sheet.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${sheet.filename}"`, 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('GET /api/me/pay/sheet', e)
    return NextResponse.json({ error: 'Could not build your pay sheet' }, { status: 500 })
  }
}
