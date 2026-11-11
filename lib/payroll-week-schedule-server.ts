/**
 * Server side of the pay-week schedule (lib/payroll-week-schedule.ts): the one reader of a company's schedule, the one writer, and
 * the "what changes" preview the owner sees before saving.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgTimeZone } from '@/lib/cron-orgs'
import { mergeOrgSettings } from '@/lib/org-settings'
import { findOrCreateWeek } from '@/lib/payroll-periods'
import {
  cutoffInstantForYmd,
  cutoffWeekday,
  nextWeekCutoff,
  cutoffYmd,
  describePayWeek,
  lastCutoffAtOrBefore,
  parsePayWeek,
  PAY_WEEK_SETTINGS_KEY,
  previewPayWeekChange,
  readPayWeekSchedule,
  sameStoredPayWeek,
  weekdayOfYmd,
  type PayWeekChangePreview,
  type PayWeekSchedule,
  type StoredPayWeek,
} from '@/lib/payroll-week-schedule'

/** The company's pay week (saved schedule or the legacy one) in the company's own time zone. */
export async function loadPayWeekSchedule(admin: SupabaseClient, orgId: string): Promise<PayWeekSchedule> {
  const { data, error } = await admin.from('orgs').select('settings, timezone').eq('id', orgId).maybeSingle()
  if (error) throw error
  return readPayWeekSchedule(data?.settings, orgTimeZone(data?.timezone))
}

/** The cutoff of the latest week before `cutoffAt` that was not cancelled: this week's neighbour (lib/payroll-week-schedule weekDays). */
export async function loadPrevCutoff(admin: SupabaseClient, orgId: string, periodId: string | null, cutoffAt: string): Promise<string | null> {
  let q = admin.from('payroll_periods').select('cutoff_at').eq('org_id', orgId).neq('status', 'cancelled').lt('cutoff_at', cutoffAt)
  if (periodId) q = q.neq('id', periodId)
  const { data, error } = await q.order('cutoff_at', { ascending: false }).limit(1)
  if (error) throw error
  return ((data ?? [])[0]?.cutoff_at as string | undefined) ?? null
}

/** True when a stored week closes on this schedule's cutoff day (its own calendar date; hand-typed hours on the right day count). */
export function cutoffOnSchedule(cutoffAt: string, s: PayWeekSchedule): boolean {
  return weekdayOfYmd(cutoffYmd(cutoffAt, s)) === cutoffWeekday(s)
}

/** The new-schedule week an old week's open items move to: the first new cutoff on or after the old week's last day. */
export function moveTargetCutoff(oldCutoffAt: string, s: PayWeekSchedule): Date {
  const ymd = cutoffYmd(oldCutoffAt, s)
  return weekdayOfYmd(ymd) === cutoffWeekday(s) ? cutoffInstantForYmd(ymd, s) : nextWeekCutoff(oldCutoffAt, s)
}

export type PayWeekChangeCheck = {
  current: { schedule: StoredPayWeek; words: string }
  next: { schedule: StoredPayWeek; words: string }
  unchanged: boolean
  preview: PayWeekChangePreview
  /** Open weeks that cannot be closed cleanly (pay lines already written on them): approve them first. */
  blockers: Array<{ periodId: string; weekEnding: string; what: string }>
  /** Open weeks on the old schedule: closed on save; anything waiting on them (hours, bonuses, fixes) moves to `movesTo`. */
  oldWeeks: Array<{ periodId: string; weekEnding: string; movesTo: string; what: string }>
}

/** Everything the owner sees before saving a new pay week. Reads only. */
export async function checkPayWeekChange(admin: SupabaseClient, orgId: string, raw: unknown, now: Date): Promise<{ ok: true; value: PayWeekChangeCheck } | { ok: false; error: string }> {
  const parsed = parsePayWeek(raw)
  if (!parsed.ok) return parsed
  const current = await loadPayWeekSchedule(admin, orgId)
  const next: PayWeekSchedule = { ...parsed.value, timeZone: current.timeZone }

  const { data: open, error } = await admin.from('payroll_periods').select('id, cutoff_at').eq('org_id', orgId).eq('status', 'open').order('cutoff_at', { ascending: true })
  if (error) throw error
  const blockers: PayWeekChangeCheck['blockers'] = []
  const oldWeeks: PayWeekChangeCheck['oldWeeks'] = []
  for (const p of (open ?? []).filter((x) => !cutoffOnSchedule(x.cutoff_at as string, next))) {
    const id = p.id as string
    const [h, b, a, l] = await Promise.all([
      admin.from('payroll_rep_hours').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id),
      admin.from('payroll_bonus_lines').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id),
      admin.from('payroll_adjustments').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id).eq('status', 'pending'),
      admin.from('payroll_payout_lines').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id),
    ])
    const weekEnding = cutoffYmd(p.cutoff_at as string, current)
    if (l.count) {
      blockers.push({ periodId: id, weekEnding, what: 'pay lines already written — approve it first' })
      continue
    }
    const what = [h.count ? 'hours' : '', b.count ? 'bonuses' : '', a.count ? 'fixes' : ''].filter(Boolean).join(', ') || 'nothing'
    oldWeeks.push({ periodId: id, weekEnding, movesTo: cutoffYmd(moveTargetCutoff(p.cutoff_at as string, next), next), what })
  }

  // The first new week = the week the Pay screen will open on: the last new-schedule cutoff at or before now, unless a week that
  // stays already covers it — then the one after. Its neighbour is the latest week that stays.
  const closing = new Set(oldWeeks.map((w) => w.periodId))
  let first = lastCutoffAtOrBefore(now, next)
  const { data: latest } = await admin.from('payroll_periods').select('id, cutoff_at, status').eq('org_id', orgId).neq('status', 'cancelled').order('cutoff_at', { ascending: false }).limit(20)
  const kept = (latest ?? []).filter((p) => !closing.has(p.id as string))
  const newest = kept[0]?.cutoff_at as string | undefined
  if (newest && cutoffYmd(newest, next) >= cutoffYmd(first, next)) first = nextWeekCutoff(newest, next)
  const prev = kept.find((p) => cutoffYmd(p.cutoff_at as string, next) < cutoffYmd(first, next))?.cutoff_at as string | undefined

  const strip = ({ timeZone: _tz, ...rest }: PayWeekSchedule): StoredPayWeek => rest
  return {
    ok: true,
    value: {
      current: { schedule: strip(current), words: describePayWeek(current) },
      next: { schedule: parsed.value, words: describePayWeek(parsed.value) },
      unchanged: sameStoredPayWeek(current, parsed.value),
      preview: previewPayWeekChange(first, prev ?? null, next),
      blockers,
      oldWeeks,
    },
  }
}

const MOVE_ERRORS: Record<string, string> = {
  hours_conflict: 'has hours for someone who already has hours on the new week',
  bonus_conflict: 'has a bonus someone already has on the new week',
  has_pay_lines: 'has pay lines already written — approve it first',
  not_open: 'is no longer open',
}

/**
 * THE writer of `orgs.settings.payWeek` (super admins only — the route checks). Saves the schedule first (so every week made from
 * here on is on it), then closes each old-schedule open week with `payroll_move_open_week`: whatever was waiting on it moves to the
 * new week covering its last day, in one transaction per week. A week that cannot move is reported; the schedule stays saved and
 * saving again retries (each move is all-or-nothing).
 */
export async function savePayWeekSchedule(admin: SupabaseClient, orgId: string, raw: unknown, now: Date): Promise<{ ok: true; value: PayWeekChangeCheck } | { ok: false; status: number; error: string }> {
  const check = await checkPayWeekChange(admin, orgId, raw, now)
  if (!check.ok) return { ok: false, status: 400, error: check.error }
  const c = check.value
  if (c.blockers.length) {
    return { ok: false, status: 409, error: `Approve these weeks first: ${c.blockers.map((b) => `week ending ${b.weekEnding} (${b.what})`).join('; ')}.` }
  }
  const { error } = await mergeOrgSettings(admin, orgId, { ...c.next.schedule }, { path: [PAY_WEEK_SETTINGS_KEY] })
  if (error) return { ok: false, status: 500, error: 'Could not save the pay week.' }
  const s: PayWeekSchedule = { ...c.next.schedule, timeZone: (await loadPayWeekSchedule(admin, orgId)).timeZone }
  const failed: string[] = []
  for (const w of c.oldWeeks) {
    const { data: row } = await admin.from('payroll_periods').select('cutoff_at').eq('id', w.periodId).eq('org_id', orgId).maybeSingle()
    if (!row) continue
    const target = await findOrCreateWeek(admin, orgId, moveTargetCutoff(row.cutoff_at as string, s), s)
    const { error: moveErr } = await admin.rpc('payroll_move_open_week', { p_org_id: orgId, p_from_id: w.periodId, p_to_id: target.id })
    if (moveErr) {
      const code = /move_week:(\w+)/.exec(String(moveErr.message ?? ''))?.[1] ?? ''
      failed.push(`week ending ${w.weekEnding} ${MOVE_ERRORS[code] ?? 'could not be closed'}`)
    }
  }
  if (failed.length) return { ok: false, status: 409, error: `Pay week saved, but ${failed.join('; ')}. Fix that, then save again.` }
  return { ok: true, value: c }
}
