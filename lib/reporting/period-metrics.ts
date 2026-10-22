import type { SupabaseClient } from '@supabase/supabase-js'

import { getContactDispositionIdSet, isContactDisposition } from '@/lib/sales-metrics'
import { fetchSupabaseAllPages } from '@/lib/supabase-fetch-all-pages'

/**
 * The dashboard's weekly numbers (doors, contacts, inspections set, sits, sales, calendar appointments),
 * read from the reporting views — the one definition each metric has (docs/reporting.md). The dashboard,
 * the team leaderboard and the Sisu page all call this instead of counting `leads` / `scheduled_appointments`
 * / contracts themselves. Callers keep their own who-may-see-whom filtering; this returns org-fenced ROWS
 * with the credited people on them, so that filtering stays in one place per screen.
 *
 * Server-only: the views are readable by the service role only.
 */
export type PeriodMetricRows = {
  /** One row per door knock, credited to the person who actually knocked. */
  doors: Array<{ user_id: string | null; disposition: string | null }>
  /** Inspections set (booked) in the period. */
  sets: Array<{ setter_user_id: string | null; closer_user_id: string | null }>
  /** Sits (inspection happened with a sit outcome) in the period, one per opportunity. */
  sits: Array<{ opportunity_id: string; setter_user_id: string | null; closer_user_id: string | null }>
  /** Signed sales in the period, one per opportunity. */
  sales: Array<{ opportunity_id: string; setter_user_id: string | null; closer_user_id: string | null }>
  /** Appointments on a closer's calendar in the period (efficiency denominator). */
  calendar: Array<{ closer_user_id: string }>
}

type Row = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export async function fetchPeriodMetricRows(
  admin: SupabaseClient,
  args: { orgId: string; startIso: string; endIso: string }
): Promise<PeriodMetricRows> {
  const { orgId, startIso, endIso } = args
  // `idCol` is a unique tiebreaker: dates alone tie (bulk inserts, split deals), and a tie on a page boundary repeats or skips rows.
  const page = (view: string, columns: string, dateCol: string, idCol: string) =>
    fetchSupabaseAllPages<Row>(async (from, to) =>
      admin
        .from(view)
        .select(columns)
        .eq('org_id', orgId)
        .gte(dateCol, startIso)
        .lt(dateCol, endIso)
        .order(dateCol, { ascending: true })
        .order(idCol, { ascending: true })
        .range(from, to) as never
    )

  const [doors, sets, sits, sales, calendar] = await Promise.all([
    page('rpt_canvass_doors', 'knock_id, user_id, disposition, knocked_at', 'knocked_at', 'knock_id'),
    page('rpt_inspection_sets', 'appointment_id, setter_user_id, closer_user_id, set_at', 'set_at', 'appointment_id'),
    page('rpt_sits', 'opportunity_id, setter_user_id, closer_user_id, sat_at', 'sat_at', 'opportunity_id'),
    page('rpt_sales', 'opportunity_id, contract_id, setter_user_id, closer_user_id, signed_at', 'signed_at', 'contract_id'),
    page('rpt_appointments', 'appointment_id, closer_user_id, scheduled_for', 'scheduled_for', 'appointment_id'),
  ])

  // One sale per opportunity (a split cash/finance deal has two signed agreements).
  const saleSeen = new Set<string>()
  const saleRows: PeriodMetricRows['sales'] = []
  for (const r of sales) {
    const key = s(r.opportunity_id) ?? s(r.contract_id)
    if (!key || saleSeen.has(key)) continue
    saleSeen.add(key)
    saleRows.push({ opportunity_id: key, setter_user_id: s(r.setter_user_id), closer_user_id: s(r.closer_user_id) })
  }
  const sitSeen = new Set<string>()
  const sitRows: PeriodMetricRows['sits'] = []
  for (const r of sits) {
    const key = s(r.opportunity_id)
    if (!key || sitSeen.has(key)) continue
    sitSeen.add(key)
    sitRows.push({ opportunity_id: key, setter_user_id: s(r.setter_user_id), closer_user_id: s(r.closer_user_id) })
  }

  return {
    doors: doors.map((r) => ({ user_id: s(r.user_id), disposition: s(r.disposition) })),
    sets: sets.map((r) => ({ setter_user_id: s(r.setter_user_id), closer_user_id: s(r.closer_user_id) })),
    sits: sitRows,
    sales: saleRows,
    calendar: calendar.flatMap((r) => (s(r.closer_user_id) ? [{ closer_user_id: s(r.closer_user_id)! }] : [])),
  }
}

export function countContacts(doors: PeriodMetricRows['doors'], contactDispositionIdSet: Set<string>): number {
  return doors.filter((d) => isContactDisposition(d.disposition, contactDispositionIdSet)).length
}

export { getContactDispositionIdSet }
