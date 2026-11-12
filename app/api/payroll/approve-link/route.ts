/**
 * The one-tap approve link (lib/payroll-approve-link.ts).
 *   GET  ?token  — the live week behind the link (total, people, warnings), for its owner only.
 *   POST { token, expectedTotal } — approve: the same approvePayWeek as the Pay screen, then the same emailWeekStatements the Pay screen
 *   runs (statements go out by default, exactly like the main Approve; a failed send never undoes the approval). The link is used up only when the week is approved.
 * Same answer for a wrong, used, expired or someone else's link (no hints).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { consumeApprovalLink, findApprovalLink } from '@/lib/payroll-approve-link'
import { approvePayWeek, emailWeekStatements, type EmailSummary } from '@/lib/payroll-approve'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const GONE = () => NextResponse.json({ error: 'This link is no longer valid. Open Pay this week to approve.', code: 'link_invalid' }, { status: 410 })

async function authorize(token: string) {
  if (!isPayWeekEnabled()) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { res: NextResponse.json({ error: 'Sign in first', code: 'sign_in' }, { status: 401 }) } as const
  }
  const admin = createServiceClient()
  const link = await findApprovalLink(admin, token)
  if (!link || link.user_id !== profile.id || link.org_id !== profile.org_id) return { res: GONE() } as const
  return { admin, link, profile } as const
}

export async function GET(request: NextRequest) {
  const a = await authorize(request.nextUrl.searchParams.get('token') ?? '')
  if ('res' in a) return a.res
  try {
    const week = await loadPayWeek(a.admin, a.link.org_id, new Date(), a.link.payroll_period_id)
    return NextResponse.json({
      periodId: week.period.id,
      weekStart: week.period.weekStart,
      weekEnding: week.period.weekEnding,
      payDate: week.period.payDate,
      state: week.state,
      total: week.totals.amount,
      people: week.totals.people,
      notifiedTotal: a.link.notified_total,
      changedSinceMessage: Math.round(week.totals.amount * 100) !== Math.round(Number(a.link.notified_total) * 100),
      canApprove: week.canApprove && !week.blockedBy,
      needsCount: week.needs.length,
      warnings: week.warnings.map((w) => w.text),
      list: week.people.filter((p) => p.total > 0).map((p) => ({ name: p.name, total: p.total })),
    })
  } catch (e) {
    console.error('GET approve-link', e)
    return NextResponse.json({ error: 'Could not load this week' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; expectedTotal?: unknown } | null
  const expected = Number(body?.expectedTotal)
  if (typeof body?.token !== 'string' || !Number.isFinite(expected)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const a = await authorize(body.token)
  if ('res' in a) return a.res
  try {
    // The message promised a total. If the live week no longer matches it, the owner must look at the week first (no blind tap).
    const live = await loadPayWeek(a.admin, a.link.org_id, new Date(), a.link.payroll_period_id)
    if (Math.round(live.totals.amount * 100) !== Math.round(Number(a.link.notified_total) * 100)) {
      return NextResponse.json({ error: 'Pay changed since this message. Open the week.', code: 'changed_since_message' }, { status: 409 })
    }
    const r = await approvePayWeek(a.admin, { orgId: a.link.org_id, actorUserId: a.profile.id, periodId: a.link.payroll_period_id, expectedTotal: expected })
    if (!r.ok) return NextResponse.json(r.body, { status: r.status })
    await consumeApprovalLink(a.admin, a.link.id)
    // Same step the Pay screen runs after Approve (default on). The week is already approved: a mail problem only shows in the answer.
    let emailed: EmailSummary | { error: string } | null = null
    try {
      const res = await emailWeekStatements(a.admin, a.link.org_id, a.link.payroll_period_id)
      emailed = 'error' in res ? { error: res.error } : res
    } catch (e) {
      console.error('POST approve-link: statements', e)
      emailed = { error: 'Could not send the statements' }
    }
    return NextResponse.json({ ok: true, total: r.total, people: r.people, emailed })
  } catch (e) {
    console.error('POST approve-link', e)
    return NextResponse.json({ error: 'Could not approve. Nothing was paid.' }, { status: 500 })
  }
}
