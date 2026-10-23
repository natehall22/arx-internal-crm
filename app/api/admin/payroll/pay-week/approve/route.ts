/**
 * POST { periodId, expectedTotal, emailStatements? } — Approve this week.
 * The caller sends the total it was shown; if the live calculation no longer equals it, nothing is paid and the screen
 * reloads (409 "changed"). Otherwise: unapproved bonuses roll to next week, the period is locked by the same
 * `lockPayrollPeriod` every lock uses (the same calculation as the preview writes the lines), statements are emailed.
 */
import { NextRequest, NextResponse } from 'next/server'

import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { rollPendingBonusesForward, emailStatements } from '@/lib/payroll-approve'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; expectedTotal?: unknown; emailStatements?: unknown } | null
  const periodId = typeof body?.periodId === 'string' ? body.periodId : ''
  const expected = Number(body?.expectedTotal)
  if (!/^[0-9a-f-]{36}$/i.test(periodId) || !Number.isFinite(expected)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const orgId = a.profile.org_id

  const week = await loadPayWeek(a.admin, orgId, new Date(), periodId)
  if (week.state !== 'draft') return NextResponse.json({ error: 'This week is already approved' }, { status: 409 })
  if (Math.round(week.totals.amount * 100) !== Math.round(expected * 100)) {
    return NextResponse.json({ error: 'The numbers changed while you were looking. Review them again.', code: 'changed', total: week.totals.amount }, { status: 409 })
  }
  if (week.totals.amount <= 0) return NextResponse.json({ error: 'Nothing to pay this week' }, { status: 409 })

  await rollPendingBonusesForward(a.admin, orgId, week.period)
  const lock = await lockPayrollPeriod(a.admin, { orgId, periodId, actorUserId: a.profile.id, status: 'open', requireNoPendingBonuses: false })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  // Safety net: what was written must equal what was approved. If it does not, say so loudly (the lines are already frozen).
  const after = await loadPayWeek(a.admin, orgId, new Date(), periodId)
  const mismatch = Math.round(after.totals.amount * 100) !== Math.round(week.totals.amount * 100)
  if (mismatch) console.error('pay-week approve: written total differs from approved total', { periodId, approved: week.totals.amount, written: after.totals.amount })

  const emailed = body?.emailStatements === false ? null : await emailStatements(a.admin, orgId, periodId, after.people.filter((p) => p.total > 0).map((p) => p.userId))
  return NextResponse.json({ ok: true, total: after.totals.amount, people: after.totals.people, mismatch, emailed, message: lock.message })
}
