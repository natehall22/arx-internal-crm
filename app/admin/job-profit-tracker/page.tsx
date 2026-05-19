import Link from 'next/link'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  getSignedOrderAmount,
  isMissingJobProductOrdersTable,
  mapMaterialOrdersRowsToUi,
} from '@/lib/ops-product-orders'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const TRACKER_ADMIN_ROLES = new Set(['admin', 'owner', 'operations'])

type SearchParams = {
  status?: string
  from?: string
  to?: string
  q?: string
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
  material_cost?: number | string | null
  labor_cost?: number | string | null
  internal_notes?: string | null
  customer?: { name: string | null } | null
  project?: {
    customers?: { name: string | null } | null
    leads?: { homeowner_name: string | null } | null
  } | null
}

type CostLine = {
  job_id: string
  amount: number | string | null
  cost_type: string | null
}

type PaymentLine = {
  job_id: string
  amount_cents: number | null
}

type ProductOrderLine = {
  job_id: string
  amount: number | string | null
  status: 'ordered' | 'received' | 'paid' | 'returned'
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

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2)}%`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
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

function rowToneClass(status: string): string {
  if (status === 'Reconciled & Closed') {
    return 'border-l-4 border-emerald-500 bg-emerald-50 hover:bg-emerald-100/80'
  }
  if (status === 'Deposit Received') {
    return 'border-l-4 border-amber-400 bg-amber-50 hover:bg-amber-100/80'
  }
  return 'border-l-4 border-sky-400 bg-white hover:bg-sky-50'
}

function statusPillClass(status: string): string {
  if (status === 'Reconciled & Closed') {
    return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
  }
  if (status === 'Deposit Received') {
    return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200'
  }
  return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200'
}

function profitToneClass(percent: number | null): string {
  if (percent == null) return 'text-gray-700'
  if (percent >= 35) return 'bg-emerald-100 text-emerald-900'
  if (percent >= 20) return 'bg-amber-100 text-amber-900'
  return 'bg-rose-100 text-rose-900'
}

function moneyToneClass(value: number): string {
  return value < 0 ? 'text-rose-700' : 'text-gray-900'
}

export default async function AdminJobProfitTrackerPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const { profile } = await requireAuth()
  if (!TRACKER_ADMIN_ROLES.has(String(profile.role || '').toLowerCase())) {
    redirect('/dashboard')
  }

  const supabase = createServiceClient()
  const status = searchParams?.status || 'all'
  const from = searchParams?.from || ''
  const to = searchParams?.to || ''
  const q = (searchParams?.q || '').trim()

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
        material_cost,
        labor_cost,
        internal_notes,
        customer:customers(name),
        project:projects(customers(name), leads(homeowner_name))
      `
    )
    .eq('org_id', profile.org_id)
    .order('sale_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (status !== 'all') {
    if (status === 'closed') {
      query = query.in('status', ['complete', 'collected'])
    } else if (status === 'open') {
      query = query.not('status', 'in', '(complete,collected)')
    } else {
      query = query.eq('status', status)
    }
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

  const jobIds = jobs.map((job) => job.id)
  const costLinesByJob = new Map<string, CostLine[]>()
  const collectedCentsByJob = new Map<string, number>()
  const materialOrdersByJob = new Map<string, number>()

  if (jobIds.length > 0) {
    const [{ data: costLines }, { data: payments }] = await Promise.all([
      supabase
        .from('job_cost_lines')
        .select('job_id, amount, cost_type')
        .eq('org_id', profile.org_id)
        .eq('status', 'active')
        .is('deleted_at', null)
        .in('job_id', jobIds),
      supabase
        .from('job_payments')
        .select('job_id, amount_cents')
        .in('job_id', jobIds),
    ])

    for (const line of (costLines || []) as CostLine[]) {
      const existing = costLinesByJob.get(line.job_id) || []
      existing.push(line)
      costLinesByJob.set(line.job_id, existing)
    }

    for (const payment of (payments || []) as PaymentLine[]) {
      collectedCentsByJob.set(
        payment.job_id,
        (collectedCentsByJob.get(payment.job_id) || 0) + (payment.amount_cents || 0)
      )
    }

    const { data: productOrders, error: productOrdersError } = await supabase
      .from('job_product_orders')
      .select('job_id, amount, status')
      .in('job_id', jobIds)

    if (!productOrdersError) {
      for (const order of (productOrders || []) as ProductOrderLine[]) {
        materialOrdersByJob.set(
          order.job_id,
          (materialOrdersByJob.get(order.job_id) || 0) +
            getSignedOrderAmount(moneyValue(order.amount), order.status)
        )
      }
    } else if (isMissingJobProductOrdersTable(productOrdersError)) {
      const { data: fallbackOrders, error: fallbackOrdersError } = await supabase
        .from('material_orders')
        .select('id, org_id, job_id, supplier, items, status, total_cost, notes, created_at')
        .in('job_id', jobIds)

      if (fallbackOrdersError) {
        throw new Error(`Failed to load material orders: ${fallbackOrdersError.message}`)
      }

      for (const order of mapMaterialOrdersRowsToUi(fallbackOrders)) {
        materialOrdersByJob.set(
          order.job_id,
          (materialOrdersByJob.get(order.job_id) || 0) +
            getSignedOrderAmount(moneyValue(order.amount), order.status)
        )
      }
    } else {
      throw new Error(`Failed to load product orders: ${productOrdersError.message}`)
    }
  }

  const rows = jobs.map((job, index) => {
    const saleAmount = moneyValue(job.sale_amount)
    const financeCost = moneyValue(job.dealer_fee_amount)
    const commissionableAmount = Math.max(0, saleAmount - financeCost)
    const costLines = costLinesByJob.get(job.id) || []
    const materialLines = costLines
      .filter((line) => line.cost_type === 'material')
      .reduce((sum, line) => sum + moneyValue(line.amount), 0)
    const laborLines = costLines
      .filter((line) => line.cost_type === 'labor' || line.cost_type === 'subcontractor')
      .reduce((sum, line) => sum + moneyValue(line.amount), 0)
    const misc = costLines
      .filter((line) => !['material', 'labor', 'subcontractor'].includes(String(line.cost_type || '')))
      .reduce((sum, line) => sum + moneyValue(line.amount), 0)
    const materials = materialOrdersByJob.has(job.id)
      ? materialOrdersByJob.get(job.id) || 0
      : moneyValue(job.material_cost) || materialLines
    const labor = moneyValue(job.labor_cost) || laborLines
    const totalExpenses = materials + labor + misc
    const setterCommission = commissionableAmount * 0.05
    const closerCommission = commissionableAmount * 0.07
    const salesCommission = commissionableAmount * 0.06
    const opp = saleAmount * 0.09
    const grossProfit = saleAmount - totalExpenses - salesCommission - opp
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
            ← Admin
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

          <form className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm sm:grid-cols-2 lg:grid-cols-4">
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
            { label: 'Contract', value: totals.contract, className: 'border-sky-200 bg-sky-50 text-sky-950' },
            { label: 'Finance costs', value: totals.finance, className: 'border-indigo-200 bg-indigo-50 text-indigo-950' },
            { label: 'Expenses', value: totals.expenses, className: 'border-amber-200 bg-amber-50 text-amber-950' },
            { label: 'Gross profit', value: totals.gross, className: 'border-emerald-200 bg-emerald-50 text-emerald-950' },
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

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] text-sm">
              <thead className="bg-[#4a6080] text-left text-xs uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Last name</th>
                  <th className="px-3 py-2 font-semibold">Job address</th>
                  <th className="px-3 py-2 font-semibold text-right">Contract</th>
                  <th className="px-3 py-2 font-semibold text-right">Finance costs</th>
                  <th className="px-3 py-2 font-semibold text-right">Commissionable</th>
                  <th className="px-3 py-2 font-semibold text-right">Materials</th>
                  <th className="px-3 py-2 font-semibold text-right">Labor</th>
                  <th className="px-3 py-2 font-semibold text-right">Misc</th>
                  <th className="px-3 py-2 font-semibold text-right">Total expenses</th>
                  <th className="px-3 py-2 font-semibold text-right">Setter 5%</th>
                  <th className="px-3 py-2 font-semibold text-right">Closer 7%</th>
                  <th className="px-3 py-2 font-semibold text-right">Sales 6%</th>
                  <th className="px-3 py-2 font-semibold text-right">OPP 9%</th>
                  <th className="px-3 py-2 font-semibold text-right">Gross profit</th>
                  <th className="px-3 py-2 font-semibold text-right">GP %</th>
                  <th className="px-3 py-2 font-semibold text-right">Owner draw</th>
                  <th className="px-3 py-2 font-semibold text-right">Per owner</th>
                  <th className="px-3 py-2 font-semibold text-right">Net profit</th>
                  <th className="px-3 py-2 font-semibold text-right">Net %</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-800">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={22} className="px-4 py-8 text-center text-gray-500">
                      No jobs match the current filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.job.id} className={rowToneClass(row.trackerStatus)}>
                      <td className="px-3 py-2 text-gray-500">{row.index}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        <Link href={`/ops/jobs/${row.job.id}`} className="hover:text-indigo-700">
                          {row.lastName}
                        </Link>
                        <div className="mt-0.5 text-xs font-normal text-gray-500">{row.job.job_number}</div>
                      </td>
                      <td className="max-w-[260px] px-3 py-2 text-gray-700">
                        <div className="truncate" title={row.job.address_text || undefined}>
                          {row.job.address_text || '—'}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">Sale {formatDate(row.job.sale_date)}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.saleAmount)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.financeCost)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.commissionableAmount)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.materials)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.labor)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.misc)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.totalExpenses)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.setterCommission)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.closerCommission)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.salesCommission)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.opp)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${moneyToneClass(row.grossProfit)}`}>
                        {formatMoney(row.grossProfit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={`inline-block rounded px-2 py-1 font-medium ${profitToneClass(row.grossProfitPercent)}`}>
                          {formatPercent(row.grossProfitPercent)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.ownerDraw)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.ownerDrawPerOwner)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${moneyToneClass(row.netProfit)}`}>
                        {formatMoney(row.netProfit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={`inline-block rounded px-2 py-1 font-medium ${profitToneClass(row.netPercent)}`}>
                          {formatPercent(row.netPercent)}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-3 py-2 text-xs text-gray-600">
                        <div className="truncate" title={row.job.internal_notes || undefined}>
                          {row.job.internal_notes || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${statusPillClass(row.trackerStatus)}`}>
                          {row.trackerStatus}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
