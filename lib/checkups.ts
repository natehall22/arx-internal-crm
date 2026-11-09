/**
 * Customer checkups — THE server module (Nathan, 2026-11-09). One row per post-install touchpoint in `job_checkups`:
 * inspections at the org's months (default 6 and 12), then a call/text every N months (default 12). The clock is the
 * job's install date (`installDateOf`: `completed_at` as an Eastern calendar day, else the scheduled install day for a
 * job moved straight to collected); only installed jobs (complete / collected) get checkups, never cancelled ones.
 * Nothing here writes `completed_at` — payroll eligibility reads it.
 *
 * Rows are created lazily — `ensureCheckups` runs from the daily morning-update cron and when the Checkups page opens —
 * and only once a checkup is within CHECKUP_LEAD_DAYS of due. Nothing is ever deleted: declined / can't reach are
 * statuses. Schedule + labels: lib/checkups-settings.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { CHECKUP_LEAD_DAYS, addMonthsYmd, checkupLabel, checkupOffsets, monthsBetweenYmd, readCheckupSettings, type CheckupSettings } from '@/lib/checkups-settings'
import { contactConnected, type ContactOutcome } from '@/lib/customer-contact'
import { addDaysToDateOnly } from '@/lib/install-calendar'

export const CHECKUP_STATUSES = ['due', 'booked', 'done', 'declined', 'unreachable'] as const
export type CheckupStatus = (typeof CHECKUP_STATUSES)[number]
export const OPEN_CHECKUP_STATUSES: readonly CheckupStatus[] = ['due', 'booked']
export const CHECKUP_RESULTS = ['green', 'yellow', 'red'] as const
export type CheckupResult = (typeof CHECKUP_RESULTS)[number]

/** Installed = complete or collected (same rule as review requests); a later job at the same home within this many days does not start a second schedule. */
const INSTALLED_STATUSES = ['complete', 'collected']
const SAME_HOME_DAYS = 180

export type CheckupRow = {
  id: string
  production_job_id: string
  customer_id: string | null
  opportunity_id: string | null
  month_offset: number
  kind: 'inspection' | 'touch'
  due_on: string
  status: CheckupStatus
  booked_for: string | null
  result: CheckupResult | null
  notes: string | null
  attempts: number
  last_attempt_at: string | null
  assigned_user_id: string | null
  done_at: string | null
}

export type CheckupView = CheckupRow & {
  label: string
  jobNumber: string | null
  address: string | null
  installedOn: string | null
  customerName: string | null
  phone: string | null
  email: string | null
  assigneeName: string | null
}

const COLS =
  'id, production_job_id, customer_id, opportunity_id, month_offset, kind, due_on, status, booked_for, result, notes, attempts, last_attempt_at, assigned_user_id, done_at'

type InstalledJob = { id: string; customer_id: string | null; project_id: string | null; address_text: string | null; completed_at: string }

/**
 * The install moment a schedule counts from: `completed_at`, else the scheduled install day (noon UTC, so its Eastern
 * calendar day is that date) for a job moved straight to collected, which never got a completion time. Null = unknown.
 */
export function installInstantOf(j: { completed_at: string | null; scheduled_date?: string | null }): string | null {
  if (j.completed_at) return j.completed_at
  return j.scheduled_date && /^\d{4}-\d{2}-\d{2}$/.test(j.scheduled_date) ? `${j.scheduled_date}T12:00:00Z` : null
}

/** Pure: which installed jobs start a schedule — per home (customer, else address), a job within SAME_HOME_DAYS of the previous anchor rides along with it. */
export function anchorJobs(jobs: InstalledJob[]): InstalledJob[] {
  const sorted = [...jobs].sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.id.localeCompare(b.id))
  const lastAnchor = new Map<string, number>()
  const out: InstalledJob[] = []
  for (const j of sorted) {
    const home = j.customer_id ?? `addr:${(j.address_text ?? j.id).trim().toLowerCase().replace(/\s+/g, ' ')}`
    const at = Date.parse(j.completed_at)
    const prev = lastAnchor.get(home)
    if (prev != null && at - prev < SAME_HOME_DAYS * 86_400_000) continue
    lastAnchor.set(home, at)
    out.push(j)
  }
  return out
}

/**
 * Pure: the checkups one job should have by `todayYmd` — everything due within the lead window, except that of the
 * ones already past due only the newest is created (a job brought in years late gets one catch-up, not a pile).
 */
export function plannedCheckups(installYmd: string, todayYmd: string, s: Pick<CheckupSettings, 'inspectionMonths' | 'touchEveryMonths'>) {
  const horizon = addDaysToDateOnly(todayYmd, CHECKUP_LEAD_DAYS)
  const planned = checkupOffsets(s, Math.max(0, monthsBetweenYmd(installYmd, horizon)))
    .map((o) => ({ ...o, due: addMonthsYmd(installYmd, o.month) }))
    .filter((o) => o.due <= horizon)
  const past = planned.filter((o) => o.due <= todayYmd)
  const newestPast = past.length ? past[past.length - 1].month : null
  return planned.filter((o) => o.due > todayYmd || o.month === newestPast)
}

export async function loadCheckupSettings(admin: SupabaseClient, orgId: string): Promise<CheckupSettings> {
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  return readCheckupSettings((data as { settings?: unknown } | null)?.settings)
}

/** Create the checkups that have come within reach. Idempotent (unique job + month). Tells the assignee once when new ones appear. */
export async function ensureCheckups(admin: SupabaseClient, orgId: string, now = new Date()): Promise<{ created: number }> {
  const settings = await loadCheckupSettings(admin, orgId)
  if (!settings.enabled) return { created: 0 }

  // Paged: PostgREST returns at most 1000 rows a request, and a missing job would silently never get a schedule.
  const jobRows: unknown[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('production_jobs')
      .select('id, customer_id, project_id, address_text, completed_at, scheduled_date')
      .eq('org_id', orgId)
      .in('status', INSTALLED_STATUSES)
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    jobRows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const jobs = anchorJobs(
    ((jobRows ?? []) as Array<Omit<InstalledJob, 'completed_at'> & { completed_at: string | null; scheduled_date: string | null }>)
      .map((j) => ({ ...j, completed_at: installInstantOf(j) }))
      .filter((j): j is InstalledJob & { scheduled_date: string | null } => j.completed_at != null)
  )
  if (jobs.length === 0) return { created: 0 }

  const projectIds = Array.from(new Set(jobs.map((j) => j.project_id).filter((x): x is string => !!x)))
  const oppByProject = new Map<string, string | null>()
  for (let i = 0; i < projectIds.length; i += 200) {
    const { data } = await admin.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('id', projectIds.slice(i, i + 200))
    for (const p of (data ?? []) as Array<{ id: string; opportunity_id: string | null }>) oppByProject.set(p.id, p.opportunity_id)
  }

  const today = ymdInBusinessTz(now)
  const rows = jobs.flatMap((j) =>
    plannedCheckups(ymdInBusinessTz(new Date(j.completed_at)), today, settings).map((o) => ({
      org_id: orgId,
      production_job_id: j.id,
      customer_id: j.customer_id,
      opportunity_id: j.project_id ? oppByProject.get(j.project_id) ?? null : null,
      month_offset: o.month,
      kind: o.kind,
      due_on: o.due,
      assigned_user_id: settings.assigneeUserId,
    }))
  )
  if (rows.length === 0) return { created: 0 }

  const { data: inserted, error: insertError } = await admin
    .from('job_checkups')
    .upsert(rows, { onConflict: 'production_job_id,month_offset', ignoreDuplicates: true })
    .select('id')
  if (insertError) throw insertError
  const created = (inserted ?? []).length
  if (created > 0 && settings.assigneeUserId) {
    const title = created === 1 ? '1 customer checkup is coming due' : `${created} customer checkups are coming due`
    await admin.from('notifications').insert({
      org_id: orgId,
      recipient_user_id: settings.assigneeUserId,
      type: 'checkups_due',
      title,
      body: 'Inspections and check-in calls for past customers.',
      link_url: '/ops/checkups',
    })
    // Loaded only here: the push client pulls in modules the rest of this file (and its many importers) never need.
    const { sendPushToUserBackground } = await import('@/lib/push-apns')
    sendPushToUserBackground(settings.assigneeUserId, title, 'Open Checkups to book or call.', { type: 'checkups_due', url: '/ops/checkups' })
  }
  return { created }
}

/** Checkups with their job/customer, oldest due first. Optionally one customer's, only open ones, or only ones closed since a moment (newest first). */
export async function loadCheckups(
  admin: SupabaseClient,
  orgId: string,
  opts: { customerId?: string; jobId?: string; open?: boolean; closedSince?: string; limit?: number } = {}
): Promise<CheckupView[]> {
  // Closed lists read newest first so old history never crowds out recent rows under the limit.
  let q = admin.from('job_checkups').select(COLS).eq('org_id', orgId).order(opts.closedSince ? 'done_at' : 'due_on', { ascending: !opts.closedSince }).limit(opts.limit ?? 1000)
  if (opts.customerId) q = q.eq('customer_id', opts.customerId)
  if (opts.jobId) q = q.eq('production_job_id', opts.jobId)
  if (opts.open) q = q.in('status', OPEN_CHECKUP_STATUSES as string[])
  if (opts.closedSince) q = q.not('status', 'in', `(${OPEN_CHECKUP_STATUSES.join(',')})`).gte('done_at', opts.closedSince)
  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as CheckupRow[]
  if (rows.length === 0) return []

  const jobIds = Array.from(new Set(rows.map((r) => r.production_job_id)))
  const custIds = Array.from(new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x)))
  const userIds = Array.from(new Set(rows.map((r) => r.assigned_user_id).filter((x): x is string => !!x)))
  const [jobsRes, custRes, usersRes] = await Promise.all([
    admin.from('production_jobs').select('id, job_number, address_text, completed_at, scheduled_date').eq('org_id', orgId).in('id', jobIds),
    custIds.length ? admin.from('customers').select('id, name, phone, email').eq('org_id', orgId).in('id', custIds) : Promise.resolve({ data: [] }),
    userIds.length ? admin.from('users').select('id, full_name').eq('org_id', orgId).in('id', userIds) : Promise.resolve({ data: [] }),
  ])
  const jobs = new Map(((jobsRes.data ?? []) as Array<{ id: string; job_number: string | null; address_text: string | null; completed_at: string | null; scheduled_date: string | null }>).map((j) => [j.id, j]))
  const custs = new Map(((custRes.data ?? []) as Array<{ id: string; name: string | null; phone: string | null; email: string | null }>).map((c) => [c.id, c]))
  const users = new Map(((usersRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => [u.id, u.full_name]))
  return rows.map((r) => {
    const j = jobs.get(r.production_job_id)
    const c = r.customer_id ? custs.get(r.customer_id) : undefined
    return {
      ...r,
      label: checkupLabel(r),
      jobNumber: j?.job_number ?? null,
      address: j?.address_text ?? null,
      installedOn: j && installInstantOf(j) ? ymdInBusinessTz(new Date(installInstantOf(j) as string)) : null,
      customerName: c?.name ?? null,
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      assigneeName: r.assigned_user_id ? users.get(r.assigned_user_id) ?? null : null,
    }
  })
}

export type CheckupAction =
  | { action: 'book'; date: string }
  | { action: 'done'; result?: CheckupResult; notes?: string }
  | { action: 'decline'; notes?: string }
  | { action: 'unreachable'; notes?: string }
  | { action: 'reopen' }
  | { action: 'contact'; outcome: ContactOutcome; activityId: string | null }

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** Pure: a request body → an action, or why not. */
export function parseCheckupAction(body: unknown): CheckupAction | { error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : undefined
  switch (b.action) {
    case 'book':
      if (typeof b.date !== 'string' || !YMD_RE.test(b.date) || Number.isNaN(Date.parse(`${b.date}T12:00:00Z`))) return { error: 'Pick a date' }
      return { action: 'book', date: b.date }
    case 'done':
      if (b.result !== undefined && !(CHECKUP_RESULTS as readonly unknown[]).includes(b.result)) return { error: 'Pick green, yellow or red' }
      return { action: 'done', result: b.result as CheckupResult | undefined, notes }
    case 'decline':
    case 'unreachable':
      return { action: b.action, notes }
    case 'reopen':
      return { action: 'reopen' }
    case 'contact': {
      const outcome = b.outcome
      if (typeof outcome !== 'string' || !['reached', 'voicemail', 'no_answer', 'sent', 'replied'].includes(outcome)) return { error: 'Unknown outcome' }
      return { action: 'contact', outcome: outcome as ContactOutcome, activityId: typeof b.activityId === 'string' ? b.activityId : null }
    }
    default:
      return { error: 'Unknown action' }
  }
}

/** Pure: the column changes for an action on a row, or why it is not allowed. */
export function checkupPatch(row: Pick<CheckupRow, 'kind' | 'status' | 'attempts'>, a: CheckupAction, userId: string, now: Date): Record<string, unknown> | { error: string } {
  const open = OPEN_CHECKUP_STATUSES.includes(row.status)
  const base = { updated_at: now.toISOString(), updated_by: userId }
  switch (a.action) {
    case 'book':
      if (!open) return { error: 'This checkup is already closed' }
      if (row.kind !== 'inspection') return { error: 'Only inspections are booked' }
      return { ...base, status: 'booked', booked_for: a.date }
    case 'done':
      if (!open) return { error: 'This checkup is already closed' }
      if (row.kind === 'inspection' && !a.result) return { error: 'Pick how the roof looked: green, yellow or red' }
      return { ...base, status: 'done', result: row.kind === 'inspection' ? a.result : null, ...(a.notes !== undefined ? { notes: a.notes || null } : {}), done_at: now.toISOString(), done_by: userId }
    case 'decline':
    case 'unreachable':
      if (!open) return { error: 'This checkup is already closed' }
      return { ...base, status: a.action === 'decline' ? 'declined' : 'unreachable', ...(a.notes !== undefined ? { notes: a.notes || null } : {}), done_at: now.toISOString(), done_by: userId }
    case 'reopen':
      if (open) return { error: 'This checkup is already open' }
      return { ...base, status: 'due', result: null, done_at: null, done_by: null }
    case 'contact': {
      if (!open) return { error: 'This checkup is already closed' }
      const attempt = { attempts: row.attempts + 1, last_attempt_at: now.toISOString(), last_activity_id: a.activityId }
      // A check-in call is done once we get through; an inspection stays open until the visit is recorded.
      if (row.kind === 'touch' && contactConnected(a.outcome)) return { ...base, ...attempt, status: 'done', done_at: now.toISOString(), done_by: userId }
      return { ...base, ...attempt }
    }
  }
}

export async function applyCheckupAction(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  a: CheckupAction,
  userId: string,
  now = new Date()
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const { data: row } = await admin.from('job_checkups').select('id, kind, status, attempts, updated_at').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'Checkup not found' }
  const r = row as Pick<CheckupRow, 'kind' | 'status' | 'attempts'> & { updated_at: string }
  const patch = checkupPatch(r, a, userId, now)
  if ('error' in patch) return { ok: false, status: 400, error: patch.error as string }
  // Optimistic: only if nobody changed it since we read it (two people tapping at once).
  const { data: updated, error } = await admin.from('job_checkups').update(patch).eq('id', id).eq('org_id', orgId).eq('updated_at', r.updated_at).select('id')
  if (error) return { ok: false, status: 409, error: 'Could not save' }
  if (!updated || updated.length === 0) return { ok: false, status: 409, error: 'Someone just changed this checkup — refresh and try again' }
  return { ok: true }
}

/** A new assignee in Settings takes over every open checkup (closed ones keep who did them). */
export async function reassignOpenCheckups(admin: SupabaseClient, orgId: string, userId: string | null): Promise<void> {
  const { error } = await admin
    .from('job_checkups')
    .update({ assigned_user_id: userId, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .in('status', OPEN_CHECKUP_STATUSES as string[])
  if (error) throw error
}
