/**
 * Hourly (time & materials) billing — the rules (pure, client-safe). What a day of clocked time on a job or visit bills,
 * after the company's billing rules, and why. ONE writer is lib/hourly-billing-db.ts (SQL approve_billed_time).
 *
 * Billing never changes pay: payroll reads the exact minutes in time_entries (lib/time-tracking.ts paidTime); this file
 * only reads the same entries and rounds COPIES for the customer's invoice.
 *
 * A "day" = one job (or one visit of a plan billed by the hour) on one local calendar day in the company's time zone.
 *  - Labor: each person's work there that day minus their breaks (person-hours), or — billed per crew-hour — the time
 *    anyone of the crew was working there (the union), billed once.
 *  - Travel: the paid drive gap before arriving (a stop closed with "going to the next stop", lib/time-tracking.ts) is
 *    added as its own line at the labor rate ('yes'), a flat trip charge ('trip_charge'), or not billed ('no').
 *  - Equipment: a machine's own on/off time, or — `equipmentFromOperator` — the hours of the person who switched it on,
 *    at that stop that day (crews forget to stop machines; the operator's clock is the better record).
 *  - Rounding: none (to the hundredth of an hour), up to the next 15 min, or to the nearest 15 min — per person (person
 *    basis) or once for the crew, and once per machine.
 *  - Minimum: each visit bills at least N hours of labor, and of each machine used (0 = no minimum).
 */
import { mergeIntervals, subtractIntervals, totalSeconds, localYmd, localTimeToInstant, formatDuration, type Interval, type TimeEntry } from '@/lib/time-tracking'
import { addDaysYmd } from '@/lib/service-plans'
import { MAX_LINE_HOURS, hasAtMost2Decimals, isYmd, lineTotalCents } from '@/lib/invoice-lines'

// ---------------------------------------------------------------------------------------------------------------------
// Company rules (orgs.settings.hourlyBilling — owners, mergeOrgSettings path ['hourlyBilling'])
// ---------------------------------------------------------------------------------------------------------------------

export const HOURLY_BILLING_SETTINGS_KEY = 'hourlyBilling'

export const ROUNDINGS = ['none', 'up15', 'nearest15'] as const
export type Rounding = (typeof ROUNDINGS)[number]
export const ROUNDING_LABELS: Record<Rounding, string> = {
  none: 'Exact (no rounding)',
  up15: 'Round up to the next 15 minutes',
  nearest15: 'Round to the nearest 15 minutes',
}

export const TRAVEL_RULES = ['no', 'yes', 'trip_charge'] as const
export type TravelRule = (typeof TRAVEL_RULES)[number]
export const TRAVEL_LABELS: Record<TravelRule, string> = {
  no: "Don't bill drive time",
  yes: 'Bill drive time at the labor rate',
  trip_charge: 'Flat trip charge per visit',
}

export const BILL_BASES = ['person', 'crew'] as const
export type BillBasis = (typeof BILL_BASES)[number]
export const BILL_BASIS_LABELS: Record<BillBasis, string> = {
  person: 'Per person-hour (2 people × 3 h = 6 h)',
  crew: 'Per crew-hour (the crew working 3 h = 3 h)',
}

export type HourlyBillingSettings = {
  rounding: Rounding
  /** Each visit bills at least this many hours of labor and of each machine (0 = no minimum). */
  minimumHours: number
  travel: TravelRule
  /** The price-book item billed once per visit when travel = 'trip_charge'. */
  tripChargeItemId: string | null
  basis: BillBasis
  /** A machine bills its operator's hours at that stop (true) or its own on/off time (false). */
  equipmentFromOperator: boolean
}

export const DEFAULT_HOURLY_BILLING_SETTINGS: Readonly<HourlyBillingSettings> = Object.freeze({
  rounding: 'none',
  minimumHours: 0,
  travel: 'no',
  tripChargeItemId: null,
  basis: 'person',
  equipmentFromOperator: true,
}) as Readonly<HourlyBillingSettings>

const MAX_MINIMUM_HOURS = 24
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

function quarterHoursIn(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < lo || n > hi) return null
  return hasAtMost2Decimals(n) ? Math.round(n * 100) / 100 : null
}

/** The rules from `orgs.settings` (or the `hourlyBilling` object itself). Anything missing or bad is the default. */
export function readHourlyBillingSettings(stored: unknown): HourlyBillingSettings {
  const obj = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  const raw = obj[HOURLY_BILLING_SETTINGS_KEY]
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : obj
  const d = DEFAULT_HOURLY_BILLING_SETTINGS
  const travel = (TRAVEL_RULES as readonly unknown[]).includes(s.travel) ? (s.travel as TravelRule) : d.travel
  const trip = isUuid(s.tripChargeItemId) ? s.tripChargeItemId : null
  return {
    rounding: (ROUNDINGS as readonly unknown[]).includes(s.rounding) ? (s.rounding as Rounding) : d.rounding,
    minimumHours: quarterHoursIn(s.minimumHours, 0, MAX_MINIMUM_HOURS) ?? d.minimumHours,
    // A trip charge with no item bills nothing — treat it as "don't bill" so the screen never promises a charge.
    travel: travel === 'trip_charge' && !trip ? 'no' : travel,
    tripChargeItemId: trip,
    basis: (BILL_BASES as readonly unknown[]).includes(s.basis) ? (s.basis as BillBasis) : d.basis,
    equipmentFromOperator: typeof s.equipmentFromOperator === 'boolean' ? s.equipmentFromOperator : d.equipmentFromOperator,
  }
}

/** An owner's save `{ hourlyBilling: { rounding?, minimumHours?, travel?, tripChargeItemId?, basis?, equipmentFromOperator? } }`. */
export function parseHourlyBillingPatch(body: unknown): { set: Partial<HourlyBillingSettings> } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const patch = b.hourlyBilling && typeof b.hourlyBilling === 'object' && !Array.isArray(b.hourlyBilling) ? (b.hourlyBilling as Record<string, unknown>) : {}
  const set: Partial<HourlyBillingSettings> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'rounding') {
      if (!(ROUNDINGS as readonly unknown[]).includes(v)) return { error: 'Pick how hours are rounded' }
      set.rounding = v as Rounding
    } else if (k === 'minimumHours') {
      const n = quarterHoursIn(v, 0, MAX_MINIMUM_HOURS)
      if (n === null) return { error: `Minimum hours must be between 0 and ${MAX_MINIMUM_HOURS}` }
      set.minimumHours = n
    } else if (k === 'travel') {
      if (!(TRAVEL_RULES as readonly unknown[]).includes(v)) return { error: 'Pick how drive time is billed' }
      set.travel = v as TravelRule
    } else if (k === 'tripChargeItemId') {
      if (v !== null && !isUuid(v)) return { error: 'Pick the trip charge from your price book' }
      set.tripChargeItemId = v as string | null
    } else if (k === 'basis') {
      if (!(BILL_BASES as readonly unknown[]).includes(v)) return { error: 'Pick person-hours or crew-hours' }
      set.basis = v as BillBasis
    } else if (k === 'equipmentFromOperator') {
      if (typeof v !== 'boolean') return { error: 'Machine hours must be on or off' }
      set.equipmentFromOperator = v
    } else {
      return { error: `Unknown setting: ${k}` }
    }
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------------------------------------------------

/** Seconds → billable hours (2 decimals), by the company's rounding. 0 stays 0. */
export function roundBillableHours(seconds: number, rounding: Rounding): number {
  const s = Math.max(0, Math.round(seconds))
  if (s === 0) return 0
  if (rounding === 'up15') return Math.ceil(s / 900) / 4
  if (rounding === 'nearest15') return Math.round(s / 900) / 4
  return Math.round(s / 36) / 100
}

const ROUNDING_REASON: Record<Rounding, string> = {
  none: '',
  up15: 'rounded up to the next 15 min',
  nearest15: 'rounded to the nearest 15 min',
}

/** "6.25" — hours as people read them (no trailing zeros). */
export function hoursLabel(h: number): string {
  return String(Math.round(h * 100) / 100)
}

// ---------------------------------------------------------------------------------------------------------------------
// Clocked time per job/visit per day
// ---------------------------------------------------------------------------------------------------------------------

/** 'job:<id>' or 'visit:<id>'. */
export type TargetKey = string
export const jobTarget = (id: string): TargetKey => `job:${id}`
export const visitTarget = (id: string): TargetKey => `visit:${id}`

export type DayClock = {
  /** userId → net work seconds here (breaks out) and the intervals behind them. */
  people: Map<string, { workSeconds: number; travelSeconds: number; work: Interval[]; travel: Interval[] }>
  /** pricebook item id → machine on/off time (merged: two taps of one machine never count twice) and who switched it on. */
  machines: Map<string, { machineSeconds: number; intervals: Interval[]; operators: Set<string> }>
  /** A clock (person or machine) is still running here today: the day isn't finished. */
  open: boolean
  /** Some time here was stopped automatically (forgot to clock out) or flagged — worth a look before billing. */
  needsReview: boolean
}

const emptyDay = (): DayClock => ({ people: new Map(), machines: new Map(), open: false, needsReview: false })

const ms = (iso: string) => Date.parse(iso)

/** [from, to) cut at the company's local midnights → { day, piece }. */
export function splitByLocalDay(i: Interval, timeZone: string): Array<{ day: string; piece: Interval }> {
  const out: Array<{ day: string; piece: Interval }> = []
  let start = i.start
  let guard = 0
  while (start < i.end && guard++ < 400) {
    const day = localYmd(start, timeZone)
    const next = localTimeToInstant(addDaysYmd(day, 1), '00:00', timeZone)?.getTime() ?? i.end
    const end = Math.min(i.end, next > start ? next : i.end)
    out.push({ day, piece: { start, end } })
    start = end
  }
  return out
}

/**
 * Every job/visit day from a set of time entries (all of the company's entries in the window — breaks and other stops are
 * needed to know each person's net time and drive time). `targetOf` says which entries are billed by the hour (others
 * are only context). Removed entries must already be left out.
 */
export function clockedDays(
  entries: readonly TimeEntry[],
  opts: { timeZone: string; targetOf: (e: TimeEntry) => TargetKey | null; now: number }
): Map<TargetKey, Map<string, DayClock>> {
  const out = new Map<TargetKey, Map<string, DayClock>>()
  const dayOf = (t: TargetKey, day: string) => {
    let m = out.get(t)
    if (!m) out.set(t, (m = new Map()))
    let d = m.get(day)
    if (!d) m.set(day, (d = emptyDay()))
    return d
  }
  const byPerson = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    if (e.kind === 'equipment') {
      const t = opts.targetOf(e)
      if (!t || !e.pricebookItemId) continue
      const startMs = ms(e.startedAt)
      if (!e.endedAt) {
        dayOf(t, localYmd(startMs, opts.timeZone)).open = true
        continue
      }
      for (const { day, piece } of splitByLocalDay({ start: startMs, end: ms(e.endedAt) }, opts.timeZone)) {
        const d = dayOf(t, day)
        const m = d.machines.get(e.pricebookItemId) ?? { machineSeconds: 0, intervals: [], operators: new Set<string>() }
        m.intervals.push(piece)
        if (e.tappedBy) m.operators.add(e.tappedBy)
        d.machines.set(e.pricebookItemId, m)
        if (e.needsReview || e.endSource === 'auto_closed') d.needsReview = true
      }
      continue
    }
    if (!e.userId) continue
    const list = byPerson.get(e.userId) ?? []
    list.push(e)
    byPerson.set(e.userId, list)
  }

  for (const [userId, list] of Array.from(byPerson.entries())) {
    const breaks = mergeIntervals(list.filter((e) => e.kind === 'break' && e.endedAt).map((e) => ({ start: ms(e.startedAt), end: ms(e.endedAt as string) })))
    const works = list.filter((e) => e.kind === 'work').sort((a, b) => ms(a.startedAt) - ms(b.startedAt))
    const allWork = works.filter((e) => e.endedAt).map((e) => ({ start: ms(e.startedAt), end: ms(e.endedAt as string) }))
    const add = (t: TargetKey, kind: 'work' | 'travel', intervals: Interval[], flagged: boolean) => {
      for (const i of intervals) {
        for (const { day, piece } of splitByLocalDay(i, opts.timeZone)) {
          const d = dayOf(t, day)
          const p = d.people.get(userId) ?? { workSeconds: 0, travelSeconds: 0, work: [], travel: [] }
          p[kind].push(piece)
          d.people.set(userId, p)
          if (flagged) d.needsReview = true
        }
      }
    }
    for (let i = 0; i < works.length; i++) {
      const e = works[i]
      const t = opts.targetOf(e)
      if (!t) continue
      if (!e.endedAt) {
        dayOf(t, localYmd(ms(e.startedAt), opts.timeZone)).open = true
        continue
      }
      add(t, 'work', subtractIntervals([{ start: ms(e.startedAt), end: ms(e.endedAt) }], breaks), e.needsReview || e.endSource === 'auto_closed')
    }
    // Drive time: the gap after a stop closed "going to the next stop", the same local day, belongs to the next stop.
    for (let i = 0; i < works.length - 1; i++) {
      const a = works[i]
      const b = works[i + 1]
      if (!a.closedForTravel || !a.endedAt) continue
      const from = ms(a.endedAt)
      const to = ms(b.startedAt)
      if (to <= from || localYmd(from, opts.timeZone) !== localYmd(to, opts.timeZone)) continue
      const t = opts.targetOf(b)
      if (!t) continue
      add(t, 'travel', subtractIntervals(subtractIntervals([{ start: from, end: to }], allWork), breaks), false)
    }
  }

  // A visit is billed once (one invoice line set): a visit that ran past midnight keeps ALL its time on its first day, so
  // no hours are stranded on a second day that could never be approved.
  for (const [key, days] of Array.from(out.entries())) {
    if (!key.startsWith('visit:') || days.size < 2) continue
    const dates = Array.from(days.keys()).sort()
    const first = days.get(dates[0])!
    for (const date of dates.slice(1)) {
      const d = days.get(date)!
      for (const [u, p] of Array.from(d.people.entries())) {
        const q = first.people.get(u) ?? { workSeconds: 0, travelSeconds: 0, work: [], travel: [] }
        q.work.push(...p.work)
        q.travel.push(...p.travel)
        first.people.set(u, q)
      }
      for (const [item, m] of Array.from(d.machines.entries())) {
        const q = first.machines.get(item) ?? { machineSeconds: 0, intervals: [], operators: new Set<string>() }
        q.intervals.push(...m.intervals)
        for (const o of Array.from(m.operators)) q.operators.add(o)
        first.machines.set(item, q)
      }
      first.open = first.open || d.open
      first.needsReview = first.needsReview || d.needsReview
      days.delete(date)
    }
  }

  for (const days of Array.from(out.values())) {
    for (const d of Array.from(days.values())) {
      for (const m of Array.from(d.machines.values())) {
        m.intervals = mergeIntervals(m.intervals)
        m.machineSeconds = totalSeconds(m.intervals)
      }
      for (const p of Array.from(d.people.values())) {
        p.work = mergeIntervals(p.work)
        p.travel = subtractIntervals(mergeIntervals(p.travel), p.work)
        p.workSeconds = totalSeconds(p.work)
        p.travelSeconds = totalSeconds(p.travel)
      }
    }
  }
  return out
}

/** Labor person-seconds on a day (what the clock says, before any rule) — kept with an approval as its audit trail. */
export function dayClockedSeconds(d: DayClock): number {
  let s = 0
  for (const p of Array.from(d.people.values())) s += p.workSeconds
  return s
}

// ---------------------------------------------------------------------------------------------------------------------
// Billable lines
// ---------------------------------------------------------------------------------------------------------------------

export const BILL_LINE_KINDS = ['labor', 'travel', 'equipment', 'trip'] as const
export type BillLineKind = (typeof BILL_LINE_KINDS)[number]

export type Rate = { itemId: string | null; name: string; rateCents: number; taxable: boolean }

/** One line a day bills: hours (or 1 for a trip charge) × rate. `reasons` say how the clock became these hours. */
export type BillLine = {
  kind: BillLineKind
  itemId: string | null
  name: string
  /** People behind a labor / travel line (description only). */
  people: number | null
  /** Description only: every person billed the same hours ('each'), billed once for the crew ('crew'), or neither. */
  split?: 'each' | 'crew' | null
  /** Billable hours (2 decimals), or 1 for a trip charge. */
  hours: number
  rateCents: number | null
  taxable: boolean
  reasons: string[]
}

export type BillContext = {
  settings: HourlyBillingSettings
  /** The job's (or plan's) labor rate; null = not set yet (the day can't be approved). */
  labor: Rate | null
  /** Machines by price-book item id. */
  equipment: ReadonlyMap<string, Rate>
  /** The trip charge item when travel = 'trip_charge'. */
  trip: Rate | null
}

export const lineAmountCents = (l: Pick<BillLine, 'hours' | 'rateCents'>): number => lineTotalCents(l.hours, l.rateCents ?? 0)

function applyMinimum(hours: number, min: number, reasons: string[]): number {
  if (hours > 0 && min > 0 && hours < min) {
    reasons.push(`raised to the ${hoursLabel(min)} h minimum per visit`)
    return min
  }
  return hours
}

/** What one day of clock time bills under the company's rules. Labor first, then drive time, machines, trip charge. */
export function billableLines(d: DayClock, ctx: BillContext): BillLine[] {
  const s = ctx.settings
  const lines: BillLine[] = []
  const people = Array.from(d.people.values()).filter((p) => p.workSeconds > 0 || p.travelSeconds > 0)
  const laborName = ctx.labor?.name ?? 'Labor'
  const roundNote = ROUNDING_REASON[s.rounding]

  const person = (key: 'workSeconds' | 'travelSeconds') => people.filter((p) => p[key] > 0)
  const unionSeconds = (key: 'work' | 'travel') => totalSeconds(mergeIntervals(people.flatMap((p) => p[key])))

  // Labor
  const workers = person('workSeconds')
  if (workers.length > 0) {
    const reasons: string[] = []
    let hours: number
    let laborSplit: BillLine['split'] = 'crew'
    const clocked = workers.reduce((n, p) => n + p.workSeconds, 0)
    if (s.basis === 'crew') {
      const crewSeconds = unionSeconds('work')
      hours = roundBillableHours(crewSeconds, s.rounding)
      reasons.push(`Crew of ${workers.length} on site ${formatDuration(crewSeconds)}${roundNote ? `, ${roundNote}` : ''}`)
    } else {
      const each = workers.map((p) => roundBillableHours(p.workSeconds, s.rounding))
      hours = Math.round(each.reduce((n, h) => n + h, 0) * 100) / 100
      laborSplit = each.every((h) => h === each[0]) ? 'each' : null
      reasons.push(`Clocked ${formatDuration(clocked)} (${workers.length} ${workers.length === 1 ? 'person' : 'people'})${roundNote ? `, each person ${roundNote}` : ''}`)
    }
    const raised = applyMinimum(hours, s.minimumHours, reasons)
    if (raised !== hours && laborSplit === 'each') laborSplit = null
    hours = raised
    if (hours > 0) lines.push({ kind: 'labor', itemId: ctx.labor?.itemId ?? null, name: laborName, people: workers.length, split: laborSplit, hours, rateCents: ctx.labor?.rateCents ?? null, taxable: ctx.labor?.taxable ?? false, reasons })
  }

  // Drive time
  const drivers = person('travelSeconds')
  if (s.travel === 'yes' && drivers.length > 0) {
    const reasons: string[] = []
    let hours: number
    let split: BillLine['split'] = 'crew'
    if (s.basis === 'crew') {
      const sec = unionSeconds('travel')
      hours = roundBillableHours(sec, s.rounding)
      reasons.push(`Drive time ${formatDuration(sec)}${roundNote ? `, ${roundNote}` : ''}`)
    } else {
      const each = drivers.map((p) => roundBillableHours(p.travelSeconds, s.rounding))
      hours = Math.round(each.reduce((n, h) => n + h, 0) * 100) / 100
      split = each.every((h) => h === each[0]) ? 'each' : null
      reasons.push(`Drive time ${formatDuration(drivers.reduce((n, p) => n + p.travelSeconds, 0))} (${drivers.length} ${drivers.length === 1 ? 'person' : 'people'})${roundNote ? `, each person ${roundNote}` : ''}`)
    }
    if (hours > 0) lines.push({ kind: 'travel', itemId: ctx.labor?.itemId ?? null, name: 'Travel time', people: drivers.length, split, hours, rateCents: ctx.labor?.rateCents ?? null, taxable: ctx.labor?.taxable ?? false, reasons })
  }

  // Machines
  const machineIds = Array.from(d.machines.keys()).sort((a, b) => (ctx.equipment.get(a)?.name ?? a).localeCompare(ctx.equipment.get(b)?.name ?? b))
  for (const itemId of machineIds) {
    const m = d.machines.get(itemId)!
    const rate = ctx.equipment.get(itemId) ?? null
    const reasons: string[] = []
    let seconds = m.machineSeconds
    if (s.equipmentFromOperator) {
      // Union of the operators' time at this stop: two people taking turns on one tractor bill the tractor once.
      const opSeconds = totalSeconds(mergeIntervals(Array.from(m.operators).flatMap((u) => d.people.get(u)?.work ?? [])))
      if (opSeconds > 0) {
        seconds = opSeconds
        reasons.push(`Operator's time ${formatDuration(opSeconds)} (machine ran ${formatDuration(m.machineSeconds)})`)
      } else reasons.push(`Machine ran ${formatDuration(m.machineSeconds)} (no operator time here)`)
    } else reasons.push(`Machine ran ${formatDuration(m.machineSeconds)}`)
    let hours = roundBillableHours(seconds, s.rounding)
    if (roundNote && hours > 0) reasons[reasons.length - 1] += `, ${roundNote}`
    hours = applyMinimum(hours, s.minimumHours, reasons)
    if (hours > 0) lines.push({ kind: 'equipment', itemId, name: rate?.name ?? 'Equipment', people: null, hours, rateCents: rate?.rateCents ?? null, taxable: rate?.taxable ?? false, reasons })
  }

  // Trip charge: once per visit with anything billed.
  if (s.travel === 'trip_charge' && ctx.trip && lines.length > 0) {
    lines.push({ kind: 'trip', itemId: ctx.trip.itemId, name: ctx.trip.name, people: null, hours: 1, rateCents: ctx.trip.rateCents, taxable: ctx.trip.taxable, reasons: ['Flat trip charge per visit'] })
  }
  return lines
}

// ---------------------------------------------------------------------------------------------------------------------
// Office edits / typed hours
// ---------------------------------------------------------------------------------------------------------------------

export type EditLine = { kind: BillLineKind; itemId?: string | null; people?: number | null; hours: number }
export type DayEdit = { lines: EditLine[]; reason: string }

const MAX_PEOPLE = 50
const MAX_EDIT_LINES = 20

/** Is this a valid billable hours number (above 0, at most 2 decimals, at most a month of hours)? */
export function validHours(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_LINE_HOURS && hasAtMost2Decimals(v)
}

/** A browser edit → clean lines, or why not. Prices never come from the browser (only kind / machine / people / hours). */
export function parseDayEdit(raw: unknown): { edit: DayEdit } | { error: string } {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!b || !Array.isArray(b.lines)) return { error: 'Send the hours to bill' }
  if (b.lines.length === 0) return { error: 'Add at least one line of hours' }
  if (b.lines.length > MAX_EDIT_LINES) return { error: `At most ${MAX_EDIT_LINES} lines a day` }
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : ''
  const lines: EditLine[] = []
  const seen = new Set<string>()
  for (const l of b.lines as unknown[]) {
    const x = l && typeof l === 'object' ? (l as Record<string, unknown>) : {}
    if (!(BILL_LINE_KINDS as readonly unknown[]).includes(x.kind)) return { error: 'Unknown kind of line' }
    const kind = x.kind as BillLineKind
    const hours = typeof x.hours === 'string' ? Number(x.hours) : x.hours
    if (kind === 'trip') {
      if (seen.has('trip')) return { error: 'One trip charge a day' }
      seen.add('trip')
      lines.push({ kind, hours: 1 })
      continue
    }
    if (!validHours(hours)) return { error: `Hours must be above 0, at most ${MAX_LINE_HOURS}, with up to 2 decimals (e.g. 2.25)` }
    if (kind === 'equipment') {
      if (!isUuid(x.itemId)) return { error: 'Pick the machine' }
      if (seen.has(`eq:${x.itemId}`)) return { error: 'Each machine once a day' }
      seen.add(`eq:${x.itemId}`)
      lines.push({ kind, itemId: x.itemId, hours: Math.round((hours as number) * 100) / 100 })
      continue
    }
    if (seen.has(kind)) return { error: kind === 'labor' ? 'One labor line a day' : 'One drive-time line a day' }
    seen.add(kind)
    const people = x.people == null || x.people === '' ? null : Number(x.people)
    if (people !== null && (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE)) return { error: `People must be 1 to ${MAX_PEOPLE}` }
    lines.push({ kind, people, hours: Math.round((hours as number) * 100) / 100 })
  }
  return { edit: { lines, reason } }
}

/**
 * The office's lines with today's rates (server side). `hours` on a labor / travel line is the TOTAL billed (people ×
 * hours each when the form shows it that way). Unknown machine / no rate → error.
 */
export function linesFromEdit(edit: DayEdit, ctx: BillContext): { lines: BillLine[] } | { error: string } {
  const out: BillLine[] = []
  for (const l of edit.lines) {
    if (l.kind === 'labor' || l.kind === 'travel') {
      if (!ctx.labor) return { error: 'Set the labor rate first' }
      out.push({ kind: l.kind, itemId: ctx.labor.itemId, name: l.kind === 'labor' ? ctx.labor.name : 'Travel time', people: l.people ?? null, split: ctx.settings.basis === 'crew' ? 'crew' : 'each', hours: l.hours, rateCents: ctx.labor.rateCents, taxable: ctx.labor.taxable, reasons: ['Set by the office'] })
    } else if (l.kind === 'equipment') {
      const rate = l.itemId ? ctx.equipment.get(l.itemId) : undefined
      if (!rate) return { error: 'That machine is not in your price book (priced per hour)' }
      out.push({ kind: 'equipment', itemId: rate.itemId, name: rate.name, people: null, hours: l.hours, rateCents: rate.rateCents, taxable: rate.taxable, reasons: ['Set by the office'] })
    } else {
      if (!ctx.trip) return { error: 'Set a trip charge in Settings → Hourly billing first' }
      out.push({ kind: 'trip', itemId: ctx.trip.itemId, name: ctx.trip.name, people: null, hours: 1, rateCents: ctx.trip.rateCents, taxable: ctx.trip.taxable, reasons: ['Set by the office'] })
    }
  }
  return { lines: out }
}

/** Same lines (kind, machine, hours, people) — an "edit" that changes nothing is not an edit. */
export function sameLines(a: readonly BillLine[], b: readonly BillLine[]): boolean {
  const key = (l: BillLine) => `${l.kind}|${l.kind === 'equipment' ? l.itemId : ''}|${l.hours}|${l.kind === 'labor' || l.kind === 'travel' ? l.people ?? '' : ''}`
  const ka = a.map(key).sort()
  const kb = b.map(key).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i])
}

// ---------------------------------------------------------------------------------------------------------------------
// Invoice lines
// ---------------------------------------------------------------------------------------------------------------------

export type HoursInvoiceLine = {
  description: string
  qty: number
  unit_price_cents: number
  taxable: boolean
  unit?: 'hour'
  service_date: string
}

/** What the customer reads: "Grading labor — 3 people × 6.25 hrs", "Tractor", "Trip charge". The date is its own column. */
export function lineDescription(l: BillLine): string {
  if ((l.kind === 'labor' || l.kind === 'travel') && l.people && l.people > 1) {
    if (l.split === 'crew') return `${l.name} — crew of ${l.people}`
    const each = Math.round((l.hours / l.people) * 100) / 100
    return l.split === 'each' && Math.round(each * 100) * l.people === Math.round(l.hours * 100) ? `${l.name} — ${l.people} people × ${hoursLabel(each)} hrs` : `${l.name} — ${l.people} people`
  }
  return l.name
}

export function invoiceLinesForDay(date: string, lines: readonly BillLine[]): HoursInvoiceLine[] {
  return lines
    .filter((l) => (l.rateCents ?? 0) >= 0 && l.hours > 0)
    .map((l) => ({
      description: lineDescription(l),
      qty: l.hours,
      unit_price_cents: l.rateCents ?? 0,
      taxable: l.taxable,
      ...(l.kind === 'trip' ? {} : { unit: 'hour' as const }),
      service_date: date,
    }))
}

/** Total billable hours on a day (labor + travel + machines; a trip charge is not hours). */
export function dayBillableHours(lines: readonly BillLine[]): number {
  return Math.round(lines.filter((l) => l.kind !== 'trip').reduce((n, l) => n + l.hours, 0) * 100) / 100
}

/** Stored with the approval: what was billed and why (no prices from the browser — these are the server's lines). */
export function approvalLineSnapshot(lines: readonly BillLine[]): Array<BillLine & { description: string }> {
  return lines.map((l) => ({ ...l, reasons: [...l.reasons], description: lineDescription(l) }))
}

/** An approval's stored lines back as lines (rows written by approvalLineSnapshot; anything odd is dropped). */
export function linesFromSnapshot(raw: unknown): BillLine[] {
  if (!Array.isArray(raw)) return []
  const out: BillLine[] = []
  for (const r of raw) {
    const x = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
    if (!(BILL_LINE_KINDS as readonly unknown[]).includes(x.kind) || typeof x.hours !== 'number') continue
    out.push({
      kind: x.kind as BillLineKind,
      itemId: typeof x.itemId === 'string' ? x.itemId : null,
      name: typeof x.name === 'string' ? x.name : 'Hours',
      people: typeof x.people === 'number' ? x.people : null,
      split: x.split === 'each' || x.split === 'crew' ? x.split : null,
      hours: x.hours,
      rateCents: typeof x.rateCents === 'number' ? x.rateCents : null,
      taxable: x.taxable === true,
      reasons: Array.isArray(x.reasons) ? x.reasons.filter((y): y is string => typeof y === 'string') : [],
    })
  }
  return out
}

export { isYmd }
