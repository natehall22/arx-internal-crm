/**
 * Project work on a crew's phone day. A crew that clocks in (the time clock) also does PROJECT work — a grading job, an
 * install — which is a trade work order (`work_orders`, `work_order_type = 'install'`, assigned to the crew's sub), not a
 * service visit. Those stops are listed on the crew day page next to the visits so one phone page covers the day:
 *   - the clock: the same one-tap clock (a crew link may clock in on its own work orders — lib/time-tracking-db.ts resolveWhere);
 *   - photos + notes: the trade's own crew photo link `/crew/<token>` (lib/crew-link.ts) — walk-around photos, crew notes, the
 *     daily log. One implementation; nothing is copied here.
 * Only today's work (a 1½ / 2 day crew keeps showing on its second day). No customer contact details, no money.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { BeforeYouLine } from '@/lib/before-you'
import { loadBeforeYou } from '@/lib/before-you-db'
import { lotLabel } from '@/lib/properties'
import { addDaysYmd } from '@/lib/service-plans'
import { isCrewLinkExpired } from '@/lib/crew-link'
import { calendarDaySpan } from '@/lib/job-trades'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { orgDb } from '@/lib/supabase/org-db'
import { loadWorkOrderRollCounts } from '@/lib/work-order-moves-db'

export type CrewProjectStop = {
  /** The trade work order id: what the clock taps. */
  id: string
  jobNumber: string | null
  tradeLabel: string
  address: string | null
  lat: number | null
  lng: number | null
  status: string
  /** `/crew/<token>` — photos, notes, daily log. Null when the trade has no link (never minted). */
  photoLinkPath: string | null
  /** 1-based day of a multi-day crew ("Day 2 of 2"); null for a one-day crew. */
  dayNumber: number | null
  dayCount: number | null
  /** "Lot 14 · Oak Ridge" for a builder's lot (property tools on); null otherwise. */
  lot: string | null
  /** The crews ahead of this one on the same property (property tools on): trade + done / not done + a day. Nothing else. */
  before: BeforeYouLine[]
  /** The day this stop is booked on (what a roll is compare-and-set against). */
  scheduledDate: string
  /** Times this crew work was rolled to a later day. */
  rolls?: number
}

type WoRow = { id: string; job_id: string | null; trade: string | null; status: string; scheduled_date: string | null; install_days: unknown; crew_link_token: string | null; work_order_number: string | null; property_id?: string | null; completed_at?: string | null }
type JobRow = { id: string; job_number: string | null; address_text: string | null; lat: number | null; lng: number | null; status: string | null; cancelled_at: string | null }

/** Pure: which trade rows are working on `today` (first day through its last, cancelled never). */
export function projectStopsToday<T extends { scheduled_date: string | null; install_days: unknown; status: string }>(rows: T[], today: string): Array<T & { dayNumber: number | null; dayCount: number | null }> {
  const out: Array<T & { dayNumber: number | null; dayCount: number | null }> = []
  for (const r of rows) {
    if (!r.scheduled_date || r.status === 'cancelled') continue
    const span = calendarDaySpan(r.install_days)
    const last = addDaysYmd(r.scheduled_date, span - 1)
    if (r.scheduled_date > today || last < today) continue
    const dayNumber = span > 1 ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${r.scheduled_date}T12:00:00Z`)) / 86_400_000) + 1 : null
    out.push({ ...r, dayNumber, dayCount: span > 1 ? span : null })
  }
  return out
}

/** `propertyTools` = the company's property-tools switch is on: adds each stop's lot and the crews ahead of it. Off = the stops are exactly as before. */
export async function loadCrewProjectStops(admin: SupabaseClient, crew: { orgId: string; subId: string }, today: string, opts: { propertyTools?: boolean } = {}): Promise<CrewProjectStop[]> {
  const db = orgDb(admin, crew.orgId)
  const { data, error } = await db
    .from('work_orders')
    .select(opts.propertyTools ? 'id, job_id, trade, status, scheduled_date, install_days, crew_link_token, work_order_number, property_id' : 'id, job_id, trade, status, scheduled_date, install_days, crew_link_token, work_order_number')
    .eq('assigned_sub_id', crew.subId)
    .eq('work_order_type', 'install')
    .not('trade', 'is', null)
    .not('job_id', 'is', null)
    .neq('status', 'cancelled')
    // A crew works at most 2 calendar days: nothing that started earlier than yesterday is still running.
    .gte('scheduled_date', addDaysYmd(today, -1))
    .lte('scheduled_date', today)
    .order('scheduled_date')
    .order('id')
  if (error) throw error
  const rows = projectStopsToday((data ?? []) as WoRow[], today)
  if (rows.length === 0) return []
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x)))
  const { data: jobs, error: jobErr } = await db.from('production_jobs').select('id, job_number, address_text, lat, lng, status, cancelled_at').in('id', jobIds)
  if (jobErr) throw jobErr
  const byJob = new Map(((jobs ?? []) as JobRow[]).map((j) => [j.id, j]))
  const trades = await loadOrgTrades(admin, crew.orgId)
  const shown = rows.filter((r) => {
    const j = r.job_id ? byJob.get(r.job_id) : null
    return !!j && !j.cancelled_at && j.status !== 'cancelled'
  })
  // Property tools only: each stop's lot, and what the crews ahead of it have done. A failed read leaves both out.
  const lots = new Map<string, string | null>()
  let before = new Map<string, BeforeYouLine[]>()
  if (opts.propertyTools && shown.length > 0) {
    try {
      const propertyIds = Array.from(new Set(shown.map((r) => r.property_id).filter((x): x is string => !!x)))
      if (propertyIds.length > 0) {
        const { data: props } = await db.from('properties').select('id, community, lot').in('id', propertyIds)
        for (const p of (props ?? []) as Array<{ id: string; community: string | null; lot: string | null }>) lots.set(p.id, lotLabel(p))
      }
      before = await loadBeforeYou(admin, crew.orgId, shown.map((r) => ({ id: r.id, job_id: r.job_id, property_id: r.property_id ?? null, trade: r.trade })))
    } catch (e) {
      console.error('[crew-day] lot / before-you failed', e)
    }
  }
  const rolls = await loadWorkOrderRollCounts(admin, crew.orgId, shown.map((r) => r.id))
  return shown
    .map((r) => {
      const j = byJob.get(r.job_id as string) as JobRow
      return {
        id: r.id,
        jobNumber: j.job_number,
        tradeLabel: tradeLabel(r.trade as string, trades),
        address: j.address_text,
        lat: j.lat,
        lng: j.lng,
        status: r.status,
        // Only a link the trade page would still open: an expired one is hidden, never a dead button.
        photoLinkPath: r.crew_link_token && r.scheduled_date && !isCrewLinkExpired(r.scheduled_date, r.install_days, today) ? `/crew/${r.crew_link_token}` : null,
        dayNumber: r.dayNumber,
        dayCount: r.dayCount,
        lot: r.property_id ? lots.get(r.property_id) ?? null : null,
        before: before.get(r.id) ?? [],
        scheduledDate: r.scheduled_date as string,
        rolls: rolls.get(r.id) ?? 0,
      }
    })
}
