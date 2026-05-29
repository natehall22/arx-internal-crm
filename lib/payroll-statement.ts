import type { SupabaseClient } from '@supabase/supabase-js'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'

export type PayrollStatementDealRow = {
  jobId: string
  jobNumber: string | null
  customerName: string | null
  holdStatus: 'held_till_install' | 'released' | 'paid' | null
  ntpDate: string | null
  installDate: string | null
  commissionableAmount: number | null
  role: string
  ntpCommission: number
  revenueCommission: number
  premierPricingCommission: number
  overrideAmount: number
  dealTotal: number
}

export type PayrollStatementChargebackRow = {
  chargebackId: string
  appliedAmount: number
  reason: string | null
  jobId: string | null
}

export type PayrollStatementPayload = {
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
  totals: {
    grossCommission: number
    hourlyEarnings: number
    chargebacksApplied: number
    netPayout: number
    hasDeficit: boolean
  }
  chargebacks: PayrollStatementChargebackRow[]
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

  const { data: payoutLines } = await supabase
    .from('payroll_payout_lines')
    .select(
      'id, job_id, participant_role, gross_amount, net_amount, chargeback_applied_amount, hourly_earnings, total_earnings, payroll_job_snapshot_id'
    )
    .eq('payroll_period_id', periodId)
    .eq('user_id', userId)
    .eq('org_id', orgId)

  const jobIds = Array.from(new Set((payoutLines || []).map((l) => l.job_id as string)))

  const [{ data: jobs }, { data: hoursRow }, { data: roleRows }] = await Promise.all([
    jobIds.length
      ? supabase
          .from('production_jobs')
          .select(
            'id, job_number, customer_id, commission_comp_base, ntp_date, commission_hold_status, completed_at, sale_date'
          )
          .in('id', jobIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase
      .from('payroll_rep_hours')
      .select('regular_hours, overtime_hours, hourly_rate_snapshot, hourly_earnings, notes')
      .eq('payroll_period_id', periodId)
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle(),
    jobIds.length
      ? supabase
          .from('deal_commission_roles')
          .select('job_id, role, override_amount, premier_pricing_amount')
          .eq('org_id', orgId)
          .eq('user_id', userId)
          .in('job_id', jobIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])

  const customerIds = Array.from(
    new Set((jobs || []).map((j) => j.customer_id as string | null).filter(Boolean))
  ) as string[]
  const customerNameById = new Map<string, string>()
  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name')
      .in('id', customerIds)
    for (const c of customers || []) {
      customerNameById.set(c.id as string, (c.name as string) || '')
    }
  }

  const jobById = new Map((jobs || []).map((j) => [j.id as string, j]))
  const rolesByJob = new Map<string, Record<string, unknown>[]>()
  for (const r of roleRows || []) {
    const jid = r.job_id as string
    const list = rolesByJob.get(jid) || []
    list.push(r)
    rolesByJob.set(jid, list)
  }

  const payoutLineIds = (payoutLines || []).map((l) => l.id as string)
  const { data: cbApps } =
    payoutLineIds.length > 0
      ? await supabase
          .from('payroll_chargeback_applications')
          .select('applied_amount, payout_line_id, chargeback_id, payroll_chargebacks(reason, job_id)')
          .eq('payroll_period_id', periodId)
          .in('payout_line_id', payoutLineIds)
      : { data: [] as Record<string, unknown>[] }

  const deals: PayrollStatementDealRow[] = (payoutLines || []).map((line) => {
    const job = jobById.get(line.job_id as string)
    const cid = job?.customer_id as string | null | undefined
    const explicit = (rolesByJob.get(line.job_id as string) || []).find(
      (r) => r.role === line.participant_role
    )
    const gross = Number(line.gross_amount) || 0
    const net = Number(line.net_amount) || 0
    const overrideAmt = Number(explicit?.override_amount) || 0
    const premier = Number(explicit?.premier_pricing_amount) || 0
    const holdRaw = job?.commission_hold_status as string | null | undefined
    const installed = Boolean(job?.completed_at)
    let holdStatus: PayrollStatementDealRow['holdStatus'] = null
    if (holdRaw === 'held_till_install' && !installed) holdStatus = 'held_till_install'
    else if (holdRaw === 'released') holdStatus = 'released'
    else if (period.status === 'paid') holdStatus = 'paid'

    return {
      jobId: line.job_id as string,
      jobNumber: (job?.job_number as string) || null,
      customerName: cid ? customerNameById.get(cid) ?? null : null,
      holdStatus,
      ntpDate: (job?.ntp_date as string) || null,
      installDate: job?.completed_at ? String(job.completed_at).slice(0, 10) : null,
      commissionableAmount:
        job?.commission_comp_base != null ? Number(job.commission_comp_base) : null,
      role: line.participant_role as string,
      ntpCommission: 0,
      revenueCommission: gross,
      premierPricingCommission: premier,
      overrideAmount: overrideAmt,
      dealTotal: net,
    }
  })

  const chargebacks: PayrollStatementChargebackRow[] = (cbApps || []).map((a) => {
    const cb = a.payroll_chargebacks as { reason?: string; job_id?: string } | null
    return {
      chargebackId: a.chargeback_id as string,
      appliedAmount: Number(a.applied_amount) || 0,
      reason: cb?.reason ?? null,
      jobId: cb?.job_id ?? null,
    }
  })

  let hourly: PayrollStatementPayload['hourly'] = null
  if (hoursRow) {
    const rate = Number(hoursRow.hourly_rate_snapshot) || 0
    const reg = Number(hoursRow.regular_hours) || 0
    const ot = Number(hoursRow.overtime_hours) || 0
    const computed = computeHourlyEarnings({ regularHours: reg, overtimeHours: ot, hourlyRate: rate })
    hourly = {
      regularHours: reg,
      overtimeHours: ot,
      hourlyRate: rate,
      regularEarnings: computed.regularEarnings,
      overtimeEarnings: computed.overtimeEarnings,
      total: Number(hoursRow.hourly_earnings) || computed.total,
      notes: (hoursRow.notes as string) || null,
    }
  }

  const grossCommission = deals.reduce((s, d) => s + d.dealTotal, 0)
  const hourlyEarnings = hourly?.total ?? 0
  const chargebacksApplied = chargebacks.reduce((s, c) => s + c.appliedAmount, 0)
  const netPayout = grossCommission + hourlyEarnings - chargebacksApplied

  return {
    period: {
      id: period.id as string,
      label: period.period_label as string,
      cutoffAt: period.cutoff_at as string,
      payDate: period.scheduled_pay_date as string,
      status: period.status as string,
    },
    rep: { id: userId, name: (rep?.full_name as string) || userId },
    deals,
    hourly,
    totals: {
      grossCommission,
      hourlyEarnings,
      chargebacksApplied,
      netPayout,
      hasDeficit: netPayout < 0,
    },
    chargebacks,
  }
}
