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
  type GoalCoverage,
} from '@/lib/goals-forecast'
import {
  summarizeJobEconomics,
  type JobCostLineRow,
  type JobEconomicsRow,
} from '@/lib/goals-job-economics'
import {
  countInclusiveDays,
  getEasternDateRange,
  getEasternMonthEndDate,
  getEasternMonthRange,
  GOALS_TIMEZONE,
  listGoalMonthsInRange,
} from '@/lib/goals-period'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { countsAsInspectionSet, INSPECTION_SET_APPOINTMENT_TYPE_OR } from '@/lib/inspection-set-metrics'
import { isCanvassDoorLead, SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { fetchSupabaseAllPages } from '@/lib/supabase-fetch-all-pages'

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

/**
 * Exact org-wide door count via the same RPC the Dashboard uses — a plain
 * `.select().limit(FETCH_LIMIT)` fetch silently truncates once an org's monthly
 * lead volume exceeds 1000 rows (confirmed: June 2026 had 2682 leads, undercounting
 * the Scorecard's doors tile at 995 vs. the Dashboard's correct 2669).
 */
async function countDoorsInPeriod(
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

/** Paginated fetch of door-lead rows for forecast history — a period this long can exceed 1000 rows. */
async function fetchAllDoorLeadRows(
  supabase: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<{ created_at: string; source: string | null; canvass_disposition: string | null }[]> {
  return fetchSupabaseAllPages<{ created_at: string; source: string | null; canvass_disposition: string | null }>(
    async (from, to) =>
      supabase
        .from('leads')
        .select('created_at, source, canvass_disposition')
        .eq('org_id', orgId)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        // id tiebreaker: created_at alone isn't unique (e.g. a csv_import batch), so ties need a
        // stable secondary sort or a batch straddling a page boundary can be split inconsistently.
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
  )
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
    .select('id, opportunity_id, customer_signed_at, project_cost, agreement_type, status')
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
  // order_form_contracts has no lead_id column — resolved via opportunity_id only.
  sales: { opportunity_id: string | null; project_cost: number | string | null }[],
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
    const lead = leadFor(null, sale.opportunity_id)
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
  // order_form_contracts has no lead_id column — sales resolve to a lead only via opportunity_id below.

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
  const [doorLeadRows, setRows, sitRows, contracts] = await Promise.all([
    fetchAllDoorLeadRows(supabase, orgId, historyStartIso, historyEndIso),
    fetchSupabaseAllPages<{
      id: string
      scheduled_for: string
      opportunity_id: string | null
      lead_id: string | null
      appointment_type: string | null
      status: string | null
    }>(async (from, to) =>
      supabase
        .from('scheduled_appointments')
        .select('id, scheduled_for, opportunity_id, lead_id, appointment_type, status')
        .eq('org_id', orgId)
        .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
        .gte('scheduled_for', historyStartIso)
        .lt('scheduled_for', historyEndIso)
        .order('scheduled_for', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    ),
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

  const doors = doorLeadRows.filter((row) => isCanvassDoorLead(row)).map((row) => row.created_at)

  // Conversion rates join on the pipeline record, so every stage has to carry its
  // opportunity/lead ids through — see computeSetToSitRate / computeSitToSaleRate.
  const sets = setRows.filter(countsAsInspectionSet).map((row) => ({
    at: row.scheduled_for,
    opportunityId: row.opportunity_id,
    leadId: row.lead_id,
  }))

  const sits = sitRows.map((row) => ({
    at: row.inspection_outcome_at,
    opportunityId: row.id,
    leadId: row.lead_id,
  }))

  const sales = contracts.map((c) => ({
    signedAt: c.customer_signed_at as string,
    projectCost: Number(c.project_cost || 0),
    opportunityId: c.opportunity_id,
  }))

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

  return { doors, sets, sits, sales, payments }
}

/**
 * Goals live on `org_monthly_goals` one row per calendar month, but a forecast range
 * can cover several months (a quarter) or part of one (a custom range). Sum each
 * overlapping month's target, prorated by the share of that month's days the range
 * actually covers, so the Goal column always describes the range on screen.
 */
async function fetchGoalsForRange(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string
): Promise<{ goals: ForecastGoals; coverage: GoalCoverage }> {
  const months = listGoalMonthsInRange(startDate, endDate)
  const totals = { doors: 0, sets: 0, sits: 0, sales: 0, revenueSigned: 0 }
  const monthsMissingGoal: string[] = []
  let prorated = false
  let anyTarget = false

  // One query for every month in the range. `fetchMonthlyGoal` is the single-month
  // editor path — it also joins `users` for the "last updated by" line, which none
  // of the target arithmetic below reads.
  const { data: goalRows, error } = await supabase
    .from('org_monthly_goals')
    .select('month, doors_target, sets_target, sits_target, sales_target, revenue_target')
    .eq('org_id', orgId)
    .in(
      'month',
      months.map((m) => `${m}-01`)
    )

  if (error) throw error

  const goalByMonth = new Map<string, (typeof goalRows)[number]>()
  for (const row of goalRows || []) goalByMonth.set(String(row.month).slice(0, 7), row)

  for (const month of months) {
    const goal = goalByMonth.get(month)
    if (!goal) {
      monthsMissingGoal.push(month)
      continue
    }

    const monthStartDate = `${month}-01`
    const monthEndDate = getEasternMonthEndDate(month)
    const daysInMonth = countInclusiveDays(monthStartDate, monthEndDate)
    const overlapStart = monthStartDate > startDate ? monthStartDate : startDate
    const overlapEnd = monthEndDate < endDate ? monthEndDate : endDate
    const overlapDays = countInclusiveDays(overlapStart, overlapEnd)
    if (overlapDays <= 0 || daysInMonth <= 0) continue

    const factor = overlapDays / daysInMonth
    if (factor < 1) prorated = true

    for (const [key, target] of [
      ['doors', goal.doors_target],
      ['sets', goal.sets_target],
      ['sits', goal.sits_target],
      ['sales', goal.sales_target],
      ['revenueSigned', goal.revenue_target],
    ] as const) {
      if (target == null) continue
      anyTarget = true
      totals[key] += Number(target) * factor
    }
  }

  const goals: ForecastGoals = anyTarget
    ? {
        doors: totals.doors || null,
        sets: totals.sets || null,
        sits: totals.sits || null,
        sales: totals.sales || null,
        revenueSigned: totals.revenueSigned || null,
      }
    : {}

  return {
    goals,
    coverage: { months, monthsMissingGoal, prorated },
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
  const hasCompare = Boolean(params.compareStart && params.compareEnd)

  const historyStart = new Date(asOf.getTime() - 365 * 86_400_000).toISOString()

  // Only the history fetch needs `sitOutcomeIdSet`; the rest are independent.
  const [history, knownFutureRes, primaryGoals, compareGoals] = await Promise.all([
    buildForecastHistory(supabase, orgId, historyStart, endIso, sitOutcomeIdSet),
    supabase
      .from('scheduled_appointments')
      .select('scheduled_for, appointment_type, status')
      .eq('org_id', orgId)
      .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
      .gte('scheduled_for', asOf.toISOString())
      .lt('scheduled_for', endIso)
      .limit(FETCH_LIMIT),
    fetchGoalsForRange(supabase, orgId, params.start, params.end),
    hasCompare
      ? fetchGoalsForRange(supabase, orgId, params.compareStart!, params.compareEnd!)
      : Promise.resolve(null),
  ])

  if (knownFutureRes.error) throw knownFutureRes.error
  const knownFutureSets = (knownFutureRes.data || [])
    .filter(countsAsInspectionSet)
    .map((r) => r.scheduled_for)

  const rangeA = { start: new Date(startIso), end: new Date(endIso) }

  if (hasCompare && compareGoals) {
    const compareRange = getEasternDateRange(params.compareStart!, params.compareEnd!)
    const compared = computeQuarterCompare({
      rangeA,
      rangeB: { start: new Date(compareRange.startIso), end: new Date(compareRange.endIso) },
      asOf,
      history,
      knownFutureSets,
      primary: primaryGoals,
      compare: compareGoals,
    })
    return { forecast: compared.primary, compare: compared.compare, deltas: compared.deltas }
  }

  const forecast = computeForecast({
    rangeStart: rangeA.start,
    rangeEnd: rangeA.end,
    asOf,
    history,
    knownFutureSets,
    goals: primaryGoals.goals,
    goalCoverage: primaryGoals.coverage,
  })

  return { forecast }
}
