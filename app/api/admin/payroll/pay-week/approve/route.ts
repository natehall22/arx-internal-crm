/**
 * POST { periodId, expectedTotal, emailStatements? } — Approve this week.
 * The caller sends the total it was shown; if the live calculation no longer equals it, nothing is paid and the screen
 * reloads (409 "changed"). Otherwise: unapproved bonuses roll to next week, the period is locked by the same
 * `lockPayrollPeriod` every lock uses (the same calculation as the preview writes the lines), statements are emailed.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { approvePayWeek } from '@/lib/payroll-approve'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; expectedTotal?: unknown; emailStatements?: unknown } | null
  const periodId = typeof body?.periodId === 'string' ? body.periodId : ''
  const expected = Number(body?.expectedTotal)
  if (!/^[0-9a-f-]{36}$/i.test(periodId) || !Number.isFinite(expected)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const result = await approvePayWeek(a.admin, {
    orgId: a.profile.org_id,
    actorUserId: a.profile.id,
    periodId,
    expectedTotal: expected,
    emailStatements: body?.emailStatements !== false,
  })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })
  return NextResponse.json({ ok: true, total: result.total, people: result.people, mismatch: result.mismatch, emailed: result.emailed, message: result.message })
}
