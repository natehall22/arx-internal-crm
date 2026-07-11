import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { EASTERN_TZ } from '@/lib/eastern-datetime'
import { countOrgInspectionSetsInPeriod } from '@/lib/inspection-set-metrics'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'

const TIMEZONE = EASTERN_TZ
const PAGE_SIZE = 1000

/** Inspection feedback / close outcomes that mean the deal is going through insurance. */
const INSURANCE_INSPECTION_OUTCOME_IDS = new Set(['insurance_follow_up', 'waiting_on_insurance'])

export type MorningUpdateMetrics = {
  /** Eastern date the email is sent (today at 5:30am). */
  sentDateLabel: string
  /** Eastern calendar day covered by "Yesterday" metrics. */
  yesterdayDateLabel: string
  doorsKnockedYesterday: number
  doorsKnockedMonthToDate: number
  inspectionsScheduledYesterday: number
  inspectionsScheduledMonthToDate: number
  salesYesterday: number
  salesMonthToDate: number
  revenueLastMonth: number
  revenueMonthToDate: number
  revenueYearToDate: number
  insuranceInspectionsLastMonth: number
  insuranceInspectionsMonthToDate: number
}

function formatReportDateLabel(startIso: string): string {
  const d = new Date(startIso)
  return d.toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
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

export async function fetchMorningUpdateMetrics(
  supabase: SupabaseClient,
  orgId: string
): Promise<MorningUpdateMetrics> {
  const today = getDateRangeForTimeFrame('today', TIMEZONE)
  const yesterday = getDateRangeForTimeFrame('yesterday', TIMEZONE)
  const monthToDate = getDateRangeForTimeFrame('month', TIMEZONE)
  const lastMonth = getDateRangeForTimeFrame('last_month', TIMEZONE)
  const yearToDate = getDateRangeForTimeFrame('year', TIMEZONE)

  const [
    doorsKnockedYesterday,
    doorsKnockedMonthToDate,
    inspectionsScheduledYesterday,
    inspectionsScheduledMonthToDate,
    yesterdayContracts,
    monthContracts,
    lastMonthContracts,
    yearContracts,
    insuranceInspectionsLastMonth,
    insuranceInspectionsMonthToDate,
  ] = await Promise.all([
    countDoors(supabase, orgId, yesterday.start.toISOString(), yesterday.end.toISOString()),
    countDoors(supabase, orgId, monthToDate.start.toISOString(), monthToDate.end.toISOString()),
    countInspectionSets(
      supabase,
      orgId,
      yesterday.start.toISOString(),
      yesterday.end.toISOString()
    ),
    countInspectionSets(
      supabase,
      orgId,
      monthToDate.start.toISOString(),
      monthToDate.end.toISOString()
    ),
    fetchSignedContractsInPeriod(
      supabase,
      orgId,
      yesterday.start.toISOString(),
      yesterday.end.toISOString()
    ),
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
  ])

  const yesterdaySales = summarizeSignedContracts(yesterdayContracts)
  const monthSales = summarizeSignedContracts(monthContracts)
  const lastMonthRevenue = summarizeSignedContracts(lastMonthContracts).revenue
  const yearRevenue = summarizeSignedContracts(yearContracts).revenue

  return {
    sentDateLabel: formatReportDateLabel(today.start.toISOString()),
    yesterdayDateLabel: formatReportDateLabel(yesterday.start.toISOString()),
    doorsKnockedYesterday,
    doorsKnockedMonthToDate,
    inspectionsScheduledYesterday,
    inspectionsScheduledMonthToDate,
    salesYesterday: yesterdaySales.salesCount,
    salesMonthToDate: monthSales.salesCount,
    revenueLastMonth: lastMonthRevenue,
    revenueMonthToDate: monthSales.revenue,
    revenueYearToDate: yearRevenue,
    insuranceInspectionsLastMonth,
    insuranceInspectionsMonthToDate,
  }
}
