import { NextResponse } from 'next/server'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { categoryScopeOf } from '@/lib/category-scope'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_PLANS_NOT_READY, createOneOffVisit, crewDayLinkSubIds, ensureServiceVisits, loadVisitsPage } from '@/lib/service-plans-db'
import { addDaysYmd, daysBetweenYmd, isYmd, ymdInZone } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'
import { loadCrewIncentivesState, loadVisitMarks } from '@/lib/crew-incentives-db'
import { canSeeAllReminders, checkReminderForVisit, setReminderDone } from '@/lib/reminders'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { loadOrgTrades, tradeOptions } from '@/lib/org-trades'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ops/visits?from=YYYY-MM-DD&to=YYYY-MM-DD&crew=<subId>|none|mine — service visits on those days (default:
 * this week from today; `mine` = visits assigned to me, e.g. an inspector's follow-ons), plus the crews list. Tops up the
 * visit horizon first (the generator is idempotent). Paged: `offset` (default 0) → `{ visits, total, hasMore }`, so a big
 * week is never silently cut off — the screen offers "Load more".
 */
export async function GET(request: Request) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const url = new URL(request.url)
  const timeZone = await loadOrgTimeZone(ctx.admin, ctx.orgId)
  const today = ymdInZone(new Date(), timeZone)
  const from = isYmd(url.searchParams.get('from')) ? (url.searchParams.get('from') as string) : today
  const toRaw = url.searchParams.get('to')
  const to = isYmd(toRaw) ? toRaw : addDaysYmd(from, 6)
  if (to < from || daysBetweenYmd(from, to) > 62) return NextResponse.json({ error: 'Pick up to 9 weeks' }, { status: 400 })
  const crew = url.searchParams.get('crew')

  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  // The horizon top-up runs on the first page only (a "Load more" never re-runs it).
  if (offset === 0) await ensureServiceVisits(ctx.admin, ctx.orgId, { timeZone }).catch((e) => console.error('[visits] ensure failed', e))
  const filter = crew === 'mine' ? { from, to, userId: ctx.userId, accessNotes: true, scope: categoryScopeOf(ctx.profile) } : { from, to, subId: crew === 'none' ? null : crew || undefined, accessNotes: true, scope: categoryScopeOf(ctx.profile) }
  const [page, subs, linked] = await Promise.all([
    loadVisitsPage(ctx.admin, ctx.orgId, { ...filter, offset }),
    orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id, company_name, phone').eq('active', true).order('company_name'),
    crewDayLinkSubIds(ctx.admin, ctx.orgId),
  ])
  // Crew incentives (lawn_landscape companies that turned them on): the staff marks shown on each finished visit. Absent otherwise.
  const incentivesOn = ctx.access.edit && (await loadCrewIncentivesState(ctx.admin, ctx.orgId)).active
  const incentiveMarks = incentivesOn
    ? await loadVisitMarks(ctx.admin, ctx.orgId, page.visits.filter((v) => v.status === 'completed').map((v) => v.id)).catch(() => ({}))
    : null
  return NextResponse.json({
    ...(incentiveMarks ? { incentiveMarks } : {}),
    today,
    from,
    to,
    visits: page.visits,
    total: page.total,
    hasMore: page.hasMore,
    offset,
    canEdit: ctx.access.edit,
    /** The company's trades (the trade chips on the filter bar). */
    orgTrades: tradeOptions(await loadOrgTrades(ctx.admin, ctx.orgId)),
    // Phone only for editors (they send the crew its link by text).
    crews: ((subs.data ?? []) as Array<{ id: string; company_name: string | null; phone: string | null }>).map((s) => ({ id: s.id, name: s.company_name ?? 'Crew', hasPhoneLink: linked.has(s.id), phone: ctx.access.edit ? s.phone : null })),
  })
}

/**
 * POST /api/ops/visits — a ONE-OFF visit for a customer's property (the Visits board and the customer page share it).
 * body: { customer_id, property_id, trade, date, name?, service_lines?, price?, taxable?, sub_id?, notes? }. It is a plan that
 * starts and ends that day (lib/service-plans-db.ts createOneOffVisit), so the visit has a visit code, a crew-day stop and a
 * price like any plan visit and is billed the same way. Needs the same permission as starting a plan.
 * Optional `reminder_id`: a visit made from a reminder (Today "Make a visit"). The reminder is checked BEFORE anything is made (this
 * company's, the person may finish it, about this customer), and marked done through setReminderDone after the visit is saved. A reminder that is already done is refused (409)
 * unless the idempotency_key is that of an existing visit (a retry: same visit back, the reminder is not touched again); a reminder
 * that names a property only makes a visit at that property.
 */
export async function POST(request: Request) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const customerId = typeof body?.customer_id === 'string' ? body.customer_id : ''
  if (!customerId) return NextResponse.json({ error: 'Pick the customer' }, { status: 400 })
  const { data: customer } = await orgDb(ctx.admin, ctx.orgId).from('customers').select('id').eq('id', customerId).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const reminderId = body?.reminder_id
  const actor = { id: ctx.userId, seesAll: canSeeAllReminders(ctx.profile) }
  let reminderAlreadyDone = false
  if (reminderId !== undefined && reminderId !== null && reminderId !== '') {
    if (!(await isOrgFeatureOn(ctx.orgId, 'reminders'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ok = await checkReminderForVisit(ctx.admin, ctx.orgId, actor, reminderId, { customerId, propertyId: body?.property_id, oneOffKey: body?.idempotency_key })
    if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: ok.status })
    reminderAlreadyDone = ok.alreadyDone
  }
  const result = await createOneOffVisit(ctx.admin, ctx.orgId, ctx.userId, customerId, body)
  if (!result.ok) return NextResponse.json({ error: result.status === 503 ? SERVICE_PLANS_NOT_READY : result.error }, { status: result.status })
  let reminderDone: boolean | undefined
  if (typeof reminderId === 'string' && reminderId && !reminderAlreadyDone) {
    reminderDone = (await setReminderDone(ctx.admin, ctx.orgId, actor, reminderId, true)).ok
  }
  return NextResponse.json({ visitId: result.visitId, workOrderNumber: result.workOrderNumber, date: result.date, ...(reminderDone === undefined ? {} : { reminderDone }) }, { status: 201 })
}
