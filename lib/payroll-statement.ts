import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { roundMoney } from '@/lib/money'
import {
  loadAdditiveDealCommissionParticipants,
  type DealCommissionRoleParticipant,
  type PayrollExportRow,
} from '@/lib/payroll-export'
import { formatParticipantRoleLabel, formatPayrollMoney } from '@/lib/payroll-format'
import { computePayrollExportRowsForDateRange } from '@/lib/payroll-period-export-engine'
import {
  participantRoleToDealCommissionRole,
  resolvePeriodSaleDateRange,
} from '@/lib/payroll-period-lock'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'

export type PayrollStatementMode = 'estimated' | 'final'

export type PayrollStatementBreakdownItem = {
  key: string
  label: string
  amount: number
}

export type PayrollStatementDealRow = {
  jobId: string
  jobNumber: string | null
  customerName: string | null
  holdStatus: 'held_till_install' | 'released' | 'paid' | null
  ntpDate: string | null
  installDate: string | null
  commissionableAmount: number | null
  role: string
  /** Pre-chargeback amount for this participation line */
  grossAmount: number
  ntpCommission: number
  revenueCommission: number
  premierPricingCommission: number
  overrideAmount: number
  /** Net for this line (after line-level chargebacks when final) */
  dealTotal: number
  planName: string | null
  lineComponents: PayrollStatementBreakdownItem[]
  /** Plain-language trace for expandable "how calculated" panel */
  calculationNotes: string[]
}

export type PayrollStatementChargebackRow = {
  chargebackId: string
  appliedAmount: number
  reason: string | null
  jobId: string | null
}

/** grossCommission is always pre-chargeback; netPayout = grossCommission + hourly − chargebacksApplied */
export type PayrollStatementTotals = {
  grossCommission: number
  hourlyEarnings: number
  chargebacksApplied: number
  netPayout: number
  hasDeficit: boolean
  grossCommissionDefinition: 'pre_chargeback'
}

export type PayrollStatementPayload = {
  mode: PayrollStatementMode
  statementCalculatedAt: string
  periodStatus: string
  dataFreshnessNote: string
  projectedBreakdown: PayrollStatementBreakdownItem[]
  period: {
    id: string
    label: string
    cutoffAt: string
    payDate: string
    status: string
  }
  rep: { id: string; name: string }
  deals: PayrollStatementDealRow[]
  hourly: {
    regularHours: number
    overtimeHours: number
    hourlyRate: number
    regularEarnings: number
    overtimeEarnings: number
    total: number
    notes: string | null
  } | null
  totals: PayrollStatementTotals
  chargebacks: PayrollStatementChargebackRow[]
}

/** Maps payout/export participant_role to deal_commission_roles.role for joins. */
export function dealCommissionRoleForParticipant(participantRole: string): string {
  const mapped = participantRoleToDealCommissionRole(
    participantRole as 'sales_rep' | 'setter' | 'owner'
  )
  if (mapped) return mapped
  return participantRole
}

/** Applies deal_commission_roles overrides on top of export-engine amounts (preview / open period). */
/** Gross payout for lock lines — same resolver as estimated statement preview. */
export function lockPayoutGrossAmount(
  engineAmount: number,
  compBase: number,
  explicit: Record<string, unknown> | undefined
): number {
  return resolveParticipantLineAmount(engineAmount, compBase, explicit).grossAmount
}

export function findDealCommissionRoleRow(
  rolesByJob: Map<string, Record<string, unknown>[]>,
  jobId: string,
  participantRole: string
): Record<string, unknown> | undefined {
  return findDealRoleRow(rolesByJob, jobId, participantRole)
}

export function findDealCommissionRoleRowForUser(
  rolesByJob: Map<string, Record<string, unknown>[]>,
  jobId: string,
  userId: string,
  participantRole: string
): Record<string, unknown> | undefined {
  const dealRole = dealCommissionRoleForParticipant(participantRole)
  return (rolesByJob.get(jobId) || []).find(
    (r) => r.role === dealRole && (r.user_id as string) === userId
  )
}

export function resolveParticipantLineAmount(
  engineAmount: number,
  compBase: number,
  explicit: Record<string, unknown> | undefined
): {
  grossAmount: number
  overrideAmount: number
  overridePercent: number | null
  premierPricingCommission: number
} {
  const premier = roundMoney(Number(explicit?.premier_pricing_amount) || 0)
  const rawOverride = explicit?.override_amount
  if (rawOverride != null && rawOverride !== '' && Number.isFinite(Number(rawOverride))) {
    const overrideAmount = roundMoney(Number(rawOverride))
    return {
      grossAmount: roundMoney(overrideAmount + premier),
      overrideAmount,
      overridePercent: null,
      premierPricingCommission: premier,
    }
  }
  const rawPct = explicit?.override_percent
  if (rawPct != null && rawPct !== '' && compBase > 0 && Number.isFinite(Number(rawPct))) {
    const overridePercent = Number(rawPct)
    const overrideAmount = roundMoney(compBase * (overridePercent / 100))
    return {
      grossAmount: roundMoney(overrideAmount + premier),
      overrideAmount,
      overridePercent,
      premierPricingCommission: premier,
    }
  }
  return {
    grossAmount: roundMoney(engineAmount + premier),
    overrideAmount: 0,
    overridePercent: null,
    premierPricingCommission: premier,
  }
}

export function computePayrollStatementTotals(input: {
  deals: Pick<PayrollStatementDealRow, 'grossAmount' | 'dealTotal'>[]
  hourlyTotal: number
  chargebacksApplied: number
}): PayrollStatementTotals {
  const grossCommission = roundMoney(input.deals.reduce((s, d) => s + (Number(d.grossAmount) || 0), 0))
  const hourlyEarnings = roundMoney(input.hourlyTotal)
  const chargebacksApplied = roundMoney(input.chargebacksApplied)
  const netPayout = roundMoney(grossCommission + hourlyEarnings - chargebacksApplied)
  return {
    grossCommission,
    hourlyEarnings,
    chargebacksApplied,
    netPayout,
    hasDeficit: netPayout < 0,
    grossCommissionDefinition: 'pre_chargeback',
  }
}

export function aggregateProjectedBreakdown(
  deals: Pick<PayrollStatementDealRow, 'lineComponents'>[]
): PayrollStatementBreakdownItem[] {
  const byKey = new Map<string, PayrollStatementBreakdownItem>()
  for (const deal of deals) {
    for (const c of deal.lineComponents) {
      const prev = byKey.get(c.key)
      if (prev) {
        prev.amount = roundMoney(prev.amount + c.amount)
      } else {
        byKey.set(c.key, { key: c.key, label: c.label, amount: roundMoney(c.amount) })
      }
    }
  }
  return Array.from(byKey.values()).filter((c) => c.amount !== 0).sort((a, b) => a.label.localeCompare(b.label))
}

function lineComponentsFromSnapshot(
  snap: Record<string, unknown> | null | undefined,
  participantRole: string
): PayrollStatementBreakdownItem[] {
  if (!snap) return []

  if (snap.additive) {
    const scaled = roundMoney(Number(snap.scaled_commission) || 0)
    const role = String(snap.role || participantRole)
    if (scaled <= 0) return []
    return [
      {
        key: `additive:${role}`,
        label: formatParticipantRoleLabel(role),
        amount: scaled,
      },
    ]
  }

  const planName = (snap.comp_plan_name as string) || 'Commission'
  const scaled = roundMoney(Number(snap.scaled_commission) || 0)
  const volFlat = roundMoney(Number(snap.volume_bonus_flat) || 0)
  const items: PayrollStatementBreakdownItem[] = []

  const baseAmount = roundMoney(Math.max(0, scaled - volFlat))
  if (baseAmount > 0) {
    items.push({
      key: `plan:${snap.comp_plan_id || planName}:base`,
      label: planName,
      amount: baseAmount,
    })
  }
  if (volFlat > 0) {
    items.push({ key: 'volume_bonus', label: 'Volume bonus', amount: volFlat })
  }
  if (items.length === 0 && scaled > 0) {
    items.push({ key: `plan:${snap.comp_plan_id || 'commission'}`, label: planName, amount: scaled })
  }
  return items
}

function calculationNotesFromExportRow(row: PayrollExportRow): string[] {
  const notes: string[] = []
  if (row.comp_plan_name) notes.push(`Comp plan: ${row.comp_plan_name}`)
  if (row.pool_cap != null) {
    notes.push(`Job commission pool cap: ${formatPayrollMoney(row.pool_cap)}`)
  }
  if (row.pool_cap_enforced) {
    notes.push('Your amount was scaled so total job commissions fit the pool cap.')
  }
  const raw = roundMoney(row.raw_commission)
  const scaled = roundMoney(row.scaled_commission)
  if (raw !== scaled && raw > 0) {
    notes.push(
      `Before pool cap: ${formatPayrollMoney(raw)} → after cap: ${formatPayrollMoney(scaled)}`
    )
  }
  if (row.effective_rate_pct != null && row.effective_rate_pct > 0) {
    notes.push(`Effective rate on commissionable base: ${row.effective_rate_pct}%`)
  }
  if (row.note) notes.push(row.note)
  return notes
}

function calculationNotesFromCompSnapshot(
  snap: Record<string, unknown> | null | undefined,
  jobSnapshotPayload?: Record<string, unknown> | null
): string[] {
  const notes: string[] = []
  if (!snap) return notes
  if (snap.comp_plan_name) notes.push(`Comp plan: ${String(snap.comp_plan_name)}`)
  const poolCap = jobSnapshotPayload?.poolCap
  if (poolCap != null && Number.isFinite(Number(poolCap))) {
    notes.push(`Job commission pool cap: ${formatPayrollMoney(Number(poolCap))}`)
  }
  if (snap.pool_cap_enforced) {
    notes.push('Pool cap was applied when this period was locked.')
  }
  const raw = roundMoney(Number(snap.raw_commission) || 0)
  const scaled = roundMoney(Number(snap.scaled_commission) || 0)
  if (raw !== scaled && raw > 0) {
    notes.push(
      `Before pool cap: ${formatPayrollMoney(raw)} → locked amount: ${formatPayrollMoney(scaled)}`
    )
  }
  if (snap.note) notes.push(String(snap.note))
  if (snap.additive) notes.push('Manager or custom role add-on (not in main pool split).')
  return notes
}

function lineComponentsFromExportRow(row: PayrollExportRow): PayrollStatementBreakdownItem[] {
  const snap = {
    comp_plan_id: row.comp_plan_id,
    comp_plan_name: row.comp_plan_name,
    scaled_commission: row.scaled_commission,
    volume_bonus_flat: row.volume_bonus_flat,
  }
  return lineComponentsFromSnapshot(snap, row.participant_role)
}

function resolveHoldStatus(
  holdRaw: string | null | undefined,
  installed: boolean,
  periodStatus: string
): PayrollStatementDealRow['holdStatus'] {
  if (holdRaw === 'held_till_install' && !installed) return 'held_till_install'
  if (holdRaw === 'released') return 'released'
  if (periodStatus === 'paid') return 'paid'
  return null
}

function findDealRoleRow(
  rolesByJob: Map<string, Record<string, unknown>[]>,
  jobId: string,
  participantRole: string
) {
  const dealRole = dealCommissionRoleForParticipant(participantRole)
  return (rolesByJob.get(jobId) || []).find((r) => r.role === dealRole)
}

function additivePayoutAmount(compBase: number, p: DealCommissionRoleParticipant): number {
  if (p.overrideAmount != null) return roundMoney(p.overrideAmount)
  if (p.overridePercent != null) return roundMoney(compBase * (p.overridePercent / 100))
  return roundMoney(Number(p.premierPricingAmount) || 0)
}

type JobDisplay = {
  id: string
  job_number?: string | null
  customer_id?: string | null
  commission_comp_base?: number | null
  ntp_date?: string | null
  commission_hold_status?: string | null
  completed_at?: string | null
}

type JobSnapshotRow = {
  id: string
  job_id: string
  commission_base?: number | null
  payload?: Record<string, unknown> | null
}

async function loadCustomerNames(
  supabase: SupabaseClient,
  customerIds: string[]
): Promise<Map<string, string>> {
  const customerNameById = new Map<string, string>()
  if (!customerIds.length) return customerNameById
  const { data: customers } = await supabase.from('customers').select('id, name').in('id', customerIds)
  for (const c of customers || []) {
    customerNameById.set(c.id as string, (c.name as string) || '')
  }
  return customerNameById
}

async function loadRepHours(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
  userId: string
) {
  const { data: hoursRow } = await supabase
    .from('payroll_rep_hours')
    .select('regular_hours, overtime_hours, hourly_rate_snapshot, hourly_earnings, notes')
    .eq('payroll_period_id', periodId)
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!hoursRow) return null

  const rate = Number(hoursRow.hourly_rate_snapshot) || 0
  const reg = Number(hoursRow.regular_hours) || 0
  const ot = Number(hoursRow.overtime_hours) || 0
  const computed = computeHourlyEarnings({ regularHours: reg, overtimeHours: ot, hourlyRate: rate })
  return {
    regularHours: reg,
    overtimeHours: ot,
    hourlyRate: rate,
    regularEarnings: computed.regularEarnings,
    overtimeEarnings: computed.overtimeEarnings,
    total: Number(hoursRow.hourly_earnings) || computed.total,
    notes: (hoursRow.notes as string) || null,
  }
}

function buildDealRowFromExport(
  row: PayrollExportRow,
  job: JobDisplay | undefined,
  customerName: string | null,
  explicit: Record<string, unknown> | undefined,
  periodStatus: string
): PayrollStatementDealRow {
  const compBase = row.commission_comp_base ?? 0
  const resolved = resolveParticipantLineAmount(row.scaled_commission, compBase, explicit)
  const installed = Boolean(job?.completed_at)
  const holdStatus = resolveHoldStatus(job?.commission_hold_status, installed, periodStatus)
  const lineComponents = lineComponentsFromExportRow(row)
  if (resolved.overrideAmount > 0 || resolved.overridePercent != null) {
    lineComponents.push({
      key: `override:${row.job_id}:${row.participant_role}`,
      label: 'Manual override',
      amount: resolved.grossAmount - resolved.premierPricingCommission,
    })
  }

  return {
    jobId: row.job_id,
    jobNumber: row.job_number ?? (job?.job_number as string) ?? null,
    customerName: row.customer_name ?? customerName,
    holdStatus,
    ntpDate: (job?.ntp_date as string) || null,
    installDate: job?.completed_at ? String(job.completed_at).slice(0, 10) : null,
    commissionableAmount: row.commission_comp_base,
    role: row.participant_role,
    grossAmount: resolved.grossAmount,
    ntpCommission: 0,
    revenueCommission: resolved.grossAmount - resolved.premierPricingCommission,
    premierPricingCommission: resolved.premierPricingCommission,
    overrideAmount: resolved.overrideAmount,
    dealTotal: resolved.grossAmount,
    planName: row.comp_plan_name,
    lineComponents,
    calculationNotes: calculationNotesFromExportRow(row),
  }
}

function buildDealRowFromPayoutLine(input: {
  line: {
    job_id: string
    participant_role: string
    gross_amount: unknown
    net_amount: unknown
    comp_plan_snapshot?: Record<string, unknown> | null
  }
  job: JobDisplay | undefined
  snapshot: JobSnapshotRow | undefined
  customerName: string | null
  explicit: Record<string, unknown> | undefined
  periodStatus: string
}): PayrollStatementDealRow {
  const snap = input.line.comp_plan_snapshot
  const gross = roundMoney(Number(input.line.gross_amount) || 0)
  const net = roundMoney(Number(input.line.net_amount) || 0)
  const scaled =
    snap && !snap.additive
      ? roundMoney(Number(snap.scaled_commission) || gross)
      : snap?.additive
        ? roundMoney(Number(snap.scaled_commission) || gross)
        : gross
  const overrideAmt =
    Number(input.explicit?.override_amount) ||
    (snap?.additive ? Number(snap.override_amount) : 0) ||
    0
  const premier =
    Number(input.explicit?.premier_pricing_amount) ||
    (snap?.additive ? Number(snap.premier_pricing_amount) : 0) ||
    0
  const installed = Boolean(input.job?.completed_at)
  const holdStatus = resolveHoldStatus(
    input.job?.commission_hold_status,
    installed,
    input.periodStatus
  )

  return {
    jobId: input.line.job_id as string,
    jobNumber: (input.job?.job_number as string) || null,
    customerName: input.customerName,
    holdStatus,
    ntpDate: (input.job?.ntp_date as string) || null,
    installDate: input.job?.completed_at ? String(input.job.completed_at).slice(0, 10) : null,
    commissionableAmount:
      input.snapshot?.commission_base != null
        ? Number(input.snapshot.commission_base)
        : input.job?.commission_comp_base != null
          ? Number(input.job.commission_comp_base)
          : null,
    role: input.line.participant_role as string,
    grossAmount: gross,
    ntpCommission: 0,
    revenueCommission: scaled,
    premierPricingCommission: premier,
    overrideAmount: overrideAmt,
    dealTotal: net,
    planName: (snap?.comp_plan_name as string) || null,
    lineComponents: lineComponentsFromSnapshot(snap, input.line.participant_role as string),
    calculationNotes: calculationNotesFromCompSnapshot(snap, input.snapshot?.payload ?? null),
  }
}

async function buildEstimatedStatement(
  supabase: SupabaseClient,
  orgId: string,
  period: { id: string; period_label: string; cutoff_at: string; scheduled_pay_date: string; status: string },
  userId: string,
  repName: string
): Promise<PayrollStatementPayload> {
  const calculatedAt = new Date().toISOString()
  const { from, to } = await resolvePeriodSaleDateRange(supabase, orgId, period.cutoff_at as string)
  const exportRows = await computePayrollExportRowsForDateRange(supabase, orgId, from, to)
  const repRows = exportRows.filter((r) => r.user_id === userId)

  const jobIds = Array.from(new Set(exportRows.map((r) => r.job_id)))
  const { data: jobs } =
    jobIds.length > 0
      ? await supabase
          .from('production_jobs')
          .select(
            'id, job_number, customer_id, commission_comp_base, ntp_date, commission_hold_status, completed_at, project_id'
          )
          .eq('org_id', orgId)
          .in('id', jobIds)
      : { data: [] as JobDisplay[] }

  const jobById = new Map((jobs || []).map((j) => [j.id as string, j as JobDisplay]))
  const customerIds = Array.from(
    new Set((jobs || []).map((j) => j.customer_id as string | null).filter(Boolean))
  ) as string[]
  const customerNameById = await loadCustomerNames(supabase, customerIds)

  const { data: roleRows } =
    jobIds.length > 0
      ? await supabase
          .from('deal_commission_roles')
          .select('job_id, role, override_amount, override_percent, premier_pricing_amount')
          .eq('org_id', orgId)
          .eq('user_id', userId)
          .in('job_id', jobIds)
      : { data: [] as Record<string, unknown>[] }

  const rolesByJob = new Map<string, Record<string, unknown>[]>()
  for (const r of roleRows || []) {
    const jid = r.job_id as string
    const list = rolesByJob.get(jid) || []
    list.push(r)
    rolesByJob.set(jid, list)
  }

  const deals: PayrollStatementDealRow[] = repRows.map((row) => {
    const job = jobById.get(row.job_id)
    const cid = job?.customer_id as string | null | undefined
    const customerName = row.customer_name ?? (cid ? customerNameById.get(cid) ?? null : null)
    const explicit = findDealRoleRow(rolesByJob, row.job_id, row.participant_role)
    return buildDealRowFromExport(row, job, customerName, explicit, period.status as string)
  })

  const seenLineKeys = new Set(deals.map((d) => `${d.jobId}|${d.role}`))

  for (const jobId of jobIds) {
    const job = jobById.get(jobId)
    if (!job) continue
    const snap = buildCommissionPayrollSnapshot(job)
    const compBase = snap.compBase ?? 0
    const additive = await loadAdditiveDealCommissionParticipants(supabase, orgId, jobId)
    for (const add of additive) {
      if (add.userId !== userId) continue
      const lineKey = `${jobId}|${add.role}`
      if (seenLineKeys.has(lineKey)) continue
      seenLineKeys.add(lineKey)

      const amount = additivePayoutAmount(compBase, add)
      if (amount <= 0) continue

      const cid = job.customer_id as string | null | undefined
      const explicit = findDealRoleRow(rolesByJob, jobId, add.role)
      const installed = Boolean(job.completed_at)
      deals.push({
        jobId,
        jobNumber: (job.job_number as string) || null,
        customerName: cid ? customerNameById.get(cid) ?? null : null,
        holdStatus: resolveHoldStatus(job.commission_hold_status, installed, period.status as string),
        ntpDate: (job.ntp_date as string) || null,
        installDate: job.completed_at ? String(job.completed_at).slice(0, 10) : null,
        commissionableAmount: compBase > 0 ? compBase : null,
        role: add.role,
        grossAmount: amount,
        ntpCommission: 0,
        revenueCommission: amount,
        premierPricingCommission: Number(explicit?.premier_pricing_amount) || add.premierPricingAmount || 0,
        overrideAmount: Number(explicit?.override_amount) || add.overrideAmount || 0,
        dealTotal: amount,
        planName: null,
        lineComponents: lineComponentsFromSnapshot(
          {
            additive: true,
            role: add.role,
            scaled_commission: amount,
            override_amount: add.overrideAmount,
            premier_pricing_amount: add.premierPricingAmount,
          },
          add.role
        ),
        calculationNotes: ['Manager or custom role add-on (not in main pool split).'],
      })
    }
  }

  const hourly = await loadRepHours(supabase, orgId, period.id as string, userId)
  const totals = computePayrollStatementTotals({
    deals,
    hourlyTotal: hourly?.total ?? 0,
    chargebacksApplied: 0,
  })

  return {
    mode: 'estimated',
    statementCalculatedAt: calculatedAt,
    periodStatus: period.status as string,
    dataFreshnessNote:
      'Estimated from live jobs and comp plans using the same engine as payroll export. Amounts may change until the period is locked.',
    projectedBreakdown: aggregateProjectedBreakdown(deals),
    period: {
      id: period.id as string,
      label: period.period_label as string,
      cutoffAt: period.cutoff_at as string,
      payDate: period.scheduled_pay_date as string,
      status: period.status as string,
    },
    rep: { id: userId, name: repName },
    deals,
    hourly,
    totals,
    chargebacks: [],
  }
}

async function buildFinalStatement(
  supabase: SupabaseClient,
  orgId: string,
  period: { id: string; period_label: string; cutoff_at: string; scheduled_pay_date: string; status: string },
  userId: string,
  repName: string
): Promise<PayrollStatementPayload> {
  const calculatedAt = new Date().toISOString()

  const { data: payoutLines } = await supabase
    .from('payroll_payout_lines')
    .select(
      'id, job_id, participant_role, gross_amount, net_amount, chargeback_applied_amount, comp_plan_snapshot, payroll_job_snapshot_id'
    )
    .eq('payroll_period_id', period.id)
    .eq('user_id', userId)
    .eq('org_id', orgId)

  const lines = payoutLines || []
  const snapshotIds = Array.from(
    new Set(lines.map((l) => l.payroll_job_snapshot_id as string).filter(Boolean))
  )
  const jobIds = Array.from(new Set(lines.map((l) => l.job_id as string)))

  const [{ data: snapshots }, { data: jobs }, { data: roleRows }] = await Promise.all([
    snapshotIds.length
      ? supabase
          .from('payroll_job_snapshots')
          .select('id, job_id, commission_base, payload')
          .in('id', snapshotIds)
      : Promise.resolve({ data: [] as JobSnapshotRow[] }),
    jobIds.length
      ? supabase
          .from('production_jobs')
          .select(
            'id, job_number, customer_id, commission_comp_base, ntp_date, commission_hold_status, completed_at'
          )
          .eq('org_id', orgId)
          .in('id', jobIds)
      : Promise.resolve({ data: [] as JobDisplay[] }),
    jobIds.length
      ? supabase
          .from('deal_commission_roles')
          .select('job_id, role, override_amount, override_percent, premier_pricing_amount')
          .eq('org_id', orgId)
          .eq('user_id', userId)
          .in('job_id', jobIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])

  const snapshotById = new Map((snapshots || []).map((s) => [s.id as string, s as JobSnapshotRow]))
  const snapshotByJobId = new Map((snapshots || []).map((s) => [s.job_id as string, s as JobSnapshotRow]))
  const jobById = new Map((jobs || []).map((j) => [j.id as string, j as JobDisplay]))

  const customerIds = Array.from(
    new Set((jobs || []).map((j) => j.customer_id as string | null).filter(Boolean))
  ) as string[]
  const customerNameById = await loadCustomerNames(supabase, customerIds)

  const rolesByJob = new Map<string, Record<string, unknown>[]>()
  for (const r of roleRows || []) {
    const jid = r.job_id as string
    const list = rolesByJob.get(jid) || []
    list.push(r)
    rolesByJob.set(jid, list)
  }

  const deals: PayrollStatementDealRow[] = lines.map((line) => {
    const job = jobById.get(line.job_id as string)
    const snap =
      snapshotById.get(line.payroll_job_snapshot_id as string) ||
      snapshotByJobId.get(line.job_id as string)
    const cid = job?.customer_id as string | null | undefined
    const customerName = cid ? customerNameById.get(cid) ?? null : null
    const explicit = findDealRoleRow(rolesByJob, line.job_id as string, line.participant_role as string)
    return buildDealRowFromPayoutLine({
      line: {
        ...line,
        comp_plan_snapshot: line.comp_plan_snapshot as Record<string, unknown> | null,
      },
      job,
      snapshot: snap,
      customerName,
      explicit,
      periodStatus: period.status as string,
    })
  })

  const payoutLineIds = lines.map((l) => l.id as string)
  const { data: cbApps } =
    payoutLineIds.length > 0
      ? await supabase
          .from('payroll_chargeback_applications')
          .select('applied_amount, payout_line_id, chargeback_id, payroll_chargebacks(reason, job_id)')
          .eq('payroll_period_id', period.id)
          .in('payout_line_id', payoutLineIds)
      : { data: [] as Record<string, unknown>[] }

  const chargebacks: PayrollStatementChargebackRow[] = (cbApps || []).map((a) => {
    const cb = a.payroll_chargebacks as { reason?: string; job_id?: string } | null
    return {
      chargebackId: a.chargeback_id as string,
      appliedAmount: Number(a.applied_amount) || 0,
      reason: cb?.reason ?? null,
      jobId: cb?.job_id ?? null,
    }
  })

  const hourly = await loadRepHours(supabase, orgId, period.id as string, userId)
  const chargebacksApplied = roundMoney(chargebacks.reduce((s, c) => s + c.appliedAmount, 0))
  const totals = computePayrollStatementTotals({
    deals,
    hourlyTotal: hourly?.total ?? 0,
    chargebacksApplied,
  })

  return {
    mode: 'final',
    statementCalculatedAt: calculatedAt,
    periodStatus: period.status as string,
    dataFreshnessNote:
      'Official statement from locked payout lines and job snapshots. Commission amounts are not recalculated from live jobs.',
    projectedBreakdown: aggregateProjectedBreakdown(deals),
    period: {
      id: period.id as string,
      label: period.period_label as string,
      cutoffAt: period.cutoff_at as string,
      payDate: period.scheduled_pay_date as string,
      status: period.status as string,
    },
    rep: { id: userId, name: repName },
    deals,
    hourly,
    totals,
    chargebacks,
  }
}

export async function buildPayrollStatement(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
  userId: string
): Promise<PayrollStatementPayload | null> {
  const { data: period, error: periodErr } = await supabase
    .from('payroll_periods')
    .select('id, period_label, cutoff_at, scheduled_pay_date, status')
    .eq('id', periodId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (periodErr || !period) return null

  const { data: rep } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  const repName = (rep?.full_name as string) || userId
  const status = period.status as string

  if (status === 'open') {
    return buildEstimatedStatement(supabase, orgId, period, userId, repName)
  }

  return buildFinalStatement(supabase, orgId, period, userId, repName)
}

/** Reps with export rows or saved hours in the period window. */
export async function listRepIdsWithPeriodActivity(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
  cutoffAt: string
): Promise<string[]> {
  const { from, to } = await resolvePeriodSaleDateRange(supabase, orgId, cutoffAt)
  const exportRows = await computePayrollExportRowsForDateRange(supabase, orgId, from, to)
  const repIds = new Set<string>(exportRows.map((r) => r.user_id))

  const { data: hoursRows } = await supabase
    .from('payroll_rep_hours')
    .select('user_id')
    .eq('payroll_period_id', periodId)
    .eq('org_id', orgId)

  for (const h of hoursRows || []) {
    repIds.add(h.user_id as string)
  }

  return Array.from(repIds)
}
