import { NextResponse } from 'next/server'

import { parseEntryEdit } from '@/lib/time-tracking'
import { requireTimeOfficeApi } from '@/lib/time-tracking-access'
import { addTimeEntry, loadTimeWeek } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

/** GET ?day=YYYY-MM-DD — the pay week holding that day (default: this week): everyone's time, totals, warnings. */
export async function GET(request: Request) {
  const a = await requireTimeOfficeApi()
  if (a.error) return a.error
  const day = new URL(request.url).searchParams.get('day')
  // The company's pay week whose days include that day (lib/payroll-week-schedule weekCutoffForDay), else the current one.
  if (day && !(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)))) return NextResponse.json({ error: 'Bad day' }, { status: 400 })
  return NextResponse.json(await loadTimeWeek(a.admin, a.profile.org_id, day ?? new Date()), { headers: { 'Cache-Control': 'no-store, private' } })
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
