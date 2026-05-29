import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { classifyWeeklyPayrollJob } from '@/lib/weekly-payroll/eligibility'
import { fundingRequiredTotal } from '@/lib/weekly-payroll/commission-base'
import { hasResolvableCompPlanForUserOnDate } from '@/lib/payroll-export'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export const dynamic = 'force-dynamic'

type JobRow = {
  id: string
  job_number: string
  status: string
  sale_amount: number | null
  /** Used with `loadActiveCompPlanForUser` — same as commission export */
  sale_date: string | null
  completed_at: string | null
  salesperson_id: string | null
  project_id: string | null
  customer_id: string | null
  allow_close_with_balance?: boolean | null
  ntp_commission_percent?: number | null
}

function saleYmdForCompPlan(d: string | null | undefined): string {
  if (d && String(d).length >= 10) return String(d).slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

/**
 * Weekly payroll worksheet / exception queue (v1).
 * Classifies jobs using job_payroll_state, payments (cleared), change orders, and cost lines.
 */
export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '150', 10) || 150, 500)

    const supabase = createServiceClient()
    const orgId = profile.org_id
    const now = new Date()

    const { data: jobs, error: jobsErr } = await supabase
      .from('production_jobs')
      .select(
        'id, job_number, status, sale_amount, sale_date, completed_at, salesperson_id, project_id, customer_id, allow_close_with_balance, ntp_commission_percent'
      )
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (jobsErr) {
      console.error('worksheet jobs', jobsErr)
      return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
    }

    const jobList = (jobs || []) as JobRow[]
    const jobIds = jobList.map((j) => j.id)
    const projectIds = Array.from(
      new Set(jobList.map((j) => j.project_id).filter(Boolean))
    ) as string[]

    const customerIdByProjectId = new Map<string, string>()
    if (projectIds.length > 0) {
      const { data: projRows } = await supabase
        .from('projects')
        .select('id, customer_id')
        .eq('org_id', orgId)
        .in('id', projectIds)
      for (const p of projRows || []) {
        const cid = p.customer_id as string | null | undefined
        if (cid) customerIdByProjectId.set(p.id as string, cid)
      }
    }

    const customerIdsForNames = Array.from(
      new Set([
        ...jobList.map((j) => j.customer_id).filter((id): id is string => typeof id === 'string'),
        ...Array.from(customerIdByProjectId.values()),
      ])
    )
    const customerNameById = new Map<string, string>()
    if (customerIdsForNames.length > 0) {
      const { data: custRows } = await supabase
        .from('customers')
        .select('id, name')
        .eq('org_id', orgId)
        .in('id', customerIdsForNames)
      for (const c of custRows || []) {
        const nm = ((c.name as string) || '').trim()
        if (nm) customerNameById.set(c.id as string, nm)
      }
    }

    const [{ data: states }, { data: payments }, { data: cos }, { data: costLines }] = await Promise.all([
      jobIds.length
        ? supabase.from('job_payroll_state').select('*').in('job_id', jobIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      jobIds.length
        ? supabase.from('job_payments').select('job_id, amount_cents, funding_status').in('job_id', jobIds)
        : Promise.resolve({ data: [] as { job_id: string; amount_cents: number; funding_status: string }[] }),
      projectIds.length
        ? supabase
            .from('job_change_orders')
            .select('project_id, updated_total, is_commissionable')
            .eq('org_id', orgId)
            .in('project_id', projectIds)
        : Promise.resolve({ data: [] as { project_id: string; updated_total: number; is_commissionable: boolean }[] }),
      jobIds.length
        ? supabase.from('job_cost_lines').select('job_id, approved, deduct_from_commission_base').in('job_id', jobIds)
        : Promise.resolve({ data: [] as { job_id: string; approved: boolean; deduct_from_commission_base: boolean }[] }),
    ])

    const compPlanKeys = new Map<string, { userId: string; saleYmd: string }>()
    for (const job of jobList) {
      if (!job.salesperson_id) continue
      const ymd = saleYmdForCompPlan(job.sale_date)
      const k = `${job.salesperson_id}|${ymd}`
      if (!compPlanKeys.has(k)) compPlanKeys.set(k, { userId: job.salesperson_id, saleYmd: ymd })
    }

    const compPlanResolved = new Map<string, boolean>()
    await Promise.all(
      Array.from(compPlanKeys.entries()).map(async ([k, { userId, saleYmd }]) => {
        const ok = await hasResolvableCompPlanForUserOnDate(supabase, orgId, userId, saleYmd)
        compPlanResolved.set(k, ok)
      })
    )

    const stateByJob = new Map((states || []).map((s: any) => [s.job_id as string, s]))
    const collectedByJob = new Map<string, number>()
    for (const p of payments || []) {
      if (p.funding_status !== 'cleared') continue
      collectedByJob.set(p.job_id, (collectedByJob.get(p.job_id) || 0) + p.amount_cents)
    }

    const coByProject = new Map<string, { signedTotal: number; commissionableTotal: number }>()
    for (const co of cos || []) {
      const cur = coByProject.get(co.project_id) || { signedTotal: 0, commissionableTotal: 0 }
      cur.signedTotal += Number(co.updated_total) || 0
      if (co.is_commissionable !== false) {
        cur.commissionableTotal += Number(co.updated_total) || 0
      }
      coByProject.set(co.project_id, cur)
    }

    const costLinesByJob = new Map<string, { job_id: string; approved: boolean; deduct_from_commission_base: boolean }[]>()
    for (const line of costLines || []) {
      const list = costLinesByJob.get(line.job_id) || []
      list.push(line)
      costLinesByJob.set(line.job_id, list)
    }

    const rows = jobList.map((job) => {
      const st = stateByJob.get(job.id) as
        | {
            install_completed_at?: string | null
            ntp_completed_at?: string | null
            fully_funded_at?: string | null
            costs_ready_at?: string | null
            locked_at?: string | null
          }
        | undefined

      const installCompletedAt = st?.install_completed_at
        ? new Date(st.install_completed_at)
        : job.completed_at
          ? new Date(job.completed_at)
          : null

      const sale = Number(job.sale_amount) || 0
      const co = job.project_id ? coByProject.get(job.project_id) : undefined
      const signedCo = co?.signedTotal ?? 0
      const requiredDollars = fundingRequiredTotal({
        originalContractTotal: sale,
        signedChangeOrderTotal: signedCo,
      })
      const requiredCents = Math.round(requiredDollars * 100)
      const collected = collectedByJob.get(job.id) || 0
      const funded =
        requiredCents <= 0 ||
        collected >= requiredCents ||
        (job.status === 'collected' && Boolean(job.allow_close_with_balance))

      const fullyFundedAt = st?.fully_funded_at
        ? new Date(st.fully_funded_at)
        : funded
          ? now
          : null

      const lines = costLinesByJob.get(job.id) || []
      const blockingLines = lines.filter((l) => !l.approved && l.deduct_from_commission_base)
      const costsReady = lines.length === 0 ? true : blockingLines.length === 0
      const costsReadyAt = st?.costs_ready_at
        ? new Date(st.costs_ready_at)
        : costsReady
          ? now
          : null

      const hasSalesRep = !!job.salesperson_id
      /** Same resolution as commission export (`loadActiveCompPlanForUser` + default plan fallback), keyed by job sale date. */
      const hasCompPlanAssignment =
        !job.salesperson_id
          ? false
          : compPlanResolved.get(`${job.salesperson_id}|${saleYmdForCompPlan(job.sale_date)}`) ?? false

      const ntpCompletedAt = st?.ntp_completed_at
        ? new Date(st.ntp_completed_at)
        : null

      const c = classifyWeeklyPayrollJob({
        now,
        installCompletedAt,
        ntpCompletedAt,
        ntpCommissionPercent: Number(job.ntp_commission_percent) || 0,
        jobStatusCompleteOrCollected: job.status === 'complete' || job.status === 'collected',
        funded,
        fullyFundedAt,
        costsReady,
        costsReadyAt,
        hasSalesRep,
        hasCompPlanAssignment,
        compPlanUnsupported: false,
        payrollLocked: !!st?.locked_at,
        hasBlockingExceptions: false,
      })

      const pid = job.project_id
      const effectiveCustomerId =
        job.customer_id || (pid ? customerIdByProjectId.get(pid) : undefined) || null
      const customerName = effectiveCustomerId
        ? customerNameById.get(effectiveCustomerId) ?? null
        : null

      return {
        jobId: job.id,
        jobNumber: job.job_number,
        customerName,
        ...c,
      }
    })

    const summary = rows.reduce(
      (acc, r) => {
        acc[r.bucket] = (acc[r.bucket] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    return NextResponse.json({
      generatedAt: now.toISOString(),
      orgId,
      limit,
      summary,
      rows,
    })
  } catch (e) {
    console.error('GET /api/admin/payroll/weekly/worksheet', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
