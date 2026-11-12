/**
 * Crew incentives — server side. Proposes the crew bonus rules' lines (lib/crew-incentives.ts) into the EXISTING bonus
 * approval: `payroll_bonus_lines` rows with status pending_approval, shown on the Bonus approval screen. Nothing here
 * approves, pays or touches a payroll total; an owner approves or rejects every line.
 *
 * Gate: the company's industry profile is lawn_landscape AND its own switch (`orgs.settings.crewIncentives.enabled`) is
 * on. Anything else returns before any query on visits, time or pay — ARX (roofing) never runs a line of this.
 *
 * Idempotent: every line has a unique `source_key` (rule + visit or crew-week + person); a rejected line keeps its key.
 * Never adds to a locked / approved / being-approved week: the line goes on the next open week.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  CREW_INCENTIVES_SETTINGS_KEY,
  CREW_INCENTIVES_PROFILE,
  RULE_BONUS_TYPES,
  anyRuleLive,
  planVisitLines,
  planWeeklyLines,
  readCrewIncentiveSettings,
  targetProgress,
  workOrderHours,
  isCrewBonusType,
  type CrewIncentiveSettings,
  type CrewWeek,
  type PlannedLine,
  type VisitFacts,
} from '@/lib/crew-incentives'
import { loadOrgProfile } from '@/lib/org-profile'
import { findOrCreateWeek, findWeekNear, isPeriodClaimedError, periodIsEditable } from '@/lib/payroll-periods'
import { addWeeks, cutoffYmd, nextWeekCutoff, weekCutoffContaining, type PayWeekSchedule } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { orgDb } from '@/lib/supabase/org-db'
import { TIME_ENTRY_COLUMNS, entryFromRow, type TimeEntry } from '@/lib/time-tracking'

type Row = Record<string, unknown>

const LOOKBACK_DAYS = 28
const CHUNK = 200

async function inChunks<T>(ids: readonly string[], run: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await run(ids.slice(i, i + CHUNK) as string[])
    if (error) throw new Error(error.message ?? 'read failed')
    out.push(...((data ?? []) as T[]))
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Gate + settings
// ---------------------------------------------------------------------------------------------------------------------

export type CrewIncentivesState = { available: boolean; settings: CrewIncentiveSettings; active: boolean }

/**
 * available = the company's profile is lawn_landscape (the Settings card and routes exist); active = available AND the
 * company turned the switch on. A failed read is "not available" (fail closed: this proposes pay).
 */
export async function loadCrewIncentivesState(admin: SupabaseClient, orgId: string): Promise<CrewIncentivesState> {
  const off: CrewIncentivesState = { available: false, settings: readCrewIncentiveSettings(null), active: false }
  try {
    const profile = await loadOrgProfile(admin, orgId)
    if (profile.id !== CREW_INCENTIVES_PROFILE) return off
    const { data, error } = await admin.from('orgs').select(`s:settings->${CREW_INCENTIVES_SETTINGS_KEY}`).eq('id', orgId).maybeSingle()
    if (error) throw error
    const settings = readCrewIncentiveSettings((data as { s?: unknown } | null)?.s)
    return { available: true, settings, active: settings.enabled }
  } catch (e) {
    console.error('crew incentives: state not readable, treating as off', orgId, e)
    return off
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Which pay week a line goes on
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The open week for something earned at `earnedAt`: the week it belongs to if that week is still open (and not being
 * approved), else the next open week. A past week that was never opened is skipped, never revived. Null = none found.
 */
export async function pickOpenWeek(admin: SupabaseClient, orgId: string, earnedAt: Date, s: PayWeekSchedule, now: Date): Promise<{ id: string; cutoffAt: string } | null> {
  let target = weekCutoffContaining(earnedAt, s)
  for (let k = 0; k < 12; k++) {
    const row = await findWeekNear(admin, orgId, target, s)
    if (row) {
      if (periodIsEditable(row)) return { id: row.id, cutoffAt: row.cutoff_at }
    } else if (target.getTime() > now.getTime()) {
      const made = await findOrCreateWeek(admin, orgId, target, s)
      if (periodIsEditable(made as { status?: unknown })) return { id: made.id, cutoffAt: made.cutoff_at }
    }
    target = nextWeekCutoff(target, s)
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing lines
// ---------------------------------------------------------------------------------------------------------------------

export type PlaceResult = { proposed: number; existing: number; deferred: number }

/** Insert the lines that are not there yet (by source key) on an open week. A week that refuses is retried next run. */
export async function placeLines(admin: SupabaseClient, orgId: string, lines: readonly PlannedLine[], s: PayWeekSchedule, now: Date): Promise<PlaceResult & { doneKeys: Set<string> }> {
  const res = { proposed: 0, existing: 0, deferred: 0, doneKeys: new Set<string>() }
  if (lines.length === 0) return res
  const db = orgDb(admin, orgId)
  const have = new Set(
    (await inChunks<{ source_key: string }>(lines.map((l) => l.sourceKey), (chunk) => db.from('payroll_bonus_lines').select('source_key').in('source_key', chunk))).map((r) => r.source_key)
  )
  const weeks = new Map<string, { id: string; cutoffAt: string } | null>()
  for (const l of lines) {
    if (have.has(l.sourceKey)) {
      res.existing++
      res.doneKeys.add(l.sourceKey)
      continue
    }
    const wk = weekCutoffContaining(l.earnedAt, s).toISOString()
    if (!weeks.has(wk)) weeks.set(wk, await pickOpenWeek(admin, orgId, l.earnedAt, s, now))
    const week = weeks.get(wk)
    if (!week) {
      res.deferred++
      continue
    }
    const { error } = await db.from('payroll_bonus_lines').insert({
      payroll_period_id: week.id,
      user_id: l.userId,
      bonus_type: RULE_BONUS_TYPES[l.rule],
      amount: l.cents / 100,
      description: l.reason,
      source_id: l.sourceId,
      source_key: l.sourceKey,
      created_by: null,
      status: 'pending_approval',
    })
    const code = (error as { code?: string } | null)?.code
    if (!error) {
      res.proposed++
      res.doneKeys.add(l.sourceKey)
    } else if (code === '23505') {
      res.existing++ // a parallel run (or the unique key) already has it
      res.doneKeys.add(l.sourceKey)
    } else if (isPeriodClaimedError(error)) {
      res.deferred++ // the week started being approved between the check and the write: next run
    } else {
      console.error('crew incentives: could not propose a line', l.sourceKey, error)
      res.deferred++
    }
  }
  return res
}

// ---------------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------------

type WorkOrderRow = {
  id: string
  work_order_number: string | null
  work_order_type: string | null
  completed_at: string | null
  assigned_sub_id: string | null
  job_id: string | null
  estimated_hours: number | string | null
  visit_step: string | null
}
const WO_COLS = 'id, work_order_number, work_order_type, status, completed_at, assigned_sub_id, job_id, estimated_hours, visit_step'

export type RunSummary = { skipped?: 'off' | 'no_rules'; visits: number; proposed: number; existing: number; deferred: number }

/**
 * Evaluate the last four weeks of completed work and propose what is earned. Safe to run any number of times.
 * Called by the morning cron and right after staff mark a visit.
 */
export async function runCrewIncentives(admin: SupabaseClient, orgId: string, opts: { now?: Date } = {}): Promise<RunSummary> {
  const none: RunSummary = { visits: 0, proposed: 0, existing: 0, deferred: 0 }
  const state = await loadCrewIncentivesState(admin, orgId)
  if (!state.active) return { ...none, skipped: 'off' }
  const settings = state.settings
  if (!anyRuleLive(settings)) return { ...none, skipped: 'no_rules' }
  const now = opts.now ?? new Date()
  const sched = await loadPayWeekSchedule(admin, orgId)
  const tz = sched.timeZone
  const db = orgDb(admin, orgId)
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()

  // Completed work in the window, plus older visits that got a mark in the window.
  const { data: doneRows, error: doneErr } = await db.from('work_orders').select(WO_COLS).eq('status', 'completed').gte('completed_at', from).limit(2000)
  if (doneErr) throw new Error(doneErr.message)
  const { data: markRows, error: markErr } = await db.from('crew_visit_marks').select('work_order_id, kind, marked_at, proposed_at').gte('marked_at', from).limit(2000)
  if (markErr) throw new Error(markErr.message)
  const wos = new Map<string, WorkOrderRow>()
  for (const r of (doneRows ?? []) as WorkOrderRow[]) wos.set(r.id, r)
  const extraIds = Array.from(new Set(((markRows ?? []) as Row[]).map((m) => String(m.work_order_id)))).filter((id) => !wos.has(id))
  for (const r of await inChunks<WorkOrderRow & { status: string }>(extraIds, (c) => db.from('work_orders').select(WO_COLS).in('id', c))) if (r.status === 'completed' && r.completed_at) wos.set(r.id, r)
  // Plain visits (the plan's own step) and job work orders; follow-on inspection steps are not crew work.
  const eligible = Array.from(wos.values()).filter((w) => w.completed_at && (w.visit_step == null || w.visit_step === 'service'))
  if (eligible.length === 0) return none
  const ids = eligible.map((w) => w.id)
  const subIds = Array.from(new Set(eligible.map((w) => w.assigned_sub_id).filter((x): x is string => !!x)))

  const [photos, work, roster, charges, marks] = await Promise.all([
    inChunks<{ work_order_id: string; photo_tag: string | null }>(ids, (c) => db.from('photos').select('work_order_id, photo_tag').in('work_order_id', c).is('deleted_at', null)),
    inChunks<Row>(ids, (c) => db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('kind', 'work').in('work_order_id', c).is('removed_at', null)),
    inChunks<{ sub_id: string; user_id: string }>(subIds, (c) => db.from('crew_members').select('sub_id, user_id').in('sub_id', c)),
    settings.weeklyTarget.on && settings.weeklyTarget.basis === 'dollars'
      ? inChunks<{ work_order_id: string; price: number | string | null }>(ids, (c) => db.from('service_visit_charges').select('work_order_id, price').in('work_order_id', c))
      : Promise.resolve([] as Array<{ work_order_id: string; price: number | string | null }>),
    inChunks<{ work_order_id: string; kind: string; marked_at: string }>(ids, (c) => db.from('crew_visit_marks').select('work_order_id, kind, marked_at').in('work_order_id', c)),
  ])
  const workEntries = work.map(entryFromRow)
  const clockedUsers = Array.from(new Set(workEntries.map((e) => e.userId).filter((x): x is string => !!x)))
  const breaks: TimeEntry[] = (
    await inChunks<Row>(clockedUsers, (c) => db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('kind', 'break').in('user_id', c).gte('started_at', from).is('removed_at', null))
  ).map(entryFromRow)

  // Budget: the work order's own hours, else the job's when this is the job's only work order.
  const jobIds = Array.from(new Set(eligible.filter((w) => w.estimated_hours == null && w.job_id).map((w) => w.job_id as string)))
  const jobHours = new Map<string, number>()
  const jobWoCount = new Map<string, number>()
  if (jobIds.length) {
    for (const j of await inChunks<{ id: string; estimated_hours: number | string | null }>(jobIds, (c) => db.from('production_jobs').select('id, estimated_hours').in('id', c))) {
      if (j.estimated_hours != null && Number(j.estimated_hours) > 0) jobHours.set(j.id, Number(j.estimated_hours))
    }
    for (const w of await inChunks<{ job_id: string; status: string }>(jobIds, (c) => db.from('work_orders').select('job_id, status').in('job_id', c))) {
      if (w.status !== 'cancelled') jobWoCount.set(w.job_id, (jobWoCount.get(w.job_id) ?? 0) + 1)
    }
  }

  const rosterBySub = new Map<string, string[]>()
  for (const r of roster) rosterBySub.set(r.sub_id, [...(rosterBySub.get(r.sub_id) ?? []), r.user_id])
  const photosBy = new Map<string, Array<string | null>>()
  for (const p of photos) photosBy.set(p.work_order_id, [...(photosBy.get(p.work_order_id) ?? []), p.photo_tag])
  const priceBy = new Map(charges.map((c) => [c.work_order_id, c.price == null ? 0 : Number(c.price)]))
  const markBy = new Map<string, { review: string | null; callback: string | null }>()
  for (const m of marks) {
    const cur = markBy.get(m.work_order_id) ?? { review: null, callback: null }
    if (m.kind === 'review') cur.review = m.marked_at
    if (m.kind === 'callback') cur.callback = m.marked_at
    markBy.set(m.work_order_id, cur)
  }

  const lines: PlannedLine[] = []
  const weekAgg = new Map<string, CrewWeekAgg>()
  for (const w of eligible) {
    const clocked = Array.from(new Set(workEntries.filter((e) => e.workOrderId === w.id && e.userId).map((e) => e.userId as string)))
    const members = clocked.length ? clocked : w.assigned_sub_id ? rosterBySub.get(w.assigned_sub_id) ?? [] : []
    const hasClock = clocked.length > 0
    const own = w.estimated_hours != null ? Number(w.estimated_hours) : null
    const budget = own != null && own > 0 ? own : w.job_id && jobWoCount.get(w.job_id) === 1 ? jobHours.get(w.job_id) ?? null : null
    const actual = hasClock ? workOrderHours([...workEntries, ...breaks], w.id) : null
    const m = markBy.get(w.id)
    const facts: VisitFacts = {
      id: w.id,
      number: w.work_order_number,
      completedAt: w.completed_at as string,
      isJobWorkOrder: !!w.job_id,
      members,
      photoCount: (photosBy.get(w.id) ?? []).length,
      photoTags: photosBy.get(w.id) ?? [],
      callbackAt: m?.callback ?? null,
      reviewAt: m?.review ?? null,
      budgetHours: budget,
      actualHours: actual,
    }
    lines.push(...planVisitLines(settings, facts, now, tz))
    if (w.assigned_sub_id && new Date(w.completed_at as string).getTime() <= now.getTime()) {
      const cutoff = weekCutoffContaining(new Date(w.completed_at as string), sched)
      const key = `${w.assigned_sub_id}|${cutoffYmd(cutoff, sched)}`
      const agg = weekAgg.get(key) ?? { subId: w.assigned_sub_id, weekEnding: cutoffYmd(cutoff, sched), visits: 0, dollars: 0, members: new Set<string>(), earnedAt: new Date(w.completed_at as string) }
      agg.visits++
      agg.dollars += priceBy.get(w.id) ?? 0
      for (const u of members) agg.members.add(u)
      if (new Date(w.completed_at as string) > agg.earnedAt) agg.earnedAt = new Date(w.completed_at as string)
      weekAgg.set(key, agg)
    }
  }
  for (const agg of Array.from(weekAgg.values())) lines.push(...planWeeklyLines(settings, { ...agg, members: Array.from(agg.members) }))

  const placed = await placeLines(admin, orgId, lines, sched, now)
  // A mark whose lines now exist can no longer be un-marked (the line is rejected on the Bonus approval screen instead).
  const markedKeys = ((markRows ?? []) as Row[]).filter((m) => !m.proposed_at)
  for (const m of markedKeys) {
    const rule = m.kind === 'review' ? 'review' : 'deduction'
    const mine = lines.filter((l) => l.sourceId === m.work_order_id && l.rule === rule)
    if (mine.length > 0 && mine.every((l) => placed.doneKeys.has(l.sourceKey))) {
      await db.from('crew_visit_marks').update({ proposed_at: now.toISOString() }).eq('work_order_id', m.work_order_id as string).eq('kind', m.kind as string)
    }
  }
  return { visits: eligible.length, proposed: placed.proposed, existing: placed.existing, deferred: placed.deferred }
}

type CrewWeekAgg = Omit<CrewWeek, 'members'> & { members: Set<string> }

// ---------------------------------------------------------------------------------------------------------------------
// Marks (staff: "review named the crew", "callback or redo")
// ---------------------------------------------------------------------------------------------------------------------

export type MarkKind = 'review' | 'callback'
export type MarkResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string }

export async function setVisitMark(admin: SupabaseClient, orgId: string, userId: string, workOrderId: string, kind: MarkKind, on: boolean, now = new Date()): Promise<MarkResult> {
  const db = orgDb(admin, orgId)
  const { data: wo } = await db.from('work_orders').select('id, status').eq('id', workOrderId).maybeSingle()
  if (!wo) return { ok: false, status: 404, error: 'Visit not found' }
  if ((wo as { status: string }).status !== 'completed') return { ok: false, status: 400, error: 'Only a finished visit can be marked' }
  const { data: cur } = await db.from('crew_visit_marks').select('id, proposed_at').eq('work_order_id', workOrderId).eq('kind', kind).maybeSingle()
  if (on) {
    if (cur) return { ok: true }
    const { error } = await db.from('crew_visit_marks').insert({ work_order_id: workOrderId, kind, marked_by: userId, marked_at: now.toISOString() })
    if (error && (error as { code?: string }).code !== '23505') return { ok: false, status: 409, error: 'Could not save the mark' }
    return { ok: true }
  }
  if (!cur) return { ok: true }
  if ((cur as { proposed_at: string | null }).proposed_at) return { ok: false, status: 409, error: 'A bonus line was already proposed for this. Reject it on the Bonus approval screen.' }
  await db.from('crew_visit_marks').delete().eq('work_order_id', workOrderId).eq('kind', kind)
  return { ok: true }
}

/** Marks for a set of visits (the Visits board shows the buttons' state). */
export async function loadVisitMarks(admin: SupabaseClient, orgId: string, workOrderIds: readonly string[]): Promise<Record<string, { review: boolean; callback: boolean }>> {
  const out: Record<string, { review: boolean; callback: boolean }> = {}
  const rows = await inChunks<{ work_order_id: string; kind: string }>(workOrderIds, (c) => orgDb(admin, orgId).from('crew_visit_marks').select('work_order_id, kind').in('work_order_id', c))
  for (const r of rows) {
    const cur = (out[r.work_order_id] ??= { review: false, callback: false })
    if (r.kind === 'review') cur.review = true
    if (r.kind === 'callback') cur.callback = true
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------------------------------------------------

export type ScoreboardPerson = { userId: string; name: string; earned: number; pending: number; isMe: boolean }
export type ScoreboardCrew = {
  subId: string
  name: string
  people: ScoreboardPerson[]
  target: ReturnType<typeof targetProgress>
}
export type Scoreboard = { weekEnding: string; crews: ScoreboardCrew[] }

/**
 * This week's earned (approved / paid) and pending crew bonuses, per person, and progress to the weekly target.
 * `scope` is the ONLY thing deciding whose numbers appear: a crew link shows that crew; a signed-in person sees the
 * crews they are a member of — and the lines of those crews' members only. Never another crew's pay. Field roles
 * never see job money: a dollar target shows a percent, not dollars.
 */
export async function loadScoreboard(admin: SupabaseClient, orgId: string, scope: { subId: string } | { userId: string }, now = new Date()): Promise<Scoreboard | null> {
  const state = await loadCrewIncentivesState(admin, orgId)
  if (!state.active) return null
  const db = orgDb(admin, orgId)
  const sched = await loadPayWeekSchedule(admin, orgId)
  const cutoff = weekCutoffContaining(now, sched)
  const prev = addWeeks(cutoff, -1, sched)
  const week = await findWeekNear(admin, orgId, cutoff, sched)

  let subIds: string[]
  if ('subId' in scope) subIds = [scope.subId]
  else subIds = (await db.from('crew_members').select('sub_id').eq('user_id', scope.userId)).data?.map((r: { sub_id: string }) => r.sub_id) ?? []
  subIds = Array.from(new Set(subIds))
  const me = 'userId' in scope ? scope.userId : null
  const crews: ScoreboardCrew[] = []
  for (const subId of subIds) {
    const [{ data: sub }, { data: members }] = await Promise.all([
      db.from('sub_contractors').select('id, company_name').eq('id', subId).maybeSingle(),
      db.from('crew_members').select('user_id').eq('sub_id', subId),
    ])
    if (!sub) continue
    const userIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id)
    const names = new Map<string, string>()
    if (userIds.length) for (const u of ((await db.from('users').select('id, full_name').in('id', userIds)).data ?? []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, u.full_name || 'Crew member')
    const lines = userIds.length
      ? (((await db.from('payroll_bonus_lines').select('user_id, amount, status, bonus_type, payroll_period_id').in('user_id', userIds).in('status', ['pending_approval', 'approved', 'paid']).gte('created_at', new Date(now.getTime() - 60 * 86_400_000).toISOString())).data ?? []) as Array<{ user_id: string; amount: number | string; status: string; bonus_type: string; payroll_period_id: string }>)
      : []
    const people: ScoreboardPerson[] = userIds.map((u) => {
      const mine = lines.filter((l) => l.user_id === u && isCrewBonusType(l.bonus_type))
      const earned = mine.filter((l) => (l.status === 'approved' || l.status === 'paid') && week && l.payroll_period_id === week.id).reduce((s, l) => s + Number(l.amount), 0)
      const pending = mine.filter((l) => l.status === 'pending_approval').reduce((s, l) => s + Number(l.amount), 0)
      return { userId: u, name: names.get(u) ?? 'Crew member', earned: Math.round(earned * 100) / 100, pending: Math.round(pending * 100) / 100, isMe: u === me }
    })
    people.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name))
    // Weekly target progress: this crew's completed visits in the current pay week.
    const { data: done } = await db.from('work_orders').select('id').eq('assigned_sub_id', subId).eq('status', 'completed').gt('completed_at', prev.toISOString()).lte('completed_at', cutoff.toISOString())
    const doneIds = ((done ?? []) as Array<{ id: string }>).map((d) => d.id)
    let dollars = 0
    if (state.settings.weeklyTarget.basis === 'dollars' && doneIds.length) {
      for (const c of await inChunks<{ price: number | string | null }>(doneIds, (c) => db.from('service_visit_charges').select('price').in('work_order_id', c))) dollars += c.price == null ? 0 : Number(c.price)
    }
    crews.push({ subId, name: (sub as { company_name: string | null }).company_name ?? 'Crew', people, target: targetProgress(state.settings, { visits: doneIds.length, dollars }) })
  }
  return { weekEnding: cutoffYmd(cutoff, sched), crews }
}
