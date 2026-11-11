/**
 * Server side of the pay-week schedule (lib/payroll-week-schedule.ts): the one reader of a company's schedule, the one writer, and
 * the "what changes" preview the owner sees before saving.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgTimeZone } from '@/lib/cron-orgs'
import { mergeOrgSettings } from '@/lib/org-settings'
import {
  cutoffWeekday,
  cutoffYmd,
  describePayWeek,
  lastCutoffAtOrBefore,
  nextCutoffAfter,
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

/** True when a stored cutoff sits on this schedule's cutoff day (the ±36 h tolerance the week lookup uses absorbs hand-typed times). */
export function cutoffOnSchedule(cutoffAt: string, s: PayWeekSchedule): boolean {
  const ms = new Date(cutoffAt).getTime()
  for (const delta of [-36, 0, 36]) {
    const ymd = cutoffYmd(new Date(ms + delta * 3_600_000), s)
    if (weekdayOfYmd(ymd) === cutoffWeekday(s)) return true
  }
  return false
}

export type PayWeekChangeCheck = {
  current: { schedule: StoredPayWeek; words: string }
  next: { schedule: StoredPayWeek; words: string }
  unchanged: boolean
  preview: PayWeekChangePreview
  /** Open weeks on the old schedule that hold pay (hours, bonuses, fixes): approve or empty them first. */
  blockers: Array<{ periodId: string; weekEnding: string; what: string }>
  /** Open, EMPTY weeks on the old schedule: cancelled when the change is saved (nothing is on them). */
  emptyOldWeeks: Array<{ periodId: string; weekEnding: string }>
}

/** Everything the owner sees before saving a new pay week. Reads only. */
export async function checkPayWeekChange(admin: SupabaseClient, orgId: string, raw: unknown, now: Date): Promise<{ ok: true; value: PayWeekChangeCheck } | { ok: false; error: string }> {
  const parsed = parsePayWeek(raw)
  if (!parsed.ok) return parsed
  const current = await loadPayWeekSchedule(admin, orgId)
  const next: PayWeekSchedule = { ...parsed.value, timeZone: current.timeZone }

  // Open weeks on the old schedule (after the last approved week) would sit beside the new weeks.
  const { data: open, error } = await admin.from('payroll_periods').select('id, cutoff_at').eq('org_id', orgId).eq('status', 'open').order('cutoff_at', { ascending: true })
  if (error) throw error
  const offSchedule = (open ?? []).filter((p) => !cutoffOnSchedule(p.cutoff_at as string, next))
  const blockers: PayWeekChangeCheck['blockers'] = []
  const emptyOldWeeks: PayWeekChangeCheck['emptyOldWeeks'] = []
  for (const p of offSchedule) {
    const id = p.id as string
    const [h, b, a, l] = await Promise.all([
      admin.from('payroll_rep_hours').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id),
      admin.from('payroll_bonus_lines').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id).in('status', ['pending_approval', 'approved', 'paid']),
      admin.from('payroll_adjustments').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id).neq('status', 'void'),
      admin.from('payroll_payout_lines').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('payroll_period_id', id),
    ])
    const what = [h.count ? 'hours' : '', b.count ? 'bonuses' : '', a.count ? 'fixes' : '', l.count ? 'pay lines' : ''].filter(Boolean)
    const weekEnding = cutoffYmd(p.cutoff_at as string, current)
    if (what.length) blockers.push({ periodId: id, weekEnding, what: what.join(', ') })
    else emptyOldWeeks.push({ periodId: id, weekEnding })
  }

  // The first new week = the week the Pay screen will open on: the last new-schedule cutoff at or before now, unless a week that
  // stays (not one cancelled above) already covers it — then the one after.
  const staying = new Set((open ?? []).map((p) => p.id as string).filter((id) => !emptyOldWeeks.some((w) => w.periodId === id)))
  let first = lastCutoffAtOrBefore(now, next)
  const { data: latest } = await admin.from('payroll_periods').select('id, cutoff_at, status').eq('org_id', orgId).neq('status', 'cancelled').order('cutoff_at', { ascending: false }).limit(20)
  const kept = (latest ?? []).filter((p) => p.status !== 'open' || staying.has(p.id as string))
  const newest = kept[0]?.cutoff_at as string | undefined
  if (newest && new Date(newest).getTime() >= first.getTime() - 36 * 3_600_000) first = nextCutoffAfter(new Date(Math.max(new Date(newest).getTime(), first.getTime()) + 36 * 3_600_000), next)
  const prev = kept.find((p) => new Date(p.cutoff_at as string).getTime() < first.getTime() - 36 * 3_600_000)?.cutoff_at as string | undefined

  const strip = ({ timeZone: _tz, ...rest }: PayWeekSchedule): StoredPayWeek => rest
  return {
    ok: true,
    value: {
      current: { schedule: strip(current), words: describePayWeek(current) },
      next: { schedule: parsed.value, words: describePayWeek(parsed.value) },
      unchanged: sameStoredPayWeek(current, parsed.value),
      preview: previewPayWeekChange(first, prev ?? null, next),
      blockers,
      emptyOldWeeks,
    },
  }
}

/**
 * THE writer of `orgs.settings.payWeek` (super admins only — the route checks). Refuses while an old-schedule open week holds pay;
 * cancels old-schedule open weeks that are empty (nothing was ever on them), then saves through mergeOrgSettings path ['payWeek'].
 */
export async function savePayWeekSchedule(admin: SupabaseClient, orgId: string, raw: unknown, now: Date): Promise<{ ok: true; value: PayWeekChangeCheck } | { ok: false; status: number; error: string }> {
  const check = await checkPayWeekChange(admin, orgId, raw, now)
  if (!check.ok) return { ok: false, status: 400, error: check.error }
  const c = check.value
  if (c.blockers.length) {
    return { ok: false, status: 409, error: `Approve or clear these weeks first: ${c.blockers.map((b) => `week ending ${b.weekEnding} (${b.what})`).join('; ')}.` }
  }
  for (const w of c.emptyOldWeeks) {
    // Only an open week is ever touched; the frozen-status guard refuses anything else.
    const { error } = await admin.from('payroll_periods').update({ status: 'cancelled' }).eq('id', w.periodId).eq('org_id', orgId).eq('status', 'open').is('lock_claim_token', null)
    if (error) return { ok: false, status: 500, error: 'Could not close the old empty week. Nothing was changed.' }
  }
  const { error } = await mergeOrgSettings(admin, orgId, { ...c.next.schedule }, { path: [PAY_WEEK_SETTINGS_KEY] })
  if (error) return { ok: false, status: 500, error: 'Could not save the pay week.' }
  return { ok: true, value: c }
}
