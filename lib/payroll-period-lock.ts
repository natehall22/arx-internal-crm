import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { roundMoney } from '@/lib/money'
import {
  collectParticipants,
  loadAdditiveDealCommissionParticipants,
  type DealCommissionRoleParticipant,
  type PayrollExportRow,
  type PayrollParticipant,
} from '@/lib/payroll-export'
import { computePayrollExportRowsForDateRange } from '@/lib/payroll-period-export-engine'
import {
  findDealCommissionRoleRowForUser,
  lockPayoutGrossAmount,
  resolveParticipantLineAmount,
} from '@/lib/payroll-statement'

export { clearPayrollPeriodLockArtifacts } from '@/lib/payroll-period-snapshot-cleanup'

export type PayrollPeriodLockBackfillResult = {
  jobsSnapshotted: number
  linesCreated: number
  repsAffected: number
  rolesBackfilled: number
  skippedExisting: boolean
}

/** Maps legacy participant roles to deal_commission_roles.role values. */
export function participantRoleToDealCommissionRole(
  role: PayrollParticipant['role']
): 'setter' | 'closer' | null {
  if (role === 'setter') return 'setter'
  if (role === 'owner' || role === 'sales_rep') return 'closer'
  return null
}

/**
 * Sale-date window for period lock: day after previous period cutoff through this period's cutoff (date).
 */
export async function resolvePeriodSaleDateRange(
  supabase: SupabaseClient,
  orgId: string,
  cutoffAt: string
): Promise<{ from: string; to: string }> {
  const to = cutoffAt.slice(0, 10)

  const { data: prev } = await supabase
    .from('payroll_periods')
    .select('cutoff_at')
    .eq('org_id', orgId)
    .lt('cutoff_at', cutoffAt)
    .neq('status', 'cancelled')
    .order('cutoff_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (prev?.cutoff_at) {
    const prevDate = new Date(prev.cutoff_at as string)
    prevDate.setUTCDate(prevDate.getUTCDate() + 1)
    return { from: prevDate.toISOString().slice(0, 10), to }
  }

  const cut = new Date(cutoffAt)
  cut.setUTCDate(cut.getUTCDate() - 120)
  return { from: cut.toISOString().slice(0, 10), to }
}

function compPlanSnapshotFromExportRow(
  row: PayrollExportRow,
  compBase: number,
  explicit: Record<string, unknown> | undefined,
  lockedGross: number
): Record<string, unknown> {
  const resolved = resolveParticipantLineAmount(row.scaled_commission, compBase, explicit)
  return {
    comp_plan_id: row.comp_plan_id,
    comp_plan_name: row.comp_plan_name,
    plan_type: row.plan_type,
    base_rate_pct: row.base_rate_pct,
    period_volume: row.period_volume,
    volume_bonus_rate_pct: row.volume_bonus_rate_pct,
    volume_bonus_flat: row.volume_bonus_flat,
    effective_rate_pct: row.effective_rate_pct,
    raw_commission: row.raw_commission,
    scaled_commission: lockedGross,
    engine_scaled_commission: row.scaled_commission,
    override_amount: resolved.overrideAmount || null,
    override_percent: resolved.overridePercent,
    premier_pricing_amount: resolved.premierPricingCommission || null,
    pool_cap: row.pool_cap,
    pool_cap_enforced: row.pool_cap_enforced,
    unsupported_plan: row.unsupported_plan,
    note: row.note,
    participant_role: row.participant_role,
    snapshot_version: 1,
    ntp_split_available: false,
  }
}

function additivePayoutAmount(
  compBase: number,
  p: DealCommissionRoleParticipant
): number {
  if (p.overrideAmount != null) return roundMoney(p.overrideAmount)
  if (p.overridePercent != null) return roundMoney(compBase * (p.overridePercent / 100))
  return 0
}

async function backfillDealCommissionRolesForJob(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string,
  participants: PayrollParticipant[]
): Promise<number> {
  let inserted = 0
  for (const part of participants) {
    const dealRole = participantRoleToDealCommissionRole(part.role)
    if (!dealRole) continue

    const { data: existing } = await supabase
      .from('deal_commission_roles')
      .select('id')
      .eq('job_id', jobId)
      .eq('role', dealRole)
      .eq('user_id', part.userId)
      .maybeSingle()

    if (existing) continue

    const { error } = await supabase.from('deal_commission_roles').insert({
      org_id: orgId,
      job_id: jobId,
      role: dealRole,
      user_id: part.userId,
    })

    if (!error) inserted += 1
    else console.error('deal_commission_roles backfill', jobId, dealRole, error)
  }
  return inserted
}

/**
 * Persists job snapshots and payout lines for a period using the same math as payroll export.
 * Idempotent: skips row creation when payout lines already exist for the period.
 */
export async function runPayrollPeriodLockBackfill(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    periodId: string
    cutoffAt: string
    lockedBy: string
    lockedAt: string
    scheduledPayDate?: string | null
  }
): Promise<PayrollPeriodLockBackfillResult> {
  const { orgId, periodId, cutoffAt, lockedBy, lockedAt, scheduledPayDate } = opts

  const { count: existingLineCount, error: countErr } = await supabase
    .from('payroll_payout_lines')
    .select('id', { count: 'exact', head: true })
    .eq('payroll_period_id', periodId)
    .eq('org_id', orgId)

  if (countErr) {
    throw new Error('Failed to check existing payout lines')
  }

  const { data: periodSnap, error: snapErr } = await supabase
    .from('payroll_period_snapshots')
    .upsert(
      {
        org_id: orgId,
        payroll_period_id: periodId,
        locked_at: lockedAt,
        locked_by: lockedBy,
      },
      { onConflict: 'payroll_period_id' }
    )
    .select('id')
    .single()

  if (snapErr || !periodSnap) {
    throw new Error('Failed to upsert payroll period snapshot')
  }

  const periodSnapshotId = periodSnap.id as string

  if ((existingLineCount ?? 0) > 0) {
    return {
      jobsSnapshotted: 0,
      linesCreated: 0,
      repsAffected: 0,
      rolesBackfilled: 0,
      skippedExisting: true,
    }
  }

  const { from, to } = await resolvePeriodSaleDateRange(supabase, orgId, cutoffAt)
  const exportRows = await computePayrollExportRowsForDateRange(supabase, orgId, from, to)

  const jobIds = Array.from(new Set(exportRows.map((r) => r.job_id)))
  if (!jobIds.length) {
    return {
      jobsSnapshotted: 0,
      linesCreated: 0,
      repsAffected: 0,
      rolesBackfilled: 0,
      skippedExisting: false,
    }
  }

  const { data: jobs, error: jobsErr } = await supabase
    .from('production_jobs')
    .select(
      'id, sale_amount, commission_pre_tax_subtotal, commission_comp_base, dealer_fee_amount, salesperson_id, project_id'
    )
    .eq('org_id', orgId)
    .in('id', jobIds)

  if (jobsErr) {
    throw new Error('Failed to load jobs for lock backfill')
  }

  const projectIds = Array.from(
    new Set((jobs || []).map((j) => j.project_id).filter(Boolean))
  ) as string[]

  const { data: projects } =
    projectIds.length > 0
      ? await supabase.from('projects').select('id, opportunity_id').in('id', projectIds)
      : { data: [] as { id: string; opportunity_id: string | null }[] }

  const projectOpp = new Map<string, string | null>()
  for (const p of projects || []) {
    projectOpp.set(p.id, p.opportunity_id ?? null)
  }

  const oppIds = Array.from(new Set(Array.from(projectOpp.values()).filter(Boolean))) as string[]

  const { data: opps } =
    oppIds.length > 0
      ? await supabase.from('opportunities').select('id, owner_user_id, setter_user_id').in('id', oppIds)
      : { data: [] as { id: string; owner_user_id: string | null; setter_user_id: string | null }[] }

  const opportunityById = new Map<string, { owner_user_id?: string | null; setter_user_id?: string | null }>()
  for (const o of opps || []) {
    opportunityById.set(o.id, { owner_user_id: o.owner_user_id, setter_user_id: o.setter_user_id })
  }

  const opportunityByProjectId = new Map<
    string,
    { owner_user_id?: string | null; setter_user_id?: string | null } | null
  >()
  for (const [pid, oid] of Array.from(projectOpp.entries())) {
    if (!oid) {
      opportunityByProjectId.set(pid, null)
      continue
    }
    opportunityByProjectId.set(pid, opportunityById.get(oid) ?? null)
  }

  const jobById = new Map((jobs || []).map((j) => [j.id as string, j]))
  const rowsByJob = new Map<string, PayrollExportRow[]>()
  for (const row of exportRows) {
    const list = rowsByJob.get(row.job_id) || []
    list.push(row)
    rowsByJob.set(row.job_id, list)
  }

  const { data: dealRoleRows } = await supabase
    .from('deal_commission_roles')
    .select(
      'job_id, user_id, role, override_amount, override_percent, premier_pricing_amount'
    )
    .eq('org_id', orgId)
    .in('job_id', jobIds)

  const rolesByJob = new Map<string, Record<string, unknown>[]>()
  for (const r of dealRoleRows || []) {
    const jid = r.job_id as string
    const list = rolesByJob.get(jid) || []
    list.push(r as Record<string, unknown>)
    rolesByJob.set(jid, list)
  }

  const payDate = scheduledPayDate?.slice(0, 10) ?? null
  let jobsSnapshotted = 0
  let linesCreated = 0
  let rolesBackfilled = 0
  const repIds = new Set<string>()
  const lineKeys = new Set<string>()

  for (const jobId of jobIds) {
    const job = jobById.get(jobId)
    if (!job) continue

    const jobRows = rowsByJob.get(jobId) || []
    const snap = buildCommissionPayrollSnapshot(job)
    const compBase = snap.compBase ?? 0

    const pid = job.project_id as string | null | undefined
    const opp = pid ? opportunityByProjectId.get(pid) ?? null : null
    const participants = collectParticipants(job, opp)

    rolesBackfilled += await backfillDealCommissionRolesForJob(supabase, orgId, jobId, participants)

    const lineAmountsForJob: { row: PayrollExportRow; amount: number; explicit?: Record<string, unknown> }[] =
      []

    for (const row of jobRows) {
      const explicit = findDealCommissionRoleRowForUser(
        rolesByJob,
        jobId,
        row.user_id,
        row.participant_role
      )
      const amount = lockPayoutGrossAmount(row.scaled_commission, compBase, explicit)
      lineAmountsForJob.push({ row, amount, explicit })
    }

    const participantsJson = lineAmountsForJob.map(({ row, amount }) => ({
      userId: row.user_id,
      role: row.participant_role,
      grossAmount: amount,
      rawCommission: row.raw_commission,
      compPlanId: row.comp_plan_id,
      compPlanName: row.comp_plan_name,
      planType: row.plan_type,
    }))

    const grossTotal = roundMoney(lineAmountsForJob.reduce((s, { amount }) => s + amount, 0))

    const { data: jobSnap, error: jobSnapErr } = await supabase
      .from('payroll_job_snapshots')
      .upsert(
        {
          org_id: orgId,
          payroll_period_snapshot_id: periodSnapshotId,
          payroll_period_id: periodId,
          job_id: jobId,
          contract_total: job.sale_amount != null ? roundMoney(job.sale_amount) : null,
          dealer_fee: snap.dealerFeeAmount,
          commission_base: compBase > 0 ? compBase : null,
          chargebacks_applied: 0,
          comp_plan_version: null,
          participants: participantsJson,
          gross_payout_total: grossTotal,
          net_payout_total: grossTotal,
          pay_date: payDate,
          payload: { exportFrom: from, exportTo: to, poolCap: snap.poolCap },
        },
        { onConflict: 'payroll_period_id,job_id' }
      )
      .select('id')
      .single()

    if (jobSnapErr || !jobSnap) {
      console.error('payroll_job_snapshots upsert', jobId, jobSnapErr)
      throw new Error(`Failed to snapshot job ${jobId}`)
    }

    jobsSnapshotted += 1
    const jobSnapshotId = jobSnap.id as string

    for (const { row, amount, explicit } of lineAmountsForJob) {
      const lineKey = `${jobId}|${row.user_id}|${row.participant_role}`
      if (lineKeys.has(lineKey)) continue
      lineKeys.add(lineKey)

      const { error: lineErr } = await supabase.from('payroll_payout_lines').insert({
        org_id: orgId,
        payroll_period_id: periodId,
        payroll_job_snapshot_id: jobSnapshotId,
        job_id: jobId,
        user_id: row.user_id,
        participant_role: row.participant_role,
        gross_amount: amount,
        net_amount: amount,
        chargeback_applied_amount: 0,
        hourly_earnings: 0,
        comp_plan_snapshot: compPlanSnapshotFromExportRow(row, compBase, explicit, amount),
      })

      if (lineErr) {
        console.error('payroll_payout_lines insert', lineKey, lineErr)
        throw new Error(`Failed to create payout line for job ${jobId}`)
      }

      linesCreated += 1
      repIds.add(row.user_id)
    }

    const additive = await loadAdditiveDealCommissionParticipants(supabase, orgId, jobId)
    for (const add of additive) {
      const explicit = findDealCommissionRoleRowForUser(rolesByJob, jobId, add.userId, add.role)
      const engine = additivePayoutAmount(compBase, add)
      const amount = lockPayoutGrossAmount(engine, compBase, explicit ?? {
        override_amount: add.overrideAmount,
        override_percent: add.overridePercent,
        premier_pricing_amount: add.premierPricingAmount,
      })
      if (amount <= 0) continue

      const lineKey = `${jobId}|${add.userId}|${add.role}`
      if (lineKeys.has(lineKey)) continue
      lineKeys.add(lineKey)

      const { error: addErr } = await supabase.from('payroll_payout_lines').insert({
        org_id: orgId,
        payroll_period_id: periodId,
        payroll_job_snapshot_id: jobSnapshotId,
        job_id: jobId,
        user_id: add.userId,
        participant_role: add.role,
        gross_amount: amount,
        net_amount: amount,
        chargeback_applied_amount: 0,
        hourly_earnings: 0,
        comp_plan_snapshot: {
          additive: true,
          role: add.role,
          override_amount: explicit?.override_amount ?? add.overrideAmount,
          override_percent: explicit?.override_percent ?? add.overridePercent,
          premier_pricing_amount:
            explicit?.premier_pricing_amount ?? add.premierPricingAmount,
          scaled_commission: amount,
        },
      })

      if (addErr) {
        console.error('payroll_payout_lines additive', lineKey, addErr)
        throw new Error(`Failed to create additive payout line for job ${jobId}`)
      }

      linesCreated += 1
      repIds.add(add.userId)
    }
  }

  return {
    jobsSnapshotted,
    linesCreated,
    repsAffected: repIds.size,
    rolesBackfilled,
    skippedExisting: false,
  }
}
