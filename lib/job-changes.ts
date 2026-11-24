/**
 * Job change history (`production_job_changes`, migration 202612010040): who changed what on a production job, and when.
 * Same entry shape as every change log (lib/change-log.ts: `{ field, label, old, new }`) — no second format.
 *
 * ONE writer, {@link recordJobChanges}. It never throws: a history write must never block a job save. Money writers
 * (payments, commission, payroll) have their own audits and are deliberately not hooked here. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { formatInTimeZone } from 'date-fns-tz'

import { describeChange, diffFields, sameValue, type FieldChange } from '@/lib/change-log'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { formatMoney } from '@/lib/format'
import { orgDb } from '@/lib/supabase/org-db'

export type JobChangeSource = 'job_edit' | 'status' | 'schedule' | 'cancel' | 'uncancel' | 'billing' | 'owner' | 'category'

export const JOB_HISTORY_PAGE_SIZE = 50

/** Plain words for the job columns the generic edit route may change. */
export const JOB_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  started_at: 'Started',
  completed_at: 'Completed',
  internal_notes: 'Internal notes',
  customer_po: 'Customer PO',
  deposit_required_percent: 'Deposit required (%)',
  finance_submitted_at: 'Finance submitted',
  job_source: 'Job source',
  insurance_stage: 'Insurance stage', // roofing-ok: only written while the insurance feature is on (the job PATCH refuses it otherwise)
  acv_amount: 'ACV amount',
  depreciation_amount: 'Depreciation amount',
  supplement_amount: 'Supplement amount',
  claim_number: 'Claim number', // roofing-ok: only written while the insurance feature is on (the job PATCH refuses it otherwise)
  insurance_company: 'Insurance company', // roofing-ok: only written while the insurance feature is on (the job PATCH refuses it otherwise)
}

/** Fields that are money: shown only to a viewer who may see the job's money (raw values are stored, filtered on read). */
export const JOB_MONEY_FIELDS: ReadonlySet<string> = new Set(['acv_amount', 'depreciation_amount', 'supplement_amount', 'deposit_required_percent', 'sale_amount', 'commission_base'])

const STATUS_WORDS: Record<string, string> = {
  sold: 'Sold',
  materials: 'Materials',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  complete: 'Complete',
  collected: 'Collected',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
}

export const jobStatusWord = (s: unknown): string => (typeof s === 'string' && STATUS_WORDS[s]) || (s == null ? '' : String(s))

const NOTE_PREVIEW = 120

function shorten(v: unknown): unknown {
  return typeof v === 'string' && v.length > NOTE_PREVIEW ? `${v.slice(0, NOTE_PREVIEW)}…` : v
}

/**
 * Pure: the changes a PATCH made, from the columns as they were before and as they are after. Status is shown in words,
 * long notes are shortened, and a field that did not really change (same value sent again) is left out.
 */
export function jobPatchChanges(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  return diffFields(before, after, JOB_FIELD_LABELS).map((c) => {
    if (c.field === 'status') return { ...c, old: jobStatusWord(c.old) || null, new: jobStatusWord(c.new) || null }
    const old = shorten(c.old)
    const next = shorten(c.new)
    // An edit past the preview length reads the same once shortened: say so instead of showing "same → same".
    return { ...c, old, new: old === next && c.old !== c.new ? `${String(next)} (edited)` : next }
  })
}

/** Pure: split one patch's changes into the status line (its own source) and the rest. */
export function splitStatusChange(changes: FieldChange[]): { status: FieldChange[]; rest: FieldChange[] } {
  return { status: changes.filter((c) => c.field === 'status'), rest: changes.filter((c) => c.field !== 'status') }
}

/** THE writer. Skips an empty list; logs and carries on if the write fails (table not there yet, network, anything). */
export async function recordJobChanges(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  userId: string | null,
  source: JobChangeSource,
  changes: FieldChange[],
  note?: string | null
): Promise<void> {
  // A change whose old and new read the same on screen ("(empty) → (empty)", 8 → "8") is not a change.
  // Compared in FULL (never the shortened text): only null / '' / undefined count as equal.
  changes = changes.filter((c) => !sameValue(c.old === '' ? null : c.old, c.new === '' ? null : c.new))
  if (!changes.length && !note) return
  try {
    const { error } = await orgDb(admin, orgId)
      .from('production_job_changes')
      .insert({ job_id: jobId, changed_by: userId, source, changes, note: note ? note.slice(0, 500) : null })
    if (error) console.error('[job-changes] not recorded', jobId, source, error.message)
  } catch (e) {
    console.error('[job-changes] not recorded', jobId, source, e instanceof Error ? e.message : e)
  }
}

export type JobHistoryEntry = { id: string; source: JobChangeSource; at: string; by: string | null; lines: string[]; note: string | null }

/** Fields that hold an instant (shown as a date and time in the company zone) and fields that hold a calendar day. */
const INSTANT_FIELDS: ReadonlySet<string> = new Set(['started_at', 'completed_at', 'finance_submitted_at'])
const DAY_FIELDS: ReadonlySet<string> = new Set(['trade_date'])

function inZone(v: unknown, tz: string, pattern: string, bareDay: boolean): unknown {
  if (typeof v !== 'string' || !v) return v
  const d = new Date(bareDay && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v)
  if (Number.isNaN(d.getTime())) return v
  // The year is added for a date outside the current year (in the company zone).
  const zone = bareDay ? 'UTC' : tz
  const thisYear = formatInTimeZone(new Date(), tz, 'yyyy')
  const p = formatInTimeZone(d, zone, 'yyyy') === thisYear ? pattern : pattern.replace('MMM d', 'MMM d, yyyy')
  return formatInTimeZone(d, zone, p)
}

/** Pure: one line for the screen; money gets a $ sign, instants and days are shown in the company time zone ("Nov 4, 6:12 PM", "Nov 4"). */
export function jobChangeLine(c: FieldChange, tz: string): string {
  if (INSTANT_FIELDS.has(c.field)) return describeChange({ ...c, old: inZone(c.old, tz, 'MMM d, h:mm a', false), new: inZone(c.new, tz, 'MMM d, h:mm a', false) })
  if (DAY_FIELDS.has(c.field)) return describeChange({ ...c, old: inZone(c.old, tz, 'MMM d', true), new: inZone(c.new, tz, 'MMM d', true) })
  if (JOB_MONEY_FIELDS.has(c.field) && c.field !== 'deposit_required_percent') {
    const m = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) ? formatMoney(Number(v)) : v)
    return describeChange({ ...c, old: m(c.old), new: m(c.new) })
  }
  return describeChange(c)
}

type Row = { id: string; source: JobChangeSource; changed_at: string; changed_by: string | null; changes: FieldChange[] | null; note: string | null }

/** Pure: rows -> screen entries. Without money access, money fields are dropped and an entry left with nothing is dropped. */
export function toHistoryEntries(rows: Row[], names: Map<string, string | null>, canSeeMoney: boolean, tz: string): JobHistoryEntry[] {
  const out: JobHistoryEntry[] = []
  for (const r of rows) {
    const all = r.changes ?? []
    const shown = canSeeMoney ? all : all.filter((c) => !JOB_MONEY_FIELDS.has(c.field))
    if (!shown.length && !r.note) continue
    out.push({ id: r.id, source: r.source, at: r.changed_at, by: r.changed_by ? (names.get(r.changed_by) ?? 'Someone') : null, lines: shown.map((c) => jobChangeLine(c, tz)), note: r.note })
  }
  return out
}

const MAX_PAGES_SCANNED = 5

/**
 * Newest first, 50 a page (`page` starts at 0). The caller has already loaded the job in its company. A page that is all money
 * lines for a viewer without money access shows nothing, so the next page is read (a few at most) until something is visible
 * or there is no more; `page` in the answer is the last one read, so "older" continues from it.
 */
export async function loadJobHistory(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  opts: { canSeeMoney: boolean; page?: number }
): Promise<{ entries: JobHistoryEntry[]; hasMore: boolean; startsAt: string; page: number }> {
  const start = Math.max(0, Math.floor(opts.page ?? 0))
  const tz = await loadOrgTimeZone(admin, orgId)
  let page = start
  for (;;) {
    const from = page * JOB_HISTORY_PAGE_SIZE
    const { data, error } = await orgDb(admin, orgId)
      .from('production_job_changes')
      .select('id, source, changed_at, changed_by, changes, note')
      .eq('job_id', jobId)
      .order('changed_at', { ascending: false })
      .range(from, from + JOB_HISTORY_PAGE_SIZE) // one extra row tells us there is another page
    if (error) return { entries: [], hasMore: false, startsAt: new Date().toISOString(), page }
    const rows = (data ?? []) as Row[]
    const pageRows = rows.slice(0, JOB_HISTORY_PAGE_SIZE)
    const userIds = Array.from(new Set(pageRows.map((r) => r.changed_by).filter((x): x is string => !!x)))
    const { data: users } = userIds.length ? await orgDb(admin, orgId).from('users').select('id, full_name').in('id', userIds) : { data: [] }
    const names = new Map(((users ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => [u.id, u.full_name]))
    const entries = toHistoryEntries(pageRows, names, opts.canSeeMoney, tz)
    const hasMore = rows.length > JOB_HISTORY_PAGE_SIZE
    if (entries.length || !hasMore || page - start + 1 >= MAX_PAGES_SCANNED) {
      // "History starts <date>": the company's first recorded change (no backfill exists), else now.
      let startsAt = new Date().toISOString()
      if (!entries.length && start === 0 && !hasMore) {
        const { data: first } = await orgDb(admin, orgId).from('production_job_changes').select('changed_at').order('changed_at', { ascending: true }).limit(1)
        startsAt = (first as Array<{ changed_at: string }> | null)?.[0]?.changed_at ?? startsAt
      }
      return { entries, hasMore, startsAt, page }
    }
    page += 1
  }
}

export type TradeScheduleFacts = { scheduled_date: string | null; install_days: number | string | null; crew: string | null }

/** Pure: what a booking / move / clearing of one trade changed, in words that name the trade ("Gutters date: Nov 4 → Nov 6"). */
export function tradeScheduleChanges(tradeName: string, before: TradeScheduleFacts, after: TradeScheduleFacts): FieldChange[] {
  const n = (v: number | string | null) => (v == null || v === '' ? null : Number(v))
  return diffFields(
    { trade_crew: before.crew, trade_date: before.scheduled_date, trade_days: n(before.install_days) },
    { trade_crew: after.crew, trade_date: after.scheduled_date, trade_days: n(after.install_days) },
    { trade_crew: `${tradeName} crew`, trade_date: `${tradeName} date`, trade_days: `${tradeName} length (days)` }
  )
}
