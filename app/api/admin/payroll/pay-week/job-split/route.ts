/**
 * The "Change" sheet for one job on an open week (lib/payroll-job-split.ts).
 *   GET  ?periodId&jobId                         — the job's lines as the planner prices them.
 *   POST { periodId, jobId, reason, lines, added } — the final split; saved in ONE transaction with an audit row per change.
 * Payroll admins (the office prepares; only owners approve the week).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { jobSplitErrorMessage, loadJobSplit, planJobSplitWrites, type SplitEdit } from '@/lib/payroll-job-split'
import { isUuid } from '@/lib/payroll-pay-week'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const periodId = request.nextUrl.searchParams.get('periodId')
  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!isUuid(periodId) || !isUuid(jobId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    const r = await loadJobSplit(a.admin, a.profile.org_id, periodId, jobId)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json(r.value)
  } catch (e) {
    console.error('GET job-split', e)
    return NextResponse.json({ error: 'Could not load this job' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; jobId?: unknown; reason?: unknown; lines?: unknown; added?: unknown } | null
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
  if (!isUuid(body?.periodId) || !isUuid(body?.jobId) || !Array.isArray(body?.lines) || (body?.added != null && !Array.isArray(body.added))) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ error: 'Say why (one line).' }, { status: 400 })
  const edit: SplitEdit = {
    lines: (body.lines as Array<Record<string, unknown>>).map((l) => ({ key: String(l?.key ?? ''), percent: l?.percent == null ? null : Number(l.percent), backToPlan: l?.backToPlan === true })),
    added: ((body.added as Array<Record<string, unknown>> | undefined) ?? []).map((x) => ({ userId: isUuid(x?.userId) ? (x.userId as string) : '', percent: Number(x?.percent) })),
  }
  const orgId = a.profile.org_id
  try {
    // Always re-read the job's lines on the server: the write is planned from what payroll would pay NOW, not from the browser.
    const current = await loadJobSplit(a.admin, orgId, body.periodId as string, body.jobId as string)
    if (!current.ok) return NextResponse.json({ error: current.error }, { status: current.status })
    const planned = planJobSplitWrites(current.value, edit)
    if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: 400 })
    if (planned.rows.length === 0) return NextResponse.json({ ok: true, changed: 0, split: current.value })
    const { error } = await a.admin.rpc('payroll_set_job_split', {
      p_org_id: orgId,
      p_job_id: body.jobId,
      p_period_id: body.periodId,
      p_actor_user_id: a.profile.id,
      p_reason: reason,
      p_rows: planned.rows,
    })
    if (error) {
      const m = jobSplitErrorMessage(error)
      if (m.status === 500) console.error('payroll_set_job_split', error)
      return NextResponse.json({ error: m.error }, { status: m.status })
    }
    const after = await loadJobSplit(a.admin, orgId, body.periodId as string, body.jobId as string)
    return NextResponse.json({ ok: true, changed: planned.rows.length, split: after.ok ? after.value : null })
  } catch (e) {
    console.error('POST job-split', e)
    return NextResponse.json({ error: 'Could not save the change. Nothing was changed.' }, { status: 500 })
  }
}
