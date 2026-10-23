import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { evaluateJobCollection, sumCollectedCents } from '@/lib/job-collection'
import { roundMoney } from '@/lib/money'
import { loadJobCostLedger } from '@/lib/job-cost-ledger'
import {
  buildAdditiveParticipantsForJob,
  loadDerivedCommissionContext,
  resolveDerivedCommissionRatesForSaleDate,
} from '@/lib/job-derived-commission-lines'
import {
  buildMonthlyTierMetricMaps,
  collectParticipants,
  computeRawCommissionForParticipant,
  loadActiveCompPlanForUser,
  loadAdditiveDealCommissionParticipants,
  loadProducerCommissionOverrides,
  monthKeyFromSaleDate,
  periodSitsAndCloseRateForParticipant,
  poolKey,
  producerOverrideKey,
  producerStorageRoleForParticipant,
  resolveAdditiveParticipantAmount,
  resolveProducerOverrideAmount,
  scaleCommissionsToPool,
  type PayrollParticipant,
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
  close_balance_by?: string | null
  close_balance_at?: string | null
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

/**
 * True when Postgres rejected a payroll write because the job (or job/rep/role) is
 * already paid in a different period — raised by the single-period triggers in
 * supabase/migrations/202610210002_payroll_no_cross_period_double_pay.sql.
 */
export function isPayrollAlreadyPaidError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return code === '23505' && typeof message === 'string' && message.startsWith('payroll_already_paid:')
}

/**
 * Deletes a job snapshot only while it has no payout lines, in one atomic DB call
 * (payroll_discard_lineless_job_snapshot, serialized with line inserts for the job).
 * Used when the line write for a just-written snapshot fails. The "no lines" condition
 * matters: if a concurrent lock of the SAME period already wrote this snapshot's lines
 * (which is why our insert hit the unique index), deleting it would cascade away real
 * pay. Best effort: a cleanup failure is logged and the original error is reported.
 * If it does fail, the lineless snapshot is retried by the next lock of this period.
 */
async function discardSnapshotIfLineless(
  supabase: SupabaseClient,
  orgId: string,
  snapshotId: string,
  jobNumber: string
): Promise<void> {
  const { error } = await supabase.rpc('payroll_discard_lineless_job_snapshot', {
    p_org_id: orgId,
    p_snapshot_id: snapshotId,
  })
  if (error) console.error('materializePayrollPeriod: snapshot cleanup failed', { jobNumber, error })
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
  // One "paid in full" rule (lib/job-collection.ts): payments within $0.05, or a super
  // admin forced it with a reason. A job with no sale amount is not paid — it is broken.
  const collection = evaluateJobCollection({
    saleAmount: input.job.sale_amount,
    payments: input.payments,
    allowCloseWithBalance: input.job.allow_close_with_balance,
    closeBalanceBy: input.job.close_balance_by,
  })
  if (!collection.paidInFull) return { eligibleAt: null, reason: 'not_funded', deductibleCosts: 0 }

  const blockingCosts = input.costs.filter(
    (line) => line.deduct_from_commission_base && !line.approved
  )
  if (blockingCosts.length > 0) {
    return { eligibleAt: null, reason: 'missing_costs', deductibleCosts: 0 }
  }

  const fundedAt =
    input.state?.fully_funded_at ||
    latestIso(cleared.map(paidAtIso)) ||
    (collection.forcedPaidInFull ? input.job.close_balance_at || installAt : null)
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

export type PlannedPayoutRow = {
  org_id: string
  payroll_period_id: string
  job_id: string
  user_id: string
  participant_role: string
  gross_amount: number
  net_amount: number
  chargeback_applied_amount: number
  comp_plan_snapshot: Record<string, unknown>
}

export type PlannedJob = {
  job: JobRow
  eligibleAt: string
  rows: PlannedPayoutRow[]
  commissionBase: number
  poolCap: number
  grossTotal: number
  netTotal: number
  /** Everything the job snapshot upsert needs except `payroll_period_snapshot_id` (known only when persisting). */
  snapshotRow: Record<string, unknown>
  /** The job_payroll_state upsert for this job (without period-specific pointers). */
  stateRow: Record<string, unknown>
}

/** A job that is not payable THIS period yet, with what it would pay (computed by the same engine) and why it waits. */
export type WaitingJob = {
  job: JobRow
  reason: string
  /** Plain-English reason shown to office and reps. */
  reasonText: string
  collectedCents: number
  /** Estimated lines, same math as an approved run; empty when the engine could not price the job. */
  rows: PlannedPayoutRow[]
}

export type PayrollPlan = {
  period: PeriodRow
  /** Jobs that WILL be paid if this period is approved now. */
  jobs: PlannedJob[]
  /** Jobs that wait (only filled with includeWaiting). */
  waiting: WaitingJob[]
  /** Count of jobs that passed eligibility (before any pricing skip) — what the legacy result called eligibleJobs. */
  eligibleJobs: number
  skippedJobs: Array<{ jobId: string; reason: string }>
  selfGenSetterConflictJobIds: string[]
}

const WAITING_TEXT: Record<string, string> = {
  not_installed: 'Install not marked complete',
  missing_costs: 'Office is reviewing a cost on this job',
  missing_commission_base: 'Price info missing — the office is fixing it',
  after_cutoff: "Finished after this week's cutoff — pays next week",
  missing_eligibility_timestamp: 'Waiting on a date the office has to fill in',
  missing_participants: 'Nobody is credited on this job yet',
  no_resolvable_participant_plans: 'The people on this job have no pay plan yet',
}

export function waitingReasonText(reason: string, collectedCents: number, saleAmount: number | null): string {
  if (reason === 'not_funded') {
    const sale = Math.round((Number(saleAmount) || 0) * 100)
    const owed = Math.max(0, sale - collectedCents) / 100
    const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    return sale > 0 ? `Customer still owes ${fmt(owed)} of ${fmt(sale / 100)}` : 'No sale amount on file'
  }
  return WAITING_TEXT[reason] ?? 'Not payable yet'
}

/**
 * THE payroll calculation, with no writes. Everything "what will this period pay" shows (the Pay-this-week preview) and
 * everything Approve writes comes from this one function: `materializePayrollPeriod` below is plan + persist, so a
 * preview cannot drift from what is paid. Eligible jobs → `jobs`; with `includeWaiting`, every other job sold on/before
 * the cutoff is priced by the same code and returned in `waiting` with its reason.
 */
export async function planPayrollPeriod(
  supabase: SupabaseClient,
  input: { orgId: string; periodId: string; onlyJobIds?: string[]; includeWaiting?: boolean }
): Promise<PayrollPlan> {
  const { orgId, periodId } = input
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

  const emptyPlan = (skippedJobs: PayrollPlan['skippedJobs'] = [], eligibleJobs = 0): PayrollPlan => ({
    period,
    jobs: [],
    waiting: [],
    eligibleJobs,
    skippedJobs,
    selfGenSetterConflictJobIds: [],
  })

  const statuses = input.includeWaiting
    ? ['sold', 'materials', 'scheduled', 'in_progress', 'complete', 'collected']
    : ['complete', 'collected']
  let jobsQuery = supabase
    .from('production_jobs')
    .select(
      'id, job_number, status, sale_date, sale_amount, commission_comp_base, commission_pre_tax_subtotal, dealer_fee_amount, salesperson_id, project_id, completed_at, allow_close_with_balance, close_balance_by, close_balance_at'
    )
    .eq('org_id', orgId)
    .not('sale_date', 'is', null)
    .lte('sale_date', period.cutoff_at.slice(0, 10))
    .in('status', statuses)
  if (input.onlyJobIds?.length) jobsQuery = jobsQuery.in('id', input.onlyJobIds)
  const { data: jobData, error: jobError } = await jobsQuery
  if (jobError) throw jobError
  const candidateJobs = (jobData || []) as JobRow[]
  const jobIds = candidateJobs.map((j) => j.id)

  if (jobIds.length === 0) return emptyPlan()

  const [
    { data: existingSnapshots, error: existingError },
    { data: stateData, error: stateError },
    { data: paymentData, error: paymentError },
    { data: costData, error: costError },
    { data: periodLineData, error: periodLineError },
  ] = await Promise.all([
    supabase.from('payroll_job_snapshots').select('id, job_id, payroll_period_id').in('job_id', jobIds),
    supabase
      .from('job_payroll_state')
      .select('job_id, install_completed_at, fully_funded_at, costs_ready_at')
      .eq('org_id', orgId)
      .in('job_id', jobIds),
    supabase
      .from('job_payments')
      .select('job_id, amount_cents, funding_status, paid_at, created_at')
      .in('job_id', jobIds),
    // The one cost ledger reader (lib/job-cost-ledger.ts): live lines only, so an archived
    // duplicate (26-0013's two $918 lending-fee lines) no longer counts or blocks.
    loadJobCostLedger(supabase, orgId, jobIds).then(
      (ledger) => ({ data: Array.from(ledger.values()).flatMap((entry) => entry.lines), error: null }),
      (error) => ({ data: null, error })
    ),
    supabase
      .from('payroll_payout_lines')
      .select('payroll_job_snapshot_id')
      .eq('payroll_period_id', periodId)
      .in('job_id', jobIds),
  ])
  const loadError = existingError || stateError || paymentError || costError || periodLineError
  if (loadError) throw loadError

  // A job counts as paid if it has a snapshot in ANOTHER period, or one in THIS period
  // that has payout lines. A lineless snapshot in this period is debris from a failed
  // write (nothing was paid), so the job is retried; the same-period upsert below
  // reuses that snapshot row.
  const snapshotIdsWithLinesHere = new Set(
    (periodLineData || []).map((r) => r.payroll_job_snapshot_id as string)
  )
  const alreadySnapshotted = new Set(
    (existingSnapshots || [])
      .filter((r) => r.payroll_period_id !== periodId || snapshotIdsWithLinesHere.has(r.id as string))
      .map((r) => r.job_id as string)
  )
  const stateByJob = new Map((stateData || []).map((r) => [r.job_id as string, r as JobStateRow]))
  const paymentsByJob = new Map<string, PaymentRow[]>()
  for (const row of (paymentData || []) as PaymentRow[]) {
    paymentsByJob.set(row.job_id, [...(paymentsByJob.get(row.job_id) || []), row])
  }
  const costsByJob = new Map<string, CostRow[]>()
  for (const row of (costData || []) as CostRow[]) {
    costsByJob.set(row.job_id, [...(costsByJob.get(row.job_id) || []), row])
  }

  const skippedJobs: PayrollPlan['skippedJobs'] = []
  const waitingItems: Array<{ job: JobRow; reason: string }> = []
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
      const reason = result.reason || 'not_eligible'
      skippedJobs.push({ jobId: job.id, reason })
      waitingItems.push({ job, reason })
      return []
    }
    if (new Date(result.eligibleAt).getTime() > new Date(period.cutoff_at).getTime()) {
      skippedJobs.push({ jobId: job.id, reason: 'after_cutoff' })
      waitingItems.push({ job, reason: 'after_cutoff' })
      return []
    }
    return [{ job, eligibleAt: result.eligibleAt, deductibleCosts: result.deductibleCosts }]
  })

  const waitingToPrice = input.includeWaiting ? waitingItems : []
  if (eligible.length === 0 && waitingToPrice.length === 0) return emptyPlan(skippedJobs)

  const pricedJobs = [...eligible.map((e) => e.job), ...waitingToPrice.map((w) => w.job)]
  const projectIds = Array.from(
    new Set(pricedJobs.map((j) => j.project_id).filter((v): v is string => Boolean(v)))
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
  // loaded once for the whole period rather than per job. Each rate defaults to 0 = off,
  // and a rate of 0 skips its lookup entirely.
  const derivedContext = await loadDerivedCommissionContext(supabase, { orgId, opportunityIds })
  const selfGenSetterConflictJobIds: string[] = []

  // Per-job overrides that REPLACE a producer's comp-plan commission (see
  // loadProducerCommissionOverrides). Batched for the whole period rather than
  // re-queried per participant.
  const producerOverrides = await loadProducerCommissionOverrides(
    supabase,
    orgId,
    pricedJobs.map((j) => j.id)
  )

  const bounds = monthBounds(pricedJobs, period.cutoff_at)
  const tierMetrics = await buildMonthlyTierMetricMaps(supabase, orgId, bounds.from, bounds.to)

  const flatBonusApplied = new Set<string>()

  /** Prices one job: its payout rows (or why it can't be priced). The ONLY place a job's lines are computed. */
  const priceJob = async (
    job: JobRow
  ): Promise<
    | { skip: string; selfGenSetterConflict?: boolean }
    | {
        rows: PlannedPayoutRow[]
        payrollSnapshot: ReturnType<typeof buildCommissionPayrollSnapshot>
        meta: Map<string, { role: string; plan: CompPlanForCalc; calc: ReturnType<typeof computeRawCommissionForParticipant>; flatBonus: number }>
        selfGenSetterConflict: boolean
      }
  > => {
    const payrollSnapshot = buildCommissionPayrollSnapshot(job)
    if (!payrollSnapshot.compBase || payrollSnapshot.compBase <= 0 || payrollSnapshot.poolCap == null) {
      return { skip: 'missing_commission_base' }
    }
    const opportunity = job.project_id ? oppByProjectId.get(job.project_id) || null : null
    const participants = collectParticipants(job, opportunity)
    if (participants.length === 0) return { skip: 'missing_participants' }

    const rawByUser = new Map<string, number>()
    const meta = new Map<
      string,
      { role: string; plan: CompPlanForCalc; calc: ReturnType<typeof computeRawCommissionForParticipant>; flatBonus: number }
    >()
    const saleDate = job.sale_date || period.cutoff_at.slice(0, 10)
    const monthKey = monthKeyFromSaleDate(job.sale_date)

    // Producers whose pay on THIS job was overridden by an admin. Their comp plan is
    // not consulted at all — the override is the whole answer — so they are collected
    // here and written as their own rows below, keeping `meta` (which snapshots a
    // resolved plan) untouched.
    const overriddenProducers: Array<{
      participant: PayrollParticipant
      resolved: { amount: number; basis: 'flat' | 'percent' }
    }> = []

    for (const participant of participants) {
      const override = producerOverrides.get(
        producerOverrideKey(
          job.id,
          participant.userId,
          producerStorageRoleForParticipant(participant.role)
        )
      )
      const overrideResolved = resolveProducerOverrideAmount(override, payrollSnapshot.compBase)
      if (overrideResolved) {
        overriddenProducers.push({ participant, resolved: overrideResolved })
        rawByUser.set(poolKey(participant.userId, participant.role), overrideResolved.amount)
        // Deliberately skips the comp plan AND the monthly flat-bonus bookkeeping:
        // an overridden line carries no plan-derived bonus, and the once-per-month
        // flat bonus slot stays unconsumed so it can still land on another job.
        continue
      }

      const assignment = await loadActiveCompPlanForUser(supabase, participant.userId, orgId, saleDate)
      const plan = assignment?.comp_plans as unknown as CompPlanForCalc | null
      if (!plan) continue
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
      setterUserId: opportunity?.setter_user_id ?? null,
      salespersonId: job.salesperson_id ?? null,
      opportunityOwnerUserId: opportunity?.owner_user_id ?? null,
      saleDate: job.sale_date ?? null,
    })
    const additiveParticipants = derived.participants
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
    const payoutRows: PlannedPayoutRow[] = Array.from(meta.entries()).map(([userId, value]) => {
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
    // Overridden producers keep their ORIGINAL participant role (sales_rep / setter /
    // owner) on the payout line, so statements, pool keys and the retry-dedupe key
    // read exactly as they would without an override — only the amount changes. A
    // deliberate $0 still writes a line: "paid nothing on this deal" is an auditable
    // fact, and silently dropping it would look identical to a bug.
    const producerOverrideRows: PlannedPayoutRow[] = overriddenProducers.map(({ participant, resolved }) => {
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
          source: 'deal_commission_roles_producer_override',
          basis: resolved.basis,
          storage_role: producerStorageRoleForParticipant(participant.role),
          commission_base: payrollSnapshot.compBase,
          pool_cap_enforced: scaled.enforced,
          note: 'Comp plan bypassed: an explicit per-job override replaced this line.',
        },
      }
    })

    const additiveRows: PlannedPayoutRow[] = additivePayable.map(({ participant, resolved }) => {
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
          source: participant.sourceSnapshot ? 'derived_commission' : 'deal_commission_roles',
          basis: resolved.basis,
          override_amount: participant.overrideAmount,
          override_percent: participant.overridePercent,
          commission_base: payrollSnapshot.compBase,
          pool_cap_enforced: scaled.enforced,
          ...(participant.sourceSnapshot || {}),
        },
      }
    })

    const rows = [...payoutRows, ...producerOverrideRows, ...additiveRows]
    if (rows.length === 0) return { skip: 'no_resolvable_participant_plans', selfGenSetterConflict: derived.selfGenSetterConflict }
    return { rows, payrollSnapshot, meta, selfGenSetterConflict: derived.selfGenSetterConflict }
  }

  const jobs: PlannedJob[] = []
  const waiting: WaitingJob[] = []
  for (const item of eligible) {
    const job = item.job
    const priced = await priceJob(job)
    if ('skip' in priced) {
      skippedJobs.push({ jobId: job.id, reason: priced.skip })
      if (priced.selfGenSetterConflict) selfGenSetterConflictJobIds.push(job.id)
      // An eligible job the engine cannot price still has to show up in the preview, with the reason.
      if (input.includeWaiting) {
        waiting.push({
          job,
          reason: priced.skip,
          reasonText: waitingReasonText(priced.skip, sumCollectedCents(paymentsByJob.get(job.id) || []), job.sale_amount),
          collectedCents: sumCollectedCents(paymentsByJob.get(job.id) || []),
          rows: [],
        })
      }
      continue
    }
    if (priced.selfGenSetterConflict) {
      selfGenSetterConflictJobIds.push(job.id)
      console.warn('materializePayrollPeriod: self-gen job also has a setter; 6% line suppressed', {
        orgId,
        periodId,
        jobId: job.id,
        jobNumber: job.job_number,
      })
    }
    const { rows, payrollSnapshot, meta } = priced
    const grossTotal = roundMoney(rows.reduce((sum, row) => sum + row.gross_amount, 0))
    const netTotal = roundMoney(rows.reduce((sum, row) => sum + row.net_amount, 0))
    jobs.push({
      job,
      eligibleAt: item.eligibleAt,
      rows,
      commissionBase: payrollSnapshot.compBase as number,
      poolCap: payrollSnapshot.poolCap as number,
      grossTotal,
      netTotal,
      snapshotRow: {
        org_id: orgId,
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
        participants: rows.map((row) => ({ user_id: row.user_id, role: row.participant_role })),
        gross_payout_total: grossTotal,
        net_payout_total: netTotal,
        pay_date: period.scheduled_pay_date,
        payload: {
          eligible_at: item.eligibleAt,
          commission_source: payrollSnapshot.source,
          pool_cap: payrollSnapshot.poolCap,
          derived_commission_rates: resolveDerivedCommissionRatesForSaleDate(
            derivedContext.rateHistory,
            job.sale_date
          ),
          self_gen_setter_conflict: priced.selfGenSetterConflict,
        },
      },
      stateRow: {
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
      },
    })
  }

  for (const item of waitingToPrice) {
    const priced = await priceJob(item.job)
    const collectedCents = sumCollectedCents(paymentsByJob.get(item.job.id) || [])
    // A job that cannot be priced still waits — with the pricing reason if that is what blocks it.
    const reason = 'skip' in priced && item.reason === 'not_installed' ? item.reason : 'skip' in priced ? priced.skip : item.reason
    waiting.push({
      job: item.job,
      reason,
      reasonText: waitingReasonText(reason, collectedCents, item.job.sale_amount),
      collectedCents,
      rows: 'skip' in priced ? [] : priced.rows,
    })
  }

  return {
    period,
    jobs,
    waiting,
    eligibleJobs: eligible.length,
    skippedJobs,
    selfGenSetterConflictJobIds,
  }
}

/**
 * Builds immutable job snapshots and participant payout lines for all eligible,
 * previously-unpaid jobs through a payroll period cutoff. Safe to retry.
 *
 * This is `planPayrollPeriod` (the one calculation) plus the writes — nothing here recomputes a line.
 */
export async function materializePayrollPeriod(
  supabase: SupabaseClient,
  input: { orgId: string; periodId: string; actorUserId: string; onlyJobIds?: string[] }
): Promise<MaterializePayrollPeriodResult> {
  const { orgId, periodId, actorUserId } = input
  const plan = await planPayrollPeriod(supabase, { orgId, periodId, onlyJobIds: input.onlyJobIds })
  const { period } = plan
  const skippedJobs = plan.skippedJobs

  if (plan.eligibleJobs === 0) {
    return {
      periodId,
      eligibleJobs: 0,
      snapshotsCreated: 0,
      payoutLinesCreated: 0,
      skippedJobs,
      selfGenSetterConflictJobIds: [],
    }
  }

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

  for (const planned of plan.jobs) {
    const job = planned.job
    const { data: jobSnapshot, error: jobSnapshotError } = await supabase
      .from('payroll_job_snapshots')
      .upsert(
        { ...planned.snapshotRow, payroll_period_snapshot_id: periodSnapshot.id },
        { onConflict: 'payroll_period_id,job_id' }
      )
      .select('id')
      .single()
    if (isPayrollAlreadyPaidError(jobSnapshotError)) {
      // Another lock paid this job after `alreadySnapshotted` was read. The DB trigger
      // (202610210002_payroll_no_cross_period_double_pay.sql) rejected the write; skip
      // the job exactly as the up-front check would have.
      skippedJobs.push({ jobId: job.id, reason: 'already_paid_by_race' })
      continue
    }
    if (jobSnapshotError || !jobSnapshot) {
      throw jobSnapshotError || new Error(`Failed to snapshot job ${job.job_number}`)
    }
    const rowsWithSnapshot = planned.rows.map((row) => ({
      ...row,
      payroll_job_snapshot_id: jobSnapshot.id,
    }))
    // Snapshot and lines are separate PostgREST calls, so a failure here would leave a
    // snapshot with no lines: every later lock would treat the job as paid and it would
    // never be paid at all. Remove that snapshot before giving up on the job.
    let payoutError: unknown = null
    let missingRows: typeof rowsWithSnapshot = []
    // Keep the application retry-safe even before the additive unique-index
    // migration reaches an environment with legacy migration-history drift.
    const { data: existingPayoutRows, error: existingPayoutError } = await supabase
      .from('payroll_payout_lines')
      .select('user_id, participant_role')
      .eq('payroll_period_id', periodId)
      .eq('job_id', job.id)
    if (existingPayoutError) {
      payoutError = existingPayoutError
    } else {
      const existingPayoutKeys = new Set(
        (existingPayoutRows || []).map((row) => `${row.user_id}|${row.participant_role}`)
      )
      missingRows = rowsWithSnapshot.filter(
        (row) => !existingPayoutKeys.has(`${row.user_id}|${row.participant_role}`)
      )
      if (missingRows.length > 0) {
        const { error } = await supabase.from('payroll_payout_lines').insert(missingRows)
        payoutError = error
      }
    }
    if (payoutError) {
      await discardSnapshotIfLineless(supabase, orgId, jobSnapshot.id as string, job.job_number)
      if (isPayrollAlreadyPaidError(payoutError)) {
        skippedJobs.push({ jobId: job.id, reason: 'already_paid_by_race' })
        continue
      }
      throw payoutError
    }
    snapshotsCreated += 1
    payoutLinesCreated += missingRows.length

    const { error: stateUpdateError } = await supabase
      .from('job_payroll_state')
      .upsert({ ...planned.stateRow, updated_at: now }, { onConflict: 'job_id' })
    if (stateUpdateError) throw stateUpdateError
  }

  return {
    periodId,
    eligibleJobs: plan.eligibleJobs,
    snapshotsCreated,
    payoutLinesCreated,
    skippedJobs,
    selfGenSetterConflictJobIds: plan.selfGenSetterConflictJobIds,
  }
}
