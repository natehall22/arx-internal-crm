import { NextResponse } from 'next/server'

import { parseEntryEdit } from '@/lib/time-tracking'
import { requireTimeOfficeApi } from '@/lib/time-tracking-access'
import { addTimeEntry, loadTimeWeek } from '@/lib/time-tracking-db'
import { cutoffInstantForYmd, payWeekCutoffFor } from '@/lib/weekly-payroll/cutoff'

export const dynamic = 'force-dynamic'

/** GET ?day=YYYY-MM-DD — the pay week holding that day (default: this week): everyone's time, totals, warnings. */
export async function GET(request: Request) {
  const a = await requireTimeOfficeApi()
  if (a.error) return a.error
  const day = new URL(request.url).searchParams.get('day')
  // Noon of the day (any time inside it lands in the same pay week; the cutoff is late evening).
  const ref = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(cutoffInstantForYmd(day).getTime() - 12 * 3_600_000) : new Date()
  if (!Number.isFinite(ref.getTime())) return NextResponse.json({ error: 'Bad day' }, { status: 400 })
  return NextResponse.json(await loadTimeWeek(a.admin, a.profile.org_id, payWeekCutoffFor(ref)), { headers: { 'Cache-Control': 'no-store, private' } })
}

/** POST { userId, startedAt, endedAt, kind?, jobId? | workOrderId?, reason } — add time someone forgot to tap. */
export async function POST(request: Request) {
  const a = await requireTimeOfficeApi()
  if (a.error) return a.error
  const parsed = parseEntryEdit(await request.json().catch(() => null), { adding: true })
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const res = await addTimeEntry(a.admin, a.profile.org_id, a.profile.id, parsed.edit, parsed.reason)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, id: res.id })
}
