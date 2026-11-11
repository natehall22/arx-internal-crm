/**
 * The company's pay week (lib/payroll-week-schedule.ts).
 *   GET                         — the current schedule in words.
 *   POST { schedule, preview }  — preview: the exact dates of the first new week and the two after, and anything blocking the change
 *                                 (shown BEFORE saving). Without preview: save (owners / super admins only).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { describePayWeek } from '@/lib/payroll-week-schedule'
import { checkPayWeekChange, loadPayWeekSchedule, savePayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const s = await loadPayWeekSchedule(a.admin, a.profile.org_id)
  const { timeZone, ...schedule } = s
  return NextResponse.json({ schedule, timeZone, words: describePayWeek(s), canEdit: isSuperAdmin(a.profile) })
}

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  if (!isSuperAdmin(a.profile)) return NextResponse.json({ error: 'Only an owner can change the pay week.', code: 'owner_only' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { schedule?: unknown; preview?: unknown } | null
  try {
    if (body?.preview === true) {
      const r = await checkPayWeekChange(a.admin, a.profile.org_id, body?.schedule, new Date())
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
      return NextResponse.json(r.value)
    }
    const r = await savePayWeekSchedule(a.admin, a.profile.org_id, body?.schedule, new Date())
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, ...r.value })
  } catch (e) {
    console.error('pay-week schedule', e)
    return NextResponse.json({ error: 'Could not change the pay week. Nothing was saved.' }, { status: 500 })
  }
}
