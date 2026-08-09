import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { EASTERN_TZ } from '@/lib/eastern-datetime'
import { getOrgMonthlyGoal } from '@/lib/goals-scorecard'
import { countOrgInspectionSetsInPeriod } from '@/lib/inspection-set-metrics'
import {
  isMondayEastern,
  resolveMorningUpdateActivityWindow,
  resolveMorningUpdateLastWeekWindow,
  resolveMorningUpdateSentDateLabel,
  shareOfMonthGoalPct,
} from '@/lib/morning-update-windows'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'

const TIMEZONE = EASTERN_TZ
const PAGE_SIZE = 1000

/** Inspection feedback / close outcomes that mean the deal is going through insurance. */
const INSURANCE_INSPECTION_OUTCOME_IDS = new Set(['insurance_follow_up', 'waiting_on_insurance'])

export type MorningUpdateGoalShare = {
  actual: number
  goal: number | null
  shareOfMonthPct: number | null
}

export type MorningUpdateLastWeekVsGoals = {
  rangeLabel: string
  monthGoalLabel: string
  /** Unique opportunities with at least one generated proposal PDF in the prior week. */
  proposalsShown: number | null
  /** Unique opportunities with at least one generated proposal PDF month to date. */
  proposalsShownMonthToDate: number | null
  doors: MorningUpdateGoalShare
  sets: MorningUpdateGoalShare
  sales: MorningUpdateGoalShare
  revenue: MorningUpdateGoalShare
}

export type MorningUpdateMetrics = {
  sentDateLabel: string
  activityPeriodKind: 'yesterday' | 'weekend'
  activityPeriodLabel: string
  /** Doors / sets / sales for the activity window (yesterday, or Sat–Sun on Monday). */
  doorsKnockedPeriod: number
  doorsKnockedMonthToDate: number
  inspectionsScheduledPeriod: number
  inspectionsScheduledMonthToDate: number
  salesPeriod: number
  salesMonthToDate: number
  revenueLastMonth: number
  revenueMonthToDate: number
  revenueYearToDate: number
  insuranceInspectionsLastMonth: number
  insuranceInspectionsMonthToDate: number
  /** Monday only: last week totals vs current month goals. Null Tue–Sat. */
  lastWeekVsGoals: MorningUpdateLastWeekVsGoals | null
}

async function countDoors(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const { data, error } = await supabase.rpc('dashboard_count_door_leads_scoped', {
    p_org_id: orgId,
    p_start: startIso,
    p_end: endIso,
    p_scope_user_ids: [],
  })

  if (error) throw error
  return Number(data ?? 0)
}

async function countInspectionSets(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  return countOrgInspectionSetsInPeriod(supabase, { orgId, startIso, endIso })
}

async function countInsuranceInspectionsInPeriod(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const rows = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
    orgId,
    startIso,
    endIso,
    sitOutcomeIdSet: INSURANCE_INSPECTION_OUTCOME_IDS,
  })
  return rows.length
}

type SignedContractRow = {
  id: string
  opportunity_id: string | null
  project_cost: number | string | null
}

async function fetchSignedContractsInPeriod(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<SignedContractRow[]> {
  const rows: SignedContractRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('order_form_contracts')
      .select('id, opportunity_id, project_cost')
      .eq('org_id', orgId)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .not('customer_signed_at', 'is', null)
      .gte('customer_signed_at', startIso)
      .lt('customer_signed_at', endIso)
      .order('customer_signed_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data || []) as SignedContractRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return rows
}

function summarizeSignedContracts(rows: SignedContractRow[]): { salesCount: number; revenue: number } {
  const seen = new Set<string>()
  let revenue = 0

  for (const row of rows) {
    const key = row.opportunity_id || row.id
    if (!seen.has(key)) {
      seen.add(key)
    }
    revenue += Number(row.project_cost || 0)
  }

  return { salesCount: seen.size, revenue }
}

type GeneratedProposalRow = {
  id: string
  opportunity_id: string | null
}

export function countUniqueGeneratedProposalOpportunities(rows: GeneratedProposalRow[]): number {
  return new Set(rows.map((proposal) => proposal.opportunity_id || proposal.id)).size
}

async function countGeneratedProposalOpportunitiesInPeriod(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const uniqueOpportunities = new Set<string>()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('proposals')
      .select('id, opportunity_id')
      .eq('org_id', orgId)
      .not('pdf_generated_at', 'is', null)
      .gte('pdf_generated_at', startIso)
      .lt('pdf_generated_at', endIso)
      .order('pdf_generated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data || []) as GeneratedProposalRow[]
    for (const proposal of page) uniqueOpportunities.add(proposal.opportunity_id || proposal.id)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return uniqueOpportunities.size
}

async function safelyCountGeneratedProposalOpportunities(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string,
  label: string
): Promise<number | null> {
  try {
    return await countGeneratedProposalOpportunitiesInPeriod(
      supabase,
      orgId,
      startIso,
      endIso
    )
  } catch (error) {
    // Proposal reporting is supplemental. A transient read failure must not suppress
    // the entire owner recap and all of its core operating metrics.
    console.error(`fetchMorningUpdateMetrics: ${label} proposal count failed`, error)
    return null
  }
}

function goalShare(actual: number, goal: number | null | undefined): MorningUpdateGoalShare {
  const normalized = goal == null ? null : Number(goal)
  return {
    actual,
    goal: normalized,
    shareOfMonthPct: shareOfMonthGoalPct(actual, normalized),
  }
}

export async function fetchMorningUpdateMetrics(
  supabase: SupabaseClient,
  orgId: string,
  now: Date = new Date()
): Promise<MorningUpdateMetrics> {
  const activity = resolveMorningUpdateActivityWindow(now)
  const monday = isMondayEastern(now)
  const lastWeek = monday ? resolveMorningUpdateLastWeekWindow(now) : null

  const monthToDate = getDateRangeForTimeFrame('month', TIMEZONE)
  const lastMonth = getDateRangeForTimeFrame('last_month', TIMEZONE)
  const yearToDate = getDateRangeForTimeFrame('year', TIMEZONE)

  const activityStart = activity.start.toISOString()
  const activityEnd = activity.end.toISOString()

  const [
    doorsKnockedPeriod,
    doorsKnockedMonthToDate,
    inspectionsScheduledPeriod,
    inspectionsScheduledMonthToDate,
    periodContracts,
    monthContracts,
    lastMonthContracts,
    yearContracts,
    insuranceInspectionsLastMonth,
    insuranceInspectionsMonthToDate,
    lastWeekDoors,
    lastWeekSets,
    lastWeekContracts,
    lastWeekProposalsShown,
    proposalsShownMonthToDate,
    monthGoal,
  ] = await Promise.all([
    countDoors(supabase, orgId, activityStart, activityEnd),
    countDoors(supabase, orgId, monthToDate.start.toISOString(), monthToDate.end.toISOString()),
    countInspectionSets(supabase, orgId, activityStart, activityEnd),
    countInspectionSets(
      supabase,
      orgId,
      monthToDate.start.toISOString(),
      monthToDate.end.toISOString()
    ),
    fetchSignedContractsInPeriod(supabase, orgId, activityStart, activityEnd),
    fetchSignedContractsInPeriod(
      supabase,
      orgId,
      monthToDate.start.toISOString(),
      monthToDate.end.toISOString()
    ),
    fetchSignedContractsInPeriod(
      supabase,
      orgId,
      lastMonth.start.toISOString(),
      lastMonth.end.toISOString()
    ),
    fetchSignedContractsInPeriod(
      supabase,
      orgId,
      yearToDate.start.toISOString(),
      yearToDate.end.toISOString()
    ),
    countInsuranceInspectionsInPeriod(
      supabase,
      orgId,
      lastMonth.start.toISOString(),
      lastMonth.end.toISOString()
    ),
    countInsuranceInspectionsInPeriod(
      supabase,
      orgId,
      monthToDate.start.toISOString(),
      monthToDate.end.toISOString()
    ),
    lastWeek
      ? countDoors(supabase, orgId, lastWeek.start.toISOString(), lastWeek.end.toISOString())
      : Promise.resolve(0),
    lastWeek
      ? countInspectionSets(supabase, orgId, lastWeek.start.toISOString(), lastWeek.end.toISOString())
      : Promise.resolve(0),
    lastWeek
      ? fetchSignedContractsInPeriod(
          supabase,
          orgId,
          lastWeek.start.toISOString(),
          lastWeek.end.toISOString()
        )
      : Promise.resolve([] as SignedContractRow[]),
    lastWeek
      ? safelyCountGeneratedProposalOpportunities(
          supabase,
          orgId,
          lastWeek.start.toISOString(),
          lastWeek.end.toISOString(),
          'last-week'
        )
      : Promise.resolve(null),
    monday
      ? safelyCountGeneratedProposalOpportunities(
          supabase,
          orgId,
          monthToDate.start.toISOString(),
          monthToDate.end.toISOString(),
          'month-to-date'
        )
      : Promise.resolve(null),
    monday
      ? getOrgMonthlyGoal(
          supabase,
          orgId,
          now.toLocaleDateString('en-CA', { timeZone: TIMEZONE }).slice(0, 7)
        // The core morning email must still send if the goals lookup fails — degrade to
        // "no goal" rather than let an unrelated goals-feature error kill the whole send.
        ).catch(() => null)
      : Promise.resolve(null),
  ])

  const periodSales = summarizeSignedContracts(periodContracts)
  const monthSales = summarizeSignedContracts(monthContracts)
  const lastMonthRevenue = summarizeSignedContracts(lastMonthContracts).revenue
  const yearRevenue = summarizeSignedContracts(yearContracts).revenue
  const lastWeekSales = summarizeSignedContracts(lastWeekContracts)

  let lastWeekVsGoals: MorningUpdateLastWeekVsGoals | null = null
  if (monday && lastWeek) {
    lastWeekVsGoals = {
      rangeLabel: lastWeek.rangeLabel,
      monthGoalLabel: lastWeek.monthGoalLabel,
      proposalsShown: lastWeekProposalsShown,
      proposalsShownMonthToDate,
      doors: goalShare(lastWeekDoors, monthGoal?.doors_target),
      sets: goalShare(lastWeekSets, monthGoal?.sets_target),
      sales: goalShare(lastWeekSales.salesCount, monthGoal?.sales_target),
      revenue: goalShare(
        lastWeekSales.revenue,
        monthGoal?.revenue_target != null ? Number(monthGoal.revenue_target) : null
      ),
    }
  }

  return {
    sentDateLabel: resolveMorningUpdateSentDateLabel(now),
    activityPeriodKind: activity.kind,
    activityPeriodLabel: activity.periodLabel,
    doorsKnockedPeriod,
    doorsKnockedMonthToDate,
    inspectionsScheduledPeriod,
    inspectionsScheduledMonthToDate,
    salesPeriod: periodSales.salesCount,
    salesMonthToDate: monthSales.salesCount,
    revenueLastMonth: lastMonthRevenue,
    revenueMonthToDate: monthSales.revenue,
    revenueYearToDate: yearRevenue,
    insuranceInspectionsLastMonth,
    insuranceInspectionsMonthToDate,
    lastWeekVsGoals,
  }
}
