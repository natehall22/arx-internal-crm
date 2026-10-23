import { sumCollectedCents } from '@/lib/job-collection'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import JobProfitTable from '@/components/admin/JobProfitTable'
import { requireAuth } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import { CANCELLED_JOB_STATUS } from '@/lib/job-status'
import { jobDirectCost, ledgerSummaryFor, loadJobCostLedger, type JobCostLedger } from '@/lib/job-cost-ledger'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

type SearchParams = {
  status?: string
  from?: string
  to?: string
  q?: string
  source?: string
}

type JobRow = {
  id: string
  job_number: string
  status: string
  address_text: string | null
  sale_amount: number | string | null
  sale_date: string | null
  completed_at: string | null
  dealer_fee_amount?: number | string | null
  internal_notes?: string | null
  customer?: { name: string | null } | null
  project?: {
    customers?: { name: string | null } | null
    leads?: { homeowner_name: string | null; source: string | null } | null
  } | null
}

type PaymentLine = {
  job_id: string
  amount_cents: number | null
  funding_status?: string | null
}

function moneyValue(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function humanStatus(status: string): string {
  return status
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function customerNameFor(job: JobRow): string {
  return (
    job.customer?.name ||
    job.project?.customers?.name ||
    job.project?.leads?.homeowner_name ||
    ''
  ).trim()
}

function lastNameFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : '—'
}

export default async function AdminJobProfitTrackerPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const { profile } = await requireAuth()
  if (!isPayrollAdminRole(profile.role)) {
    redirect('/dashboard')
  }

  const supabase = createServiceClient()
  const status = searchParams?.status || 'all'
  const from = searchParams?.from || ''
  const to = searchParams?.to || ''
  const q = (searchParams?.q || '').trim()
  const sourceFilter = searchParams?.source || 'all'

  let query = supabase
    .from('production_jobs')
    .select(
      `
        id,
        job_number,
        status,
        address_text,
        sale_amount,
        sale_date,
        completed_at,
        dealer_fee_amount,
        internal_notes,
        customer:customers(name),
        project:projects(customers(name), leads(homeowner_name, source))
      `
    )
    .eq('org_id', profile.org_id)
    .order('sale_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500)

  // A cancelled job has no profit to track; it shows only when asked for by name.
  if (status === 'all') {
    query = query.neq('status', CANCELLED_JOB_STATUS)
  } else if (status === 'closed') {
    query = query.in('status', ['complete', 'collected'])
  } else if (status === 'open') {
    query = query.not('status', 'in', `(complete,collected,${CANCELLED_JOB_STATUS})`)
  } else {
    query = query.eq('status', status)
  }

  if (from) query = query.gte('sale_date', from)
  if (to) query = query.lte('sale_date', to)

  const { data: jobsData, error } = await query
  if (error) {
    throw new Error(`Failed to load job profit tracker: ${error.message}`)
  }

  let jobs = (jobsData || []) as unknown as JobRow[]
  if (q) {
    const needle = q.toLowerCase()
    jobs = jobs.filter((job) => {
      const haystack = [
        job.job_number,
        job.address_text || '',
        customerNameFor(job),
        job.internal_notes || '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }

  if (sourceFilter === 'call_center') {
    jobs = jobs.filter((job) => {
      const leads = job.project?.leads
      if (!leads) return false
      if (Array.isArray(leads)) return leads.some((l) => l?.source === 'call_center')
      return leads.source === 'call_center'
    })
  }

  const jobIds = jobs.map((job) => job.id)
  const collectedCentsByJob = new Map<string, number>()
  // Costs come from the one job cost ledger (lib/job-cost-ledger.ts) — the same numbers the
  // job page, ops board, goals and payroll use. The old production_jobs.material_cost /
  // labor_cost columns and job_product_orders are no longer read (Known Redundancy #11).
  let ledger: JobCostLedger = new Map()

  if (jobIds.length > 0) {
    const [loadedLedger, { data: payments }] = await Promise.all([
      loadJobCostLedger(supabase, profile.org_id, jobIds),
      supabase
        .from('job_payments')
        .select('job_id, amount_cents, funding_status')
        .in('job_id', jobIds),
    ])
    ledger = loadedLedger

    for (const payment of (payments || []) as PaymentLine[]) {
      collectedCentsByJob.set(
        payment.job_id,
        (collectedCentsByJob.get(payment.job_id) || 0) + sumCollectedCents([payment])
      )
    }
  }

  const rows = jobs.map((job, index) => {
    const saleAmount = moneyValue(job.sale_amount)
    const financeCost = moneyValue(job.dealer_fee_amount)
    const commissionableAmount = Math.max(0, saleAmount - financeCost)
    const costs = ledgerSummaryFor(ledger, job.id)
    const hasUnreviewedCostLines = costs.hasUnreviewed
    const materials = costs.materials
    const labor = costs.labor
    const misc = costs.other
    const totalExpenses = costs.total
    // The finance (dealer) fee is subtracted exactly once, from dealer_fee_amount. Before the
    // one-ledger change it was only subtracted on jobs that happened to carry a mirrored
    // "Lender / dealer fee" cost line, so older financed jobs overstated profit.
    const directCost = jobDirectCost(costs, financeCost)
    const setterCommission = commissionableAmount * 0.05
    const closerCommission = commissionableAmount * 0.07
    const salesCommission = commissionableAmount * 0.06
    const opp = saleAmount * 0.09
    const grossProfit = saleAmount - directCost - salesCommission - opp
    const grossProfitPercent = saleAmount > 0 ? (grossProfit / saleAmount) * 100 : null
    const ownerDraw = grossProfit * 0.2
    const ownerDrawPerOwner = ownerDraw / 4
    const netProfit = grossProfit - ownerDraw
    const netPercent = saleAmount > 0 ? (netProfit / saleAmount) * 100 : null
    const collected = (collectedCentsByJob.get(job.id) || 0) / 100
    const balance = Math.max(0, saleAmount - collected)
    const customerName = customerNameFor(job)
    const trackerStatus =
      balance <= 0 && saleAmount > 0
        ? 'Reconciled & Closed'
        : collected > 0
          ? 'Deposit Received'
          : humanStatus(job.status)

    return {
      index: index + 1,
      job,
      customerName,
      lastName: lastNameFor(customerName),
      saleAmount,
      financeCost,
      commissionableAmount,
      materials,
      labor,
      misc,
      totalExpenses,
      setterCommission,
      closerCommission,
      salesCommission,
      opp,
      grossProfit,
      grossProfitPercent,
      ownerDraw,
      ownerDrawPerOwner,
      netProfit,
      netPercent,
      collected,
      balance,
      trackerStatus,
      hasUnreviewedCostLines,
    }
  })

  const totals = rows.reduce(
    (acc, row) => {
      acc.contract += row.saleAmount
      acc.finance += row.financeCost
      acc.expenses += row.totalExpenses
      acc.gross += row.grossProfit
      acc.net += row.netProfit
      acc.balance += row.balance
      return acc
    },
    { contract: 0, finance: 0, expenses: 0, gross: 0, net: 0, balance: 0 }
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link href="/admin" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ← Settings
          </Link>
        </div>

        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Job Profit Tracker</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Read-only admin view modeled after the ARX Tracker sheet. It uses existing CRM job financials,
              cost lines, and payments; no Google Sheet data is changed.
            </p>
          </div>

          <form className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm sm:grid-cols-2 lg:grid-cols-5">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</span>
              <select
                name="status"
                defaultValue={status}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
              >
                <option value="all">All jobs</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="sold">Sold</option>
                <option value="materials">Materials</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
                <option value="collected">Collected</option>
                <option value="on_hold">On hold</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">From</span>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">To</span>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Source Filter</span>
              <select
                name="source"
                defaultValue={sourceFilter}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
              >
                <option value="all">All</option>
                <option value="call_center">Call Center</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Search</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Name, job, address"
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900"
                />
                <button
                  type="submit"
                  className="rounded-md bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-800"
                >
                  Apply
                </button>
              </div>
            </label>
          </form>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: sourceFilter === 'call_center' ? 'Call Center Contract' : 'Contract', value: totals.contract, className: 'border-sky-200 bg-sky-50 text-sky-950' },
            { label: 'Finance costs', value: totals.finance, className: 'border-indigo-200 bg-indigo-50 text-indigo-950' },
            { label: 'Expenses', value: totals.expenses, className: 'border-amber-200 bg-amber-50 text-amber-950' },
            { label: sourceFilter === 'call_center' ? 'Call Center Gross Profit' : 'Gross profit', value: totals.gross, className: 'border-emerald-200 bg-emerald-50 text-emerald-950' },
            { label: 'Net profit', value: totals.net, className: 'border-teal-200 bg-teal-50 text-teal-950' },
          ].map((item) => (
            <div key={item.label} className={`rounded-lg border px-4 py-3 shadow-sm ${item.className}`}>
              <div className="text-xs font-medium uppercase tracking-wide opacity-70">{item.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatMoney(item.value)}
              </div>
            </div>
          ))}
        </div>

        <JobProfitTable
          rows={rows.map((r) => ({
            id: r.job.id,
            jobNumber: r.job.job_number,
            lastName: r.lastName,
            customerName: r.customerName,
            address: r.job.address_text,
            saleDate: r.job.sale_date,
            saleAmount: r.saleAmount,
            financeCost: r.financeCost,
            commissionable: r.commissionableAmount,
            materials: r.materials,
            labor: r.labor,
            misc: r.misc,
            totalExpenses: r.totalExpenses,
            setter: r.setterCommission,
            closer: r.closerCommission,
            sales: r.salesCommission,
            opp: r.opp,
            grossProfit: r.grossProfit,
            grossPercent: r.grossProfitPercent,
            ownerDraw: r.ownerDraw,
            perOwner: r.ownerDrawPerOwner,
            netProfit: r.netProfit,
            netPercent: r.netPercent,
            notes: r.job.internal_notes ?? null,
            status: r.trackerStatus,
            unreviewed: r.hasUnreviewedCostLines,
          }))}
        />
      </main>
    </div>
  )
}
