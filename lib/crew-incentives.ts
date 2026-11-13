/**
 * Crew incentives — the rules (pure, client-safe). Automatic bonus rules for in-house crews that FEED the existing bonus
 * approval (`payroll_bonus_lines`, pending_approval → approved → paid). There is no second payroll path: this file only
 * decides WHICH lines to propose and how much; lib/crew-incentives-db.ts writes them and nothing is paid until an owner
 * approves each line on the Bonus approval screen.
 *
 * Only for companies on the lawn_landscape profile that turned the switch on (Settings → Crew incentives). The switch
 * lives in `orgs.settings.crewIncentives.enabled` (default off), not in the feature list, so no other company's
 * Features card ever shows it.
 *
 * Five rules, each on/off with company-set amounts, each with a split mode:
 *  1. doneRight    — $X per completed visit / work order with its done photos and no staff-marked callback within N days.
 *  2. beatTime     — TIME ON SITE (first clock-in to last clock-out on the visit, wall clock, not man-hours) under the
 *                    budget (work_orders.estimated_hours, else the job's): $Y flat, or Z% of (hours saved × the company's
 *                    $/hour value of an hour).
 *  3. review       — $X when staff mark that a 5-star review named the crew.
 *  4. weeklyTarget — the crew hit N completed visits (or $N of completed visit price) in the pay week: the crew splits $X.
 *  5. deduction    — a callback / redo marked by staff takes back $X (a NEGATIVE line, same approval).
 *
 * Money is handled in whole cents; a split never creates or loses a cent.
 *
 * No back pay (owner decision): a rule pays only for work finished AFTER the rule (and the master switch) was turned on —
 * the server stamps `onSince` / `enabledAt`; marking an old visit never pays or deducts for it.
 * Deductions only take back BONUS money: they never go below the person's crew bonuses that week (the rest is dropped).
 */
import { missingRequiredPhotoTags } from '@/lib/final-photo-tags'
import { localYmd, type TimeEntry } from '@/lib/time-tracking'

export const CREW_INCENTIVES_SETTINGS_KEY = 'crewIncentives'

/** The only industry profile this applies to. */
export const CREW_INCENTIVES_PROFILE = 'lawn_landscape'

export const SPLIT_MODES = ['even', 'full'] as const
export type SplitMode = (typeof SPLIT_MODES)[number]
export const SPLIT_LABELS: Record<SplitMode, string> = {
  even: 'Split evenly across the crew members on that visit',
  full: 'Each member gets the full amount',
}

export const RULE_KEYS = ['doneRight', 'beatTime', 'review', 'weeklyTarget', 'deduction'] as const
export type RuleKey = (typeof RULE_KEYS)[number]

/** The `payroll_bonus_lines.bonus_type` of each rule (the database check lists exactly these). */
export const RULE_BONUS_TYPES: Record<RuleKey, string> = {
  doneRight: 'crew_done_right',
  beatTime: 'crew_beat_time',
  review: 'crew_review',
  weeklyTarget: 'crew_weekly_target',
  deduction: 'crew_deduction',
}
export const CREW_BONUS_TYPES: readonly string[] = Object.values(RULE_BONUS_TYPES)
export const isCrewBonusType = (t: unknown): boolean => typeof t === 'string' && CREW_BONUS_TYPES.includes(t)

export const RULE_LABELS: Record<RuleKey, string> = {
  doneRight: 'Visit done right',
  beatTime: 'Beat the time',
  review: 'Customer review names the crew',
  weeklyTarget: 'Weekly crew target',
  deduction: 'Callback or redo',
}

/** `onSince`: when the rule was turned on (set by the server only; null = not live). Work finished before it never pays. */
type Stamped = { onSince: string | null }
export type DoneRightRule = Stamped & { on: boolean; amount: number; split: SplitMode; holdDays: number; minPhotos: number }
export type BeatTimeRule = Stamped & { on: boolean; mode: 'flat' | 'percent'; amount: number; percent: number; ratePerHour: number; split: SplitMode }
export type ReviewRule = Stamped & { on: boolean; amount: number; split: SplitMode }
export type WeeklyTargetRule = Stamped & { on: boolean; basis: 'visits' | 'dollars'; target: number; amount: number; split: SplitMode }
export type DeductionRule = Stamped & { on: boolean; amount: number; split: SplitMode }

export type CrewIncentiveSettings = {
  /** Master switch (default off). Does nothing unless the company's industry profile is lawn_landscape. */
  enabled: boolean
  /** When the master switch was turned on (server-stamped). */
  enabledAt: string | null
  doneRight: DoneRightRule
  beatTime: BeatTimeRule
  review: ReviewRule
  weeklyTarget: WeeklyTargetRule
  deduction: DeductionRule
}

export const MAX_AMOUNT = 10_000
export const MAX_HOLD_DAYS = 30
export const MAX_MIN_PHOTOS = 20
export const MAX_TARGET = 1_000_000

const DEFAULTS: CrewIncentiveSettings = {
  enabled: false,
  enabledAt: null,
  doneRight: { on: false, onSince: null, amount: 0, split: 'even', holdDays: 3, minPhotos: 1 },
  beatTime: { on: false, onSince: null, mode: 'flat', amount: 0, percent: 0, ratePerHour: 0, split: 'even' },
  review: { on: false, onSince: null, amount: 0, split: 'even' },
  weeklyTarget: { on: false, onSince: null, basis: 'visits', target: 0, amount: 0, split: 'even' },
  deduction: { on: false, onSince: null, amount: 0, split: 'even' },
}
export const DEFAULT_CREW_INCENTIVE_SETTINGS: Readonly<CrewIncentiveSettings> = Object.freeze(DEFAULTS)

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const money = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT ? Math.round(n * 100) / 100 : fallback
}
const whole = (v: unknown, fallback: number, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback
}
const stamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
const split = (v: unknown, fallback: SplitMode): SplitMode => ((SPLIT_MODES as readonly unknown[]).includes(v) ? (v as SplitMode) : fallback)

/** Stored (or missing / hand-edited) settings → a complete, valid object. Anything wrong falls back to the default for that field. */
export function readCrewIncentiveSettings(stored: unknown): CrewIncentiveSettings {
  const s = obj(stored)
  const d = DEFAULT_CREW_INCENTIVE_SETTINGS
  const dr = obj(s.doneRight)
  const bt = obj(s.beatTime)
  const rv = obj(s.review)
  const wt = obj(s.weeklyTarget)
  const dd = obj(s.deduction)
  return {
    enabled: s.enabled === true,
    enabledAt: stamp(s.enabledAt),
    doneRight: { on: dr.on === true, onSince: stamp(dr.onSince), amount: money(dr.amount, d.doneRight.amount), split: split(dr.split, d.doneRight.split), holdDays: whole(dr.holdDays, d.doneRight.holdDays, MAX_HOLD_DAYS), minPhotos: whole(dr.minPhotos, d.doneRight.minPhotos, MAX_MIN_PHOTOS) },
    beatTime: {
      on: bt.on === true,
      onSince: stamp(bt.onSince),
      mode: bt.mode === 'percent' ? 'percent' : 'flat',
      amount: money(bt.amount, d.beatTime.amount),
      percent: money(bt.percent, d.beatTime.percent) <= 100 ? money(bt.percent, d.beatTime.percent) : d.beatTime.percent,
      ratePerHour: money(bt.ratePerHour, d.beatTime.ratePerHour),
      split: split(bt.split, d.beatTime.split),
    },
    review: { on: rv.on === true, onSince: stamp(rv.onSince), amount: money(rv.amount, d.review.amount), split: split(rv.split, d.review.split) },
    weeklyTarget: { on: wt.on === true, onSince: stamp(wt.onSince), basis: wt.basis === 'dollars' ? 'dollars' : 'visits', target: whole(wt.target, d.weeklyTarget.target, MAX_TARGET), amount: money(wt.amount, d.weeklyTarget.amount), split: split(wt.split, d.weeklyTarget.split) },
    deduction: { on: dd.on === true, onSince: stamp(dd.onSince), amount: money(dd.amount, d.deduction.amount), split: split(dd.split, d.deduction.split) },
  }
}

/** True when a rule would propose something (on AND has an amount the rule can use). */
export function ruleIsLive(s: CrewIncentiveSettings, k: RuleKey): boolean {
  const r = s[k]
  if (!r.on) return false
  switch (k) {
    case 'beatTime': {
      const b = s.beatTime
      return b.mode === 'flat' ? b.amount > 0 : b.percent > 0 && b.ratePerHour > 0
    }
    case 'weeklyTarget':
      return s.weeklyTarget.target > 0 && s.weeklyTarget.amount > 0
    default:
      return (r as { amount: number }).amount > 0
  }
}
export const anyRuleLive = (s: CrewIncentiveSettings): boolean => RULE_KEYS.some((k) => ruleIsLive(s, k))

/**
 * The instant from which a rule pays: the later of the master switch and the rule being turned on. Work finished before it
 * is never paid (no back pay). Null (a stamp is missing) = the rule pays nothing — it fails closed.
 */
export function liveSince(s: CrewIncentiveSettings, k: RuleKey): number | null {
  const a = s.enabledAt ? Date.parse(s.enabledAt) : NaN
  const b = s[k].onSince ? Date.parse(s[k].onSince as string) : NaN
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(a, b)
}
/** True when something finished at `at` is covered by the rule (turned on before it finished). */
export function coveredByRule(s: CrewIncentiveSettings, k: RuleKey, at: string | Date): boolean {
  const since = liveSince(s, k)
  const t = typeof at === 'string' ? Date.parse(at) : at.getTime()
  return since != null && !Number.isNaN(t) && t >= since
}

/**
 * A save from Settings: `{ crewIncentives: { enabled?, doneRight?: {...}, … } }` → the top-level keys to write at path
 * ['crewIncentives'] (each rule replaced whole, merged over `current` so a partial rule keeps its other fields), or why not.
 * A wrong value is an error, never silently replaced.
 */
export function parseCrewIncentivesPatch(body: unknown, current: CrewIncentiveSettings, now: Date = new Date()): { set: Record<string, unknown> } | { error: string } {
  const patch = obj(obj(body)[CREW_INCENTIVES_SETTINGS_KEY])
  const set: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'enabledAt') continue // server-stamped, never taken from the browser
    if (k === 'enabled') {
      if (typeof v !== 'boolean') return { error: 'Crew incentives must be on or off' }
      set.enabled = v
      set.enabledAt = !v ? null : current.enabled && current.enabledAt ? current.enabledAt : now.toISOString()
      continue
    }
    if (!(RULE_KEYS as readonly string[]).includes(k)) return { error: `Unknown setting: ${k}` }
    const rk = k as RuleKey
    const given = { ...obj(v) }
    delete given.onSince // server-stamped
    const merged = { ...(current[rk] as Record<string, unknown>), ...given }
    for (const [f, fv] of Object.entries(given)) {
      if (!(f in (DEFAULT_CREW_INCENTIVE_SETTINGS[rk] as Record<string, unknown>))) return { error: `Unknown setting: ${k}.${f}` }
      if (f === 'on' && typeof fv !== 'boolean') return { error: `${RULE_LABELS[rk]} must be on or off` }
      if (f === 'split' && !(SPLIT_MODES as readonly unknown[]).includes(fv)) return { error: 'Pick how the amount is split' }
      if (f === 'mode' && fv !== 'flat' && fv !== 'percent') return { error: 'Pick a flat amount or a percent' }
      if (f === 'basis' && fv !== 'visits' && fv !== 'dollars') return { error: 'Pick visits or dollars of work' }
      if (['amount', 'ratePerHour'].includes(f) && money(fv, -1) < 0) return { error: `Amounts must be between $0 and $${MAX_AMOUNT.toLocaleString('en-US')}` }
      if (f === 'percent' && !(money(fv, -1) >= 0 && money(fv, -1) <= 100)) return { error: 'Percent must be between 0 and 100' }
      if (f === 'holdDays' && whole(fv, -1, MAX_HOLD_DAYS) < 0) return { error: `Days to wait must be a whole number from 0 to ${MAX_HOLD_DAYS}` }
      if (f === 'minPhotos' && whole(fv, -1, MAX_MIN_PHOTOS) < 0) return { error: `Photos must be a whole number from 0 to ${MAX_MIN_PHOTOS}` }
      if (f === 'target' && whole(fv, -1, MAX_TARGET) < 0) return { error: 'The target must be a whole number' }
    }
    const next = readCrewIncentiveSettings({ [rk]: merged })[rk]
    // Turning a rule on stamps the moment (no back pay); turning it off clears it so a later "on" stamps again.
    const was = current[rk]
    next.onSince = !next.on ? null : was.on && was.onSince ? was.onSince : now.toISOString()
    set[rk] = next
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

// ---------------------------------------------------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One amount (cents, may be negative) across people. `even`: whole cents, the leftover cents go one each to the first
 * people in id order (so the same crew always splits the same way and the parts add up exactly); `full`: everyone gets it all.
 */
export function splitCents(totalCents: number, userIds: readonly string[], mode: SplitMode): Map<string, number> {
  const ids = Array.from(new Set(userIds)).sort()
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  if (mode === 'full') {
    for (const id of ids) out.set(id, totalCents)
    return out
  }
  const sign = totalCents < 0 ? -1 : 1
  const abs = Math.abs(totalCents)
  const base = Math.floor(abs / ids.length)
  const extra = abs - base * ids.length
  ids.forEach((id, i) => out.set(id, sign * (base + (i < extra ? 1 : 0))))
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Hours on a work order
// ---------------------------------------------------------------------------------------------------------------------

/**
 * TIME ON SITE for one work order (owner decision: wall clock, not man-hours): from the first clock-in to the last clock-out
 * of anyone's work entries on it. `open` = somebody is still clocked in on it (the visit is not finished being timed, so no
 * rule pays yet). `hours` is null when nobody clocked it.
 */
export function timeOnSite(entries: readonly TimeEntry[], workOrderId: string): { hours: number | null; open: boolean } {
  let first = Infinity
  let last = -Infinity
  let open = false
  for (const e of entries) {
    if (e.kind !== 'work' || e.workOrderId !== workOrderId) continue
    if (!e.endedAt) {
      open = true
      continue
    }
    first = Math.min(first, Date.parse(e.startedAt))
    last = Math.max(last, Date.parse(e.endedAt))
  }
  return { hours: first === Infinity || last <= first ? null : (last - first) / 3_600_000, open }
}

// ---------------------------------------------------------------------------------------------------------------------
// Proposed lines
// ---------------------------------------------------------------------------------------------------------------------

/** What the rules need to know about one completed visit / work order. */
export type VisitFacts = {
  id: string
  /** The work order number (WO-00123) — shown on the line instead of any customer detail. */
  number: string | null
  completedAt: string
  /** An install-style work order of a job (its done photos are the four walk-around angles) vs a plain visit. */
  isJobWorkOrder: boolean
  /** People who worked it (time clock), else the crew's roster. */
  members: readonly string[]
  photoCount: number
  photoTags: readonly (string | null | undefined)[]
  callbackAt: string | null
  reviewAt: string | null
  budgetHours: number | null
  /** Time on site (first clock-in to last clock-out, hours); null = nobody clocked it (the rule skips). */
  actualHours: number | null
  /** Somebody is still clocked in on it: nothing is proposed for the visit yet. */
  clockOpen?: boolean
  /** Who marked it (staff name, shown on the line). */
  reviewBy?: string | null
  callbackBy?: string | null
}

export type PlannedLine = {
  rule: RuleKey
  userId: string
  /** Whole cents; negative only for the deduction. */
  cents: number
  /** Plain English, no customer name. */
  reason: string
  /** Unique per (rule, visit or crew-week, person): the proposal is made once, ever. */
  sourceKey: string
  /** The work order (or crew-week seed) the line is about — payroll_bonus_lines.source_id (the server turns a seed into a uuid). */
  sourceId: string
  /** When it was earned: picks the pay week. */
  earnedAt: Date
}

export const sourceKey = (rule: RuleKey, subject: string, userId: string, extra?: string): string => `crew:${rule}:${subject}${extra ? `:${extra}` : ''}:${userId}`

const mmdd = (iso: string | Date, tz: string): string => {
  const ymd = localYmd(typeof iso === 'string' ? Date.parse(iso) : iso.getTime(), tz)
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`
}
const label = (v: Pick<VisitFacts, 'number'>) => v.number || 'visit'
const markedBy = (name: string | null | undefined) => (name ? ` (marked by ${name})` : '')
const hoursText = (h: number) => `${Math.round(h * 100) / 100} h`

/** Done photos present: a job's work order needs the four walk-around angles; a plain visit needs the company's minimum count. */
export function hasDonePhotos(v: Pick<VisitFacts, 'isJobWorkOrder' | 'photoCount' | 'photoTags'>, minPhotos: number): boolean {
  if (v.isJobWorkOrder) return missingRequiredPhotoTags(v.photoTags).length === 0
  return v.photoCount >= minPhotos
}

const DAY = 86_400_000

/** Crew work = the plan's own visit (or a job work order); follow-on inspection steps are not crew work. */
export const isCrewWorkVisit = (visitStep: string | null | undefined): boolean => visitStep == null || visitStep === 'service'

/** ONE rule for "this finished visit counts toward the weekly target" — the run and the scoreboard both use it. */
export const countsForWeeklyTarget = (s: CrewIncentiveSettings, v: { visit_step?: string | null; completed_at?: string | null }): boolean =>
  !!v.completed_at && isCrewWorkVisit(v.visit_step) && coveredByRule(s, 'weeklyTarget', v.completed_at)

/** Bonus lines a completed visit earns under rules 1–3 and the deduction (rule 5). Pure: nothing is written. */
export function planVisitLines(s: CrewIncentiveSettings, v: VisitFacts, now: Date, tz: string): PlannedLine[] {
  if (!s.enabled || v.members.length === 0 || v.clockOpen) return []
  const out: PlannedLine[] = []
  const done = mmdd(v.completedAt, tz)
  const completed = new Date(v.completedAt)
  const push = (rule: RuleKey, totalCents: number, mode: SplitMode, reason: string, earnedAt: Date) => {
    if (totalCents === 0) return
    for (const [userId, cents] of Array.from(splitCents(totalCents, v.members, mode))) {
      if (cents === 0) continue
      out.push({ rule, userId, cents, reason, sourceKey: sourceKey(rule, v.id, userId), sourceId: v.id, earnedAt })
    }
  }

  // 1. Done right: photos, no callback marked, and the waiting days have passed without one.
  const dr = s.doneRight
  if (ruleIsLive(s, 'doneRight') && coveredByRule(s, 'doneRight', v.completedAt)) {
    const heldUntil = completed.getTime() + dr.holdDays * DAY
    if (!v.callbackAt && now.getTime() >= heldUntil && hasDonePhotos(v, dr.minPhotos)) {
      push('doneRight', Math.round(dr.amount * 100), dr.split, `Visit done right — ${label(v)}, ${done}`, completed)
    }
  }

  // 2. Beat the time: clocked and finished under the budget.
  const bt = s.beatTime
  if (ruleIsLive(s, 'beatTime') && coveredByRule(s, 'beatTime', v.completedAt) && v.budgetHours != null && v.budgetHours > 0 && v.actualHours != null && v.actualHours > 0 && v.actualHours < v.budgetHours) {
    const saved = Math.round((v.budgetHours - v.actualHours) * 100) / 100
    const total = bt.mode === 'flat' ? Math.round(bt.amount * 100) : Math.round((bt.percent / 100) * saved * bt.ratePerHour * 100)
    push('beatTime', total, bt.split, `Beat the time — ${label(v)}, ${done} (on site ${hoursText(v.actualHours)}, budget ${hoursText(v.budgetHours)})`, completed)
  }

  // 3. A 5-star review named the crew (staff marked it).
  if (ruleIsLive(s, 'review') && v.reviewAt && coveredByRule(s, 'review', v.completedAt)) {
    push('review', Math.round(s.review.amount * 100), s.review.split, `5-star review named the crew — ${label(v)}, ${done}${markedBy(v.reviewBy)}`, new Date(v.reviewAt))
  }

  // 5. A callback / redo marked by staff takes the amount back (a negative line, same approval).
  if (ruleIsLive(s, 'deduction') && v.callbackAt && coveredByRule(s, 'deduction', v.completedAt)) {
    push('deduction', -Math.round(s.deduction.amount * 100), s.deduction.split, `Callback or redo — ${label(v)}, ${done}${markedBy(v.callbackBy)}`, new Date(v.callbackAt))
  }
  return out
}

/** One crew's completed work in one pay week. */
export type CrewWeek = {
  subId: string
  /** The week's cutoff day (YYYY-MM-DD, company zone) — part of the key, so the week pays the crew once. */
  weekEnding: string
  visits: number
  /** Sum of the visits' prices (0 for a visit with none). */
  dollars: number
  /** Everyone who worked those visits. */
  members: readonly string[]
  /** An instant inside the week (picks the pay week). */
  earnedAt: Date
}

/** Rule 4: the crew hit the weekly target → the crew splits $X. Proposed as soon as the target is reached. */
export function planWeeklyLines(s: CrewIncentiveSettings, w: CrewWeek): PlannedLine[] {
  if (!s.enabled || !ruleIsLive(s, 'weeklyTarget') || w.members.length === 0) return []
  const t = s.weeklyTarget
  const reached = t.basis === 'visits' ? w.visits >= t.target : w.dollars >= t.target
  if (!reached) return []
  const reason = `Weekly crew target hit — week ending ${Number(w.weekEnding.slice(5, 7))}/${Number(w.weekEnding.slice(8, 10))}${t.basis === 'visits' ? ` (${w.visits} visits)` : ''}`
  const out: PlannedLine[] = []
  for (const [userId, cents] of Array.from(splitCents(Math.round(t.amount * 100), w.members, t.split))) {
    if (cents === 0) continue
    out.push({ rule: 'weeklyTarget', userId, cents, reason, sourceKey: sourceKey('weeklyTarget', w.subId, userId, w.weekEnding), sourceId: `${w.subId}|${w.weekEnding}`, earnedAt: w.earnedAt })
  }
  return out
}

/** Progress toward the weekly target for the scoreboard. Dollar targets show a percent only (field roles never see job money). */
export function targetProgress(s: CrewIncentiveSettings, w: Pick<CrewWeek, 'visits' | 'dollars'>): { basis: 'visits' | 'dollars'; goal: number | null; done: number | null; percent: number; hit: boolean; amount: number } | null {
  if (!s.enabled || !ruleIsLive(s, 'weeklyTarget')) return null
  const t = s.weeklyTarget
  const have = t.basis === 'visits' ? w.visits : w.dollars
  const percent = Math.min(100, Math.floor((have / t.target) * 100))
  return { basis: t.basis, goal: t.basis === 'visits' ? t.target : null, done: t.basis === 'visits' ? w.visits : null, percent, hit: have >= t.target, amount: t.amount }
}

// ---------------------------------------------------------------------------------------------------------------------
// Deductions only take back bonus money
// ---------------------------------------------------------------------------------------------------------------------

export const DEDUCTION_LIMITED_TEXT = 'Deduction limited to bonuses earned this week'

/**
 * A deduction takes back crew BONUS money only: within a pay week a person's crew deductions can bring their crew-bonus
 * total down to $0 and no lower (never base pay or the weekly minimum). `roomCents` = the person's crew bonuses that week
 * (pending + approved + paid) minus deductions already counted. What is left over is dropped, not carried.
 * The database trigger `crew_deduction_cap` enforces the same rule on every write and when a bonus is rejected later.
 */
export function capDeductionCents(wantCents: number, roomCents: number): { cents: number; limited: boolean } {
  const want = Math.abs(wantCents)
  const room = Math.max(0, roomCents)
  const taken = Math.min(want, room)
  return { cents: taken === 0 ? 0 : -taken, limited: taken < want }
}
