/**
 * "All work" (server, read-only): everything on the calendar between two days, merged for the owner / office —
 *   install  trade work orders (work_orders.trade, by crew)      → type 'job'
 *   stage    planned job stages not yet booked to a crew         → type 'job'
 *   visit    service-plan visits (loadVisits)                    → type 'visit'
 *   appointment  sales inspections / closes (scheduled_appointments) → type 'appointment', ONLY when the viewer may see every
 *            appointment (resolveCanReassignAppointment, the permission the Appointments screen already uses).
 * Reuses the existing loaders; it writes nothing and carries no money. The viewer's gates are decided by the caller.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { calendarDaySpan } from '@/lib/job-trades'
import { isYmd, stageEnd } from '@/lib/job-schedule'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { isMissingProjectToolsSchema } from '@/lib/project-tools/budget-db'
import { addDaysYmd, daysBetweenYmd, SERVICE_STEP, ymdInZone } from '@/lib/service-plans'
import { loadVisits } from '@/lib/service-plans-db'
import type { WorkFilterable, WorkType } from '@/lib/schedule-filters'
import { orgDb } from '@/lib/supabase/org-db'
import { loadWorkOrderRollCounts } from '@/lib/work-order-moves-db'

export type WorkItem = WorkFilterable & {
  key: string
  kind: 'install' | 'visit' | 'stage' | 'appointment'
  type: WorkType
  /** First and last day it sits on (bare YYYY-MM-DD, org time zone). */
  date: string
  endDate: string
  title: string
  subtitle: string | null
  /** 'HH:MM' for a timed item, else null. */
  time: string | null
  crewName: string | null
  techName: string | null
  status: string
  /** Where a tap goes (staff screens). */
  href: string
  rolls: number
}

export type AllWork = { items: WorkItem[]; trades: Array<{ slug: string; label: string; active: boolean }>; from: string; to: string }

export const ALL_WORK_MAX_DAYS = 62

type Viewer = { visits: boolean; appointments: boolean; timeZone: string }

const CAP = 2000

export async function loadAllWork(admin: SupabaseClient, orgId: string, from: string, to: string, viewer: Viewer): Promise<AllWork> {
  if (!isYmd(from) || !isYmd(to) || to < from || daysBetweenYmd(from, to) > ALL_WORK_MAX_DAYS) throw new Error('Pick up to 9 weeks')
  const db = orgDb(admin, orgId)
  const orgTrades = await loadOrgTrades(admin, orgId)
  const items: WorkItem[] = []

  const [wos, visits, stages, appts, subs] = await Promise.all([
    db
      .from('work_orders')
      .select('id, job_id, trade, status, assigned_sub_id, scheduled_date, scheduled_time_start, install_days, work_order_number')
      .eq('work_order_type', 'install')
      .not('trade', 'is', null)
      .not('job_id', 'is', null)
      .neq('status', 'cancelled')
      .gte('scheduled_date', addDaysYmd(from, -1))
      .lte('scheduled_date', to)
      .order('scheduled_date')
      .limit(CAP),
    viewer.visits ? loadVisits(admin, orgId, { from, to, accessNotes: false }) : Promise.resolve([]),
    db.from('job_stages').select('id, job_id, name, trade, work_order_id, start_date, workdays, done_at').gte('start_date', addDaysYmd(from, -60)).lte('start_date', to).limit(CAP),
    viewer.appointments ? loadAppointments(admin, orgId, from, to, viewer.timeZone) : Promise.resolve([]),
    db.from('sub_contractors').select('id, company_name'),
  ])
  if (wos.error) throw wos.error
  const subName = new Map(((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => [s.id, s.company_name ?? 'Crew']))

  const stageRows = stages.error ? (isMissingProjectToolsSchema(stages.error) ? [] : (console.error('[all-work] stages failed', stages.error), [])) : ((stages.data ?? []) as Array<Record<string, unknown>>)
  const woRows = (wos.data ?? []) as Array<{ id: string; job_id: string; trade: string; status: string; assigned_sub_id: string | null; scheduled_date: string | null; scheduled_time_start: string | null; install_days: unknown; work_order_number: string | null }>
  const bookedStageWo = new Set(stageRows.map((s) => s.work_order_id).filter((x): x is string => typeof x === 'string'))

  // Jobs behind the trade work orders and the stages (number, address, customer).
  const jobIds = Array.from(new Set([...woRows.map((w) => w.job_id), ...stageRows.map((s) => String(s.job_id))]))
  const jobs = new Map<string, { id: string; job_number: string | null; address_text: string | null; cancelled_at: string | null; status: string | null; customer: { id: string; name: string | null } | null }>()
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data } = await db.from('production_jobs').select('id, job_number, address_text, cancelled_at, status, customer:customers(id, name)').in('id', jobIds.slice(i, i + 200))
    for (const j of (data ?? []) as unknown as Array<{ id: string; job_number: string | null; address_text: string | null; cancelled_at: string | null; status: string | null; customer: { id: string; name: string | null } | Array<{ id: string; name: string | null }> | null }>)
      jobs.set(j.id, { ...j, customer: Array.isArray(j.customer) ? (j.customer[0] ?? null) : j.customer })
  }
  const live = (jobId: string) => {
    const j = jobs.get(jobId)
    return j && !j.cancelled_at && j.status !== 'cancelled' ? j : null
  }

  const rolls = await loadWorkOrderRollCounts(admin, orgId, woRows.map((w) => w.id))

  for (const w of woRows) {
    const j = live(w.job_id)
    if (!j || !w.scheduled_date) continue
    const end = addDaysYmd(w.scheduled_date, calendarDaySpan(w.install_days) - 1)
    if (end < from || w.scheduled_date > to) continue
    items.push({
      key: `wo:${w.id}`, kind: 'install', type: 'job', date: w.scheduled_date, endDate: end,
      title: `${tradeLabel(w.trade, orgTrades)} · ${j.job_number ?? ''}`.trim(), subtitle: j.address_text, time: w.scheduled_time_start ? w.scheduled_time_start.slice(0, 5) : null,
      trade: w.trade, crewId: w.assigned_sub_id, crewName: w.assigned_sub_id ? (subName.get(w.assigned_sub_id) ?? null) : null, techId: null, techName: null,
      customerId: j.customer?.id ?? null, customerName: j.customer?.name ?? null, status: w.status, href: `/ops/jobs/${w.job_id}#job-trades`, rolls: rolls.get(w.id) ?? 0,
      text: [j.job_number, j.customer?.name, j.address_text, tradeLabel(w.trade, orgTrades), w.assigned_sub_id ? subName.get(w.assigned_sub_id) : ''].filter(Boolean).join(' '),
    })
  }

  for (const s of stageRows) {
    // A stage booked to a crew is already on the calendar as that crew's work order (above): never twice.
    if (s.done_at || (typeof s.work_order_id === 'string' && bookedStageWo.has(s.work_order_id) && woRows.some((w) => w.id === s.work_order_id))) continue
    const j = live(String(s.job_id))
    const start = String(s.start_date)
    const end = stageEnd({ start, workdays: Number(s.workdays) || 1 })
    if (!j || end < from || start > to) continue
    const trade = (s.trade as string | null) ?? null
    items.push({
      key: `stage:${s.id}`, kind: 'stage', type: 'job', date: start, endDate: end, title: `${String(s.name)} · ${j.job_number ?? ''}`.trim(), subtitle: j.address_text, time: null,
      trade, crewId: null, crewName: null, techId: null, techName: null, customerId: j.customer?.id ?? null, customerName: j.customer?.name ?? null,
      status: 'planned', href: `/ops/jobs/${j.id}`, rolls: 0,
      text: [String(s.name), j.job_number, j.customer?.name, j.address_text, trade ? tradeLabel(trade, orgTrades) : ''].filter(Boolean).join(' '),
    })
  }

  const community = await loadCommunities(admin, orgId, visits.map((v) => v.propertyId))
  for (const v of visits) {
    if (v.status === 'cancelled') continue
    const what = v.step !== SERVICE_STEP && v.stepLabel ? `${v.stepLabel} — ${v.planName}` : v.planName
    const trade = v.trade || null
    items.push({
      key: `visit:${v.id}`, kind: 'visit', type: 'visit', date: v.scheduledDate, endDate: v.scheduledDate, title: what, subtitle: v.address, time: null,
      trade, crewId: v.subId, crewName: v.subName, techId: v.userId, techName: v.userName, customerId: v.customerId, customerName: v.customerName,
      community: v.propertyId ? (community.get(v.propertyId) ?? null) : null, status: v.status, href: '/ops/schedule', rolls: v.rolls,
      text: [what, v.workOrderNumber, v.customerName, v.address, v.subName, v.userName, v.propertyId ? community.get(v.propertyId) : ''].filter(Boolean).join(' '),
    })
  }

  items.push(...appts)
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.key.localeCompare(b.key))
  return { items, trades: orgTrades.map((t) => ({ slug: t.slug, label: t.label, active: t.active })), from, to }
}

/** properties.community (the development / subdivision) — absent until that column exists; then no development filter. */
async function loadCommunities(admin: SupabaseClient, orgId: string, propertyIds: Array<string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(propertyIds.filter((x): x is string => !!x)))
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await orgDb(admin, orgId).from('properties').select('id, community').in('id', ids.slice(i, i + 200))
    if (error) return out
    for (const r of (data ?? []) as Array<{ id: string; community: string | null }>) if (r.community?.trim()) out.set(r.id, r.community.trim())
  }
  return out
}

async function loadAppointments(admin: SupabaseClient, orgId: string, from: string, to: string, timeZone: string): Promise<WorkItem[]> {
  const { data, error } = await orgDb(admin, orgId)
    .from('scheduled_appointments')
    .select('id, scheduled_for, status, appointment_type, closer_user_id, lead:leads(homeowner_name, address_text)')
    // Padded a day each side; the exact day is decided in the org time zone below.
    .gte('scheduled_for', `${addDaysYmd(from, -1)}T00:00:00Z`)
    .lte('scheduled_for', `${addDaysYmd(to, 2)}T00:00:00Z`)
    .neq('status', 'cancelled')
    .order('scheduled_for')
    .limit(CAP)
  if (error) {
    console.error('[all-work] appointments failed', error)
    return []
  }
  const rows = (data ?? []) as unknown as Array<{ id: string; scheduled_for: string; status: string; appointment_type: string | null; closer_user_id: string | null; lead: { homeowner_name: string | null; address_text: string | null } | Array<{ homeowner_name: string | null; address_text: string | null }> | null }>
  const closers = Array.from(new Set(rows.map((r) => r.closer_user_id).filter((x): x is string => !!x)))
  const names = new Map<string, string>()
  if (closers.length) {
    const { data: us } = await orgDb(admin, orgId).from('users').select('id, full_name').in('id', closers)
    for (const u of (us ?? []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, u.full_name ?? 'Staff')
  }
  const out: WorkItem[] = []
  for (const r of rows) {
    const at = new Date(r.scheduled_for)
    const day = ymdInZone(at, timeZone)
    if (day < from || day > to) continue
    const lead = Array.isArray(r.lead) ? (r.lead[0] ?? null) : r.lead
    const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
    const kind = (r.appointment_type ?? 'appointment').replace(/_/g, ' ')
    out.push({
      key: `appt:${r.id}`, kind: 'appointment', type: 'appointment', date: day, endDate: day, title: kind.charAt(0).toUpperCase() + kind.slice(1), subtitle: lead?.address_text ?? null, time,
      trade: null, crewId: null, crewName: null, techId: r.closer_user_id, techName: r.closer_user_id ? (names.get(r.closer_user_id) ?? null) : null,
      customerId: null, customerName: lead?.homeowner_name ?? null, status: r.status, href: '/appointments?view=calendar', rolls: 0,
      text: [kind, lead?.homeowner_name, lead?.address_text, r.closer_user_id ? names.get(r.closer_user_id) : ''].filter(Boolean).join(' '),
    })
  }
  return out
}
