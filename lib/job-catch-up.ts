/**
 * Job catch-up — "where does this job stand?" in one line, so someone stepping in to help is never lost.
 *
 * Nothing here is typed by anyone: every word is DERIVED from what already happened on the job (Nathan, 2026-11-06 —
 * "better than Asana, which only knows what people type and goes stale"). This is the ONE derivation; the board line,
 * the board's "Stuck" view and the job page's "Where this stands" box all read {@link buildJobCatchUp}.
 *
 * Reused, never re-implemented:
 * - status label            → lib/job-status.ts (`jobStatusConfig`)
 * - materials               → lib/job-materials-state.ts (`MaterialsState`, computed by the caller)
 * - crews (trades)          → lib/job-trades.ts labels + lib/data-health.ts `crewLastDay`
 * - overdue / needs attention → lib/data-health.ts problems, shaped to the no-dollar ops view (`shapeNeedsYou`)
 * - paid / waiting on payment → lib/job-status.ts `paymentStatusChip` (the board chip; one collection rule underneath)
 *
 * "Stuck" = Needs-you has an ops problem on the job, OR nothing MOVED for N working days (Mon–Fri in the business time
 * zone; org setting, default 7). Movement is a person or a real job event only: notes and logged contact by people,
 * status changes, crew events, supplier order sends/receipts, payments (when the viewer sees them), photos, signed
 * change orders. `production_jobs.updated_at` is NOT movement — automated writes (schedule sync, materials mirror) bump
 * it. Customer messages are shown but are not movement (a customer chasing us is a sign it's stuck). Automated notes
 * are not shown. A collected, cancelled or on-hold job is never stuck.
 *
 * Owner: ONLY the job's explicit owner (`production_jobs.owner_user_id`, Nathan 2026-11-06 — never guessed). No owner
 * shows as "No owner" (red on the board, a red banner on the job page). Before the owner migration is applied the
 * column is unknown and nothing about owners is shown.
 *
 * Pure. No dollar amounts ever leave this module (a note that looks like pricing is shown as "mentions pricing").
 */
import { crewLastDay, type HealthProblem } from '@/lib/data-health'
import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { formatDateShort } from '@/lib/format'
import type { MaterialsState } from '@/lib/job-materials-state'
import { jobStatusConfig } from '@/lib/job-status'
import { TRADE_LABELS, isTrade } from '@/lib/job-trades'
import { daysBetweenDateOnly, workingDaysBetweenDateOnly } from '@/lib/schedule-window'
import { ACTIVITY_WINDOW_DAYS } from '@/lib/job-catch-up-settings'

/* ------------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------------ */

export type CatchUpJob = {
  id: string
  status: string
  scheduled_date?: string | null
  permit_required?: boolean | null
  permit_status?: string | null
  sale_date?: string | null
  materials_ordered_at?: string | null
  finance_submitted_at?: string | null
  close_balance_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  cancelled_at?: string | null
  created_at?: string | null
  /** Read but never counted as movement (automated writes bump it). */
  updated_at?: string | null
  /** Explicit owner. null = nobody set one; undefined = unknown (the owner column doesn't exist yet). */
  owner_user_id?: string | null
  /** The explicit owner's name, resolved by the loader. */
  owner_name?: string | null
}

export type CatchUpTrade = {
  trade: string | null
  status: string
  scheduled_date: string | null
  install_days: number | string | null
  /** The crew's company (sub_contractors.company_name). */
  sub_name: string | null
  created_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
  /** A failed Google invite sync stamps the row; that write is not crew movement. */
  install_sync_failed_at?: string | null
}

/** Something that happened, with no text from a person (job / crew / supplier / payment timestamps). */
export type CatchUpEvent = { at: string; what: string; who?: string | null }

/** A thread row the viewer may already read (the caller filtered it through visibleActivities). */
export type CatchUpNote = {
  id: string
  at: string
  /** Author's name; null for automated rows. */
  who: string | null
  /** activities.type: note | call | text | email | visit | status_change | thread_message … */
  type: string
  /** Display text — null when withheld (it looks like pricing). */
  text: string | null
  /** person = one of us wrote/logged it; customer = an inbound customer message; automated = written by the system. */
  from: 'person' | 'customer' | 'automated'
}

export type CatchUpFacts = {
  job: CatchUpJob
  trades: CatchUpTrade[]
  materials: MaterialsState
  /** `paymentStatusChip(job).label`, or null when the viewer doesn't see collection today / no sale amount. */
  payment: string | null
  /** Ops-visible Needs-you problems for this job (already shaped: no dollars). */
  problems: HealthProblem[]
  /** Other real events (supplier orders, payments, photos, change orders). Job and crew timestamps come from `job` / `trades`. */
  events: CatchUpEvent[]
  /** Visible thread rows, any order. */
  notes: CatchUpNote[]
  stuckDays: number
  now: Date
}

/* ------------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------------ */

export type CatchUpUpdate = { at: string; what: string; who: string | null; kind: 'note' | 'contact' | 'event' | 'customer' }

export type JobCatchUp = {
  stage: string
  nextStep: string
  /** The explicit owner's first name, "No owner", "—" for finished jobs, or "" when owners aren't known yet. */
  owner: string
  /** assigned = explicit owner; unassigned = nobody set one; none = finished job; unknown = owner column not there yet. */
  ownerKind: 'assigned' | 'unassigned' | 'none' | 'unknown'
  /** The explicit owner (null when nobody set one). */
  ownerUserId: string | null
  /** Latest MOVEMENT (never a customer message or an automated write). */
  lastUpdate: CatchUpUpdate | null
  /** Calendar days since the last movement (display). */
  ageDays: number | null
  /** Working days (Mon–Fri) since the last movement — what "stuck" counts. */
  idleWorkingDays: number | null
  /** "today", "2d", "90d+" */
  ageLabel: string
  stuck: boolean
  /** Why it is stuck / overdue, plain English, no dollars. */
  reasons: string[]
  /** "Steve · Waiting on permit · 2d" */
  line: string
  lastContact: CatchUpUpdate | null
  /** True when there is no logged call/text/email/visit and lastContact is the latest note instead. */
  contactIsNote: boolean
  recent: CatchUpUpdate[]
  done: boolean
}

/** What the board and job page receive: the catch-up plus where the full thread lives. */
export type JobCatchUpResult = JobCatchUp & { jobId: string; threadHref: string | null }

/* ------------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------------ */

/** activities types that are a conversation with the customer (enum activity_type). */
export const CUSTOMER_CONTACT_TYPES: ReadonlySet<string> = new Set(['call', 'text', 'email', 'visit'])

const CONTACT_WORD: Record<string, string> = { call: 'Call', text: 'Text', email: 'Email', visit: 'Visit' }
const EXCERPT_MAX = 140
const PRE_INSTALL = new Set(['sold', 'materials', 'scheduled'])
const DONE_STATUSES = new Set(['collected', 'cancelled'])
/** Two crew-row timestamps this close are the same write. */
const SAME_MOMENT_MS = 5 * 60_000

function tradeWord(trade: string | null | undefined): string {
  return isTrade(trade) ? TRADE_LABELS[trade] : 'Crew'
}

function firstName(name: string | null | undefined): string | null {
  const n = String(name ?? '').trim()
  return n ? n.split(/\s+/)[0] : null
}

function time(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

function excerpt(text: string | null): string | null {
  if (text == null) return null
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX - 1)}…` : t
}

function noteUpdate(n: CatchUpNote): CatchUpUpdate {
  const contact = CUSTOMER_CONTACT_TYPES.has(n.type)
  const body = n.text == null ? 'mentions pricing — open the thread' : excerpt(n.text) || (contact ? 'logged' : 'note')
  if (n.from === 'customer') return { at: n.at, who: 'Customer', kind: 'customer', what: contact ? `${CONTACT_WORD[n.type]}: ${body}` : body }
  if (n.type === 'status_change') return { at: n.at, who: n.who, kind: 'event', what: body }
  return { at: n.at, who: n.who, kind: contact ? 'contact' : 'note', what: contact ? `${CONTACT_WORD[n.type]}: ${body}` : body }
}

/** Movement = a person's note / logged contact, or a status change (whoever recorded it). */
export function noteIsMovement(n: CatchUpNote): boolean {
  return n.type === 'status_change' || n.from === 'person'
}

function ymdOf(iso: string): string {
  return iso.length === 10 ? iso : ymdInBusinessTz(new Date(iso))
}

/** Working days (Mon–Fri, business time zone) since `iso`. Date-only math, so DST cannot shift it. */
export function catchUpIdleWorkingDays(iso: string, now: Date): number {
  return workingDaysBetweenDateOnly(ymdOf(iso), ymdInBusinessTz(now))
}

/** Calendar days since `iso`, counted in the business time zone (date-only math, so DST cannot shift it). */
export function catchUpAgeDays(iso: string, now: Date): number {
  return Math.max(0, daysBetweenDateOnly(ymdOf(iso), ymdInBusinessTz(now)))
}

export function catchUpAgeLabel(days: number | null): string {
  if (days == null) return '—'
  if (days === 0) return 'today'
  return days > ACTIVITY_WINDOW_DAYS ? `${ACTIVITY_WINDOW_DAYS}d+` : `${days}d`
}

/**
 * Events the job row itself proves (named status timestamps). `updated_at` is never one: the schedule sync and the
 * materials mirror bump it with nobody touching the job.
 */
export function jobEvents(job: CatchUpJob): CatchUpEvent[] {
  const named: CatchUpEvent[] = []
  const add = (at: string | null | undefined, what: string) => {
    if (at && Number.isFinite(time(at))) named.push({ at, what })
  }
  add(job.created_at ?? job.sale_date, 'Job created')
  add(job.materials_ordered_at, 'Materials marked ordered')
  add(job.finance_submitted_at, 'Financing submitted')
  add(job.started_at, 'Job started')
  add(job.completed_at, 'Job marked complete')
  add(job.close_balance_at, 'Closed with a balance')
  add(job.cancelled_at, 'Job cancelled')
  return named
}

/** What a crew row proves happened, and when. An untouched auto-created crew is not movement. */
export function tradeEvents(trades: CatchUpTrade[]): CatchUpEvent[] {
  const out: CatchUpEvent[] = []
  for (const t of trades) {
    const word = tradeWord(t.trade)
    if (t.completed_at) out.push({ at: t.completed_at, what: `${word} crew marked done`, who: t.sub_name })
    const u = time(t.updated_at)
    if (!Number.isFinite(u)) continue
    if (t.completed_at && Math.abs(u - time(t.completed_at)) <= SAME_MOMENT_MS) continue
    if (t.status === 'pending' && t.created_at && Math.abs(u - time(t.created_at)) <= SAME_MOMENT_MS) continue
    // A failed Google invite sync stamps the row on its own — not crew movement.
    if (t.install_sync_failed_at && Math.abs(u - time(t.install_sync_failed_at)) <= SAME_MOMENT_MS) continue
    const what =
      t.status === 'cancelled' ? `${word} crew removed` : t.scheduled_date && t.status !== 'completed' ? `${word} crew scheduled for ${formatDateShort(t.scheduled_date)}` : `${word} crew updated`
    out.push({ at: t.updated_at as string, what, who: t.sub_name })
  }
  return out
}

type Step = { text: string; owner: 'crew' | 'office' | 'none'; crew?: string | null }

/** The next thing that has to happen on the job — first match wins. */
export function deriveNextStep(f: Pick<CatchUpFacts, 'job' | 'trades' | 'materials' | 'payment' | 'problems'>, todayYmd: string): Step {
  const { job } = f
  if (job.status === 'cancelled') return { text: 'Cancelled', owner: 'none' }
  if (job.status === 'collected') return { text: 'Done — closed out', owner: 'none' }
  if (job.status === 'on_hold') return { text: 'On hold', owner: 'office' }
  if (job.status === 'complete') {
    if (f.payment === 'Paid in full' || f.payment === 'Closed with balance') return { text: 'Mark collected', owner: 'office' }
    if (f.payment === 'Partially paid' || f.payment === 'Unpaid') return { text: 'Waiting on payment', owner: 'office' }
    return { text: 'Close out the job', owner: 'office' }
  }

  const active = f.trades.filter((t) => t.status !== 'cancelled')
  const open = active.filter((t) => t.status !== 'completed')
  if (active.length > 0 && open.length === 0) return { text: 'Mark job complete', owner: 'office' }

  const pastDue = open.find((t) => {
    const last = crewLastDay(t)
    return !!last && last < todayYmd
  })
  if (pastDue) return { text: `Mark ${tradeWord(pastDue.trade).toLowerCase()} crew done`, owner: 'crew', crew: pastDue.sub_name }

  const working = open.find((t) => {
    const last = crewLastDay(t)
    return !!t.scheduled_date && !!last && t.scheduled_date <= todayYmd && todayYmd <= last
  })
  if (working) return { text: `${tradeWord(working.trade)} crew on site`, owner: 'crew', crew: working.sub_name }

  if (f.problems.some((p) => p.code === 'trade_done_no_photos')) return { text: 'Get crew photos', owner: 'office' }

  if (PRE_INSTALL.has(job.status)) {
    if (job.permit_required && job.permit_status === 'denied') return { text: 'Permit denied — fix permit', owner: 'office' }
    if (job.permit_required && job.permit_status !== 'approved') return { text: 'Waiting on permit', owner: 'office' }
    if (f.materials.key === 'not_ordered') return { text: 'Order materials', owner: 'office' }
    if (f.materials.key === 'partial') return { text: `Finish ordering materials${f.materials.detail ? ` (${f.materials.detail})` : ''}`, owner: 'office' }
  }

  const unscheduled = open.filter((t) => !t.scheduled_date)
  if (active.length === 0 && !job.scheduled_date) return { text: 'Schedule crew', owner: 'office' }
  if (unscheduled.length > 0) {
    const words = unscheduled.map((t) => tradeWord(t.trade).toLowerCase())
    return { text: `Schedule ${Array.from(new Set(words)).join(' + ')} crew`, owner: 'office' }
  }

  const next = open
    .filter((t) => t.scheduled_date && t.scheduled_date > todayYmd)
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))[0]
  if (next) return { text: `${tradeWord(next.trade)} crew ${formatDateShort(next.scheduled_date)}`, owner: 'crew', crew: next.sub_name }

  return { text: jobStatusConfig(job.status).label, owner: 'office' }
}

export function buildJobCatchUp(f: CatchUpFacts): JobCatchUp {
  const todayYmd = ymdInBusinessTz(f.now)
  const done = DONE_STATUSES.has(f.job.status)
  const paused = f.job.status === 'on_hold'
  const stage = jobStatusConfig(f.job.status).label
  const step = deriveNextStep(f, todayYmd)

  // Automated notes are not shown at all; customer messages are shown but are not movement.
  const notes = [...f.notes]
    .filter((n) => Number.isFinite(time(n.at)) && (n.from !== 'automated' || n.type === 'status_change'))
    .sort((a, b) => time(b.at) - time(a.at))

  let owner: string
  let ownerKind: JobCatchUp['ownerKind']
  if (step.owner === 'none') {
    owner = '—'
    ownerKind = 'none'
  } else if (f.job.owner_user_id === undefined) {
    owner = ''
    ownerKind = 'unknown'
  } else if (f.job.owner_user_id) {
    owner = firstName(f.job.owner_name) ?? 'Owner set'
    ownerKind = 'assigned'
  } else {
    owner = 'No owner'
    ownerKind = 'unassigned'
  }

  const events: CatchUpUpdate[] = [...jobEvents(f.job), ...tradeEvents(f.trades), ...f.events]
    .filter((e) => Number.isFinite(time(e.at)))
    .map((e) => ({ at: e.at, what: e.what, who: e.who ?? null, kind: 'event' as const }))
  const movement: CatchUpUpdate[] = [...notes.filter(noteIsMovement).map(noteUpdate), ...events].sort((a, b) => time(b.at) - time(a.at))
  const shown: CatchUpUpdate[] = [...movement, ...notes.filter((n) => n.from === 'customer').map(noteUpdate)].sort((a, b) => time(b.at) - time(a.at))

  const lastUpdate = movement[0] ?? null
  const ageDays = lastUpdate ? catchUpAgeDays(lastUpdate.at, f.now) : null
  const idleWorkingDays = lastUpdate ? catchUpIdleWorkingDays(lastUpdate.at, f.now) : null

  const watch = !done && !paused
  const reasons = watch ? f.problems.map((p) => p.message) : []
  if (watch && (idleWorkingDays == null || idleWorkingDays >= f.stuckDays)) {
    reasons.push(idleWorkingDays == null ? 'Nothing has been recorded on this job.' : `Nothing has moved in ${idleWorkingDays} working days.`)
  }
  const stuck = reasons.length > 0

  const contact = notes.find((n) => CUSTOMER_CONTACT_TYPES.has(n.type) && n.from !== 'automated')
  const latestNote = notes.find((n) => n.from === 'person' && n.type !== 'status_change')
  const lastContact = contact ? noteUpdate(contact) : latestNote ? noteUpdate(latestNote) : null

  return {
    stage,
    nextStep: step.text,
    owner,
    ownerKind,
    ownerUserId: f.job.owner_user_id ?? null,
    lastUpdate,
    ageDays,
    idleWorkingDays,
    ageLabel: catchUpAgeLabel(ageDays),
    stuck,
    reasons,
    line: [owner, step.text, catchUpAgeLabel(ageDays)].filter(Boolean).join(' · '),
    lastContact,
    contactIsNote: !contact && !!lastContact,
    recent: shown.slice(0, 3),
    done,
  }
}

/** Board owner filter: 'me' / 'other' (explicit owner) or 'none' (nobody set one); null when owners aren't known. */
export function boardOwnerFilterValue(job: { catch_up?: Pick<JobCatchUp, 'ownerUserId' | 'ownerKind'> | null }, viewerId: string | null | undefined): 'me' | 'other' | 'none' | null {
  if (!job.catch_up || job.catch_up.ownerKind === 'unknown' || job.catch_up.ownerKind === 'none') return null
  const owner = job.catch_up.ownerUserId
  if (!owner) return 'none'
  return viewerId && owner === viewerId ? 'me' : 'other'
}
