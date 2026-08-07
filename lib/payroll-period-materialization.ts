import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { roundMoney } from '@/lib/money'
import {
  buildAdditiveParticipantsForJob,
  loadDerivedCommissionContext,
} from '@/lib/job-derived-commission-lines'
import {
  buildMonthlyTierMetricMaps,
  buildMonthlyVolumeMaps,
  collectParticipants,
  computeRawCommissionForParticipant,
  loadActiveCompPlanForUser,
  loadAdditiveDealCommissionParticipants,
  monthKeyFromSaleDate,
  periodSitsAndCloseRateForParticipant,
  poolKey,
  resolveAdditiveParticipantAmount,
  scaleCommissionsToPool,
} from '@/lib/payroll-export'

type PeriodRow = {
  id: string
  cutoff_at: string
  scheduled_pay_date: string
  status: string
}

type JobRow = {
  id: string
  job_number: string
  status: string
  sale_date: string | null
  sale_amount: number | null
  commission_comp_base: number | null
  commission_pre_tax_subtotal: number | null
  dealer_fee_amount: number | null
  salesperson_id: string | null
  project_id: string | null
  completed_at: string | null
  allow_close_with_balance: boolean | null
}

type JobStateRow = {
  job_id: string
  install_completed_at: string | null
  fully_funded_at: string | null
  costs_ready_at: string | null
}

type PaymentRow = {
  job_id: string
  amount_cents: number
  funding_status: string
  paid_at: string | null
  created_at: string
}

type CostRow = {
  job_id: string
  amount: number
  approved: boolean
  deduct_from_commission_base: boolean
  created_at: string
  updated_at: string
}

export type MaterializePayrollPeriodResult = {
  periodId: string
  eligibleJobs: number
  snapshotsCreated: number
  payoutLinesCreated: number
  skippedJobs: Array<{ jobId: string; reason: string }>
  /**
   * Jobs flagged self-generated that ALSO carry a separate setter. The derived 6%
   * self-gen line was suppressed on these (paying both would stack past the 18% pool
   * cap and scale every other line down); a human must fix the attribution.
   */
  selfGenSetterConflictJobIds: string[]
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((v): v is string => Boolean(v) && Number.isFinite(new Date(v as string).getTime()))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  return valid[0] ?? null
}

function paidAtIso(payment: PaymentRow): string {
  // paid_at is a DATE in the current schema. created_at supplies the actual
  // recorded timestamp and avoids moving a cleared payment after a cutoff.
  return payment.created_at || `${payment.paid_at}T00:00:00.000Z`
}

export function derivePayrollEligibility(input: {
  job: JobRow
  state?: JobStateRow
  payments: PaymentRow[]
  costs: CostRow[]
}): { eligibleAt: string | null; reason: string | null; deductibleCosts: number } {
  const installAt = input.state?.install_completed_at || input.job.completed_at
  if (!installAt && input.job.status !== 'complete' && input.job.status !== 'collected') {
    return { eligibleAt: null, reason: 'not_installed', deductibleCosts: 0 }
  }

  const cleared = input.payments.filter((p) => p.funding_status === 'cleared')
  const collectedCents = cleared.reduce((sum, p) => sum + (Number(p.amount_cents) || 0), 0)
  const requiredCents = Math.round((Number(input.job.sale_amount) || 0) * 100)
  const funded =
    requiredCents <= 0 ||
    collectedCents >= requiredCents ||
    (input.job.status === 'collected' && Boolean(input.job.allow_close_with_balance))
  if (!funded) return { eligibleAt: null, reason: 'not_funded', deductibleCosts: 0 }

  const blockingCosts = input.costs.filter(
    (line) => line.deduct_from_commission_base && !line.approved
  )
  if (blockingCosts.length > 0) {
    return { eligibleAt: null, reason: 'missing_costs', deductibleCosts: 0 }
  }

  const fundedAt =
    input.state?.fully_funded_at ||
    latestIso(cleared.map(paidAtIso)) ||
    (input.job.status === 'collected' && input.job.allow_close_with_balance ? installAt : null)
  const costsAt =
    input.state?.costs_ready_at ||
    latestIso(input.costs.filter((c) => c.approved).map((c) => c.updated_at || c.created_at)) ||
    installAt

  if (!installAt || !fundedAt || !costsAt) {
    return { eligibleAt: null, reason: 'missing_eligibility_timestamp', deductibleCosts: 0 }
  }

  const eligibleAt = latestIso([installAt, fundedAt, costsAt])
  const deductibleCosts = roundMoney(
    input.costs
      .filter((line) => line.approved && line.deduct_from_commission_base)
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  )
  return { eligibleAt, reason: null, deductibleCosts }
}

function monthBounds(jobs: JobRow[], fallbackDate: string): { from: string; to: string } {
  const months = jobs
    .map((j) => j.sale_date?.slice(0, 7))
    .filter((v): v is string => Boolean(v))
    .sort()
  const first = months[0] || fallbackDate.slice(0, 7)
  const last = months[months.length - 1] || fallbackDate.slice(0, 7)
  const [year, month] = last.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return { from: `${first}-01`, to: `${last}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * Builds immutable job snapshots and participant payout lines for all eligible,
 * previously-unpaid jobs through a payroll period cutoff. Safe to retry.
 */
export async function materializePayrollPeriod(
  supabase: SupabaseClient,
  input: { orgId: string; periodId: string; actorUserId: string; onlyJobIds?: string[] }
): Promise<MaterializePayrollPeriodResult> {
  const { orgId, periodId, actorUserId } = input
  const { data: periodData, error: periodError } = await supabase
    .from('payroll_periods')
    .select('id, cutoff_at, scheduled_pay_date, status')
    .eq('id', periodId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (periodError || !periodData) throw periodError || new Error('Payroll period not found')
  const period = periodData as PeriodRow
  if (period.status === 'paid' || period.status === 'cancelled') {
    throw new Error(`Cannot materialize a ${period.status} payroll period`)
  }

  let jobsQuery = supabase
    .from('production_jobs')
    .select(
      'id, job_number, status, sale_date, sale_amount, commission_comp_base, commission_pre_tax_subtotal, dealer_fee_amount, salesperson_id, project_id, completed_at, allow_close_with_balance'
    )
    .eq('org_id', orgId)
    .not('sale_date', 'is', null)
    .lte('sale_date', period.cutoff_at.slice(0, 10))
    .in('status', ['complete', 'collected'])
  if (input.onlyJobIds?.length) jobsQuery = jobsQuery.in('id', input.onlyJobIds)
  const { data: jobData, error: jobError } = await jobsQuery
  if (jobError) throw jobError
  const candidateJobs = (jobData || []) as JobRow[]
  const jobIds = candidateJobs.map((j) => j.id)

  if (jobIds.length === 0) {
    return {
      periodId,
      eligibleJobs: 0,
      snapshotsCreated: 0,
      payoutLinesCreated: 0,
      skippedJobs: [],
      selfGenSetterConflictJobIds: [],
    }
  }

  const [
    { data: existingSnapshots, error: existingError },
    { data: stateData, error: stateError },
    { data: paymentData, error: paymentError },
    { data: costData, error: costError },
  ] = await Promise.all([
    supabase.from('payroll_job_snapshots').select('job_id').in('job_id', jobIds),
    supabase
      .from('job_payroll_state')
      .select('job_id, install_completed_at, fully_funded_at, costs_ready_at')
      .eq('org_id', orgId)
      .in('job_id', jobIds),
    supabase
      .from('job_payments')
      .select('job_id, amount_cents, funding_status, paid_at, created_at')
      .in('job_id', jobIds),
    supabase
      .from('job_cost_lines')
      .select('job_id, amount, approved, deduct_from_commission_base, created_at, updated_at')
      .eq('org_id', orgId)
      .in('job_id', jobIds)
      .is('deleted_at', null),
  ])
  const loadError = existingError || stateError || paymentError || costError
  if (loadError) throw loadError

  const alreadySnapshotted = new Set((existingSnapshots || []).map((r) => r.job_id as string))
  const stateByJob = new Map((stateData || []).map((r) => [r.job_id as string, r as JobStateRow]))
  const paymentsByJob = new Map<string, PaymentRow[]>()
  for (const row of (paymentData || []) as PaymentRow[]) {
    paymentsByJob.set(row.job_id, [...(paymentsByJob.get(row.job_id) || []), row])
  }
  const costsByJob = new Map<string, CostRow[]>()
  for (const row of (costData || []) as CostRow[]) {
    costsByJob.set(row.job_id, [...(costsByJob.get(row.job_id) || []), row])
  }

  const skippedJobs: MaterializePayrollPeriodResult['skippedJobs'] = []
  const eligible = candidateJobs.flatMap((job) => {
    if (alreadySnapshotted.has(job.id)) {
      skippedJobs.push({ jobId: job.id, reason: 'already_snapshotted' })
      return []
    }
    const result = derivePayrollEligibility({
      job,
      state: stateByJob.get(job.id),
      payments: paymentsByJob.get(job.id) || [],
      costs: costsByJob.get(job.id) || [],
    })
    if (result.reason || !result.eligibleAt) {
      skippedJobs.push({ jobId: job.id, reason: result.reason || 'not_eligible' })
      return []
    }
    if (new Date(result.eligibleAt).getTime() > new Date(period.cutoff_at).getTime()) {
      skippedJobs.push({ jobId: job.id, reason: 'after_cutoff' })
      return []
    }
    return [{ job, eligibleAt: result.eligibleAt, deductibleCosts: result.deductibleCosts }]
  })

  if (eligible.length === 0) {
    return {
      periodId,
      eligibleJobs: 0,
      snapshotsCreated: 0,
      payoutLinesCreated: 0,
      skippedJobs,
      selfGenSetterConflictJobIds: [],
    }
  }

  const eligibleJobs = eligible.map((e) => e.job)
  const projectIds = Array.from(
    new Set(eligibleJobs.map((j) => j.project_id).filter((v): v is string => Boolean(v)))
  )
  const { data: projects, error: projectError } = projectIds.length
    ? await supabase
        .from('projects')
        .select('id, opportunity_id')
        .eq('org_id', orgId)
        .in('id', projectIds)
    : { data: [], error: null }
  if (projectError) throw projectError
  const opportunityIds = Array.from(
    new Set((projects || []).map((p) => p.opportunity_id).filter((v): v is string => Boolean(v)))
  )
  const { data: opportunities, error: opportunityError } = opportunityIds.length
    ? await supabase
        .from('opportunities')
        .select('id, owner_user_id, setter_user_id')
        .eq('org_id', orgId)
        .in('id', opportunityIds)
    : { data: [], error: null }
  if (opportunityError) throw opportunityError
  const oppById = new Map((opportunities || []).map((o) => [o.id as string, o]))
  const oppByProjectId = new Map<string, { owner_user_id?: string | null; setter_user_id?: string | null } | null>()
  const oppIdByProjectId = new Map<string, string>()
  for (const project of projects || []) {
    oppByProjectId.set(
      project.id as string,
      project.opportunity_id ? oppById.get(project.opportunity_id as string) || null : null
    )
    if (project.opportunity_id) {
      oppIdByProjectId.set(project.id as string, project.opportunity_id as string)
    }
  }

  // Everything the derived lines need (inspection, manager override, self-gen),
  // loaded once for the whole period rather than per job. Shared with the payroll
  // preview route so the two can never drift. Each rate defaults to 0 = off, and a
  // rate of 0 skips its lookup entirely.
  const derivedContext = await loadDerivedCommissionContext(supabase, { orgId, opportunityIds })
  const selfGenSetterConflictJobIds: string[] = []

  const bounds = monthBounds(eligibleJobs, period.cutoff_at)
  const { data: volumeJobs, error: volumeError } = await supabase
    .from('production_jobs')
    .select('id, sale_date, salesperson_id, commission_comp_base, dealer_fee_amount, sale_amount, project_id')
    .eq('org_id', orgId)
    .gte('sale_date', bounds.from)
    .lte('sale_date', bounds.to)
    .not('sale_date', 'is', null)
  if (volumeError) throw volumeError
  const volumeProjectIds = Array.from(
    new Set((volumeJobs || []).map((j) => j.project_id).filter((v): v is string => Boolean(v)))
  )
  const { data: volumeProjects, error: volumeProjectError } = volumeProjectIds.length
    ? await supabase
        .from('projects')
        .select('id, opportunity_id')
        .eq('org_id', orgId)
        .in('id', volumeProjectIds)
    : { data: [], error: null }
  if (volumeProjectError) throw volumeProjectError
  const volumeOppIds = Array.from(
    new Set((volumeProjects || []).map((p) => p.opportunity_id).filter((v): v is string => Boolean(v)))
  )
  const { data: volumeOpps, error: volumeOppError } = volumeOppIds.length
    ? await supabase
        .from('opportunities')
        .select('id, owner_user_id, setter_user_id')
        .eq('org_id', orgId)
        .in('id', volumeOppIds)
    : { data: [], error: null }
  if (volumeOppError) throw volumeOppError
  const volumeOppById = new Map((volumeOpps || []).map((o) => [o.id as string, o]))
  const volumeOppByProject = new Map<string, { owner_user_id?: string | null; setter_user_id?: string | null } | null>()
  for (const project of volumeProjects || []) {
    volumeOppByProject.set(
      project.id as string,
      project.opportunity_id ? volumeOppById.get(project.opportunity_id as string) || null : null
    )
  }
  const projectIdByJobId = new Map<string, string>()
  for (const job of volumeJobs || []) if (job.project_id) projectIdByJobId.set(job.id as string, job.project_id as string)
  const volumeMap = buildMonthlyVolumeMaps(volumeJobs || [], volumeOppByProject, projectIdByJobId)
  const tierMetrics = await buildMonthlyTierMetricMaps(supabase, orgId, bounds.from, bounds.to)

  const now = new Date().toISOString()
  const { data: periodSnapshot, error: periodSnapshotError } = await supabase
    .from('payroll_period_snapshots')
    .upsert(
      { org_id: orgId, payroll_period_id: periodId, locked_at: now, locked_by: actorUserId },
      { onConflict: 'payroll_period_id' }
    )
    .select('id')
    .single()
  if (periodSnapshotError || !periodSnapshot) {
    throw periodSnapshotError || new Error('Failed to create payroll period snapshot')
  }

  let snapshotsCreated = 0
  let payoutLinesCreated = 0
  const flatBonusApplied = new Set<string>()

  for (const item of eligible) {
    const job = item.job
    const payrollSnapshot = buildCommissionPayrollSnapshot(job)
    if (!payrollSnapshot.compBase || payrollSnapshot.compBase <= 0 || payrollSnapshot.poolCap == null) {
      skippedJobs.push({ jobId: job.id, reason: 'missing_commission_base' })
      continue
    }
    const opportunity = job.project_id ? oppByProjectId.get(job.project_id) || null : null
    const participants = collectParticipants(job, opportunity)
    if (participants.length === 0) {
      skippedJobs.push({ jobId: job.id, reason: 'missing_participants' })
      continue
    }

    const rawByUser = new Map<string, number>()
    const meta = new Map<
      string,
      { role: string; plan: CompPlanForCalc; calc: ReturnType<typeof computeRawCommissionForParticipant>; flatBonus: number }
    >()
    const saleDate = job.sale_date || period.cutoff_at.slice(0, 10)
    const monthKey = monthKeyFromSaleDate(job.sale_date)
    for (const participant of participants) {
      const assignment = await loadActiveCompPlanForUser(supabase, participant.userId, orgId, saleDate)
      const plan = assignment?.comp_plans as unknown as CompPlanForCalc | null
      if (!plan) continue
      const periodVolume = monthKey ? volumeMap.get(`${participant.userId}|${monthKey}`) || 0 : 0
      const metrics = periodSitsAndCloseRateForParticipant({
        userId: participant.userId,
        monthKey,
        participantRole: participant.role,
        sitsBySetterMonth: tierMetrics.sitsBySetterMonth,
        sitsByOwnerMonth: tierMetrics.sitsByOwnerMonth,
        salesByOwnerMonth: tierMetrics.salesByOwnerMonth,
      })
      const calc = computeRawCommissionForParticipant({
        plan,
        commissionableAmount: payrollSnapshot.compBase,
        periodVolume,
        periodSits: metrics.periodSits,
        periodClosingRatePct: metrics.periodClosingRatePct,
        overridePercentage: assignment?.override_percentage ?? null,
      })
      if (calc.unsupported) continue
      const bonusKey = `${participant.userId}|${monthKey || ''}`
      const flatBonus =
        calc.volumeBonusFlat > 0 && !flatBonusApplied.has(bonusKey) ? calc.volumeBonusFlat : 0
      if (flatBonus > 0) flatBonusApplied.add(bonusKey)
      meta.set(participant.userId, { role: participant.role, plan, calc, flatBonus })
      // Per-COMPONENT pool-cap rule: a hybrid plan's per-sale percentage / $-per-job
      // amount counts inside the cap; its hourly and per-unit dollars never reach
      // calc.totalAmount at all. See lib/calculate-commission-from-plan.ts.
      rawByUser.set(
        poolKey(participant.userId, participant.role),
        calc.countsTowardPoolCap ? calc.totalAmount : 0
      )
    }

    // Additive per-job participants (inspector, manager overrides). These count
    // INSIDE the commission pool: they enter rawByUser before scaling, so if a job's
    // total sales pay would exceed the pool cap, every line — inspection included —
    // scales down together. Keyed by user+role so one person who both closes and
    // inspects a job keeps two independently-scaled lines.
    const explicitAdditive = await loadAdditiveDealCommissionParticipants(supabase, orgId, job.id)
    const jobOpportunityId = job.project_id ? oppIdByProjectId.get(job.project_id) ?? null : null
    const derived = buildAdditiveParticipantsForJob({
      explicit: explicitAdditive,
      context: derivedContext,
      opportunityId: jobOpportunityId,
      participantUserIds: participants.map((p) => p.userId),
      salespersonId: job.salesperson_id ?? null,
    })
    const additiveParticipants = derived.participants
    if (derived.selfGenSetterConflict) {
      selfGenSetterConflictJobIds.push(job.id)
      console.warn('materializePayrollPeriod: self-gen job also has a setter; 6% line suppressed', {
        orgId,
        periodId,
        jobId: job.id,
        jobNumber: job.job_number,
      })
    }
    // Captured as a local const: the guard above proves compBase is a positive
    // number, but TypeScript drops property narrowing inside the closures below.
    const additiveCommissionBase = payrollSnapshot.compBase
    const additivePayable = additiveParticipants.flatMap((participant) => {
      const resolved = resolveAdditiveParticipantAmount(participant, additiveCommissionBase)
      // A row with neither an override amount nor a percent pays nothing; skip it
      // rather than writing a $0 payout line.
      if (resolved.basis === 'none' || resolved.amount === 0) return []
      return [{ participant, resolved }]
    })
    for (const { participant, resolved } of additivePayable) {
      rawByUser.set(poolKey(participant.userId, participant.role), resolved.amount)
    }

    const scaled = scaleCommissionsToPool(rawByUser, payrollSnapshot.poolCap)
    const payoutRows = Array.from(meta.entries()).map(([userId, value]) => {
      const key = poolKey(userId, value.role)
      const gross = roundMoney((rawByUser.get(key) || 0) + value.flatBonus)
      const net = roundMoney((scaled.scaled.get(key) || 0) + value.flatBonus)
      return {
        org_id: orgId,
        payroll_period_id: periodId,
        job_id: job.id,
        user_id: userId,
        participant_role: value.role,
        gross_amount: gross,
        net_amount: net,
        chargeback_applied_amount: 0,
        comp_plan_snapshot: {
          plan: value.plan,
          calculation: value.calc,
          pool_cap_enforced: scaled.enforced,
        },
      }
    })
    const additiveRows = additivePayable.map(({ participant, resolved }) => {
      const key = poolKey(participant.userId, participant.role)
      return {
        org_id: orgId,
        payroll_period_id: periodId,
        job_id: job.id,
        user_id: participant.userId,
        participant_role: participant.role,
        gross_amount: resolved.amount,
        net_amount: roundMoney(scaled.scaled.get(key) ?? resolved.amount),
        chargeback_applied_amount: 0,
        comp_plan_snapshot: {
          source: 'deal_commission_roles',
          basis: resolved.basis,
          override_amount: participant.overrideAmount,
          override_percent: participant.overridePercent,
          commission_base: payrollSnapshot.compBase,
          pool_cap_enforced: scaled.enforced,
        },
      }
    })

    const allPayoutRows = [...payoutRows, ...additiveRows]
    if (allPayoutRows.length === 0) {
      skippedJobs.push({ jobId: job.id, reason: 'no_resolvable_participant_plans' })
      continue
    }

    const grossTotal = roundMoney(allPayoutRows.reduce((sum, row) => sum + row.gross_amount, 0))
    const netTotal = roundMoney(allPayoutRows.reduce((sum, row) => sum + row.net_amount, 0))
    const { data: jobSnapshot, error: jobSnapshotError } = await supabase
      .from('payroll_job_snapshots')
      .upsert(
        {
          org_id: orgId,
          payroll_period_snapshot_id: periodSnapshot.id,
          payroll_period_id: periodId,
          job_id: job.id,
          contract_total: job.sale_amount,
          signed_change_orders_total: 0,
          commissionable_change_orders_total: 0,
          dealer_fee: job.dealer_fee_amount || 0,
          deductible_costs_total: item.deductibleCosts,
          commission_base: payrollSnapshot.compBase,
          comp_plan_version: Object.fromEntries(
            Array.from(meta.entries()).map(([userId, value]) => [userId, value.plan])
          ),
          participants: allPayoutRows.map((row) => ({
            user_id: row.user_id,
            role: row.participant_role,
          })),
          gross_payout_total: grossTotal,
          net_payout_total: netTotal,
          pay_date: period.scheduled_pay_date,
          payload: {
            eligible_at: item.eligibleAt,
            commission_source: payrollSnapshot.source,
            pool_cap: payrollSnapshot.poolCap,
            derived_commission_rates: derivedContext.rates,
            self_gen_setter_conflict: derived.selfGenSetterConflict,
          },
        },
        { onConflict: 'payroll_period_id,job_id' }
      )
      .select('id')
      .single()
    if (jobSnapshotError || !jobSnapshot) {
      throw jobSnapshotError || new Error(`Failed to snapshot job ${job.job_number}`)
    }
    snapshotsCreated += 1

    const rowsWithSnapshot = allPayoutRows.map((row) => ({
      ...row,
      payroll_job_snapshot_id: jobSnapshot.id,
    }))
    // Keep the application retry-safe even before the additive unique-index
    // migration reaches an environment with legacy migration-history drift.
    const { data: existingPayoutRows, error: existingPayoutError } = await supabase
      .from('payroll_payout_lines')
      .select('user_id, participant_role')
      .eq('payroll_period_id', periodId)
      .eq('job_id', job.id)
    if (existingPayoutError) throw existingPayoutError
    const existingPayoutKeys = new Set(
      (existingPayoutRows || []).map((row) => `${row.user_id}|${row.participant_role}`)
    )
    const missingRows = rowsWithSnapshot.filter(
      (row) => !existingPayoutKeys.has(`${row.user_id}|${row.participant_role}`)
    )
    const { error: payoutError } =
      missingRows.length > 0
        ? await supabase.from('payroll_payout_lines').insert(missingRows)
        : { error: null }
    if (payoutError) throw payoutError
    payoutLinesCreated += missingRows.length

    const { error: stateUpdateError } = await supabase.from('job_payroll_state').upsert(
      {
        job_id: job.id,
        org_id: orgId,
        install_completed_at: stateByJob.get(job.id)?.install_completed_at || job.completed_at,
        fully_funded_at:
          stateByJob.get(job.id)?.fully_funded_at ||
          latestIso((paymentsByJob.get(job.id) || []).filter((p) => p.funding_status === 'cleared').map(paidAtIso)),
        costs_ready_at:
          stateByJob.get(job.id)?.costs_ready_at ||
          latestIso((costsByJob.get(job.id) || []).filter((c) => c.approved).map((c) => c.updated_at || c.created_at)) ||
          job.completed_at,
        payroll_eligible_at: item.eligibleAt,
        payroll_cutoff_at: period.cutoff_at,
        scheduled_pay_date: period.scheduled_pay_date,
        current_payroll_period_id: periodId,
        updated_at: now,
      },
      { onConflict: 'job_id' }
    )
    if (stateUpdateError) throw stateUpdateError
  }

  return {
    periodId,
    eligibleJobs: eligible.length,
    snapshotsCreated,
    payoutLinesCreated,
    skippedJobs,
    selfGenSetterConflictJobIds,
  }
}
