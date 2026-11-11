/**
 * Crew time clock — the ONE writer of `time_entries` / `crew_members` / `time_entry_changes`, and the feeds from the
 * clock into payroll hours (`saveHoursEntries`) and job labor cost (`job_cost_lines` source 'time_entries').
 * Rules live in lib/time-tracking.ts (pure). Every table here is service-role only (RLS on, no policies).
 *
 * Who may tap for whom:
 *  - a crew phone link (/crew/day/<token>): the members of THAT crew, only when the crew `tracks_time`;
 *  - a signed-in person on a job page: themselves, plus the members of every time-tracked crew they lead;
 *  - the office (payroll admins): anyone in the company, from the time list, with a reason, while the week is open.
 *
 * Not atomic across rows: a move closes the old entry, then opens the new one. If the open fails the old one is
 * re-opened (compensation); the partial unique indexes stop a person ever having two open clocks.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { diffFields, type FieldChange } from '@/lib/change-log'
import { orgTimeZone } from '@/lib/cron-orgs'
import { NEW_COST_LINE_PAYROLL_FLAGS } from '@/lib/job-cost-ledger'
import { loadPlanForWeek, saveHoursEntries } from '@/lib/payroll-hours'
import { resolveHourlyRate } from '@/lib/payroll-hourly-rate'
import { findPeriodForCutoff, periodIsEditable } from '@/lib/payroll-periods'
import { isMissingColumn, isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import {
  ENTRY_FIELD_LABELS,
  TIME_ENTRY_COLUMNS,
  clipIntervals,
  entryFromRow,
  formatDuration,
  localYmd,
  localTimeToInstant,
  paidTime,
  readTimeTrackingSettings,
  resolveTapTime,
  splitOvertime,
  subtractIntervals,
  mergeIntervals,
  totalSeconds,
  weekWarnings,
  type ClockTap,
  type EntryEdit,
  type Interval,
  type TimeEntry,
  type TimeTrackingSettings,
  type TimeWarning,
} from '@/lib/time-tracking'
import { cutoffYmdEt, payWeekCutoffFor, payWeekStartInstant } from '@/lib/weekly-payroll/cutoff'

type Fail = { ok: false; status: number; error: string }

/** "That table / column is not there yet" — migration 202611110070 not applied. */
export function isTimeTrackingNotReadyError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return isMissingTable(error) || isMissingColumn(error, 'tracks_time') || isMissingColumn(error, 'time_week_ending') || /time_entr|crew_members/.test(String(error.message ?? '')) && /does not exist|could not find/i.test(String(error.message ?? ''))
}
export const TIME_TRACKING_NOT_READY = 'The time clock turns on once the database update for it is applied.'

// ---------------------------------------------------------------------------------------------------------------------
// Company settings + time zone (one read)
// ---------------------------------------------------------------------------------------------------------------------

export type ClockConfig = { settings: TimeTrackingSettings; timeZone: string }

export async function loadClockConfig(admin: SupabaseClient, orgId: string): Promise<ClockConfig> {
  const { data } = await admin.from('orgs').select('timezone, tt:settings->timeTracking').eq('id', orgId).maybeSingle()
  const row = (data ?? {}) as { timezone?: unknown; tt?: unknown }
  return { settings: readTimeTrackingSettings(row.tt ?? {}), timeZone: orgTimeZone(row.timezone) }
}

// ---------------------------------------------------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------------------------------------------------

export type CrewMember = { userId: string; name: string; isLead: boolean }
export type CrewRoster = { subId: string; name: string; tracksTime: boolean; members: CrewMember[] }

/** One crew with its ACTIVE members (leads first, then by name). Null when the crew isn't this company's. */
export async function loadCrewRoster(admin: SupabaseClient, orgId: string, subId: string): Promise<CrewRoster | null> {
  const db = orgDb(admin, orgId)
  const { data: sub, error } = await db.from('sub_contractors').select('id, company_name, tracks_time, active').eq('id', subId).maybeSingle()
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return null
    throw error
  }
  if (!sub) return null
  const s = sub as { id: string; company_name: string | null; tracks_time: boolean | null }
  const members = await loadMembers(admin, orgId, [s.id])
  return { subId: s.id, name: s.company_name ?? 'Crew', tracksTime: s.tracks_time === true, members: members.get(s.id) ?? [] }
}

async function loadMembers(admin: SupabaseClient, orgId: string, subIds: string[]): Promise<Map<string, CrewMember[]>> {
  const out = new Map<string, CrewMember[]>()
  if (subIds.length === 0) return out
  const db = orgDb(admin, orgId)
  const { data, error } = await db.from('crew_members').select('sub_id, user_id, is_lead').in('sub_id', subIds)
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return out
    throw error
  }
  const rows = (data ?? []) as Array<{ sub_id: string; user_id: string; is_lead: boolean }>
  const names = await loadActiveNames(admin, orgId, rows.map((r) => r.user_id))
  for (const r of rows) {
    const name = names.get(r.user_id)
    if (!name) continue // left the company: no longer on the crew screen (their entries stay)
    const list = out.get(r.sub_id) ?? []
    list.push({ userId: r.user_id, name, isLead: r.is_lead === true })
    out.set(r.sub_id, list)
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name))
  return out
}

async function loadActiveNames(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return out
  const { data } = await orgDb(admin, orgId).from('users').select('id, full_name, active').in('id', unique)
  for (const u of (data ?? []) as Array<{ id: string; full_name: string | null; active: boolean | null }>) {
    if (u.active === false) continue
    out.set(u.id, u.full_name || 'Unnamed')
  }
  return out
}

async function loadAnyNames(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return out
  const { data } = await orgDb(admin, orgId).from('users').select('id, full_name').in('id', unique)
  for (const u of (data ?? []) as Array<{ id: string; full_name: string | null }>) out.set(u.id, u.full_name || 'Unnamed')
  return out
}

/** Time-tracked, active crews this person leads (signed-in "Clock in crew"). */
export async function loadCrewsLedBy(admin: SupabaseClient, orgId: string, userId: string): Promise<CrewRoster[]> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db.from('crew_members').select('sub_id').eq('user_id', userId).eq('is_lead', true)
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return []
    throw error
  }
  const subIds = ((data ?? []) as Array<{ sub_id: string }>).map((r) => r.sub_id)
  if (subIds.length === 0) return []
  const { data: subs } = await db.from('sub_contractors').select('id, company_name, tracks_time, active').in('id', subIds)
  const live = ((subs ?? []) as Array<{ id: string; company_name: string | null; tracks_time: boolean | null; active: boolean | null }>).filter((s) => s.tracks_time === true && s.active !== false)
  const members = await loadMembers(admin, orgId, live.map((s) => s.id))
  return live.map((s) => ({ subId: s.id, name: s.company_name ?? 'Crew', tracksTime: true, members: members.get(s.id) ?? [] }))
}

export type CrewSetup = { tracksTime: boolean; members: Array<{ userId: string; isLead: boolean }> }

export function parseCrewSetup(body: unknown): { setup: CrewSetup } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!b || typeof b.tracksTime !== 'boolean' || !Array.isArray(b.members)) return { error: 'Bad request' }
  if (b.members.length > 40) return { error: 'A crew can have at most 40 people' }
  const seen = new Set<string>()
  const members: CrewSetup['members'] = []
  for (const m of b.members) {
    const r = m && typeof m === 'object' ? (m as Record<string, unknown>) : {}
    if (typeof r.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(r.userId)) return { error: 'Bad person' }
    if (seen.has(r.userId)) continue
    seen.add(r.userId)
    members.push({ userId: r.userId, isLead: r.isLead === true })
  }
  if (b.tracksTime && members.length > 0 && !members.some((m) => m.isLead)) return { error: 'Pick a crew lead (the person who taps the clock for the crew)' }
  return { setup: { tracksTime: b.tracksTime, members } }
}

/** Save who is on a crew and whether it clocks in. Members must be active people in this company. */
export async function saveCrewSetup(admin: SupabaseClient, orgId: string, subId: string, actorUserId: string, setup: CrewSetup): Promise<{ ok: true } | Fail> {
  const db = orgDb(admin, orgId)
  const { data: sub } = await db.from('sub_contractors').select('id').eq('id', subId).maybeSingle()
  if (!sub) return { ok: false, status: 404, error: 'Crew not found' }
  const wanted = setup.members.map((m) => m.userId)
  const active = await loadActiveNames(admin, orgId, wanted)
  const stranger = wanted.find((id) => !active.has(id))
  if (stranger) return { ok: false, status: 400, error: 'Only active people in your company can be on a crew' }

  const { error: subErr } = await db.from('sub_contractors').update({ tracks_time: setup.tracksTime }).eq('id', subId)
  if (subErr) {
    if (isTimeTrackingNotReadyError(subErr)) return { ok: false, status: 503, error: TIME_TRACKING_NOT_READY }
    throw subErr
  }
  const { data: current, error: curErr } = await db.from('crew_members').select('id, user_id, is_lead').eq('sub_id', subId)
  if (curErr) {
    if (isTimeTrackingNotReadyError(curErr)) return { ok: false, status: 503, error: TIME_TRACKING_NOT_READY }
    throw curErr
  }
  const have = new Map(((current ?? []) as Array<{ id: string; user_id: string; is_lead: boolean }>).map((r) => [r.user_id, r]))
  const keep = new Set(wanted)
  const gone = Array.from(have.values()).filter((r) => !keep.has(r.user_id)).map((r) => r.id)
  if (gone.length) {
    const { error } = await db.from('crew_members').delete().in('id', gone)
    if (error) throw error
  }
  for (const m of setup.members) {
    const row = have.get(m.userId)
    if (row) {
      if (row.is_lead !== m.isLead) {
        const { error } = await db.from('crew_members').update({ is_lead: m.isLead }).eq('id', row.id)
        if (error) throw error
      }
    } else {
      const { error } = await db.from('crew_members').insert({ sub_id: subId, user_id: m.userId, is_lead: m.isLead, created_by: actorUserId })
      if (error && error.code !== '23505') throw error
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------------------------------------------------

export type ClockActor =
  | { via: 'crew_link'; orgId: string; subId: string }
  | { via: 'signed_in'; orgId: string; userId: string }

/** Who this actor may tap for: userId → the crew the entry is filed under (null = themselves, no crew). */
export async function allowedPeople(admin: SupabaseClient, actor: ClockActor): Promise<{ people: Map<string, { name: string; subId: string | null; isLead: boolean }>; crews: CrewRoster[] }> {
  const people = new Map<string, { name: string; subId: string | null; isLead: boolean }>()
  if (actor.via === 'crew_link') {
    const crew = await loadCrewRoster(admin, actor.orgId, actor.subId)
    if (!crew || !crew.tracksTime) return { people, crews: [] }
    for (const m of crew.members) people.set(m.userId, { name: m.name, subId: crew.subId, isLead: m.isLead })
    return { people, crews: [crew] }
  }
  const crews = await loadCrewsLedBy(admin, actor.orgId, actor.userId)
  for (const c of crews) for (const m of c.members) if (!people.has(m.userId)) people.set(m.userId, { name: m.name, subId: c.subId, isLead: m.isLead })
  if (!people.has(actor.userId)) {
    const names = await loadActiveNames(admin, actor.orgId, [actor.userId])
    const me = names.get(actor.userId)
    if (me) people.set(actor.userId, { name: me, subId: null, isLead: false })
  }
  return { people, crews }
}

type Where = { workOrderId: string | null; jobId: string | null }

/** The visit / job a tap names, checked against what this actor may clock in on. */
async function resolveWhere(admin: SupabaseClient, actor: ClockActor, tap: Pick<ClockTap, 'workOrderId' | 'jobId'>): Promise<Where | Fail> {
  const db = orgDb(admin, actor.orgId)
  if (tap.workOrderId) {
    const { data } = await db.from('work_orders').select('id, job_id, assigned_sub_id, status').eq('id', tap.workOrderId).maybeSingle()
    const wo = data as { id: string; job_id: string | null; assigned_sub_id: string | null; status: string | null } | null
    if (!wo) return { ok: false, status: 404, error: 'That stop isn’t on the list' }
    // A crew link may only clock in on its own work.
    if (actor.via === 'crew_link' && wo.assigned_sub_id !== actor.subId) return { ok: false, status: 404, error: 'That stop isn’t on the list' }
    if (wo.status === 'cancelled') return { ok: false, status: 409, error: 'That stop was cancelled' }
    if (tap.jobId && wo.job_id && tap.jobId !== wo.job_id) return { ok: false, status: 400, error: 'That stop belongs to another job' }
    return { workOrderId: wo.id, jobId: wo.job_id }
  }
  if (tap.jobId) {
    if (actor.via === 'crew_link') return { ok: false, status: 400, error: 'Pick a stop' }
    const { data } = await db.from('production_jobs').select('id, status').eq('id', tap.jobId).maybeSingle()
    const job = data as { id: string; status: string | null } | null
    if (!job) return { ok: false, status: 404, error: 'Job not found' }
    if (job.status === 'cancelled') return { ok: false, status: 409, error: 'That job was cancelled' }
    return { workOrderId: null, jobId: job.id }
  }
  return { ok: false, status: 400, error: 'Which stop or job?' }
}

async function loadOpen(admin: SupabaseClient, orgId: string, userIds: string[], kind: 'work' | 'break'): Promise<Map<string, TimeEntry>> {
  const out = new Map<string, TimeEntry>()
  if (userIds.length === 0) return out
  const { data, error } = await orgDb(admin, orgId)
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .in('user_id', userIds)
    .eq('kind', kind)
    .is('ended_at', null)
    .is('removed_at', null)
  if (error) throw error
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const e = entryFromRow(r)
    if (e.userId) out.set(e.userId, e)
  }
  return out
}

async function loadOpenEquipment(admin: SupabaseClient, orgId: string, subIds: string[], tappedBy: string | null): Promise<TimeEntry[]> {
  const db = orgDb(admin, orgId)
  let q = db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('kind', 'equipment').is('ended_at', null).is('removed_at', null)
  if (subIds.length) q = q.in('sub_id', subIds)
  else if (tappedBy) q = q.is('sub_id', null).eq('tapped_by_user_id', tappedBy)
  else return []
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(entryFromRow)
}

type TapCtx = {
  admin: SupabaseClient
  orgId: string
  at: string
  source: 'lead_tap' | 'self_tap'
  via: 'crew_link' | 'signed_in'
  tappedBy: string | null
  flag: string | null
  skewSeconds: number
  loc: { lat: number | null; lng: number | null }
  touched: { users: Set<string>; instants: Set<string>; jobs: Set<string> }
}

async function closeEntry(ctx: TapCtx, e: TimeEntry, opts: { forTravel?: boolean } = {}): Promise<void> {
  // A queued tap can arrive after a later one: never end before the start (flagged instead).
  const late = Date.parse(ctx.at) < Date.parse(e.startedAt)
  const endedAt = late ? e.startedAt : ctx.at
  const note = late ? 'Stop time came in before the start — check this time' : ctx.flag
  const patch: Record<string, unknown> = {
    ended_at: endedAt,
    end_source: ctx.source,
    ended_by_user_id: ctx.tappedBy,
    closed_for_travel: opts.forTravel === true,
    end_lat: ctx.loc.lat,
    end_lng: ctx.loc.lng,
  }
  if (note) Object.assign(patch, { needs_review: true, review_note: note })
  const { error } = await orgDb(ctx.admin, ctx.orgId).from('time_entries').update(patch).eq('id', e.id).is('ended_at', null)
  if (error) throw error
  if (e.userId) ctx.touched.users.add(e.userId)
  ctx.touched.instants.add(e.startedAt).add(endedAt)
  if (e.jobId) ctx.touched.jobs.add(e.jobId)
}

/** Insert one entry; a resend of the same tap (or a race for the same person) is not an error. */
async function insertEntry(ctx: TapCtx, row: Record<string, unknown>, tapId: string): Promise<'inserted' | 'exists'> {
  const fullRow: Record<string, unknown> = {
    ...row,
    started_at: ctx.at,
    source: ctx.source,
    tapped_by_user_id: ctx.tappedBy,
    tapped_via: ctx.via,
    client_tap_id: tapId,
    start_lat: ctx.loc.lat,
    start_lng: ctx.loc.lng,
    device_clock_skew_seconds: ctx.flag && Math.abs(ctx.skewSeconds) >= 60 ? ctx.skewSeconds : null,
    ...(ctx.flag ? { needs_review: true, review_note: ctx.flag } : {}),
  }
  const { error } = await orgDb(ctx.admin, ctx.orgId).from('time_entries').insert(fullRow)
  if (error) {
    if (error.code === '23505') return 'exists'
    throw error
  }
  if (typeof row.user_id === 'string') ctx.touched.users.add(row.user_id)
  ctx.touched.instants.add(ctx.at)
  if (typeof row.production_job_id === 'string') ctx.touched.jobs.add(row.production_job_id)
  return 'inserted'
}

export type TapResult = { ok: true; done: number } | (Fail & { permanent?: boolean })

/**
 * Apply one tap (from the crew phone link or a signed-in job page). Idempotent per `tapId`: a resend from the offline
 * queue changes nothing the second time. Feeds (payroll hours, job labor cost) are refreshed after, best effort.
 */
export async function applyClockTap(admin: SupabaseClient, actor: ClockActor, tap: ClockTap, now = new Date()): Promise<TapResult> {
  const config = await loadClockConfig(admin, actor.orgId)
  const time = resolveTapTime(tap, now)
  if ('error' in time) return { ok: false, status: 400, error: time.error, permanent: true }
  const { people, crews } = await allowedPeople(admin, actor)
  if (people.size === 0) return { ok: false, status: 403, error: 'This crew doesn’t use the time clock', permanent: true }

  // Who is tapping: on a crew link, the lead the phone named (must be on this crew); signed in, the person.
  let tappedBy: string | null = actor.via === 'signed_in' ? actor.userId : null
  if (actor.via === 'crew_link' && tap.tappedBy) {
    if (!people.has(tap.tappedBy)) return { ok: false, status: 400, error: 'Pick who is tapping again', permanent: true }
    tappedBy = tap.tappedBy
  }
  const source: TapCtx['source'] = actor.via === 'signed_in' && tap.userIds.every((id) => id === actor.userId) ? 'self_tap' : 'lead_tap'

  // Taps for a week that is already approved are kept, flagged, and never sent to payroll (the office moves them).
  let flag = time.flag
  const period = await findPeriodForCutoff(admin, actor.orgId, payWeekCutoffFor(time.at), { create: false }).catch(() => null)
  if (!periodIsEditable(period)) flag = [flag, 'Came in after that week was approved — add it to an open week'].filter(Boolean).join('. ')

  const ctx: TapCtx = {
    admin,
    orgId: actor.orgId,
    at: time.at.toISOString(),
    source,
    via: actor.via,
    tappedBy,
    flag,
    skewSeconds: time.skewSeconds,
    loc: config.settings.captureLocation ? { lat: tap.lat, lng: tap.lng } : { lat: null, lng: null },
    touched: { users: new Set(), instants: new Set(), jobs: new Set() },
  }
  const allIds = Array.from(people.keys())
  const picked = tap.userIds.length ? tap.userIds.filter((id) => people.has(id)) : allIds
  if (tap.userIds.length && picked.length === 0) return { ok: false, status: 400, error: 'Pick who is here', permanent: true }
  const crewSubIds = actor.via === 'crew_link' ? [actor.subId] : crews.map((c) => c.subId)

  let done = 0
  try {
    switch (tap.action) {
      case 'clock_in': {
        const where = await resolveWhere(admin, actor, tap)
        if ('ok' in where) return { ...where, permanent: where.status !== 500 }
        const [openWork, openBreak] = await Promise.all([loadOpen(admin, actor.orgId, picked, 'work'), loadOpen(admin, actor.orgId, picked, 'break')])
        for (const userId of picked) {
          const b = openBreak.get(userId)
          if (b) await closeEntry(ctx, b)
          const w = openWork.get(userId)
          if (w && w.workOrderId === where.workOrderId && (where.workOrderId || w.jobId === where.jobId)) continue // already here
          if (w) await closeEntry(ctx, w)
          let inserted: 'inserted' | 'exists'
          try {
            inserted = await insertEntry(ctx, { user_id: userId, sub_id: people.get(userId)?.subId ?? null, work_order_id: where.workOrderId, production_job_id: where.jobId, kind: 'work' }, tap.tapId)
          } catch (e) {
            if (w) await reopenIfLeft(ctx, w)
            throw e
          }
          // 'exists' = another phone clocked them in at the same moment (or this tap was already applied): if they
          // have no clock running now, put them back on the one this tap closed.
          if (inserted === 'exists') {
            if (w) await reopenIfLeft(ctx, w)
          } else done++
        }
        // The crew's machines stop when the crew leaves a stop.
        for (const e of await loadOpenEquipment(admin, actor.orgId, crewSubIds, actor.via === 'signed_in' ? actor.userId : null)) {
          if (e.workOrderId !== where.workOrderId || (!where.workOrderId && e.jobId !== where.jobId)) await closeEntry(ctx, e)
        }
        break
      }
      case 'clock_out': {
        const [openWork, openBreak] = await Promise.all([loadOpen(admin, actor.orgId, picked, 'work'), loadOpen(admin, actor.orgId, picked, 'break')])
        for (const userId of picked) {
          const b = openBreak.get(userId)
          if (b) await closeEntry(ctx, b)
          const w = openWork.get(userId)
          if (w) {
            await closeEntry(ctx, w, { forTravel: tap.forTravel })
            done++
          }
        }
        for (const e of await loadOpenEquipment(admin, actor.orgId, crewSubIds, actor.via === 'signed_in' ? actor.userId : null)) await closeEntry(ctx, e)
        break
      }
      case 'break_start': {
        const [openWork, openBreak] = await Promise.all([loadOpen(admin, actor.orgId, picked, 'work'), loadOpen(admin, actor.orgId, picked, 'break')])
        for (const userId of picked) {
          const w = openWork.get(userId)
          if (!w || openBreak.has(userId)) continue
          const r = await insertEntry(ctx, { user_id: userId, sub_id: w.subId, work_order_id: w.workOrderId, production_job_id: w.jobId, kind: 'break' }, tap.tapId)
          if (r === 'inserted') done++
        }
        break
      }
      case 'break_end': {
        const openBreak = await loadOpen(admin, actor.orgId, picked, 'break')
        for (const userId of picked) {
          const b = openBreak.get(userId)
          if (b) {
            await closeEntry(ctx, b)
            done++
          }
        }
        break
      }
      case 'equipment_start': {
        const { data: item } = await orgDb(admin, actor.orgId).from('pricebook_items').select('id, active').eq('id', tap.pricebookItemId).maybeSingle()
        if (!item || (item as { active?: boolean }).active === false) return { ok: false, status: 404, error: 'That equipment isn’t in the price book', permanent: true }
        let where: Where | null = null
        if (tap.workOrderId || tap.jobId) {
          const w = await resolveWhere(admin, actor, tap)
          if ('ok' in w) return { ...w, permanent: true }
          where = w
        } else {
          const anyOpen = Array.from((await loadOpen(admin, actor.orgId, allIds, 'work')).values())[0]
          if (anyOpen) where = { workOrderId: anyOpen.workOrderId, jobId: anyOpen.jobId }
        }
        if (!where) return { ok: false, status: 409, error: 'Clock the crew in at a stop first', permanent: true }
        const running = (await loadOpenEquipment(admin, actor.orgId, crewSubIds, actor.via === 'signed_in' ? actor.userId : null)).find((e) => e.pricebookItemId === tap.pricebookItemId)
        if (running) break
        const r = await insertEntry(ctx, { user_id: null, sub_id: actor.via === 'crew_link' ? actor.subId : crews[0]?.subId ?? null, work_order_id: where.workOrderId, production_job_id: where.jobId, kind: 'equipment', pricebook_item_id: tap.pricebookItemId }, tap.tapId)
        if (r === 'inserted') done++
        break
      }
      case 'equipment_stop': {
        const open = await loadOpenEquipment(admin, actor.orgId, crewSubIds, actor.via === 'signed_in' ? actor.userId : null)
        const e = open.find((x) => x.id === tap.entryId)
        if (e) {
          await closeEntry(ctx, e)
          done++
        }
        break
      }
      case 'finish_answer': {
        const r = await answerFinishTime(admin, actor.orgId, { entryId: tap.entryId!, finishTime: tap.finishTime!, allowed: people, answeredBy: tappedBy, config, now })
        if (!r.ok) return { ...r, permanent: true }
        ctx.touched.users.add(r.userId)
        ctx.touched.instants.add(r.startedAt).add(r.endedAt)
        if (r.jobId) ctx.touched.jobs.add(r.jobId)
        done++
        break
      }
    }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (isTimeTrackingNotReadyError(err)) return { ok: false, status: 503, error: TIME_TRACKING_NOT_READY }
    throw e
  }
  if (!periodIsEditable(period)) ctx.touched.instants.clear() // never feed an approved week
  await syncTimeFeeds(admin, actor.orgId, { userIds: Array.from(ctx.touched.users), instants: Array.from(ctx.touched.instants), jobIds: Array.from(ctx.touched.jobs), actorUserId: tappedBy }).catch((e) =>
    console.error('[time-clock] feed sync failed', e)
  )
  return { ok: true, done }
}

/** Compensation: the new entry could not be opened after this tap closed the old one — reopen the old one, unless the person already has a clock running. */
async function reopenIfLeft(ctx: TapCtx, closed: TimeEntry): Promise<void> {
  if (!closed.userId) return
  const open = await loadOpen(ctx.admin, ctx.orgId, [closed.userId], 'work')
  if (open.size > 0) return
  const { error } = await orgDb(ctx.admin, ctx.orgId).from('time_entries').update({ ended_at: null, end_source: null, ended_by_user_id: null, closed_for_travel: false }).eq('id', closed.id)
  if (error) console.error('[time-clock] reopen after a failed move failed', error)
}

// ---------------------------------------------------------------------------------------------------------------------
// Forgot to clock out
// ---------------------------------------------------------------------------------------------------------------------

const FORGOT_NOTE = 'Forgot to clock out — stopped at the last tap. Ask what time they finished.'

/**
 * Stop every clock left running longer than the company's limit, at that person's last tap (their start, or the end of
 * a later break), and flag it. The crew lead is asked the real finish time next morning. Returns entries closed.
 */
export async function autoCloseForgotten(admin: SupabaseClient, orgId: string, opts: { now?: Date; userIds?: string[]; config?: ClockConfig } = {}): Promise<number> {
  const now = opts.now ?? new Date()
  const config = opts.config ?? (await loadClockConfig(admin, orgId))
  const limit = new Date(now.getTime() - config.settings.autoCloseHours * 3_600_000).toISOString()
  const db = orgDb(admin, orgId)
  let q = db.from('time_entries').select(TIME_ENTRY_COLUMNS).is('ended_at', null).is('removed_at', null).lt('started_at', limit)
  if (opts.userIds) {
    if (opts.userIds.length === 0) return 0
    q = q.in('user_id', opts.userIds)
  }
  const { data, error } = await q
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return 0
    throw error
  }
  const stale = ((data ?? []) as Array<Record<string, unknown>>).map(entryFromRow)
  if (stale.length === 0) return 0
  const touched = { users: new Set<string>(), instants: new Set<string>(), jobs: new Set<string>() }
  let closed = 0
  for (const e of stale) {
    const lastTap = await lastTapFor(admin, orgId, e)
    const { data: upd, error: updErr } = await db
      .from('time_entries')
      .update({ ended_at: lastTap, end_source: 'auto_closed', needs_review: true, review_note: FORGOT_NOTE })
      .eq('id', e.id)
      .is('ended_at', null)
      .select('id')
    if (updErr) throw updErr
    if (!upd || (upd as unknown[]).length === 0) continue // someone closed it a moment ago
    closed++
    await logChange(admin, orgId, e.id, 'auto_closed', null, null, [{ field: 'ended_at', label: 'End', old: null, new: lastTap }])
    if (e.userId) touched.users.add(e.userId)
    touched.instants.add(e.startedAt).add(lastTap)
    if (e.jobId) touched.jobs.add(e.jobId)
  }
  await syncTimeFeeds(admin, orgId, { userIds: Array.from(touched.users), instants: Array.from(touched.instants), jobIds: Array.from(touched.jobs), actorUserId: null }).catch((err) =>
    console.error('[time-clock] feed sync after auto-close failed', err)
  )
  return closed
}

/** The latest moment we KNOW this person (or, for a machine, its crew) was still working: start, or a later tap. */
async function lastTapFor(admin: SupabaseClient, orgId: string, e: TimeEntry): Promise<string> {
  let latest = Date.parse(e.startedAt)
  const db = orgDb(admin, orgId)
  let q = db.from('time_entries').select('started_at, ended_at').is('removed_at', null).gte('started_at', e.startedAt).neq('id', e.id)
  if (e.userId) q = q.eq('user_id', e.userId)
  else if (e.subId) q = q.eq('sub_id', e.subId)
  else return e.startedAt
  const { data } = await q
  for (const r of (data ?? []) as Array<{ started_at: string; ended_at: string | null }>) {
    latest = Math.max(latest, Date.parse(r.started_at), r.ended_at ? Date.parse(r.ended_at) : 0)
  }
  return new Date(latest).toISOString()
}

export type FinishQuestion = { entryId: string; userId: string; name: string; day: string; startedAt: string; stoppedAt: string }

/** Clocks the system stopped (forgot to clock out) in the last 3 days, still waiting for the real finish time. */
export async function loadFinishQuestions(admin: SupabaseClient, orgId: string, people: Map<string, { name: string }>, timeZone: string, now = new Date()): Promise<FinishQuestion[]> {
  const ids = Array.from(people.keys())
  if (ids.length === 0) return []
  const { data, error } = await orgDb(admin, orgId)
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .in('user_id', ids)
    .eq('kind', 'work')
    .eq('end_source', 'auto_closed')
    .eq('needs_review', true)
    .is('removed_at', null)
    .gte('started_at', new Date(now.getTime() - 3 * 86_400_000).toISOString())
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(entryFromRow)
    .map((e) => ({ entryId: e.id, userId: e.userId!, name: people.get(e.userId!)?.name ?? '', day: localYmd(Date.parse(e.startedAt), timeZone), startedAt: e.startedAt, stoppedAt: e.endedAt! }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

async function answerFinishTime(
  admin: SupabaseClient,
  orgId: string,
  input: { entryId: string; finishTime: string; allowed: Map<string, unknown>; answeredBy: string | null; config: ClockConfig; now: Date }
): Promise<({ ok: true; userId: string; jobId: string | null; startedAt: string; endedAt: string }) | Fail> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('id', input.entryId).is('removed_at', null).maybeSingle()
  const e = data ? entryFromRow(data as Record<string, unknown>) : null
  if (!e || !e.userId || !input.allowed.has(e.userId) || e.endSource !== 'auto_closed' || !e.needsReview) return { ok: false, status: 404, error: 'Nothing to answer' }
  const startMs = Date.parse(e.startedAt)
  const day = localYmd(startMs, input.config.timeZone)
  let end = localTimeToInstant(day, input.finishTime, input.config.timeZone)
  // A finish "before" the start is the next morning (a night shift).
  if (end && end.getTime() <= startMs) {
    const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    end = localTimeToInstant(next, input.finishTime, input.config.timeZone)
  }
  if (!end || end.getTime() <= startMs) return { ok: false, status: 400, error: 'That’s before they started' }
  if (end.getTime() - startMs > 24 * 3_600_000 || end.getTime() > input.now.getTime()) return { ok: false, status: 400, error: 'That time doesn’t fit — ask the office to fix it' }
  const period = await findPeriodForCutoff(admin, orgId, payWeekCutoffFor(end), { create: false })
  const periodStart = await findPeriodForCutoff(admin, orgId, payWeekCutoffFor(new Date(startMs)), { create: false })
  if (!periodIsEditable(period) || !periodIsEditable(periodStart)) return { ok: false, status: 409, error: 'That week is already approved — ask the office' }
  const endedAt = end.toISOString()
  const { error } = await db
    .from('time_entries')
    .update({ ended_at: endedAt, end_source: 'typed', needs_review: false, review_note: 'Finish time given the next day', ended_by_user_id: input.answeredBy })
    .eq('id', e.id)
  if (error) throw error
  await logChange(admin, orgId, e.id, 'finish_answered', input.answeredBy, 'Asked next morning', [{ field: 'ended_at', label: 'End', old: e.endedAt, new: endedAt }])
  return { ok: true, userId: e.userId, jobId: e.jobId, startedAt: e.startedAt, endedAt }
}

// ---------------------------------------------------------------------------------------------------------------------
// The clock screen (crew link + job page)
// ---------------------------------------------------------------------------------------------------------------------

export type ClockPerson = {
  userId: string
  name: string
  isLead: boolean
  /** Clocked in at a stop / job. */
  open: { entryId: string; workOrderId: string | null; jobId: string | null; startedAt: string } | null
  onBreak: boolean
  /** Left a stop "going to the next one" today and not clocked in since. */
  travelling: boolean
}

export type ClockState = {
  ready: boolean
  people: ClockPerson[]
  equipment: Array<{ entryId: string; name: string; workOrderId: string | null; startedAt: string }>
  equipmentChoices: Array<{ id: string; name: string }>
  finishQuestions: FinishQuestion[]
  captureLocation: boolean
  timeZone: string
}

/** What the clock buttons show. Stops forgotten clocks first, so the lead is asked the same morning. */
export async function loadClockState(admin: SupabaseClient, actor: ClockActor, now = new Date()): Promise<ClockState> {
  const config = await loadClockConfig(admin, actor.orgId)
  const empty: ClockState = { ready: true, people: [], equipment: [], equipmentChoices: [], finishQuestions: [], captureLocation: config.settings.captureLocation, timeZone: config.timeZone }
  const { people, crews } = await allowedPeople(admin, actor)
  if (people.size === 0) return empty
  const ids = Array.from(people.keys())
  try {
    await autoCloseForgotten(admin, actor.orgId, { now, userIds: ids, config })
    const [openWork, openBreak, recent, finishQuestions, equipment, items] = await Promise.all([
      loadOpen(admin, actor.orgId, ids, 'work'),
      loadOpen(admin, actor.orgId, ids, 'break'),
      orgDb(admin, actor.orgId)
        .from('time_entries')
        .select('user_id, ended_at, closed_for_travel')
        .in('user_id', ids)
        .eq('kind', 'work')
        .is('removed_at', null)
        .gte('ended_at', new Date(now.getTime() - 18 * 3_600_000).toISOString()),
      loadFinishQuestions(admin, actor.orgId, people, config.timeZone, now),
      loadOpenEquipment(admin, actor.orgId, actor.via === 'crew_link' ? [actor.subId] : crews.map((c) => c.subId), actor.via === 'signed_in' ? actor.userId : null),
      loadEquipmentChoices(admin, actor.orgId),
    ])
    const today = localYmd(now.getTime(), config.timeZone)
    const lastEnd = new Map<string, { at: string; travel: boolean }>()
    for (const r of ((recent as { data?: unknown }).data ?? []) as Array<{ user_id: string; ended_at: string; closed_for_travel: boolean }>) {
      const prev = lastEnd.get(r.user_id)
      if (!prev || r.ended_at > prev.at) lastEnd.set(r.user_id, { at: r.ended_at, travel: r.closed_for_travel === true })
    }
    const itemName = new Map(items.map((i) => [i.id, i.name]))
    return {
      ...empty,
      people: ids.map((userId) => {
        const p = people.get(userId)!
        const w = openWork.get(userId)
        const last = lastEnd.get(userId)
        return {
          userId,
          name: p.name,
          isLead: p.isLead,
          open: w ? { entryId: w.id, workOrderId: w.workOrderId, jobId: w.jobId, startedAt: w.startedAt } : null,
          onBreak: openBreak.has(userId),
          travelling: !w && !!last && last.travel && localYmd(Date.parse(last.at), config.timeZone) === today,
        }
      }),
      equipment: equipment.map((e) => ({ entryId: e.id, name: itemName.get(e.pricebookItemId ?? '') ?? 'Equipment', workOrderId: e.workOrderId, startedAt: e.startedAt })),
      equipmentChoices: items,
      finishQuestions,
    }
  } catch (e) {
    if (isTimeTrackingNotReadyError(e as { code?: string; message?: string })) return { ...empty, ready: false }
    throw e
  }
}

/**
 * Machines that bill by the hour: active price-book items priced per hour (the `hour` unit arrives with the industry
 * profiles migration 202611100090; until then this list is empty and the Equipment button stays hidden).
 */
export async function loadEquipmentChoices(admin: SupabaseClient, orgId: string): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await orgDb(admin, orgId).from('pricebook_items').select('id, name, unit, active').eq('active', true).limit(500)
  if (error) return []
  return ((data ?? []) as Array<{ id: string; name: string; unit: string }>).filter((r) => r.unit === 'hour').map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------------------------------

type ChangeAction = 'added' | 'updated' | 'removed' | 'auto_closed' | 'finish_answered'

async function logChange(admin: SupabaseClient, orgId: string, entryId: string, action: ChangeAction, by: string | null, reason: string | null, changes: FieldChange[]): Promise<void> {
  const { error } = await orgDb(admin, orgId).from('time_entry_changes').insert({ time_entry_id: entryId, action, changed_by: by, reason, changes })
  if (error) console.error('[time-clock] change log failed', error)
}

export type TimeEntryHistory = { action: ChangeAction; by: string | null; at: string; reason: string | null; changes: FieldChange[] }

export async function loadEntryHistory(admin: SupabaseClient, orgId: string, entryId: string): Promise<TimeEntryHistory[]> {
  const { data } = await orgDb(admin, orgId).from('time_entry_changes').select('action, changed_by, changed_at, reason, changes').eq('time_entry_id', entryId).order('changed_at', { ascending: false }).limit(100)
  const rows = (data ?? []) as Array<{ action: ChangeAction; changed_by: string | null; changed_at: string; reason: string | null; changes: FieldChange[] }>
  const names = await loadAnyNames(admin, orgId, rows.map((r) => r.changed_by ?? ''))
  return rows.map((r) => ({ action: r.action, by: r.changed_by ? names.get(r.changed_by) ?? 'Someone' : r.action === 'auto_closed' ? 'System' : null, at: r.changed_at, reason: r.reason, changes: r.changes ?? [] }))
}

// ---------------------------------------------------------------------------------------------------------------------
// Office: the time list
// ---------------------------------------------------------------------------------------------------------------------

export type TimeListEntry = {
  id: string
  kind: TimeEntry['kind']
  startedAt: string
  endedAt: string | null
  where: string
  workOrderId: string | null
  jobId: string | null
  source: TimeEntry['source']
  endSource: TimeEntry['endSource']
  needsReview: boolean
  reviewNote: string | null
  tappedBy: string | null
  equipment: string | null
}

export type TimeListPerson = {
  userId: string
  name: string
  paidSeconds: number
  travelSeconds: number
  breakSeconds: number
  regularHours: number
  overtimeHours: number
  /** Hours payroll has for this person this week (regular + overtime), null = nothing saved. */
  payrollHours: number | null
  warnings: TimeWarning[]
  entries: TimeListEntry[]
}

export type TimeWeek = {
  ready: boolean
  weekStart: string
  weekEnd: string
  cutoffAt: string
  editable: boolean
  timeZone: string
  people: TimeListPerson[]
  equipment: TimeListEntry[]
  /** Active people, for "+ Add time". */
  staff: Array<{ userId: string; name: string }>
}

/** One pay week of time: every person with entries, their paid total, warnings, and what payroll has. */
export async function loadTimeWeek(admin: SupabaseClient, orgId: string, cutoff: Date, now = new Date()): Promise<TimeWeek> {
  const config = await loadClockConfig(admin, orgId)
  await autoCloseForgotten(admin, orgId, { now, config }).catch((e) => console.error('[time-clock] auto-close on list failed', e))
  const from = payWeekStartInstant(cutoff).getTime()
  const to = cutoff.getTime()
  const period = await findPeriodForCutoff(admin, orgId, cutoff, { create: false })
  const base: TimeWeek = {
    ready: true,
    weekStart: localYmd(from, config.timeZone),
    weekEnd: cutoffYmdEt(cutoff),
    cutoffAt: cutoff.toISOString(),
    editable: periodIsEditable(period),
    timeZone: config.timeZone,
    people: [],
    equipment: [],
    staff: [],
  }
  const { data: staffRows } = await orgDb(admin, orgId).from('users').select('id, full_name').eq('active', true).order('full_name').limit(1000)
  base.staff = ((staffRows ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ userId: u.id, name: u.full_name || 'Unnamed' }))
  const { data, error } = await orgDb(admin, orgId)
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .is('removed_at', null)
    .gte('started_at', new Date(from - 86_400_000).toISOString())
    .lte('started_at', new Date(to).toISOString())
    .order('started_at', { ascending: true })
    .limit(5000)
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return { ...base, ready: false }
    throw error
  }
  const all = ((data ?? []) as Array<Record<string, unknown>>).map(entryFromRow)
  const inWeek = (e: TimeEntry) => {
    const s = Date.parse(e.startedAt)
    const end = e.endedAt ? Date.parse(e.endedAt) : now.getTime()
    return end > from && s <= to
  }
  const labels = await loadWhereLabels(admin, orgId, all)
  const items = new Map((await loadEquipmentNames(admin, orgId, all)).map((i) => [i.id, i.name]))
  const view = (e: TimeEntry): TimeListEntry => ({
    id: e.id,
    kind: e.kind,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    where: labels.get(e.workOrderId ?? '') ?? labels.get(`job:${e.jobId ?? ''}`) ?? '—',
    workOrderId: e.workOrderId,
    jobId: e.jobId,
    source: e.source,
    endSource: e.endSource,
    needsReview: e.needsReview,
    reviewNote: e.reviewNote,
    tappedBy: e.tappedBy,
    equipment: e.pricebookItemId ? items.get(e.pricebookItemId) ?? 'Equipment' : null,
  })
  const byUser = new Map<string, TimeEntry[]>()
  for (const e of all) if (e.userId) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e])
  const names = await loadAnyNames(admin, orgId, [...Array.from(byUser.keys()), ...all.map((e) => e.tappedBy ?? '')])
  const payroll = new Map<string, number>()
  if (period) {
    const { data: hours } = await orgDb(admin, orgId).from('payroll_rep_hours').select('user_id, regular_hours, overtime_hours').eq('payroll_period_id', period.id)
    for (const h of (hours ?? []) as Array<{ user_id: string; regular_hours: number; overtime_hours: number }>) payroll.set(h.user_id, Number(h.regular_hours || 0) + Number(h.overtime_hours || 0))
  }
  for (const [userId, entries] of Array.from(byUser.entries())) {
    const shown = entries.filter(inWeek)
    if (shown.length === 0) continue
    const t = paidTime(entries, { timeZone: config.timeZone })
    const paid = totalSeconds(clipIntervals(t.paid, from, to))
    const split = splitOvertime(paid, config.settings.overtimeAfterHours)
    base.people.push({
      userId,
      name: names.get(userId) ?? 'Unnamed',
      paidSeconds: paid,
      travelSeconds: totalSeconds(clipIntervals(t.travel, from, to)),
      breakSeconds: totalSeconds(clipIntervals(t.breaks, from, to)),
      regularHours: split.regularHours,
      overtimeHours: split.overtimeHours,
      payrollHours: payroll.has(userId) ? payroll.get(userId)! : null,
      warnings: weekWarnings(entries, { timeZone: config.timeZone, settings: config.settings, weekFrom: from, weekTo: to, now: now.getTime() }),
      entries: shown.map((e) => ({ ...view(e), tappedBy: e.tappedBy ? names.get(e.tappedBy) ?? null : null })),
    })
  }
  base.people.sort((a, b) => Number(b.warnings.some((w) => w.code === 'needs_review')) - Number(a.warnings.some((w) => w.code === 'needs_review')) || a.name.localeCompare(b.name))
  base.equipment = all.filter((e) => e.kind === 'equipment' && inWeek(e)).map((e) => ({ ...view(e), tappedBy: e.tappedBy ? names.get(e.tappedBy) ?? null : null }))
  return base
}

/** "Stop label" per work order and "Job 26-0141" per job, for the list. */
async function loadWhereLabels(admin: SupabaseClient, orgId: string, entries: TimeEntry[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const db = orgDb(admin, orgId)
  const woIds = Array.from(new Set(entries.map((e) => e.workOrderId).filter(Boolean) as string[]))
  const jobIds = Array.from(new Set(entries.map((e) => e.jobId).filter(Boolean) as string[]))
  for (let i = 0; i < woIds.length; i += 200) {
    const { data } = await db.from('work_orders').select('id, title, work_order_number').in('id', woIds.slice(i, i + 200))
    for (const w of (data ?? []) as Array<{ id: string; title: string | null; work_order_number: string | null }>) out.set(w.id, w.title || w.work_order_number || 'Visit')
  }
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data } = await db.from('production_jobs').select('id, job_number').in('id', jobIds.slice(i, i + 200))
    for (const j of (data ?? []) as Array<{ id: string; job_number: string | null }>) out.set(`job:${j.id}`, `Job ${j.job_number ?? ''}`.trim())
  }
  return out
}

async function loadEquipmentNames(admin: SupabaseClient, orgId: string, entries: TimeEntry[]): Promise<Array<{ id: string; name: string }>> {
  const ids = Array.from(new Set(entries.map((e) => e.pricebookItemId).filter(Boolean) as string[]))
  if (ids.length === 0) return []
  const { data } = await orgDb(admin, orgId).from('pricebook_items').select('id, name').in('id', ids)
  return (data ?? []) as Array<{ id: string; name: string }>
}

async function weekIsOpen(admin: SupabaseClient, orgId: string, isoTimes: Array<string | null | undefined>): Promise<boolean> {
  for (const iso of isoTimes) {
    if (!iso) continue
    const p = await findPeriodForCutoff(admin, orgId, payWeekCutoffFor(new Date(iso)), { create: false })
    if (!periodIsEditable(p)) return false
  }
  return true
}

const LOCKED = 'That week is already approved, so its time can’t change. Add the fix to an open week.'

async function checkWhere(admin: SupabaseClient, orgId: string, edit: EntryEdit): Promise<Where | Fail | null> {
  if (!('workOrderId' in edit) && !('jobId' in edit)) return null
  const db = orgDb(admin, orgId)
  if (edit.workOrderId) {
    const { data } = await db.from('work_orders').select('id, job_id').eq('id', edit.workOrderId).maybeSingle()
    if (!data) return { ok: false, status: 404, error: 'Visit not found' }
    return { workOrderId: edit.workOrderId, jobId: (data as { job_id: string | null }).job_id }
  }
  if (edit.jobId) {
    const { data } = await db.from('production_jobs').select('id').eq('id', edit.jobId).maybeSingle()
    if (!data) return { ok: false, status: 404, error: 'Job not found' }
    return { workOrderId: null, jobId: edit.jobId }
  }
  return { workOrderId: null, jobId: null }
}

/** Office: add a stretch of time someone forgot to tap (reason required). */
export async function addTimeEntry(admin: SupabaseClient, orgId: string, actorUserId: string, edit: EntryEdit & { userId?: string }, reason: string): Promise<{ ok: true; id: string } | Fail> {
  const db = orgDb(admin, orgId)
  const { data: person } = await db.from('users').select('id').eq('id', edit.userId).maybeSingle()
  if (!person) return { ok: false, status: 404, error: 'Person not found' }
  if (!(await weekIsOpen(admin, orgId, [edit.startedAt, edit.endedAt]))) return { ok: false, status: 409, error: LOCKED }
  const where = await checkWhere(admin, orgId, edit)
  if (where && 'ok' in where) return where
  const row = {
    user_id: edit.userId,
    kind: edit.kind ?? 'work',
    started_at: edit.startedAt,
    ended_at: edit.endedAt,
    source: 'typed',
    end_source: 'typed',
    work_order_id: where?.workOrderId ?? null,
    production_job_id: where?.jobId ?? null,
    tapped_by_user_id: actorUserId,
    ended_by_user_id: actorUserId,
    tapped_via: 'office',
  }
  const { data, error } = await db.from('time_entries').insert(row).select('id').single()
  if (error) {
    if (isTimeTrackingNotReadyError(error)) return { ok: false, status: 503, error: TIME_TRACKING_NOT_READY }
    if (error.code === '42501') return { ok: false, status: 400, error: 'That isn’t in your company' }
    throw error
  }
  const id = (data as { id: string }).id
  await logChange(admin, orgId, id, 'added', actorUserId, reason, diffFields({}, row, LABELS_BY_COLUMN))
  await syncTimeFeeds(admin, orgId, { userIds: [edit.userId!], instants: [edit.startedAt!, edit.endedAt!], jobIds: where?.jobId ? [where.jobId] : [], actorUserId }).catch((e) => console.error('[time-clock] feed sync failed', e))
  return { ok: true, id }
}

const LABELS_BY_COLUMN: Record<string, string> = ENTRY_FIELD_LABELS

/** Office: change an entry (reason required; the week must still be open — both the old and the new times). */
export async function editTimeEntry(admin: SupabaseClient, orgId: string, actorUserId: string, entryId: string, edit: EntryEdit, reason: string): Promise<{ ok: true } | Fail> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('id', entryId).is('removed_at', null).maybeSingle()
  if (!data) return { ok: false, status: 404, error: 'Entry not found' }
  const before = data as Record<string, unknown>
  const e = entryFromRow(before)
  if (e.kind === 'equipment' && edit.kind) return { ok: false, status: 400, error: 'Equipment time stays equipment' }
  const startedAt = edit.startedAt ?? e.startedAt
  const endedAt = edit.endedAt === undefined ? e.endedAt : edit.endedAt
  if (endedAt && Date.parse(endedAt) < Date.parse(startedAt)) return { ok: false, status: 400, error: 'End is before start' }
  if (endedAt && Date.parse(endedAt) - Date.parse(startedAt) > 24 * 3_600_000) return { ok: false, status: 400, error: 'One entry can’t be longer than 24 hours — split it' }
  if (!(await weekIsOpen(admin, orgId, [e.startedAt, e.endedAt, startedAt, endedAt]))) return { ok: false, status: 409, error: LOCKED }
  const where = await checkWhere(admin, orgId, edit)
  if (where && 'ok' in where) return where
  const patch: Record<string, unknown> = {}
  if (edit.startedAt !== undefined) patch.started_at = edit.startedAt
  if (edit.endedAt !== undefined) {
    patch.ended_at = edit.endedAt
    patch.end_source = edit.endedAt ? 'typed' : null
    patch.ended_by_user_id = edit.endedAt ? actorUserId : null
  }
  if (edit.kind !== undefined) patch.kind = edit.kind
  if (where) {
    patch.work_order_id = where.workOrderId
    patch.production_job_id = where.jobId
  }
  // Looking at it and fixing it is the review; the office can also just clear the flag.
  if (edit.needsReview !== undefined) patch.needs_review = edit.needsReview
  else if (before.needs_review === true) patch.needs_review = false
  const changes = diffFields(
    { ...before, started_at: normIso(before.started_at), ended_at: normIso(before.ended_at) },
    { ...patch, ...(patch.started_at ? { started_at: normIso(patch.started_at) } : {}), ...('ended_at' in patch ? { ended_at: normIso(patch.ended_at) } : {}) },
    LABELS_BY_COLUMN
  )
  if (changes.length === 0) return { ok: false, status: 400, error: 'Nothing changed' }
  const { error } = await db.from('time_entries').update(patch).eq('id', entryId)
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, error: 'They already have a clock running — stop that one first' }
    if (error.code === '42501') return { ok: false, status: 400, error: 'That isn’t in your company' }
    throw error
  }
  await logChange(admin, orgId, entryId, 'updated', actorUserId, reason, changes)
  const jobIds = [e.jobId, where?.jobId].filter(Boolean) as string[]
  await syncTimeFeeds(admin, orgId, { userIds: e.userId ? [e.userId] : [], instants: [e.startedAt, e.endedAt, startedAt, endedAt].filter(Boolean) as string[], jobIds, actorUserId }).catch((err) =>
    console.error('[time-clock] feed sync failed', err)
  )
  return { ok: true }
}

const normIso = (v: unknown) => (typeof v === 'string' && v ? new Date(v).toISOString() : v ?? null)

/** Office: take an entry out (kept, marked removed; reason required). */
export async function removeTimeEntry(admin: SupabaseClient, orgId: string, actorUserId: string, entryId: string, reason: string): Promise<{ ok: true } | Fail> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('id', entryId).is('removed_at', null).maybeSingle()
  if (!data) return { ok: false, status: 404, error: 'Entry not found' }
  const e = entryFromRow(data as Record<string, unknown>)
  if (!(await weekIsOpen(admin, orgId, [e.startedAt, e.endedAt]))) return { ok: false, status: 409, error: LOCKED }
  const { error } = await db.from('time_entries').update({ removed_at: new Date().toISOString(), removed_by: actorUserId }).eq('id', entryId)
  if (error) throw error
  await logChange(admin, orgId, entryId, 'removed', actorUserId, reason, [])
  await syncTimeFeeds(admin, orgId, { userIds: e.userId ? [e.userId] : [], instants: [e.startedAt, e.endedAt].filter(Boolean) as string[], jobIds: e.jobId ? [e.jobId] : [], actorUserId }).catch((err) =>
    console.error('[time-clock] feed sync failed', err)
  )
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// Feeds: payroll hours + job labor cost
// ---------------------------------------------------------------------------------------------------------------------

export type FeedResult = { weeks: number; hoursSaved: number; skipped: Array<{ userId?: string; jobId?: string; reason: string }>; costLines: number }

/**
 * Refresh what payroll and the job ledger get from the clock, for the people / jobs / weeks a change touched.
 *  - Payroll: each person's paid time in the pay week (closed entries only; exact seconds, no rounding to quarter hours;
 *    regular up to the company's overtime line, the rest overtime) → `saveHoursEntries` (its audit row is the trail).
 *    A week that is approved (or being approved) is never touched. The clock is the source of these people's hours
 *    while the switch is on: fixes go in the time list, not the hours box.
 *  - Jobs: one labor line per job per pay week = Σ work time on that job (breaks out, drive time out) × the person's
 *    hourly rate (straight time; the overtime premium is not spread onto jobs). People with no rate are left out and
 *    named in the description. Visits with no job are skipped (invoicing branch: the visit charge path).
 */
export async function syncTimeFeeds(
  admin: SupabaseClient,
  orgId: string,
  input: { userIds: string[]; instants: string[]; jobIds: string[]; actorUserId: string | null }
): Promise<FeedResult> {
  const out: FeedResult = { weeks: 0, hoursSaved: 0, skipped: [], costLines: 0 }
  const cutoffs = new Map<string, Date>()
  for (const iso of input.instants) {
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) continue
    const c = payWeekCutoffFor(new Date(t))
    cutoffs.set(c.toISOString(), c)
  }
  if (cutoffs.size === 0) return out
  const config = await loadClockConfig(admin, orgId)
  for (const cutoff of Array.from(cutoffs.values())) {
    out.weeks++
    const from = payWeekStartInstant(cutoff).getTime()
    const to = cutoff.getTime()
    const period = await findPeriodForCutoff(admin, orgId, cutoff, { create: input.userIds.length > 0 })
    const weekOpen = periodIsEditable(period)
    const rateCache = new Map<string, number | null>()
    const rateFor = async (userId: string) => {
      if (!rateCache.has(userId)) {
        const a = await loadPlanForWeek(admin, userId, orgId, cutoff.toISOString(), { leftOrSaved: true })
        rateCache.set(userId, resolveHourlyRate({ hourlyRateOverride: a?.hourly_rate_override, compPlan: a?.comp_plans as never }))
      }
      return rateCache.get(userId) ?? null
    }

    // ---- payroll hours
    if (period && weekOpen) {
      for (const userId of input.userIds) {
        const entries = await loadPersonEntries(admin, orgId, userId, from - 86_400_000, to + 86_400_000)
        const t = paidTime(entries, { timeZone: config.timeZone })
        const paid = totalSeconds(clipIntervals(t.paid, from, to))
        const { data: existing } = await orgDb(admin, orgId).from('payroll_rep_hours').select('id').eq('payroll_period_id', period.id).eq('user_id', userId).maybeSingle()
        if (paid === 0 && !existing) continue
        const split = splitOvertime(paid, config.settings.overtimeAfterHours)
        const res = await saveHoursEntries(admin, {
          orgId,
          periodId: period.id,
          cutoffAt: period.cutoff_at,
          actorUserId: input.actorUserId ?? userId,
          entries: [{ user_id: userId, regular_hours: split.regularHours, overtime_hours: split.overtimeHours, reason: 'Time clock' }],
        })
        if (res.ok) out.hoursSaved++
        else out.skipped.push({ userId, reason: res.error })
      }
    } else if (input.userIds.length) {
      out.skipped.push({ reason: 'week approved' })
    }

    // ---- job labor cost
    for (const jobId of input.jobIds) {
      const { data: rows, error } = await orgDb(admin, orgId)
        .from('time_entries')
        .select(TIME_ENTRY_COLUMNS)
        .eq('production_job_id', jobId)
        .eq('kind', 'work')
        .is('removed_at', null)
        .lte('started_at', new Date(to).toISOString())
        .gte('started_at', new Date(from - 86_400_000).toISOString())
      if (error) throw error
      const work = ((rows ?? []) as Array<Record<string, unknown>>).map(entryFromRow).filter((e) => e.endedAt && e.userId)
      const users = Array.from(new Set(work.map((e) => e.userId!)))
      let amount = 0
      let seconds = 0
      let unpricedSeconds = 0
      for (const userId of users) {
        const breaks = (await loadPersonEntries(admin, orgId, userId, from - 86_400_000, to + 86_400_000)).filter((e) => e.kind === 'break' && e.endedAt)
        const mine: Interval[] = mergeIntervals(work.filter((e) => e.userId === userId).map((e) => ({ start: Date.parse(e.startedAt), end: Date.parse(e.endedAt!) })))
        const net = clipIntervals(subtractIntervals(mine, breaks.map((b) => ({ start: Date.parse(b.startedAt), end: Date.parse(b.endedAt!) }))), from, to)
        const s = totalSeconds(net)
        if (s === 0) continue
        const rate = await rateFor(userId)
        if (rate == null) {
          unpricedSeconds += s
          continue
        }
        seconds += s
        amount += (s / 3600) * rate
      }
      const written = await upsertJobLaborLine(admin, orgId, {
        jobId,
        weekEnding: cutoffYmdEt(cutoff),
        amount: Math.round(amount * 100) / 100,
        seconds,
        unpricedSeconds,
        actorUserId: input.actorUserId,
      })
      if (written) out.costLines++
    }
  }
  return out
}

async function loadPersonEntries(admin: SupabaseClient, orgId: string, userId: string, fromMs: number, toMs: number): Promise<TimeEntry[]> {
  const { data, error } = await orgDb(admin, orgId)
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .eq('user_id', userId)
    .is('removed_at', null)
    .gte('started_at', new Date(fromMs).toISOString())
    .lte('started_at', new Date(toMs).toISOString())
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(entryFromRow).filter((e) => e.kind !== 'equipment')
}

/** The ONE time-clock line per job per pay week: update it, (re)create it, or take it off when it is 0. */
async function upsertJobLaborLine(
  admin: SupabaseClient,
  orgId: string,
  l: { jobId: string; weekEnding: string; amount: number; seconds: number; unpricedSeconds: number; actorUserId: string | null }
): Promise<boolean> {
  const db = orgDb(admin, orgId)
  const { data: job } = await db.from('production_jobs').select('id').eq('id', l.jobId).maybeSingle()
  if (!job) return false
  const { data: existing, error: readErr } = await db.from('job_cost_lines').select('id, amount, deleted_at, description, approved').eq('job_id', l.jobId).eq('time_week_ending', l.weekEnding).maybeSingle()
  if (readErr) {
    if (isTimeTrackingNotReadyError(readErr)) return false
    throw readErr
  }
  const description = `Crew time — week ending ${l.weekEnding} (${formatDuration(l.seconds)})${l.unpricedSeconds ? `; ${formatDuration(l.unpricedSeconds)} not counted: no pay rate` : ''}`
  const live = l.amount > 0 || l.seconds > 0
  const row = existing as { id: string; amount: number; deleted_at: string | null; description: string; approved: boolean | null } | null
  if (row) {
    const patch: Record<string, unknown> = live
      ? { amount: l.amount, description, deleted_at: null, deleted_by: null, status: 'active', updated_at: new Date().toISOString() }
      : { deleted_at: row.deleted_at ?? new Date().toISOString(), deleted_by: l.actorUserId, status: 'archived', updated_at: new Date().toISOString() }
    // An approval refers to the number on screen (same rule as the cost-lines PATCH): a new amount goes back for review.
    if (row.approved && Number(row.amount) !== l.amount) Object.assign(patch, { approved: false, approved_by: null, approved_at: null })
    if (live && Number(row.amount) === l.amount && row.description === description && !row.deleted_at) return false
    if (!live && row.deleted_at) return false
    const { error } = await db.from('job_cost_lines').update(patch).eq('id', row.id)
    if (error) throw error
    return true
  }
  if (!live) return false
  const { error } = await db.from('job_cost_lines').insert({
    job_id: l.jobId,
    description,
    amount: l.amount,
    cost_type: 'labor',
    source: 'time_entries',
    time_week_ending: l.weekEnding,
    incurred_on: l.weekEnding,
    status: 'active',
    created_by: l.actorUserId,
    ...NEW_COST_LINE_PAYROLL_FLAGS,
  })
  if (error) {
    if (error.code === '23505') return upsertJobLaborLine(admin, orgId, l) // raced another writer: update theirs
    if (isTimeTrackingNotReadyError(error) || error.code === '22P02') return false // enum value / column not there yet
    throw error
  }
  return true
}
