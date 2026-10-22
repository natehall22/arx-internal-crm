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

/** Counts for one person, or for a whole scope (`null` = the whole org). The one place these rules live. */
export type PeriodStats = {
  doors: number
  contacts: number
  inspectionsSet: number
  /** Inspections booked with this closer (real, non-cancelled inspections). */
  inspectionsReceived: number
  sits: number
  sales: number
  /** Appointments on the closer's calendar in the period (efficiency denominator). */
  calendar: number
}

/**
 * @param scope user ids whose numbers to total, or null for everyone. Sits credit the setter for setter-like
 *   viewers and the closer otherwise; a sale credits both its setter and its closer once per opportunity.
 */
export function summarizePeriodRows(
  rows: PeriodMetricRows,
  scope: ReadonlySet<string> | null,
  opts: { setterLane: boolean; contactDispositionIdSet: Set<string> }
): PeriodStats {
  const inScope = (id: string | null | undefined) => scope === null || (!!id && scope.has(id))
  const doors = rows.doors.filter((d) => inScope(d.user_id))
  return {
    doors: doors.length,
    contacts: countContacts(doors, opts.contactDispositionIdSet),
    inspectionsSet: rows.sets.filter((r) => inScope(r.setter_user_id)).length,
    inspectionsReceived: rows.sets.filter((r) => inScope(r.closer_user_id)).length,
    sits: rows.sits.filter((r) => inScope(opts.setterLane ? r.setter_user_id : r.closer_user_id)).length,
    sales: new Set(rows.sales.filter((r) => inScope(r.setter_user_id) || inScope(r.closer_user_id)).map((r) => r.opportunity_id)).size,
    calendar: rows.calendar.filter((r) => inScope(r.closer_user_id)).length,
  }
}

/**
 * Doors one person knocked in a window — the Sisu badge counters. Same definition as everything else
 * (`rpt_canvass_doors`). Needs the service-role client: the views are not readable with a user token.
 */
export async function countUserDoors(admin: SupabaseClient, orgId: string, userId: string, range: { start: Date; end: Date }): Promise<number> {
  const { count, error } = await admin
    .from('rpt_canvass_doors')
    .select('knock_id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('knocked_at', range.start.toISOString())
    .lt('knocked_at', range.end.toISOString())
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Sales one person was credited on (as closer or setter) in a window, once per opportunity. */
export async function countUserSales(admin: SupabaseClient, orgId: string, userId: string, range: { start: Date; end: Date }): Promise<number> {
  // userId goes into a PostgREST filter string: only a plain UUID may.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error('Invalid user id')
  const rows = await fetchSupabaseAllPages<Row>(async (from, to) =>
    admin
      .from('rpt_sales')
      .select('opportunity_id, contract_id, signed_at')
      .eq('org_id', orgId)
      .or(`closer_user_id.eq.${userId},setter_user_id.eq.${userId}`)
      .gte('signed_at', range.start.toISOString())
      .lt('signed_at', range.end.toISOString())
      .order('signed_at', { ascending: true })
      .order('contract_id', { ascending: true })
      .range(from, to) as never
  )
  return new Set(rows.map((r) => s(r.opportunity_id) ?? s(r.contract_id)).filter(Boolean)).size
}

/** Inspections one person booked (as the setter) in a window — real, non-cancelled inspections. */
export async function countUserInspectionsSet(admin: SupabaseClient, orgId: string, userId: string, range: { start: Date; end: Date }): Promise<number> {
  const { count, error } = await admin
    .from('rpt_inspection_sets')
    .select('appointment_id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('setter_user_id', userId)
    .gte('set_at', range.start.toISOString())
    .lt('set_at', range.end.toISOString())
  if (error) throw new Error(error.message)
  return count ?? 0
}
