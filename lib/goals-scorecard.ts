import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import {
  GOAL_CHANNEL_ATTRIBUTION_FOOTNOTE,
  GOAL_CHANNEL_LABELS,
  resolveLeadChannel,
  type GoalChannel,
} from '@/lib/goals-channel-attribution'
import {
  computeForecast,
  computeQuarterCompare,
  type ForecastGoals,
  type ForecastHistory,
  type ForecastResult,
} from '@/lib/goals-forecast'
import {
  summarizeJobEconomics,
  type JobCostLineRow,
  type JobEconomicsRow,
} from '@/lib/goals-job-economics'
import { getEasternTodayIso } from '@/lib/eastern-datetime'
import {
  getEasternDateRange,
  getEasternMonthRange,
  GOALS_TIMEZONE,
} from '@/lib/goals-period'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { countsAsInspectionSet, INSPECTION_SET_APPOINTMENT_TYPE_OR } from '@/lib/inspection-set-metrics'
import { isCanvassDoorLead, SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'

export type OrgMonthlyGoal = {
  id: string
  org_id: string
  month: string
  doors_target: number | null
  sets_target: number | null
  sits_target: number | null
  sales_target: number | null
  revenue_target: number | null
  notes: string | null
  updated_by: string | null
  updated_at: string
  updater?: { full_name: string | null; email: string | null } | null
}

export type ScorecardKpi = {
  key: string
  label: string
  value: number
  goal: number | null
  attainmentPct: number | null
  format: 'integer' | 'currency'
}

export type FunnelStage = {
  key: string
  label: string
  value: number
  conversionFromPrevious: number | null
  trailing90Conversion: number | null
}

export type ChannelRow = {
  channel: GoalChannel
  label: string
  sets: number
  sales: number
  revenue: number
}

export type ScorecardPayload = {
  month: string
  timezone: string
  kpis: ScorecardKpi[]
  funnel: FunnelStage[]
  channels: ChannelRow[]
  channelFootnote: string
  dataQuality: {
    jobsMissingCostData: number
    jobsInMonth: number
  }
  goal: OrgMonthlyGoal | null
}

const FETCH_LIMIT = 1000

function attainmentPct(value: number, goal: number | null): number | null {
  if (goal == null || goal <= 0) return null
  return Math.round((value / goal) * 1000) / 10
}

async function loadSitOutcomeSet(
  supabase: SupabaseClient,
  orgId: string
): Promise<Set<string>> {
  const { data: org } = await supabase.from('orgs').select('settings').eq('id', orgId).single()
  const settings = (org?.settings || {}) as { inspection_outcomes?: InspectionOutcomeConfigRow[] }
  return getSitOutcomeNormalizedIdSet(settings.inspection_outcomes)
}

async function countDoorsInPeriod(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const { data, error } = await supabase
    .from('leads')
    .select('source, canvass_disposition')
    .eq('org_id', orgId)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .limit(FETCH_LIMIT)

  if (error) throw error
  return (data || []).filter((row) => isCanvassDoorLead(row)).length
}

async function fetchInspectionSets(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
) {
  const { data, error } = await supabase
    .from('scheduled_appointments')
    .select('id, lead_id, opportunity_id, scheduled_for, appointment_type, status')
    .eq('org_id', orgId)
    .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
    .gte('scheduled_for', startIso)
    .lt('scheduled_for', endIso)
    .limit(FETCH_LIMIT)

  if (error) throw error
  return (data || []).filter(countsAsInspectionSet)
}

async function fetchSignedContracts(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
) {
  const { data, error } = await supabase
    .from('order_form_contracts')
    .select('id, opportunity_id, lead_id, customer_signed_at, project_cost, agreement_type, status')
    .eq('org_id', orgId)
    .in('agreement_type', SALE_AGREEMENT_TYPES)
    .eq('status', 'completed')
    .not('customer_signed_at', 'is', null)
    .gte('customer_signed_at', startIso)
    .lt('customer_signed_at', endIso)
    .limit(FETCH_LIMIT)

  if (error) throw error
  return data || []
}

async function fetchCollectedPayments(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { data: jobs, error: jobsErr } = await supabase
    .from('production_jobs')
    .select('id')
    .eq('org_id', orgId)
    .limit(FETCH_LIMIT)

  if (jobsErr) throw jobsErr
  const jobIds = (jobs || []).map((j) => j.id)
  if (jobIds.length === 0) return 0

  const { data: payments, error } = await supabase
    .from('job_payments')
    .select('amount_cents, paid_at, job_id')
    .in('job_id', jobIds)
    .gte('paid_at', startDate)
    .lte('paid_at', endDate)
    .limit(FETCH_LIMIT)

  if (error) throw error
  return (payments || []).reduce((sum, p) => sum + (p.amount_cents || 0) / 100, 0)
}

async function fetchLeadMap(supabase: SupabaseClient, orgId: string, leadIds: string[]) {
  const map = new Map<string, { source: string | null; channel: string | null; canvass_disposition: string | null }>()
  if (leadIds.length === 0) return map

  const { data, error } = await supabase
    .from('leads')
    .select('id, source, channel, canvass_disposition')
    .eq('org_id', orgId)
    .in('id', leadIds)
    .limit(FETCH_LIMIT)

  if (error) throw error
  for (const row of data || []) {
    map.set(row.id, row)
  }
  return map
}

async function resolveLeadIdsFromOpportunities(
  supabase: SupabaseClient,
  orgId: string,
  opportunityIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (opportunityIds.length === 0) return map
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, lead_id')
    .eq('org_id', orgId)
    .in('id', opportunityIds)
    .limit(FETCH_LIMIT)

  if (error) throw error
  for (const row of data || []) {
    map.set(row.id, row.lead_id)
  }
  return map
}

function buildChannelRows(
  sets: { lead_id: string | null; opportunity_id: string | null }[],
  sales: { lead_id: string | null; opportunity_id: string | null; project_cost: number | string | null }[],
  leadMap: Map<string, { source: string | null; channel: string | null; canvass_disposition: string | null }>,
  oppLeadMap: Map<string, string | null>
): ChannelRow[] {
  const channels: GoalChannel[] = ['canvass', 'inside_sales', 'other']
  const rows: ChannelRow[] = channels.map((channel) => ({
    channel,
    label: GOAL_CHANNEL_LABELS[channel],
    sets: 0,
    sales: 0,
    revenue: 0,
  }))

  const index = (channel: GoalChannel) => rows.findIndex((r) => r.channel === channel)

  const leadFor = (leadId: string | null, oppId: string | null) => {
    const resolvedLeadId = leadId || (oppId ? oppLeadMap.get(oppId) || null : null)
    if (!resolvedLeadId) return null
    return leadMap.get(resolvedLeadId) || null
  }

  for (const set of sets) {
    const lead = leadFor(set.lead_id, set.opportunity_id)
    const channel = resolveLeadChannel(lead || {})
    rows[index(channel)].sets += 1
  }

  for (const sale of sales) {
    const lead = leadFor(sale.lead_id, sale.opportunity_id)
    const channel = resolveLeadChannel(lead || {})
    const row = rows[index(channel)]
    row.sales += 1
    row.revenue += Number(sale.project_cost || 0)
  }

  return rows
}

async function fetchMonthlyGoal(
  supabase: SupabaseClient,
  orgId: string,
  month: string
): Promise<OrgMonthlyGoal | null> {
  const { monthStart } = getEasternMonthRange(month)
  const { data, error } = await supabase
    .from('org_monthly_goals')
    .select(
      'id, org_id, month, doors_target, sets_target, sits_target, sales_target, revenue_target, notes, updated_by, updated_at'
    )
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  let updater: OrgMonthlyGoal['updater'] = null
  if (data.updated_by) {
    const { data: userRow } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', data.updated_by)
      .maybeSingle()
    updater = userRow ?? null
  }

  return { ...data, updater } as OrgMonthlyGoal
}

export async function getOrgMonthlyGoal(
  supabase: SupabaseClient,
  orgId: string,
  month: string
): Promise<OrgMonthlyGoal | null> {
  return fetchMonthlyGoal(supabase, orgId, month)
}

export async function buildScorecardPayload(
  supabase: SupabaseClient,
  orgId: string,
  month: string
): Promise<ScorecardPayload> {
  const { startIso, endIso, monthStart } = getEasternMonthRange(month)
  const trailingStart = new Date(new Date(startIso).getTime() - 90 * 86_400_000).toISOString()

  const sitOutcomeIdSet = await loadSitOutcomeSet(supabase, orgId)

  const [doors, sets, sits, contracts, goal, trailingDoors, trailingSets, trailingSits, trailingContracts] =
    await Promise.all([
      countDoorsInPeriod(supabase, orgId, startIso, endIso),
      fetchInspectionSets(supabase, orgId, startIso, endIso),
      sitOutcomeIdSet.size === 0
        ? Promise.resolve([])
        : fetchEffectiveSitOpportunitiesInPeriod(supabase, {
            orgId,
            startIso,
            endIso,
            sitOutcomeIdSet,
          }),
      fetchSignedContracts(supabase, orgId, startIso, endIso),
      fetchMonthlyGoal(supabase, orgId, month),
      countDoorsInPeriod(supabase, orgId, trailingStart, endIso),
      fetchInspectionSets(supabase, orgId, trailingStart, endIso),
      sitOutcomeIdSet.size === 0
        ? Promise.resolve([])
        : fetchEffectiveSitOpportunitiesInPeriod(supabase, {
            orgId,
            startIso: trailingStart,
            endIso,
            sitOutcomeIdSet,
          }),
      fetchSignedContracts(supabase, orgId, trailingStart, endIso),
    ])

  const revenueSigned = contracts.reduce((sum, c) => sum + Number(c.project_cost || 0), 0)

  const monthEndDate = new Date(endIso)
  monthEndDate.setUTCDate(monthEndDate.getUTCDate() - 1)
  const monthEndStr = monthEndDate.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE })
  const revenueCollected = await fetchCollectedPayments(supabase, orgId, monthStart, monthEndStr)

  const { data: monthJobs, error: jobsErr } = await supabase
    .from('production_jobs')
    .select(
      'id, sale_amount, sale_date, created_at, labor_cost, material_cost, dealer_fee_amount, commission_comp_base, commission_pre_tax_subtotal'
    )
    .eq('org_id', orgId)
    .gte('sale_date', monthStart)
    .lte('sale_date', monthEndStr)
    .limit(FETCH_LIMIT)

  if (jobsErr) throw jobsErr

  const fallbackJobsQuery = await supabase
    .from('production_jobs')
    .select(
      'id, sale_amount, sale_date, created_at, labor_cost, material_cost, dealer_fee_amount, commission_comp_base, commission_pre_tax_subtotal'
    )
    .eq('org_id', orgId)
    .is('sale_date', null)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .limit(FETCH_LIMIT)

  if (fallbackJobsQuery.error) throw fallbackJobsQuery.error

  const jobs = [
    ...((monthJobs || []) as JobEconomicsRow[]),
    ...((fallbackJobsQuery.data || []) as JobEconomicsRow[]),
  ]

  const jobIds = jobs.map((j) => j.id)
  const costLinesByJob = new Map<string, JobCostLineRow[]>()
  if (jobIds.length > 0) {
    const { data: costLines, error: costErr } = await supabase
      .from('job_cost_lines')
      .select('job_id, amount, cost_type')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .in('job_id', jobIds)
      .limit(FETCH_LIMIT)

    if (costErr) throw costErr
    for (const line of (costLines || []) as JobCostLineRow[]) {
      const existing = costLinesByJob.get(line.job_id) || []
      existing.push(line)
      costLinesByJob.set(line.job_id, existing)
    }
  }

  const economics = summarizeJobEconomics(jobs, costLinesByJob)

  const leadIds = new Set<string>()
  for (const set of sets) if (set.lead_id) leadIds.add(set.lead_id)
  for (const c of contracts) if (c.lead_id) leadIds.add(c.lead_id)

  const oppIds = new Set<string>()
  for (const set of sets) if (set.opportunity_id) oppIds.add(set.opportunity_id)
  for (const c of contracts) if (c.opportunity_id) oppIds.add(c.opportunity_id)

  const [leadMap, oppLeadMap] = await Promise.all([
    fetchLeadMap(supabase, orgId, Array.from(leadIds)),
    resolveLeadIdsFromOpportunities(supabase, orgId, Array.from(oppIds)),
  ])

  const funnel: FunnelStage[] = [
    {
      key: 'doors',
      label: 'Doors',
      value: doors,
      conversionFromPrevious: null,
      trailing90Conversion: null,
    },
    {
      key: 'sets',
      label: 'Sets',
      value: sets.length,
      conversionFromPrevious: doors > 0 ? sets.length / doors : null,
      trailing90Conversion: trailingDoors > 0 ? trailingSets.length / trailingDoors : null,
    },
    {
      key: 'sits',
      label: 'Sits',
      value: sits.length,
      conversionFromPrevious: sets.length > 0 ? sits.length / sets.length : null,
      trailing90Conversion: trailingSets.length > 0 ? trailingSits.length / trailingSets.length : null,
    },
    {
      key: 'sales',
      label: 'Sales',
      value: contracts.length,
      conversionFromPrevious: sits.length > 0 ? contracts.length / sits.length : null,
      trailing90Conversion: trailingSits.length > 0 ? trailingContracts.length / trailingSits.length : null,
    },
  ]

  const kpis: ScorecardKpi[] = [
    {
      key: 'doors',
      label: 'Doors',
      value: doors,
      goal: goal?.doors_target ?? null,
      attainmentPct: attainmentPct(doors, goal?.doors_target ?? null),
      format: 'integer',
    },
    {
      key: 'sets',
      label: 'Sets',
      value: sets.length,
      goal: goal?.sets_target ?? null,
      attainmentPct: attainmentPct(sets.length, goal?.sets_target ?? null),
      format: 'integer',
    },
    {
      key: 'sits',
      label: 'Sits',
      value: sits.length,
      goal: goal?.sits_target ?? null,
      attainmentPct: attainmentPct(sits.length, goal?.sits_target ?? null),
      format: 'integer',
    },
    {
      key: 'sales',
      label: 'Sales',
      value: contracts.length,
      goal: goal?.sales_target ?? null,
      attainmentPct: attainmentPct(contracts.length, goal?.sales_target ?? null),
      format: 'integer',
    },
    {
      key: 'revenueSigned',
      label: 'Revenue (signed)',
      value: revenueSigned,
      goal: goal?.revenue_target != null ? Number(goal.revenue_target) : null,
      attainmentPct: attainmentPct(revenueSigned, goal?.revenue_target != null ? Number(goal.revenue_target) : null),
      format: 'currency',
    },
    {
      key: 'revenueCollected',
      label: 'Revenue (collected)',
      value: revenueCollected,
      goal: null,
      attainmentPct: null,
      format: 'currency',
    },
    {
      key: 'costs',
      label: 'Costs',
      value: economics.totalCosts,
      goal: null,
      attainmentPct: null,
      format: 'currency',
    },
    {
      key: 'netProfit',
      label: 'Net profit',
      value: economics.netProfit,
      goal: null,
      attainmentPct: null,
      format: 'currency',
    },
  ]

  return {
    month: monthStart.slice(0, 7),
    timezone: GOALS_TIMEZONE,
    kpis,
    funnel,
    channels: buildChannelRows(sets, contracts, leadMap, oppLeadMap),
    channelFootnote: GOAL_CHANNEL_ATTRIBUTION_FOOTNOTE,
    dataQuality: {
      jobsMissingCostData: economics.jobsMissingCostData,
      jobsInMonth: economics.jobsInMonth,
    },
    goal,
  }
}

export async function upsertOrgMonthlyGoal(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: {
    month: string
    doors_target?: number | null
    sets_target?: number | null
    sits_target?: number | null
    sales_target?: number | null
    revenue_target?: number | null
    notes?: string | null
  }
): Promise<OrgMonthlyGoal> {
  const { monthStart } = getEasternMonthRange(input.month)

  const { data: existing } = await supabase
    .from('org_monthly_goals')
    .select('*')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()

  const payload = {
    org_id: orgId,
    month: monthStart,
    doors_target: input.doors_target ?? null,
    sets_target: input.sets_target ?? null,
    sits_target: input.sits_target ?? null,
    sales_target: input.sales_target ?? null,
    revenue_target: input.revenue_target ?? null,
    notes: input.notes ?? null,
    updated_by: userId,
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {}
  if (existing) {
    for (const key of [
      'doors_target',
      'sets_target',
      'sits_target',
      'sales_target',
      'revenue_target',
      'notes',
    ] as const) {
      if (existing[key] !== payload[key]) {
        changes[key] = { old: existing[key], new: payload[key] }
      }
    }
  } else {
    changes.created = { old: null, new: payload }
  }

  const { data: saved, error } = await supabase
    .from('org_monthly_goals')
    .upsert(payload, { onConflict: 'org_id,month' })
    .select('*')
    .single()

  if (error) throw error

  if (Object.keys(changes).length > 0) {
    await supabase.from('org_monthly_goal_audit').insert({
      goal_id: saved.id,
      org_id: orgId,
      changed_by: userId,
      changes,
    })
  }

  const full = await fetchMonthlyGoal(supabase, orgId, input.month)
  if (!full) throw new Error('Goal save succeeded but reload failed')
  return full
}

async function buildForecastHistory(
  supabase: SupabaseClient,
  orgId: string,
  historyStartIso: string,
  historyEndIso: string,
  sitOutcomeIdSet: Set<string>
): Promise<ForecastHistory> {
  const [doorLeads, sets, sits, contracts] = await Promise.all([
    supabase
      .from('leads')
      .select('created_at, source, canvass_disposition')
      .eq('org_id', orgId)
      .gte('created_at', historyStartIso)
      .lt('created_at', historyEndIso)
      .limit(FETCH_LIMIT),
    fetchInspectionSets(supabase, orgId, historyStartIso, historyEndIso),
    sitOutcomeIdSet.size === 0
      ? Promise.resolve([])
      : fetchEffectiveSitOpportunitiesInPeriod(supabase, {
          orgId,
          startIso: historyStartIso,
          endIso: historyEndIso,
          sitOutcomeIdSet,
        }),
    fetchSignedContracts(supabase, orgId, historyStartIso, historyEndIso),
  ])

  if (doorLeads.error) throw doorLeads.error

  const doors = (doorLeads.data || [])
    .filter((row) => isCanvassDoorLead(row))
    .map((row) => row.created_at as string)

  const sales = contracts.map((c) => ({
    signedAt: c.customer_signed_at as string,
    projectCost: Number(c.project_cost || 0),
  }))

  const oppIds = contracts.map((c) => c.opportunity_id).filter(Boolean) as string[]
  const setRows = await supabase
    .from('scheduled_appointments')
    .select('scheduled_for, opportunity_id, lead_id, appointment_type, status')
    .eq('org_id', orgId)
    .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
    .gte('scheduled_for', historyStartIso)
    .lt('scheduled_for', historyEndIso)
    .limit(FETCH_LIMIT)

  if (setRows.error) throw setRows.error

  const setToSalePairs: { setAt: string; signedAt: string }[] = []
  const setsByOpp = new Map<string, string>()
  for (const row of (setRows.data || []).filter(countsAsInspectionSet)) {
    if (row.opportunity_id) {
      const existing = setsByOpp.get(row.opportunity_id)
      if (!existing || row.scheduled_for < existing) {
        setsByOpp.set(row.opportunity_id, row.scheduled_for)
      }
    }
  }
  for (const contract of contracts) {
    if (!contract.opportunity_id || !contract.customer_signed_at) continue
    const setAt = setsByOpp.get(contract.opportunity_id)
    if (setAt) {
      setToSalePairs.push({ setAt, signedAt: contract.customer_signed_at })
    }
  }

  const historyStartDate = historyStartIso.slice(0, 10)
  const historyEndDate = new Date(historyEndIso)
  historyEndDate.setUTCDate(historyEndDate.getUTCDate() - 1)
  const endDateStr = historyEndDate.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE })

  const { data: jobs } = await supabase
    .from('production_jobs')
    .select('id')
    .eq('org_id', orgId)
    .limit(FETCH_LIMIT)

  const jobIds = (jobs || []).map((j) => j.id)
  let payments: { paidAt: string; amount: number }[] = []
  if (jobIds.length > 0) {
    const { data: paymentRows, error: payErr } = await supabase
      .from('job_payments')
      .select('paid_at, amount_cents')
      .in('job_id', jobIds)
      .gte('paid_at', historyStartDate)
      .lte('paid_at', endDateStr)
      .limit(FETCH_LIMIT)

    if (payErr) throw payErr
    payments = (paymentRows || []).map((p) => ({
      paidAt: `${p.paid_at}T12:00:00.000Z`,
      amount: (p.amount_cents || 0) / 100,
    }))
  }

  return {
    doors,
    sets: sets.map((s) => s.scheduled_for),
    sits: sits.map((s) => s.inspection_outcome_at),
    sales,
    payments,
    setToSalePairs,
  }
}

function goalsFromOrgGoal(goal: OrgMonthlyGoal | null): ForecastGoals {
  if (!goal) return {}
  return {
    doors: goal.doors_target,
    sets: goal.sets_target,
    sits: goal.sits_target,
    sales: goal.sales_target,
    revenueSigned: goal.revenue_target != null ? Number(goal.revenue_target) : null,
  }
}

export async function buildForecastPayload(
  supabase: SupabaseClient,
  orgId: string,
  params: {
    start: string
    end: string
    compareStart?: string | null
    compareEnd?: string | null
  }
): Promise<{
  forecast: ForecastResult
  compare?: ForecastResult
  deltas?: Record<string, number | null>
}> {
  const { startIso, endIso } = getEasternDateRange(params.start, params.end)
  const asOf = new Date()
  const sitOutcomeIdSet = await loadSitOutcomeSet(supabase, orgId)

  const historyStart = new Date(asOf.getTime() - 365 * 86_400_000).toISOString()
  const history = await buildForecastHistory(supabase, orgId, historyStart, endIso, sitOutcomeIdSet)

  const knownFutureRes = await supabase
    .from('scheduled_appointments')
    .select('scheduled_for, appointment_type, status')
    .eq('org_id', orgId)
    .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
    .gte('scheduled_for', asOf.toISOString())
    .lt('scheduled_for', endIso)
    .limit(FETCH_LIMIT)

  if (knownFutureRes.error) throw knownFutureRes.error
  const knownFutureSets = (knownFutureRes.data || [])
    .filter(countsAsInspectionSet)
    .map((r) => r.scheduled_for)

  const monthGoal = await fetchMonthlyGoal(supabase, orgId, params.start.slice(0, 7))
  const goals = goalsFromOrgGoal(monthGoal)

  if (params.compareStart && params.compareEnd) {
    const rangeA = {
      start: new Date(startIso),
      end: new Date(endIso),
    }
    const compareRange = getEasternDateRange(params.compareStart, params.compareEnd)
    const rangeB = {
      start: new Date(compareRange.startIso),
      end: new Date(compareRange.endIso),
    }
    const compared = computeQuarterCompare(rangeA, rangeB, asOf, history, knownFutureSets, goals)
    return { forecast: compared.primary, compare: compared.compare, deltas: compared.deltas }
  }

  const forecast = computeForecast({
    rangeStart: new Date(startIso),
    rangeEnd: new Date(endIso),
    asOf,
    history,
    knownFutureSets,
    goals,
  })

  return { forecast }
}

export function getForecastPresetRange(
  preset: 'mtd' | 'this_quarter' | 'last_vs_this_quarter',
  today = getEasternTodayIso()
): { start: string; end: string; compareStart?: string; compareEnd?: string } {
  if (preset === 'mtd') {
    const monthStart = today.slice(0, 7) + '-01'
    const monthRange = getDateRangeForTimeFrame('month', GOALS_TIMEZONE)
    const endDate = new Date(monthRange.end.getTime() - 86_400_000)
    return { start: monthStart, end: endDate.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE }) }
  }
  if (preset === 'this_quarter') {
    const q = getDateRangeForTimeFrame('quarter', GOALS_TIMEZONE)
    const endDate = new Date(q.end.getTime() - 86_400_000)
    return {
      start: q.start.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE }),
      end: endDate.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE }),
    }
  }

  const thisQ = getDateRangeForTimeFrame('quarter', GOALS_TIMEZONE)
  const lastQEnd = new Date(thisQ.start.getTime())
  const lastQStart = new Date(thisQ.start.getTime() - 90 * 86_400_000)
  return {
    start: thisQ.start.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE }),
    end: new Date(thisQ.end.getTime() - 86_400_000).toLocaleDateString('en-CA', {
      timeZone: GOALS_TIMEZONE,
    }),
    compareStart: lastQStart.toLocaleDateString('en-CA', { timeZone: GOALS_TIMEZONE }),
    compareEnd: new Date(lastQEnd.getTime() - 86_400_000).toLocaleDateString('en-CA', {
      timeZone: GOALS_TIMEZONE,
    }),
  }
}
