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
import { createHash } from 'crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  CREW_INCENTIVES_SETTINGS_KEY,
  CREW_INCENTIVES_PROFILE,
  RULE_BONUS_TYPES,
  anyRuleLive,
  capDeductionCents,
  countsForWeeklyTarget,
  isCrewWorkVisit,
  timeOnSite,
  DEDUCTION_LIMITED_TEXT,
  planVisitLines,
  planWeeklyLines,
  readCrewIncentiveSettings,
  targetProgress,
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
import { TIME_ENTRY_COLUMNS, entryFromRow } from '@/lib/time-tracking'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * payroll_bonus_lines.source_id must be unique per (week, person, type). A work-order id already is; a crew-week seed
 * (`<crew>|<week ending>`) becomes a stable uuid, so two weeks' target lines that roll onto ONE open week never collide
 * on that constraint (they differ in source_id; the source_key keeps "once, ever").
 */
export function toSourceUuid(id: string): string {
  if (UUID_RE.test(id)) return id
  const h = createHash('sha1').update(`crew-incentives:${id}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Only OUR once-ever key counts as "already proposed" — any other unique violation is a different problem (retry later). */
const isSourceKeyViolation = (e: unknown): boolean => {
  const x = e as { code?: string; message?: string; details?: string } | null
  return x?.code === '23505' && `${x.message ?? ''} ${x.details ?? ''}`.includes('payroll_bonus_lines_source_key_uniq')
}

/** What a person can still lose to deductions in a week: crew bonuses (pending + approved + paid) minus deductions already counted, in cents. */
async function crewBonusRoomCents(admin: SupabaseClient, orgId: string, periodId: string, userId: string): Promise<number> {
  const { data, error } = await orgDb(admin, orgId).from('payroll_bonus_lines').select('amount, bonus_type, status').eq('payroll_period_id', periodId).eq('user_id', userId).in('status', ['pending_approval', 'approved', 'paid'])
  if (error) throw new Error(error.message)
  let cents = 0
  for (const r of (data ?? []) as Array<{ amount: number | string; bonus_type: string }>) if (isCrewBonusType(r.bonus_type)) cents += Math.round(Number(r.amount) * 100)
  return cents
}

/**
 * Insert the lines that are not there yet (by source key) on an open week. A week that refuses is retried next run.
 * Bonuses go first, then deductions, so a deduction is limited by what the person earned that week (see capDeductionCents).
 */
export async function placeLines(admin: SupabaseClient, orgId: string, lines: readonly PlannedLine[], s: PayWeekSchedule, now: Date): Promise<PlaceResult & { doneKeys: Set<string> }> {
  const res = { proposed: 0, existing: 0, deferred: 0, doneKeys: new Set<string>() }
  if (lines.length === 0) return res
  const db = orgDb(admin, orgId)
  const have = new Set(
    (await inChunks<{ source_key: string }>(lines.map((l) => l.sourceKey), (chunk) => db.from('payroll_bonus_lines').select('source_key').in('source_key', chunk))).map((r) => r.source_key)
  )
  const weeks = new Map<string, { id: string; cutoffAt: string } | null>()
  const room = new Map<string, number>()
  const ordered = [...lines.filter((l) => l.rule !== 'deduction'), ...lines.filter((l) => l.rule === 'deduction')]
  for (const l of ordered) {
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
    let amountCents = l.cents
    let description = l.reason
    let status: 'pending_approval' | 'rejected' = 'pending_approval'
    let reviewNote: string | null = null
    const roomKey = `${week.id}|${l.userId}`
    if (l.rule === 'deduction') {
      if (!room.has(roomKey)) room.set(roomKey, await crewBonusRoomCents(admin, orgId, week.id, l.userId))
      const cap = capDeductionCents(l.cents, room.get(roomKey) as number)
      amountCents = cap.cents
      if (cap.limited) description = `${l.reason} — ${DEDUCTION_LIMITED_TEXT}`
      // Nothing left to take back: keep the line (so the callback is on record and never proposed again) but closed, at $0.
      if (amountCents === 0) {
        status = 'rejected'
        reviewNote = DEDUCTION_LIMITED_TEXT
      }
    }
    const { error } = await db.from('payroll_bonus_lines').insert({
      payroll_period_id: week.id,
      user_id: l.userId,
      bonus_type: RULE_BONUS_TYPES[l.rule],
      amount: amountCents / 100,
      description,
      source_id: toSourceUuid(l.sourceId),
      source_key: l.sourceKey,
      created_by: null,
      status,
      ...(reviewNote ? { review_note: reviewNote } : {}),
    })
    if (!error) {
      res.proposed++
      res.doneKeys.add(l.sourceKey)
      if (l.rule === 'deduction') room.set(roomKey, (room.get(roomKey) as number) + amountCents)
    } else if (isSourceKeyViolation(error)) {
      res.existing++ // a parallel run already proposed it
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
 * Called by the morning cron (after autoCloseForgotten, so forgotten clocks are closed first) and right after a mark.
 * A visit with a clock still open on it is skipped this run. Work finished before a rule was turned on never pays.
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
  const eligible = Array.from(wos.values()).filter((w) => w.completed_at && isCrewWorkVisit(w.visit_step))
  if (eligible.length === 0) return none
  const ids = eligible.map((w) => w.id)
  const subIds = Array.from(new Set(eligible.map((w) => w.assigned_sub_id).filter((x): x is string => !!x)))

  const [photos, work, roster, charges, marks] = await Promise.all([
    inChunks<{ work_order_id: string; photo_tag: string | null }>(ids, (c) => db.from('photos').select('work_order_id, photo_tag').in('work_order_id', c).is('deleted_at', null)),
    inChunks<Row>(ids, (c) => db.from('time_entries').select(TIME_ENTRY_COLUMNS).eq('kind', 'work').in('work_order_id', c).is('removed_at', null)),
    inChunks<{ sub_id: string; user_id: string; created_at?: string | null }>(subIds, (c) => db.from('crew_members').select('sub_id, user_id, created_at').in('sub_id', c)),
    settings.weeklyTarget.on && settings.weeklyTarget.basis === 'dollars'
      ? inChunks<{ work_order_id: string; price: number | string | null }>(ids, (c) => db.from('service_visit_charges').select('work_order_id, price').in('work_order_id', c))
      : Promise.resolve([] as Array<{ work_order_id: string; price: number | string | null }>),
    inChunks<{ work_order_id: string; kind: string; marked_at: string; marked_by: string | null }>(ids, (c) => db.from('crew_visit_marks').select('work_order_id, kind, marked_at, marked_by').in('work_order_id', c)),
  ])
  const workEntries = work.map(entryFromRow)

  // People: only those still active get a line; names for "marked by".
  const personIds = Array.from(new Set([...workEntries.map((e) => e.userId), ...roster.map((r) => r.user_id), ...marks.map((m) => m.marked_by)].filter((x): x is string => !!x)))
  const people = new Map<string, { name: string; active: boolean }>()
  for (const u of await inChunks<{ id: string; full_name: string | null; active: boolean | null }>(personIds, (c) => db.from('users').select('id, full_name, active').in('id', c))) people.set(u.id, { name: u.full_name || 'staff', active: u.active !== false })
  const isActive = (id: string) => people.get(id)?.active === true

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

  const rosterBySub = new Map<string, Array<{ userId: string; joinedAt: number }>>()
  for (const r of roster) rosterBySub.set(r.sub_id, [...(rosterBySub.get(r.sub_id) ?? []), { userId: r.user_id, joinedAt: r.created_at ? Date.parse(r.created_at) : 0 }])
  const photosBy = new Map<string, Array<string | null>>()
  for (const p of photos) photosBy.set(p.work_order_id, [...(photosBy.get(p.work_order_id) ?? []), p.photo_tag])
  const priceBy = new Map(charges.map((c) => [c.work_order_id, c.price == null ? 0 : Number(c.price)]))
  const markBy = new Map<string, { review: string | null; callback: string | null; reviewBy: string | null; callbackBy: string | null }>()
  for (const m of marks) {
    const cur = markBy.get(m.work_order_id) ?? { review: null, callback: null, reviewBy: null, callbackBy: null }
    const by = m.marked_by ? people.get(m.marked_by)?.name ?? null : null
    if (m.kind === 'review') [cur.review, cur.reviewBy] = [m.marked_at, by]
    if (m.kind === 'callback') [cur.callback, cur.callbackBy] = [m.marked_at, by]
    markBy.set(m.work_order_id, cur)
  }

  const lines: PlannedLine[] = []
  const weekAgg = new Map<string, CrewWeekAgg>()
  for (const w of eligible) {
    const completedMs = Date.parse(w.completed_at as string)
    const clocked = Array.from(new Set(workEntries.filter((e) => e.workOrderId === w.id && e.userId).map((e) => e.userId as string)))
    // Who worked it: the clock; else the crew's roster AS OF the visit (people who joined later are not on it). Never someone deactivated.
    const members = (clocked.length ? clocked : w.assigned_sub_id ? (rosterBySub.get(w.assigned_sub_id) ?? []).filter((r) => r.joinedAt <= completedMs).map((r) => r.userId) : []).filter(isActive)
    const site = timeOnSite(workEntries, w.id)
    const own = w.estimated_hours != null ? Number(w.estimated_hours) : null
    const budget = own != null && own > 0 ? own : w.job_id && jobWoCount.get(w.job_id) === 1 ? jobHours.get(w.job_id) ?? null : null
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
      reviewBy: m?.reviewBy ?? null,
      callbackBy: m?.callbackBy ?? null,
      budgetHours: budget,
      actualHours: site.hours,
      clockOpen: site.open,
    }
    lines.push(...planVisitLines(settings, facts, now, tz))
    if (w.assigned_sub_id && !site.open && completedMs <= now.getTime() && countsForWeeklyTarget(settings, w)) {
      const cutoff = weekCutoffContaining(new Date(completedMs), sched)
      const key = `${w.assigned_sub_id}|${cutoffYmd(cutoff, sched)}`
      const agg = weekAgg.get(key) ?? { subId: w.assigned_sub_id, weekEnding: cutoffYmd(cutoff, sched), visits: 0, dollars: 0, members: new Set<string>(), earnedAt: new Date(completedMs) }
      agg.visits++
      agg.dollars += priceBy.get(w.id) ?? 0
      for (const u of members) agg.members.add(u)
      if (completedMs > agg.earnedAt.getTime()) agg.earnedAt = new Date(completedMs)
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
export type MarkResult = { ok: true } | { ok: false; status: 400 | 403 | 404 | 409; error: string }

/** Everyone who worked a visit or belongs to the crew it was assigned to (stricter than who gets paid: used to keep people from marking their own work). */
async function visitCrewIds(admin: SupabaseClient, orgId: string, workOrderId: string, subId: string | null): Promise<Set<string>> {
  const out = new Set<string>()
  const db = orgDb(admin, orgId)
  const { data: clock } = await db.from('time_entries').select('user_id').eq('work_order_id', workOrderId).is('removed_at', null)
  for (const r of (clock ?? []) as Array<{ user_id: string | null }>) if (r.user_id) out.add(r.user_id)
  if (subId) {
    const { data: roster } = await db.from('crew_members').select('user_id').eq('sub_id', subId)
    for (const r of (roster ?? []) as Array<{ user_id: string }>) out.add(r.user_id)
  }
  return out
}

export async function setVisitMark(admin: SupabaseClient, orgId: string, userId: string, workOrderId: string, kind: MarkKind, on: boolean, now = new Date()): Promise<MarkResult> {
  const db = orgDb(admin, orgId)
  const { data: wo } = await db.from('work_orders').select('id, status, assigned_sub_id').eq('id', workOrderId).maybeSingle()
  if (!wo) return { ok: false, status: 404, error: 'Visit not found' }
  if ((wo as { status: string }).status !== 'completed') return { ok: false, status: 400, error: 'Only a finished visit can be marked' }
  const { data: cur } = await db.from('crew_visit_marks').select('id, proposed_at').eq('work_order_id', workOrderId).eq('kind', kind).maybeSingle()
  if (on) {
    if (cur) return { ok: true }
    // Nobody marks their own crew's work (a review that earns them money, or a callback that costs a teammate).
    if ((await visitCrewIds(admin, orgId, workOrderId, (wo as { assigned_sub_id: string | null }).assigned_sub_id)).has(userId)) {
      return { ok: false, status: 403, error: 'You worked on this visit, so someone else has to mark it.' }
    }
    const { error } = await db.from('crew_visit_marks').insert({ work_order_id: workOrderId, kind, marked_by: userId, marked_at: now.toISOString() })
    if (error && (error as { code?: string }).code !== '23505') return { ok: false, status: 409, error: 'Could not save the mark' }
    return { ok: true }
  }
  if (!cur) return { ok: true }
  // Once ANY bonus line came from this mark (even a rejected one) it stays: reject or fix the line on the Bonus approval screen.
  const lineType = kind === 'review' ? RULE_BONUS_TYPES.review : RULE_BONUS_TYPES.deduction
  const { data: made } = await db.from('payroll_bonus_lines').select('id').eq('source_id', workOrderId).eq('bonus_type', lineType).limit(1)
  if ((cur as { proposed_at: string | null }).proposed_at || ((made ?? []) as unknown[]).length > 0) {
    return { ok: false, status: 409, error: 'A bonus line was already made from this mark, so it cannot be removed here. Reject that line on the Bonus approval screen.' }
  }
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
  /** Per person. Empty on a crew link (public): the link shows crew-level progress only, never one person's dollars. */
  people: ScoreboardPerson[]
  /** The whole crew's crew-bonus total this pay week. */
  totals: { earned: number; pending: number }
  target: ReturnType<typeof targetProgress>
}
export type Scoreboard = { weekEnding: string; crews: ScoreboardCrew[] }

/**
 * This pay week's earned (approved / paid) and pending crew bonuses, and progress to the weekly target. Pending covers THIS
 * week only. `scope` is the ONLY thing deciding whose numbers appear: a crew link (public, no sign-in) shows that crew's
 * totals and target progress only — no per-person dollars and no names; a signed-in person sees the crews they are a member
 * of, with the people in them. Never another crew's pay. A dollar target shows a percent, never job money. The weekly
 * target counts the same visits the rule counts (`countsForWeeklyTarget`).
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
    if (me && userIds.length) for (const u of ((await db.from('users').select('id, full_name').in('id', userIds)).data ?? []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, u.full_name || 'Crew member')
    const lines =
      week && userIds.length
        ? (((await db.from('payroll_bonus_lines').select('user_id, amount, status, bonus_type').in('user_id', userIds).eq('payroll_period_id', week.id).in('status', ['pending_approval', 'approved', 'paid'])).data ?? []) as Array<{ user_id: string; amount: number | string; status: string; bonus_type: string }>)
        : []
    const crewLines = lines.filter((l) => isCrewBonusType(l.bonus_type))
    const sum = (ls: typeof crewLines, f: (l: (typeof crewLines)[number]) => boolean) => Math.round(ls.filter(f).reduce((t, l) => t + Number(l.amount), 0) * 100) / 100
    const earnedOf = (l: (typeof crewLines)[number]) => l.status === 'approved' || l.status === 'paid'
    const pendingOf = (l: (typeof crewLines)[number]) => l.status === 'pending_approval'
    const people: ScoreboardPerson[] = me
      ? userIds
          .map((u) => ({ userId: u, name: names.get(u) ?? 'Crew member', earned: sum(crewLines.filter((l) => l.user_id === u), earnedOf), pending: sum(crewLines.filter((l) => l.user_id === u), pendingOf), isMe: u === me }))
          .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name))
      : []
    // Weekly target progress: this crew's completed visits in the current pay week, counted by the rule's own predicate.
    const { data: done } = await db.from('work_orders').select('id, visit_step, completed_at').eq('assigned_sub_id', subId).eq('status', 'completed').gt('completed_at', prev.toISOString()).lte('completed_at', cutoff.toISOString())
    const counted = ((done ?? []) as Array<{ id: string; visit_step: string | null; completed_at: string | null }>).filter((d) => countsForWeeklyTarget(state.settings, d))
    let dollars = 0
    if (state.settings.weeklyTarget.basis === 'dollars' && counted.length) {
      for (const c of await inChunks<{ price: number | string | null }>(counted.map((d) => d.id), (c) => db.from('service_visit_charges').select('price').in('work_order_id', c))) dollars += c.price == null ? 0 : Number(c.price)
    }
    crews.push({
      subId,
      name: (sub as { company_name: string | null }).company_name ?? 'Crew',
      people,
      totals: { earned: sum(crewLines, earnedOf), pending: sum(crewLines, pendingOf) },
      target: targetProgress(state.settings, { visits: counted.length, dollars }),
    })
  }
  return { weekEnding: cutoffYmd(cutoff, sched), crews }
}
