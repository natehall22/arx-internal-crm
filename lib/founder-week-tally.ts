/**
 * Founder Week tally — the CRM numbers behind Nathan's founder calendar page, so doors, sets,
 * proposals shown and sales aren't counted by hand.
 *
 * Adds NO new metric definitions: every count reuses the morning-update email's helpers
 * (lib/morning-update-metrics.ts), so a door, set, proposal or sale means the same thing here as in
 * the 7am email and the dashboard (doors come from canvass_knocks via
 * dashboard_count_door_leads_scoped, see 202608250002). Only the window differs: Monday 00:00
 * Eastern → now, while the email's week-to-date is Sunday-start and stops at midnight, so the two
 * totals can differ mid-week.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfDay, subDays } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { EASTERN_TZ, getEasternDateIso } from '@/lib/eastern-datetime'
import { countOrgInspectionSetsInPeriod } from '@/lib/inspection-set-metrics'
import {
  countDoors,
  countGeneratedProposalOpportunitiesInPeriod,
  fetchSignedContractsInPeriod,
  summarizeSignedContracts,
} from '@/lib/morning-update-metrics'

export type FounderWeekTally = {
  /** Monday the week starts, YYYY-MM-DD (Eastern). Sunday belongs to the week that began the Monday before. */
  weekStart: string
  /** ISO instant the counts run through. */
  through: string
  doors: number
  sets: number
  /** Proposals shown (unique opportunities with a generated proposal PDF) — the sit proxy the morning email uses. */
  proposalsShown: number
  sales: number
  revenue: number
}

/** Monday 00:00 Eastern of the week containing `now` (Mon–Sun weeks). */
export function founderWeekStart(now: Date = new Date()): Date {
  const local = toZonedTime(now, EASTERN_TZ)
  const daysSinceMonday = (local.getDay() + 6) % 7
  return fromZonedTime(startOfDay(subDays(local, daysSinceMonday)), EASTERN_TZ)
}

export async function fetchFounderWeekTally(
  supabase: SupabaseClient,
  orgId: string,
  now: Date = new Date()
): Promise<FounderWeekTally> {
  const start = founderWeekStart(now)
  const startIso = start.toISOString()
  const endIso = now.toISOString()

  const [doors, sets, proposalsShown, contracts] = await Promise.all([
    countDoors(supabase, orgId, startIso, endIso),
    countOrgInspectionSetsInPeriod(supabase, { orgId, startIso, endIso }),
    countGeneratedProposalOpportunitiesInPeriod(supabase, orgId, startIso, endIso),
    fetchSignedContractsInPeriod(supabase, orgId, startIso, endIso),
  ])
  const { salesCount, revenue } = summarizeSignedContracts(contracts)

  return {
    weekStart: getEasternDateIso(startIso) as string,
    through: endIso,
    doors,
    sets,
    proposalsShown,
    sales: salesCount,
    revenue: Math.round(revenue * 100) / 100,
  }
}
