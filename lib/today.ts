/**
 * "Today": the work queue each role opens the app to. Pure shaping of rows into queues plus the loaders; every list is
 * capped and every row links straight to where the work is done. One definition per queue — the owner view is the same
 * queues counted org-wide, "exceptions only".
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { formatDateShort, formatMoney, formatTime } from '@/lib/format'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'

export type TodayKind = 'setter' | 'ops' | 'owner' | 'closer'

export type QueueItem = { id: string; title: string; detail: string; href: string }
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
    })),
  }
}

type ProposalRow = { id: string; customer_name: string | null; proposal_number: string | number | null; total: number | null }
export function proposalQueue(rows: ProposalRow[], count: number): Queue {
  return {
    id: 'unsigned-proposals',
    title: 'Proposals waiting for a signature',
    count,
    empty: 'Nothing waiting on a customer.',
    items: rows.slice(0, LIST_CAP).map((p) => ({
      id: p.id,
      title: p.customer_name || 'Proposal',
      detail: `${p.proposal_number ? `#${p.proposal_number} · ` : ''}${formatMoney(p.total)}`,
      href: `/proposals/${p.id}`,
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
    })),
  }
}

export async function loadCloserQueues(admin: SupabaseClient, orgId: string, userId: string, now = new Date()): Promise<Queue[]> {
  const { start, end } = getDateRangeForTimeFrame('today', NY)
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const apptCols = 'id, address_text, scheduled_for, opportunity_id, lead_id'
  const [todayAppts, pastAppts, proposals] = await Promise.all([
    admin.from('scheduled_appointments').select(apptCols, { count: 'exact' }).eq('org_id', orgId).eq('closer_user_id', userId).eq('status', 'scheduled').gte('scheduled_for', start.toISOString()).lt('scheduled_for', end.toISOString()).gte('scheduled_for', now.toISOString()).order('scheduled_for').limit(LIST_CAP),
    admin.from('scheduled_appointments').select(apptCols, { count: 'exact' }).eq('org_id', orgId).eq('closer_user_id', userId).eq('status', 'scheduled').is('outcome_not_recorded_at', null).lt('scheduled_for', now.toISOString()).gte('scheduled_for', since).order('scheduled_for', { ascending: false }).limit(LIST_CAP),
    admin.from('proposals').select('id, customer_name, proposal_number, total', { count: 'exact' }).eq('org_id', orgId).eq('created_by', userId).eq('status', 'sent').order('sent_at', { ascending: true }).limit(LIST_CAP),
  ])
  ;[todayAppts, pastAppts, proposals].forEach(ok)
  return [
    apptQueue('today-appointments', "Today's appointments", (todayAppts.data ?? []) as ApptRow[], todayAppts.count ?? 0, 'No more appointments today.'),
    apptQueue('outcomes-to-log', 'Outcomes to log', (pastAppts.data ?? []) as ApptRow[], pastAppts.count ?? 0, 'Every past appointment has an outcome.', true),
    proposalQueue((proposals.data ?? []) as ProposalRow[], proposals.count ?? 0),
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

/** Owner: the same queues counted across the whole org; a queue with nothing in it is not shown ("exceptions only"). */
export async function loadOwnerExceptions(admin: SupabaseClient, orgId: string, now = new Date()): Promise<Queue[]> {
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(now)
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  // Same 14-day window as Needs you (older ones are owner clean-up, see lib/data-health.ts).
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const [noOutcome, stale, overdue, unscheduled] = await Promise.all([
    admin.from('scheduled_appointments').select('id, address_text, scheduled_for, opportunity_id, lead_id', { count: 'exact' }).eq('org_id', orgId).eq('status', 'scheduled').is('outcome_not_recorded_at', null).lt('scheduled_for', now.toISOString()).gte('scheduled_for', since).order('scheduled_for', { ascending: false }).limit(LIST_CAP),
    admin.from('proposals').select('id, customer_name, proposal_number, total', { count: 'exact' }).eq('org_id', orgId).eq('status', 'sent').lt('sent_at', weekAgo).order('sent_at', { ascending: true }).limit(LIST_CAP),
    admin.from('production_jobs').select('id, job_number, address_text, scheduled_date', { count: 'exact' }).eq('org_id', orgId).eq('status', 'scheduled').lt('scheduled_date', todayYmd).order('scheduled_date').limit(LIST_CAP),
    admin.from('production_jobs').select('id, job_number, address_text, scheduled_date', { count: 'exact' }).eq('org_id', orgId).in('status', ['sold', 'materials']).is('scheduled_date', null).order('sale_date').limit(LIST_CAP),
  ])
  ;[noOutcome, stale, overdue, unscheduled].forEach(ok)
  const queues = [
    apptQueue('no-outcome', 'Appointments with no outcome logged', (noOutcome.data ?? []) as ApptRow[], noOutcome.count ?? 0, '', true),
    { ...proposalQueue((stale.data ?? []) as ProposalRow[], stale.count ?? 0), title: 'Proposals sent over a week ago, still unsigned' },
    jobQueue('overdue-installs', 'Installs past their date and not started', (overdue.data ?? []) as JobRow[], overdue.count ?? 0, ''),
    jobQueue('unscheduled-jobs', 'Sold jobs with no install date', (unscheduled.data ?? []) as JobRow[], unscheduled.count ?? 0, ''),
  ]
  return queues.filter((q) => q.count > 0)
}
