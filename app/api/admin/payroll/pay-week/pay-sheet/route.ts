/**
 * GET ?period=id[&user=id][&preview=1] — pay sheets (landscape PDF) for a week: one person's PDF, or everyone's in one zip.
 * An approved week is read from its stored lines. An open week is only produced with preview=1 and carries a "PREVIEW - not final" mark.
 * Payroll admins and owners; a rep gets only their own approved sheet from /api/me/pay/sheet.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { renderPaySheets, zipSheets } from '@/lib/payroll-pay-sheet-server'
import { isUuid, loadPayWeek } from '@/lib/payroll-pay-week'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const sp = request.nextUrl.searchParams
  const periodId = sp.get('period')
  const userId = sp.get('user')
  if (!isUuid(periodId) || (userId && !isUuid(userId))) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    const week = await loadPayWeek(a.admin, a.profile.org_id, new Date(), periodId)
    if (week.state !== 'approved' && sp.get('preview') !== '1') return NextResponse.json({ error: 'This week is not approved yet. Use Preview.', code: 'not_approved' }, { status: 409 })
    const sheets = await renderPaySheets(a.admin, a.profile.org_id, week, { userId: userId ?? undefined })
    if (sheets.length === 0) return NextResponse.json({ error: 'Nothing to put on a sheet' }, { status: 404 })
    const headers = { 'Cache-Control': 'no-store' }
    if (sheets.length === 1 && userId) return new NextResponse(new Uint8Array(sheets[0].pdf), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${sheets[0].filename}"` } })
    return new NextResponse(Buffer.from(zipSheets(sheets)), { headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="Pay_Sheets_${week.period.payDate}${week.state === 'approved' ? '' : '_PREVIEW'}.zip"` } })
  } catch (e) {
    console.error('GET pay-week pay-sheet', e)
    return NextResponse.json({ error: 'Could not build the pay sheets' }, { status: 500 })
  }
}
