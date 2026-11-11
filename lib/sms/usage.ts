/**
 * Texting usage per company per month (server only) — the source for billing. One `sms_usage` row per text sent or
 * received (unique per carrier message id, so a retried webhook or a re-run can never count one twice). The cost is an
 * estimate from the platform price table (lib/sms/provider.ts `priceMicros`) until the carrier's delivery receipt gives
 * the real charge. Months are the COMPANY's calendar months (its time zone).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { addDaysYmd, localInstant, ymdInZone } from '@/lib/payroll-week-schedule'
import { isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export type UsageInput = {
  direction: 'out' | 'in'
  kind: string
  segments: number
  costMicros: number | null
  providerMessageId: string
  customerMessageId?: string | null
  at?: Date
}

/** Record one text. A second call for the same carrier message id changes nothing. Never throws (the text already happened). */
export async function logUsage(admin: SupabaseClient, orgId: string, u: UsageInput): Promise<void> {
  const { error } = await orgDb(admin, orgId)
    .from('sms_usage')
    .upsert(
      {
        direction: u.direction,
        kind: u.kind,
        segments: Math.max(0, Math.round(u.segments)),
        provider_cost_micros: u.costMicros,
        provider_message_id: u.providerMessageId,
        customer_message_id: u.customerMessageId ?? null,
        occurred_at: (u.at ?? new Date()).toISOString(),
      },
      { onConflict: 'org_id,direction,provider_message_id', ignoreDuplicates: true }
    )
  if (error && !isMissingTable(error)) console.error('[sms] could not record usage', { orgId, providerMessageId: u.providerMessageId, error })
}

/** The carrier's real charge (from a delivery receipt) replaces the estimate. */
export async function setUsageCost(admin: SupabaseClient, orgId: string, providerMessageId: string, costMicros: number, segments: number | null): Promise<void> {
  const { error } = await orgDb(admin, orgId)
    .from('sms_usage')
    .update({ provider_cost_micros: costMicros, ...(segments != null ? { segments } : {}) })
    .eq('direction', 'out')
    .eq('provider_message_id', providerMessageId)
  if (error && !isMissingTable(error)) console.error('[sms] could not update usage cost', { orgId, providerMessageId, error })
}

/** '2026-11' of an instant in the company's time zone. */
export function monthOf(now: Date, timeZone: string): string {
  return ymdInZone(now, timeZone).slice(0, 7)
}

/** The instants a company month starts and ends (midnight local to midnight local; DST-safe). */
export function monthBounds(ym: string, timeZone: string): { start: Date; end: Date } {
  const [y, m] = ym.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { start: localInstant(`${ym}-01`, '00:00', timeZone), end: localInstant(`${next}-01`, '00:00', timeZone) }
}

/** The start of the company's current day (for the daily cap). */
export function dayStart(now: Date, timeZone: string): Date {
  return localInstant(ymdInZone(now, timeZone), '00:00', timeZone)
}
export const nextDayStart = (now: Date, timeZone: string): Date => localInstant(addDaysYmd(ymdInZone(now, timeZone), 1), '00:00', timeZone)

export type UsageTotals = { texts: number; segments: number; costMicros: number }
export type MonthUsage = { month: string; out: UsageTotals; in: UsageTotals; byKind: Record<string, UsageTotals>; costMicros: number }
const zero = (): UsageTotals => ({ texts: 0, segments: 0, costMicros: 0 })

type UsageRow = { direction: 'out' | 'in'; kind: string; segments: number; provider_cost_micros: number | null }

/** Pure: rows → totals. */
export function sumUsage(rows: UsageRow[], month: string): MonthUsage {
  const out = zero()
  const inn = zero()
  const byKind: Record<string, UsageTotals> = {}
  for (const r of rows) {
    const t = r.direction === 'out' ? out : inn
    const cost = Number(r.provider_cost_micros ?? 0)
    t.texts++
    t.segments += r.segments
    t.costMicros += cost
    const k = (byKind[`${r.direction}:${r.kind}`] ??= zero())
    k.texts++
    k.segments += r.segments
    k.costMicros += cost
  }
  return { month, out, in: inn, byKind, costMicros: out.costMicros + inn.costMicros }
}

/** One company's usage for a month. Reads in pages (a busy month can pass the 1,000-row default). */
export async function monthlyUsage(admin: SupabaseClient, orgId: string, ym: string, timeZone: string): Promise<MonthUsage> {
  const { start, end } = monthBounds(ym, timeZone)
  const rows: UsageRow[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await orgDb(admin, orgId)
      .from('sms_usage')
      .select('direction, kind, segments, provider_cost_micros')
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString())
      .order('occurred_at')
      .range(off, off + 999)
    if (error) {
      if (isMissingTable(error)) break
      throw new Error(`sms usage: ${error.message}`)
    }
    rows.push(...((data ?? []) as UsageRow[]))
    if (!data || data.length < 1000) break
  }
  return sumUsage(rows, ym)
}

/** Texts sent today (company day), for the daily cap. */
export async function sentToday(admin: SupabaseClient, orgId: string, now: Date, timeZone: string): Promise<number> {
  const { count, error } = await orgDb(admin, orgId)
    .from('sms_usage')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'out')
    .gte('occurred_at', dayStart(now, timeZone).toISOString())
  if (error) {
    if (isMissingTable(error)) return 0
    throw new Error(`sms usage today: ${error.message}`)
  }
  return count ?? 0
}

/** Dollars, for the screen: 12_345_678 micros → "$12.35". */
export function microsToDollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}
