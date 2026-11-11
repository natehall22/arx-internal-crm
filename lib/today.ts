/**
 * "Today": the work queue each role opens the app to. Pure shaping of rows into queues plus the loaders; every list is
 * capped and every row links straight to where the work is done. One definition per queue — the owner view is the same
 * queues counted org-wide, "exceptions only".
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { formatDateShort, formatDateWeekday, formatMoney, formatPhone, formatTime } from '@/lib/format'
import { formatStormEventDateLabel, formatStormMagnitudeLabel, type StormAlertLayer } from '@/lib/storm-opportunity-alerts'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { loadCheckups } from '@/lib/checkups'
import { addDaysToDateOnly } from '@/lib/install-calendar'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { SERVICE_VISIT_TYPE, SKIP_REASON_LABELS, addDaysYmd, ymdInZone } from '@/lib/service-plans'
import { loadVisits } from '@/lib/service-plans-db'
import { loadOrgTimeZone } from '@/lib/cron-orgs'

export type TodayKind = 'setter' | 'ops' | 'owner' | 'closer'

/**
 * `title`/`detail` are for the signed-in app screen. `ref`/`note` are the email version (morning update): a job or
 * proposal number and plain facts, never a customer name or address — except the storm-hits queue, which is a call
 * list and carries the customer's name and `phone` (owner "Everything" email only; Nathan, 2026-11-06).
 */
export type QueueItem = { id: string; title: string; detail: string; href: string; ref: string; note: string; phone?: string | null }
export type Queue = { id: string; title: string; count: number; items: QueueItem[]; empty: string }

export function todayKindFor(args: { role: string | null | undefined; isSuperuser: boolean; canJobBoard: boolean }): TodayKind {
  if (isSetterLikeRole(args.role)) return 'setter'
  if (args.role === 'operations') return 'ops'
  if (args.isSuperuser) return 'owner'
  if (args.canJobBoard && !['sales_rep', 'closer', 'sales_manager', 'regional_manager'].includes(args.role ?? '')) return 'ops'
  return 'closer'
}

const LIST_CAP = 8

/** A failed query must never look like an empty queue ("All clear"): throw so the page shows an error. */
function ok<T extends { error: unknown }>(r: T): T {
  if (r.error) throw r.error
  return r
}
const NY = 'America/New_York'

type ApptRow = { id: string; address_text: string | null; scheduled_for: string; opportunity_id: string | null; lead_id: string | null }
const apptHref = (a: ApptRow) => (a.opportunity_id ? `/opportunities/${a.opportunity_id}` : a.lead_id ? `/leads/${a.lead_id}` : '/appointments')

export function apptQueue(id: string, title: string, rows: ApptRow[], count: number, empty: string, withDay = false): Queue {
  return {
    id,
    title,
    count,
    empty,
    items: rows.slice(0, LIST_CAP).map((a) => ({
      id: a.id,
      title: a.address_text || 'Appointment',
      detail: withDay ? `${formatDateShort(a.scheduled_for)} · ${formatTime(a.scheduled_for)}` : formatTime(a.scheduled_for),
      href: apptHref(a),
      ref: 'Appointment',
      note: withDay ? `${formatDateShort(a.scheduled_for)} · ${formatTime(a.scheduled_for)}` : formatTime(a.scheduled_for),
    })),
  }
}

type ProposalRow = { id: string; customer_name: string | null; proposal_number: string | number | null; total: number | null; sent_at?: string | null }

type UnsignedRow = ProposalRow & { opportunity_id: string | null; pdf_generated_at: string | null; created_at: string }

/**
 * When a proposal started waiting. `sent_at` was never written when a proposal was saved as sent from the builder
 * (45 of 47 live 'sent' rows had none, 2026-11-05), so fall back to the PDF time, then creation.
 */
export function proposalWaitingSince(p: Pick<UnsignedRow, 'sent_at' | 'pdf_generated_at' | 'created_at'>): string {
  return p.sent_at || p.pdf_generated_at || p.created_at
}

/**
 * The one definition of "a proposal waiting for a signature": status 'sent', and its deal not already won or lost
 * (a won/lost deal's other proposals keep their old 'sent' label). Oldest first. `olderThan` keeps only those waiting
 * since before that moment. Returns the capped rows plus the true count.
 */
export async function loadUnsignedProposals(
  admin: SupabaseClient,
  orgId: string,
  opts: { createdBy?: string; olderThan?: Date } = {}
): Promise<{ rows: ProposalRow[]; count: number }> {
  let q = admin
    .from('proposals')
    .select('id, customer_name, proposal_number, total, sent_at, opportunity_id, pdf_generated_at, created_at')
    .eq('org_id', orgId)
    .eq('status', 'sent')
  if (opts.createdBy) q = q.eq('created_by', opts.createdBy)
  const rows = (ok(await q.order('created_at', { ascending: true }).limit(1000)).data ?? []) as UnsignedRow[]
  const oppIds = Array.from(new Set(rows.map((r) => r.opportunity_id).filter((v): v is string => Boolean(v))))
  const closed = new Set<string>()
  for (let i = 0; i < oppIds.length; i += 200) {
    const opps = ok(
      await admin.from('opportunities').select('id, status').eq('org_id', orgId).in('id', oppIds.slice(i, i + 200)).in('status', ['won', 'lost'])
    )
    for (const o of (opps.data ?? []) as Array<{ id: string }>) closed.add(o.id)
  }
  const cutoff = opts.olderThan?.getTime()
  const open = rows
    .filter((r) => !(r.opportunity_id && closed.has(r.opportunity_id)))
    .map((r) => ({ ...r, sent_at: proposalWaitingSince(r) }))
    .filter((r) => cutoff == null || new Date(r.sent_at).getTime() < cutoff)
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
  return { rows: open.slice(0, LIST_CAP), count: open.length }
}
/** `money` = the viewer has reports:financials; without it the proposal total is not shown. */
export function proposalQueue(rows: ProposalRow[], count: number, money = false): Queue {
  return {
    id: 'unsigned-proposals',
    title: 'Proposals waiting for a signature',
    count,
    empty: 'Nothing waiting on a customer.',
    items: rows.slice(0, LIST_CAP).map((p) => ({
      id: p.id,
      title: p.customer_name || 'Proposal',
      detail: `${p.proposal_number ? `#${p.proposal_number} · ` : ''}${money ? formatMoney(p.total) : ''}`.replace(/ · $/, '') || 'Sent',
      href: `/proposals/${p.id}`,
      ref: p.proposal_number ? `Proposal #${p.proposal_number}` : 'Proposal',
      note: p.sent_at ? `waiting since ${formatDateShort(p.sent_at)}` : 'waiting',
    })),
  }
}

type JobRow = { id: string; job_number: string | null; address_text: string | null; scheduled_date: string | null; sale_amount?: number | null }
export function jobQueue(id: string, title: string, rows: JobRow[], count: number, empty: string): Queue {
  return {
    id,
    title,
    count,
    empty,
    items: rows.slice(0, LIST_CAP).map((j) => ({
      id: j.id,
      title: `Job ${j.job_number ?? ''}`.trim(),
      detail: [j.address_text, j.scheduled_date ? `install ${j.scheduled_date}` : null].filter(Boolean).join(' · '),
      href: `/ops/jobs/${j.id}`,
      ref: `Job ${j.job_number ?? ''}`.trim(),
      note: j.scheduled_date ? `install ${formatDateShort(j.scheduled_date)}` : '',
    })),
  }
}

type CrewRow = { id: string; job_id: string | null; trade: string | null; scheduled_date: string; assigned_sub_id: string | null }

/** Every crew (trade) on the calendar from today through the next 6 days, soonest first. Cancelled jobs are left out. */
export async function loadCrewWeekQueue(admin: SupabaseClient, orgId: string, now = new Date()): Promise<Queue> {
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(now)
  const crews = ok(
    await admin
      .from('work_orders')
      .select('id, job_id, trade, scheduled_date, assigned_sub_id')
      .eq('org_id', orgId)
      .not('trade', 'is', null)
      // Install crews only: service-plan visits (lib/service-plans.ts) have their own Visits list.
      .neq('work_order_type', SERVICE_VISIT_TYPE)
      .not('status', 'in', '(completed,cancelled)')
      .gte('scheduled_date', todayYmd)
      .lte('scheduled_date', addDaysToDateOnly(todayYmd, 6))
      .order('scheduled_date')
      .limit(200)
  )
  const rows = (crews.data ?? []) as CrewRow[]
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id).filter((v): v is string => Boolean(v))))
  const subIds = Array.from(new Set(rows.map((r) => r.assigned_sub_id).filter((v): v is string => Boolean(v))))
  const [jobs, subs, orgTrades] = await Promise.all([
    jobIds.length
      ? admin.from('production_jobs').select('id, job_number, address_text, status').eq('org_id', orgId).in('id', jobIds)
      : Promise.resolve({ data: [], error: null }),
    subIds.length
      ? admin.from('sub_contractors').select('id, company_name').eq('org_id', orgId).in('id', subIds)
      : Promise.resolve({ data: [], error: null }),
    rows.length ? loadOrgTrades(admin, orgId) : Promise.resolve([]),
  ])
  ;[jobs, subs].forEach(ok)
  const jobById = new Map(((jobs.data ?? []) as Array<{ id: string; job_number: string | null; address_text: string | null; status: string }>).map((j) => [j.id, j]))
  const subById = new Map(((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => [s.id, s.company_name]))
  const live = rows.filter((r) => {
    const job = r.job_id ? jobById.get(r.job_id) : null
    return job && job.status !== 'cancelled'
  })
  return {
    id: 'crews-this-week',
    title: 'Crews this week',
    count: live.length,
    empty: 'No crews on the calendar this week.',
    items: live.slice(0, LIST_CAP).map((r) => {
      const job = jobById.get(r.job_id as string)!
      const trade = r.trade ? tradeLabel(r.trade, orgTrades) : 'Crew'
      const sub = (r.assigned_sub_id && subById.get(r.assigned_sub_id)) || 'no crew assigned'
      const facts = `${formatDateWeekday(r.scheduled_date)} · ${trade} · ${sub}`
      return {
        id: r.id,
        title: `Job ${job.job_number ?? ''}`.trim(),
        detail: [facts, job.address_text].filter(Boolean).join(' · '),
        href: `/ops/jobs/${job.id}`,
        ref: `Job ${job.job_number ?? ''}`.trim(),
        note: facts,
      }
    }),
  }
}

export async function loadCloserQueues(admin: SupabaseClient, orgId: string, userId: string, now = new Date(), opts: { money?: boolean } = {}): Promise<Queue[]> {
  const { start, end } = getDateRangeForTimeFrame('today', NY)
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const apptCols = 'id, address_text, scheduled_for, opportunity_id, lead_id'
  const [todayAppts, pastAppts, unsigned] = await Promise.all([
    admin.from('scheduled_appointments').select(apptCols, { count: 'exact' }).eq('org_id', orgId).eq('closer_user_id', userId).eq('status', 'scheduled').gte('scheduled_for', start.toISOString()).lt('scheduled_for', end.toISOString()).gte('scheduled_for', now.toISOString()).order('scheduled_for').limit(LIST_CAP),
    admin.from('scheduled_appointments').select(apptCols, { count: 'exact' }).eq('org_id', orgId).eq('closer_user_id', userId).eq('status', 'scheduled').is('outcome_not_recorded_at', null).lt('scheduled_for', now.toISOString()).gte('scheduled_for', since).order('scheduled_for', { ascending: false }).limit(LIST_CAP),
    loadUnsignedProposals(admin, orgId, { createdBy: userId }),
  ])
  ;[todayAppts, pastAppts].forEach(ok)
  return [
    apptQueue('today-appointments', "Today's appointments", (todayAppts.data ?? []) as ApptRow[], todayAppts.count ?? 0, 'No more appointments today.'),
    apptQueue('outcomes-to-log', 'Outcomes to log', (pastAppts.data ?? []) as ApptRow[], pastAppts.count ?? 0, 'Every past appointment has an outcome.', true),
    proposalQueue(unsigned.rows, unsigned.count, opts.money),
  ]
}

export async function loadOpsQueues(admin: SupabaseClient, orgId: string): Promise<Queue[]> {
  const cols = 'id, job_number, address_text, scheduled_date'
  const base = () => admin.from('production_jobs').select(cols, { count: 'exact' }).eq('org_id', orgId).neq('status', 'cancelled')
  const [toSchedule, toOrder, awaiting] = await Promise.all([
    base().in('status', ['sold', 'materials']).is('scheduled_date', null).order('sale_date', { ascending: true }).limit(LIST_CAP),
    base().in('status', ['sold', 'materials', 'scheduled', 'in_progress']).eq('materials_status', 'not_ordered').order('scheduled_date', { ascending: true, nullsFirst: false }).limit(LIST_CAP),
    base().eq('status', 'complete').order('sale_date', { ascending: true }).limit(LIST_CAP),
  ])
  ;[toSchedule, toOrder, awaiting].forEach(ok)
  return [
    jobQueue('jobs-to-schedule', 'Jobs to schedule', (toSchedule.data ?? []) as JobRow[], toSchedule.count ?? 0, 'Every sold job has an install date.'),
    jobQueue('orders-to-send', 'Orders to send', (toOrder.data ?? []) as JobRow[], toOrder.count ?? 0, 'Materials are ordered on every open job.'),
    jobQueue('awaiting-payment', 'Finished, waiting on payment', (awaiting.data ?? []) as JobRow[], awaiting.count ?? 0, 'Nothing is waiting on payment.'),
  ]
}

/** Storm hits stay listed this many days, so a weekend storm is still on Monday's list. */
const STORM_HIT_DAYS = 3

type StormAlertRow = {
  opportunity_id: string
  event_date: string
  layer: string
  magnitude: number | string | null
  damage: boolean | null
  distance_miles: number | string | null
  match_source: string | null
  routed: boolean | null
  created_at: string
}

/**
 * Open deals and sold customers a storm just hit — a call list. Reads what the storm-alert cron already matched
 * (`storm_opportunity_alerts`); nothing is re-matched here. One line per deal (its biggest hit), newest storm first.
 * Lost deals drop off; sold deals are listed as "customer" (installed or not). Inside-sales routing is untouched; this only lists.
 */
export async function loadStormHitsQueue(admin: SupabaseClient, orgId: string, now = new Date(), cap = LIST_CAP): Promise<Queue> {
  const since = new Date(now.getTime() - STORM_HIT_DAYS * 86_400_000).toISOString()
  const alerts = ok(
    await admin
      .from('storm_opportunity_alerts')
      .select('opportunity_id, event_date, layer, magnitude, damage, distance_miles, match_source, routed, created_at')
      .eq('org_id', orgId)
      .gte('created_at', since)
      .order('event_date', { ascending: false })
      .limit(500)
  )
  const rows = (alerts.data ?? []) as StormAlertRow[]
  // Per deal: show its biggest hit (hail beats wind, then size), sort by its latest storm, and remember whether the
  // cron routed it to inside sales (it skips deals a rep is already working, e.g. a close is booked).
  const score = (x: StormAlertRow) => (x.layer === 'hail' ? 1000 : 0) + Number(x.magnitude ?? 0)
  const best = new Map<string, StormAlertRow>()
  const latest = new Map<string, string>()
  const routed = new Set<string>()
  for (const r of rows) {
    const cur = best.get(r.opportunity_id)
    if (!cur || score(r) > score(cur)) best.set(r.opportunity_id, r)
    if ((latest.get(r.opportunity_id) ?? '') < r.event_date) latest.set(r.opportunity_id, r.event_date)
    if (r.routed) routed.add(r.opportunity_id)
  }
  const oppIds = Array.from(best.keys())
  type Opp = { id: string; status: string | null; leads: { homeowner_name: string | null; phone: string | null } | Array<{ homeowner_name: string | null; phone: string | null }> | null }
  const opps: Opp[] = []
  for (let i = 0; i < oppIds.length; i += 200) {
    const res = ok(
      await admin
        .from('opportunities')
        .select('id, status, leads(homeowner_name, phone)')
        .eq('org_id', orgId)
        .in('id', oppIds.slice(i, i + 200))
    )
    opps.push(...((res.data ?? []) as Opp[]))
  }
  const open = opps
    .filter((o) => o.status !== 'lost')
    .map((o) => ({ opp: o, alert: best.get(o.id)! }))
    // Newest storm first; same day → bigger hit first; then id, so the list never reshuffles between emails.
    .sort(
      (a, b) =>
        (latest.get(b.opp.id) ?? '').localeCompare(latest.get(a.opp.id) ?? '') ||
        score(b.alert) - score(a.alert) ||
        a.opp.id.localeCompare(b.opp.id)
    )
  return {
    id: 'storm-hits',
    title: 'Storm hits on open deals and customers',
    count: open.length,
    empty: 'No new storm hits on open deals or customers.',
    items: open.slice(0, cap).map(({ opp, alert }) => {
      const lead = Array.isArray(opp.leads) ? opp.leads[0] : opp.leads
      const name = lead?.homeowner_name?.trim() || 'Customer'
      // Keep any number on a call list; only dialable ones become tap-to-call (see the email renderer).
      const phone = lead?.phone?.trim() || null
      const distance = Number(alert.distance_miles ?? 0)
      const where = alert.match_source === 'swath' && distance <= 0 ? 'inside the storm area' : `${distance.toFixed(1)} mi away`
      const facts = [
        formatStormMagnitudeLabel((alert.layer === 'hail' ? 'hail' : 'wind') as StormAlertLayer, { magnitude: Number(alert.magnitude ?? 0), damage: Boolean(alert.damage) }),
        formatStormEventDateLabel(alert.event_date),
        where,
        opp.status === 'won' ? 'customer' : routed.has(opp.id) ? null : 'a rep is already working this deal',
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        id: opp.id,
        title: name,
        detail: [facts, phone ? formatPhone(phone) : null].filter(Boolean).join(' · '),
        href: `/opportunities/${opp.id}`,
        ref: name,
        note: facts,
        phone,
      }
    }),
  }
}

/** Owner: the same queues counted across the whole org; a queue with nothing in it is not shown ("exceptions only"). */
export async function loadOwnerExceptions(admin: SupabaseClient, orgId: string, now = new Date(), opts: { money?: boolean } = { money: true }): Promise<Queue[]> {
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(now)
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  // Same 14-day window as Needs you (older ones are owner clean-up, see lib/data-health.ts).
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const [noOutcome, stale, overdue, unscheduled] = await Promise.all([
    admin.from('scheduled_appointments').select('id, address_text, scheduled_for, opportunity_id, lead_id', { count: 'exact' }).eq('org_id', orgId).eq('status', 'scheduled').is('outcome_not_recorded_at', null).lt('scheduled_for', now.toISOString()).gte('scheduled_for', since).order('scheduled_for', { ascending: false }).limit(LIST_CAP),
    loadUnsignedProposals(admin, orgId, { olderThan: weekAgo }),
    admin.from('production_jobs').select('id, job_number, address_text, scheduled_date', { count: 'exact' }).eq('org_id', orgId).eq('status', 'scheduled').lt('scheduled_date', todayYmd).order('scheduled_date').limit(LIST_CAP),
    admin.from('production_jobs').select('id, job_number, address_text, scheduled_date', { count: 'exact' }).eq('org_id', orgId).in('status', ['sold', 'materials']).is('scheduled_date', null).order('sale_date').limit(LIST_CAP),
  ])
  ;[noOutcome, overdue, unscheduled].forEach(ok)
  const queues = [
    apptQueue('no-outcome', 'Appointments with no outcome logged', (noOutcome.data ?? []) as ApptRow[], noOutcome.count ?? 0, '', true),
    { ...proposalQueue(stale.rows, stale.count, opts.money), title: 'Proposals waiting over a week, still unsigned' },
    jobQueue('overdue-installs', 'Installs past their date and not started', (overdue.data ?? []) as JobRow[], overdue.count ?? 0, ''),
    jobQueue('unscheduled-jobs', 'Sold jobs with no install date', (unscheduled.data ?? []) as JobRow[], unscheduled.count ?? 0, ''),
  ]
  return queues.filter((q) => q.count > 0)
}

/**
 * Customer checkups due now (lib/checkups.ts): open checkups whose due date has come, plus visits booked for today or
 * earlier that still have no result.
 * Email-safe like every other queue here — job number and plain facts, no customer name or address.
 */
export async function loadCheckupsDueQueue(admin: SupabaseClient, orgId: string, now = new Date(), cap = LIST_CAP): Promise<Queue> {
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(now)
  const rows = (await loadCheckups(admin, orgId, { open: true })).filter(
    (c) => (c.status === 'due' && c.due_on <= todayYmd) || (c.status === 'booked' && !!c.booked_for && c.booked_for <= todayYmd)
  )
  return {
    id: 'checkups-due',
    title: 'Customer checkups due',
    count: rows.length,
    empty: 'No customer checkups due.',
    items: rows.slice(0, cap).map((c) => {
      const when = c.status === 'booked' ? (c.booked_for === todayYmd ? 'visit booked today' : `visit was booked ${formatDateShort(c.booked_for)}, no result yet`) : c.due_on < todayYmd ? `overdue since ${formatDateShort(c.due_on)}` : 'due today'
      const note = [c.label, when, c.attempts > 0 ? `tried ${c.attempts}×` : null].filter(Boolean).join(' · ')
      return {
        id: c.id,
        title: c.customerName || c.label,
        detail: note,
        href: '/ops/checkups',
        ref: c.jobNumber ? `Job ${c.jobNumber}` : 'Checkup',
        note,
      }
    }),
  }
}

/**
 * Service-plan visits (lib/service-plans-db.ts) for companies with the servicePlans switch on: today's visits, one line
 * per crew, and visits skipped in the last 7 days. Email-safe: crew names, plan names and counts, no customer or address.
 * Ids match the industry profiles' planned Today cards ('todays-visits', 'skipped-visits').
 */
export async function loadServiceVisitQueues(admin: SupabaseClient, orgId: string, now = new Date()): Promise<Queue[]> {
  const today = ymdInZone(now, await loadOrgTimeZone(admin, orgId))
  const [todays, recent] = await Promise.all([
    loadVisits(admin, orgId, { from: today, to: today, accessNotes: false }),
    loadVisits(admin, orgId, { from: addDaysYmd(today, -7), to: addDaysYmd(today, -1), accessNotes: false }),
  ])
  const byCrew = new Map<string, { name: string; total: number; done: number; open: number }>()
  for (const v of todays.filter((x) => x.status !== 'cancelled')) {
    const key = v.subId ?? (v.userId ? `u:${v.userId}` : 'none')
    const name = v.subName ?? v.userName ?? 'No crew assigned'
    const c = byCrew.get(key) ?? { name, total: 0, done: 0, open: 0 }
    c.total += 1
    if (v.status === 'completed' || v.status === 'skipped') c.done += 1
    else c.open += 1
    byCrew.set(key, c)
  }
  const crewItems = Array.from(byCrew.entries()).map(([key, c]) => {
    const note = `${c.total} visit${c.total === 1 ? '' : 's'}${c.done ? ` · ${c.done} finished` : ''}`
    return { id: key, title: c.name, detail: note, href: '/ops/schedule?view=visits', ref: c.name, note }
  })
  const skipped = recent.filter((v) => v.status === 'skipped')
  return [
    {
      id: 'todays-visits',
      title: "Today's visits",
      count: todays.filter((v) => v.status === 'scheduled').length,
      empty: 'No visits left today.',
      items: crewItems.slice(0, LIST_CAP),
    },
    {
      id: 'skipped-visits',
      title: 'Visits skipped this week',
      count: skipped.length,
      empty: 'No visits skipped.',
      items: skipped.slice(0, LIST_CAP).map((v) => {
        const why = v.skipReason ? SKIP_REASON_LABELS[v.skipReason as keyof typeof SKIP_REASON_LABELS] ?? v.skipReason : 'skipped'
        const note = `${formatDateShort(v.scheduledDate)} · ${why}`
        return { id: v.id, title: v.planName, detail: note, href: '/ops/schedule?view=visits', ref: v.workOrderNumber ?? 'Visit', note }
      }),
    },
  ].filter((q) => q.count > 0 || q.items.length > 0)
}
