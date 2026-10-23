'use client'

import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'

import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'
import { formatMoney } from '@/lib/format'

/** One tracker line, already computed on the server (money math stays there). */
export type ProfitRow = {
  id: string
  jobNumber: string
  lastName: string
  customerName: string
  address: string | null
  saleDate: string | null
  saleAmount: number
  financeCost: number
  commissionable: number
  materials: number
  labor: number
  misc: number
  totalExpenses: number
  setter: number
  closer: number
  sales: number
  opp: number
  grossProfit: number
  grossPercent: number | null
  ownerDraw: number
  perOwner: number
  netProfit: number
  netPercent: number | null
  notes: string | null
  status: string
  unreviewed: boolean
}

const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}%`)
const marginBand = (r: ProfitRow) => (r.grossPercent == null ? 'none' : r.grossPercent >= 35 ? 'high' : r.grossPercent >= 20 ? 'ok' : 'low')
const money = (c: { getValue: () => unknown }) => formatMoney(Number(c.getValue()) || 0)
const R = { align: 'right' as const }

const COLUMNS: ColumnDef<ProfitRow, any>[] = [
  {
    id: 'job',
    header: 'Job',
    accessorFn: (r) => `${r.lastName} ${r.customerName} ${r.jobNumber} ${r.address ?? ''}`,
    cell: (c) => {
      const r = c.row.original
      return (
        <span>
          <Link href={`/ops/jobs/${r.id}`} className="inline-flex min-h-tap items-center font-semibold underline-offset-2 hover:underline">{r.lastName}</Link>
          <span className="block text-ui-sm text-ink-muted">{r.jobNumber}</span>
        </span>
      )
    },
    meta: { mobile: 'title' },
  },
  { id: 'address', header: 'Address', accessorFn: (r) => r.address ?? '', cell: (c) => <span className="block max-w-[16rem] truncate">{(c.getValue() as string) || '—'}</span> },
  { accessorKey: 'saleAmount', header: 'Contract', cell: money, meta: R },
  { accessorKey: 'financeCost', header: 'Finance costs', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'commissionable', header: 'Commissionable', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'materials', header: 'Materials', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'labor', header: 'Labor', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'misc', header: 'Misc', cell: money, meta: { ...R, mobile: 'hide' as const } },
  {
    accessorKey: 'totalExpenses',
    header: 'Total expenses',
    cell: (c) => (
      <span>
        {formatMoney(Number(c.getValue()) || 0)}
        {c.row.original.unreviewed ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-ui-sm font-semibold text-ink" title="Includes a cost line an admin has not reviewed yet — numbers below may change">unreviewed</span> : null}
      </span>
    ),
    meta: R,
  },
  { accessorKey: 'setter', header: 'Setter 5%', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'closer', header: 'Closer 7%', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'sales', header: 'Sales 6%', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'opp', header: 'OPP 9%', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'grossProfit', header: 'Gross profit', cell: money, meta: R },
  { accessorKey: 'grossPercent', header: 'GP %', cell: (c) => pct(c.getValue()), meta: R },
  { accessorKey: 'ownerDraw', header: 'Owner draw', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'perOwner', header: 'Per owner', cell: money, meta: { ...R, mobile: 'hide' as const } },
  { accessorKey: 'netProfit', header: 'Net profit', cell: money, meta: R },
  { accessorKey: 'netPercent', header: 'Net %', cell: (c) => pct(c.getValue()), meta: R },
  { id: 'notes', header: 'Notes', accessorFn: (r) => r.notes ?? '', cell: (c) => <span className="block max-w-[14rem] truncate" title={(c.getValue() as string) || undefined}>{(c.getValue() as string) || '—'}</span>, meta: { mobile: 'hide' as const } },
  { accessorKey: 'status', header: 'Status' },
]

const FILTERS: TableFilter<ProfitRow>[] = [
  { key: 'status', label: 'Tracker status', options: ['Reconciled & Closed', 'Deposit Received', 'Sold', 'Materials', 'Scheduled', 'In Progress', 'Complete', 'Collected', 'On Hold'].map((v) => ({ value: v, label: v })), accessor: (r) => r.status },
  { key: 'margin', label: 'Gross margin', options: [{ value: 'low', label: 'Under 20%' }, { value: 'ok', label: '20–35%' }, { value: 'high', label: '35% and up' }], accessor: marginBand },
  { key: 'costs', label: 'Cost lines', options: [{ value: 'unreviewed', label: 'Has unreviewed lines' }], accessor: (r) => (r.unreviewed ? 'unreviewed' : '') },
]
const NEWEST = [{ id: 'job', desc: true }]
const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys:low', name: 'Low margin (under 20%)', state: { sorting: [{ id: 'grossPercent', desc: false }], search: '', filters: { margin: 'low' } } },
  { id: 'sys:unreviewed', name: 'Unreviewed cost lines', state: { sorting: NEWEST, search: '', filters: { costs: 'unreviewed' } } },
  { id: 'sys:open', name: 'Not reconciled yet', state: { sorting: NEWEST, search: '', filters: {} } },
]

export default function JobProfitTable({ rows }: { rows: ProfitRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      data={rows}
      tableKey="job_profit"
      getRowId={(r) => r.id}
      searchPlaceholder="Search customer, job number or address"
      filters={FILTERS}
      systemViews={SYSTEM_VIEWS}
      empty={{ title: 'No jobs match', body: 'Change the date range or status above.' }}
    />
  )
}
