import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessReportsFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

// Stage-based probability weights for insurance jobs
const INSURANCE_STAGE_PROBABILITY: Record<string, number> = {
  contingency_signed:    0.35,
  claim_filed:           0.50,
  claim_approved:        0.88,
  acv_received:          0.95,
  job_complete:          0.95,
  depreciation_filed:    0.82,
  depreciation_received: 1.00,
  supplements_filed:     0.55,
  fully_collected:       1.00,
}

// Retail pipeline stage probability (based on opportunity stage)
const RETAIL_STAGE_PROBABILITY: Record<string, number> = {
  scheduled_inspection: 0.20,  // appointment set, not yet ran
  inspection_ran:       0.35,  // ran but no outcome yet
  contract_sent:        0.65,  // contract out for signature
  won:                  0.95,  // signed — nearly locked
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    contingency_signed:    'Contingency signed',
    claim_filed:           'Claim filed',
    claim_approved:        'Claim approved',
    acv_received:          'ACV received',
    job_complete:          'Job complete',
    depreciation_filed:    'Depreciation filed',
    depreciation_received: 'Depreciation received',
    supplements_filed:     'Supplements filed',
    fully_collected:       'Fully collected',
  }
  return labels[stage] || stage
}

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const reportPermissions = await resolveEffectivePermissionNames(supabase, profile.id, profile)
    if (!canAccessReportsFromPermissionNames(reportPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }


    const period = request.nextUrl.searchParams.get('period') || 'quarter' // month | quarter | year

    // Date range for the selected period
    const now = new Date()
    let periodStart: Date
    let periodEnd: Date
    let periodLabel: string

    if (period === 'month') {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      periodLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    } else if (period === 'year') {
      periodStart = new Date(now.getFullYear(), 0, 1)
      periodEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
      periodLabel = String(now.getFullYear())
    } else {
      // quarter
      const q = Math.floor(now.getMonth() / 3)
      periodStart = new Date(now.getFullYear(), q * 3, 1)
      periodEnd = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999)
      const qLabel = `Q${q + 1} ${now.getFullYear()}`
      periodLabel = qLabel
    }

    // ── Avg deal value from last 90 days of closed sales ──────────────────────
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    const { data: recentSales } = await supabase
      .from('production_jobs')
      .select('sale_amount')
      .eq('org_id', profile.org_id)
      .not('sale_amount', 'is', null)
      .gte('sale_date', ninetyDaysAgo.toISOString().split('T')[0])
      .gt('sale_amount', 0)

    const salesWithAmount = (recentSales || []).filter(j => j.sale_amount && j.sale_amount > 0)
    let avgDealValue = 0
    let avgDealBasis = '0 sales'

    if (salesWithAmount.length >= 5) {
      avgDealValue = salesWithAmount.reduce((s, j) => s + (j.sale_amount || 0), 0) / salesWithAmount.length
      avgDealBasis = `${salesWithAmount.length} sales (last 90 days)`
    } else {
      // Fall back to all-time
      const { data: allSales } = await supabase
        .from('production_jobs')
        .select('sale_amount')
        .eq('org_id', profile.org_id)
        .not('sale_amount', 'is', null)
        .gt('sale_amount', 0)
      const allWithAmount = (allSales || []).filter(j => j.sale_amount && j.sale_amount > 0)
      if (allWithAmount.length > 0) {
        avgDealValue = allWithAmount.reduce((s, j) => s + (j.sale_amount || 0), 0) / allWithAmount.length
        avgDealBasis = `${allWithAmount.length} sales (all time)`
      }
    }

    // ── Org revenue goal from settings ────────────────────────────────────────
    const { data: org } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const revenueGoals = org?.settings?.revenue_goals || {}
    const periodGoal: number | null = revenueGoals[period] ?? null

    // ── Retail pipeline ───────────────────────────────────────────────────────
    // Upcoming inspections (scheduled appointments not yet ran)
    const { data: upcomingAppts } = await supabase
      .from('scheduled_appointments')
      .select('id, closer_user_id, opportunity_id')
      .eq('org_id', profile.org_id)
      .gte('scheduled_for', now.toISOString())
      .lte('scheduled_for', periodEnd.toISOString())

    const upcomingOpportunityIds = (upcomingAppts || [])
      .map((appt) => appt.opportunity_id)
      .filter(Boolean) as string[]
    const { data: upcomingOpportunitySources } = upcomingOpportunityIds.length > 0
      ? await supabase
          .from('opportunities')
          .select('id, job_source')
          .in('id', upcomingOpportunityIds)
      : { data: [] as { id: string; job_source: string | null }[] }
    const insuranceUpcomingOpportunityIds = new Set(
      (upcomingOpportunitySources || [])
        .filter((opp) => opp.job_source === 'insurance')
        .map((opp) => opp.id)
    )
    const retailUpcomingAppts = (upcomingAppts || []).filter((appt) =>
      !appt.opportunity_id || !insuranceUpcomingOpportunityIds.has(appt.opportunity_id)
    )

    // Opportunities ran but no outcome yet (in progress)
    const { data: ranPending } = await supabase
      .from('opportunities')
      .select('id, owner_user_id, job_source')
      .eq('org_id', profile.org_id)
      .eq('status', 'in_progress')
      .is('inspection_outcome', null)

    // Contracts out for signature: project has contract_sent_at; opportunity still open/in_progress
    // (opportunity.status has no contract_sent enum — see 011_opportunities_projects.sql)
    const { data: contractProjectRows } = await supabase
      .from('projects')
      .select('id, opportunities!opportunity_id(status, job_source)')
      .eq('org_id', profile.org_id)
      .not('contract_sent_at', 'is', null)

    const contractsSentList = (contractProjectRows || []).filter((row: {
      opportunities?: { status?: string; job_source?: string | null } | { status?: string; job_source?: string | null }[] | null
    }) => {
      const opp = row.opportunities
      const st = Array.isArray(opp) ? opp[0]?.status : opp?.status
      const source = Array.isArray(opp) ? opp[0]?.job_source : opp?.job_source
      return (st === 'open' || st === 'in_progress') && source !== 'insurance'
    })

    // Won in this period (locked retail revenue)
    const { data: wonInPeriod } = await supabase
      .from('production_jobs')
      .select('id, sale_amount')
      .eq('org_id', profile.org_id)
      .in('status', ['sold', 'materials', 'scheduled', 'in_progress', 'complete'])
      .eq('job_source', 'retail')
      .gte('sale_date', periodStart.toISOString().split('T')[0])
      .lte('sale_date', periodEnd.toISOString().split('T')[0])

    const lockedRetail = (wonInPeriod || []).reduce((s, j) => s + (j.sale_amount || avgDealValue), 0)
    const contractSentExpected = contractsSentList.length * avgDealValue * RETAIL_STAGE_PROBABILITY.contract_sent
    const retailRanPending = (ranPending || []).filter((opp) => opp.job_source !== 'insurance')
    const inspectionRanExpected = retailRanPending.length * avgDealValue * RETAIL_STAGE_PROBABILITY.inspection_ran
    const upcomingExpected = retailUpcomingAppts.length * avgDealValue * RETAIL_STAGE_PROBABILITY.scheduled_inspection

    const retailPipeline = [
      { stage: 'Signed / active jobs', count: wonInPeriod?.length || 0, expectedRevenue: lockedRetail, probability: 95, locked: true },
      { stage: 'Contract sent', count: contractsSentList.length, expectedRevenue: contractSentExpected, probability: 65 },
      { stage: 'Inspection ran, pending', count: retailRanPending.length, expectedRevenue: inspectionRanExpected, probability: 35 },
      { stage: 'Inspection scheduled', count: retailUpcomingAppts.length, expectedRevenue: upcomingExpected, probability: 20 },
    ]

    const retailTotal = retailPipeline.reduce((s, r) => s + r.expectedRevenue, 0)

    // ── Insurance pipeline ────────────────────────────────────────────────────
    const { data: insuranceJobs } = await supabase
      .from('production_jobs')
      .select('id, project_id, insurance_stage, acv_amount, depreciation_amount, supplement_amount, sale_amount, status')
      .eq('org_id', profile.org_id)
      .eq('job_source', 'insurance')
      .not('status', 'in', '("collected")')

    const insuranceJobProjectIds = (insuranceJobs || [])
      .map((job) => job.project_id)
      .filter(Boolean) as string[]
    const { data: insuranceJobProjects } = insuranceJobProjectIds.length > 0
      ? await supabase
          .from('projects')
          .select('id, opportunity_id')
          .in('id', insuranceJobProjectIds)
      : { data: [] as { id: string; opportunity_id: string | null }[] }
    const opportunityIdsWithInsuranceJobs = new Set(
      (insuranceJobProjects || [])
        .map((project) => project.opportunity_id)
        .filter(Boolean)
    )

    const { data: insuranceOpportunities } = await supabase
      .from('opportunities')
      .select('id, insurance_stage, estimated_value, status')
      .eq('org_id', profile.org_id)
      .eq('job_source', 'insurance')
      .in('status', ['open', 'in_progress', 'won'])

    // Group by stage and calculate expected revenue per stage
    const insuranceByStage = new Map<string, { count: number; expectedRevenue: number; lockedRevenue: number }>()

    for (const opp of insuranceOpportunities || []) {
      if (opportunityIdsWithInsuranceJobs.has(opp.id)) continue

      const stage = opp.insurance_stage || 'contingency_signed'
      const prob = INSURANCE_STAGE_PROBABILITY[stage] ?? 0.35
      const jobValue = (opp.estimated_value && opp.estimated_value > 0) ? opp.estimated_value : avgDealValue

      if (!insuranceByStage.has(stage)) {
        insuranceByStage.set(stage, { count: 0, expectedRevenue: 0, lockedRevenue: 0 })
      }
      const entry = insuranceByStage.get(stage)!
      entry.count++
      entry.expectedRevenue += jobValue * prob
    }

    for (const job of insuranceJobs || []) {
      const stage = job.insurance_stage || 'contingency_signed'
      const prob = INSURANCE_STAGE_PROBABILITY[stage] ?? 0.35

      // Total expected value for this job
      const totalExpected = (job.acv_amount || 0) + (job.depreciation_amount || 0) + (job.supplement_amount || 0)
      const jobValue = totalExpected > 0 ? totalExpected : (job.sale_amount || avgDealValue)

      // Locked = ACV received stages
      const acvLocked = ['acv_received', 'job_complete', 'depreciation_filed', 'depreciation_received', 'supplements_filed', 'fully_collected'].includes(stage)
      const lockedAmount = acvLocked ? (job.acv_amount || 0) : 0

      // Pending = remaining revenue × probability
      const pendingAmount = acvLocked
        ? ((job.depreciation_amount || 0) + (job.supplement_amount || 0)) * prob
        : jobValue * prob

      if (!insuranceByStage.has(stage)) {
        insuranceByStage.set(stage, { count: 0, expectedRevenue: 0, lockedRevenue: 0 })
      }
      const entry = insuranceByStage.get(stage)!
      entry.count++
      entry.expectedRevenue += lockedAmount + pendingAmount
      entry.lockedRevenue += lockedAmount
    }

    // Sort by stage progression order
    const stageOrder = Object.keys(INSURANCE_STAGE_PROBABILITY)
    const insurancePipeline = stageOrder
      .filter(s => insuranceByStage.has(s))
      .map(s => ({
        stage: stageLabel(s),
        stageKey: s,
        count: insuranceByStage.get(s)!.count,
        expectedRevenue: insuranceByStage.get(s)!.expectedRevenue,
        lockedRevenue: insuranceByStage.get(s)!.lockedRevenue,
        probability: Math.round((INSURANCE_STAGE_PROBABILITY[s] || 0) * 100),
      }))

    const insuranceTotal = insurancePipeline.reduce((s, r) => s + r.expectedRevenue, 0)
    const insuranceLocked = insurancePipeline.reduce((s, r) => s + r.lockedRevenue, 0)

    const totalForecast = retailTotal + insuranceTotal
    const totalLocked = lockedRetail + insuranceLocked

    return NextResponse.json({
      period,
      periodLabel,
      periodGoal,
      totalForecast: Math.round(totalForecast),
      totalLocked: Math.round(totalLocked),
      retailTotal: Math.round(retailTotal),
      insuranceTotal: Math.round(insuranceTotal),
      retailPipeline,
      insurancePipeline,
      avgDealValue: Math.round(avgDealValue),
      avgDealBasis,
    })
  } catch (error) {
    console.error('[reports/forecast]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — save revenue goal to org settings
export async function PATCH(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    if (!['admin', 'owner', 'sales_manager', 'regional_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const period = body?.period as string
    const goal = body?.goal

    if (!['month', 'quarter', 'year'].includes(period)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }
    const goalNum = Number(goal)
    if (!Number.isFinite(goalNum) || goalNum < 0) {
      return NextResponse.json({ error: 'Invalid goal' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: org } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const currentSettings = org?.settings || {}
    const currentGoals = currentSettings.revenue_goals || {}

    const { error: updateError } = await supabase
      .from('orgs')
      .update({
        settings: {
          ...currentSettings,
          revenue_goals: { ...currentGoals, [period]: goalNum },
        },
      })
      .eq('id', profile.org_id)

    if (updateError) {
      console.error('[reports/forecast PATCH]', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[reports/forecast PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
