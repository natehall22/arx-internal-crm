'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'

import BatchDetailDialog from '@/components/billing/BatchDetailDialog'
import BillFinishedJobsSheet from '@/components/billing/BillFinishedJobsSheet'
import InvoiceDetailModal from '@/components/ops/InvoiceDetailModal'
import { Badge, Button } from '@/components/ui'
import { DataTable, type TableFilter, type TableView, type ViewState } from '@/components/ui/data-table'
import { invoiceItemDateLabel } from '@/lib/invoice-lines'
import {
  INVOICE_PERIOD_FILTERS,
  INVOICE_STATUS_FILTERS,
  invoicePeriodOf,
  invoiceSearchText,
  invoiceStanding,
  invoiceStandingLabel,
} from '@/lib/invoice-list'
import { formatCurrency } from '@/lib/job-payments'
import type { InvoiceListRow } from '@/lib/service-billing-db'

const TONE = { overdue: 'danger', open: 'info', paid: 'success', draft: 'neutral', void: 'neutral' } as const

type Load = { rows: InvoiceListRow[]; capped: boolean; today: string; canExport: boolean; fullHistory?: boolean; masterInvoices?: boolean }

const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys-overdue', name: 'Overdue', state: { sorting: [{ id: 'due', desc: false }], search: '', filters: { status: 'overdue' } } },
  { id: 'sys-open', name: 'Open', state: { sorting: [{ id: 'due', desc: false }], search: '', filters: { status: 'open' } } },
  { id: 'sys-month', name: 'This month', state: { sorting: [], search: '', filters: { period: 'this_month' } } },
]

/**
 * Billing → All invoices: every invoice (job and service, any status) on the shared DataTable — search, status / period /
 * customer filters, saved views — and a CSV of what's on screen for people who may export financials. A row opens the
 * invoice itself (lines, payments, void), not the print page. Data: GET /api/invoices (owed and late are computed once, server side).
 */
export default function AllInvoices() {
  const [data, setData] = React.useState<Load | null>(null)
  const [error, setError] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [openBatch, setOpenBatch] = React.useState<string | null>(null)
  const [billSheet, setBillSheet] = React.useState(false)
  const state = React.useRef<ViewState>({ sorting: [], search: '', filters: {} })

  const load = React.useCallback(async () => {
    const res = await fetch('/api/invoices', { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return setError(true)
    setError(false)
    setData((await res.json()) as Load)
  }, [])
  React.useEffect(() => {
    void load()
  }, [load])

  const today = data?.today ?? ''
  const rows = React.useMemo(() => data?.rows ?? [], [data])
  // Someone without reports:financials sees open invoices only (no paid / draft / void history): the same people, the same numbers as the Unpaid list.
  const filters = React.useMemo<TableFilter<InvoiceListRow>[]>(() => {
    const customers = new Map<string, string>()
    for (const r of rows) if (r.customerId) customers.set(r.customerId, r.customerName)
    return [
      { key: 'status', label: 'Status', options: data?.fullHistory === false ? INVOICE_STATUS_FILTERS.filter((o) => o.value === 'overdue' || o.value === 'open') : INVOICE_STATUS_FILTERS, accessor: (r) => invoiceStanding(r) },
      { key: 'period', label: 'Issued', options: INVOICE_PERIOD_FILTERS, accessor: (r) => (today ? invoicePeriodOf(r, today) : '') },
      {
        key: 'customer',
        label: 'Customer',
        options: Array.from(customers, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 300),
        accessor: (r) => r.customerId,
      },
    ]
  }, [rows, today, data?.fullHistory])

  const columns = React.useMemo<ColumnDef<InvoiceListRow, any>[]>(
    () => [
      {
        id: 'invoice',
        header: 'Invoice',
        accessorFn: (r) => invoiceSearchText(r), // the only searchable column: the CSV's search uses the same text
        cell: ({ row }) => (
          <button type="button" className="min-h-tap text-left font-semibold underline" onClick={() => setOpenId(row.original.id)}>
            {row.original.invoiceNumber}
          </button>
        ),
        meta: { mobile: 'title' },
      },
      { id: 'customer', header: 'Customer', enableGlobalFilter: false, accessorFn: (r) => r.customerName, cell: ({ row }) => <span>{row.original.customerName}{row.original.jobNumber ? ` · Job ${row.original.jobNumber}` : ''}{row.original.customerPo ? ` · PO ${row.original.customerPo}` : ''}</span> },
      ...(data?.masterInvoices ? [{
        id: 'master',
        header: 'Master invoice',
        enableGlobalFilter: false,
        accessorFn: (r: InvoiceListRow) => r.batchNumber ?? '',
        cell: ({ row }: { row: { original: InvoiceListRow } }) =>
          row.original.batchId && row.original.batchNumber ? (
            <button type="button" className="min-h-tap text-left font-semibold underline" onClick={() => setOpenBatch(row.original.batchId)}>{row.original.batchNumber}</button>
          ) : (
            '—'
          ),
      }] : []),
      { id: 'issued', header: 'Issued', enableGlobalFilter: false, accessorFn: (r) => r.issuedAt ?? r.createdAt, cell: ({ row }) => (row.original.issuedAt ? invoiceItemDateLabel(row.original.issuedAt) : '—') },
      { id: 'due', header: 'Due', enableGlobalFilter: false, accessorFn: (r) => r.dueAt ?? '9999', cell: ({ row }) => (row.original.dueAt ? invoiceItemDateLabel(row.original.dueAt) : '—') },
      {
        id: 'status',
        header: 'Status',
        enableGlobalFilter: false,
        accessorFn: (r) => invoiceStanding(r),
        cell: ({ row }) => <Badge tone={TONE[invoiceStanding(row.original)]}>{invoiceStandingLabel(row.original)}</Badge>,
      },
      { id: 'total', header: 'Total', enableGlobalFilter: false, accessorFn: (r) => r.totalCents, cell: ({ row }) => formatCurrency(row.original.totalCents), meta: { align: 'right' } },
      { id: 'owed', header: 'Owed', enableGlobalFilter: false, accessorFn: (r) => r.balanceCents, cell: ({ row }) => (row.original.balanceCents > 0 ? formatCurrency(row.original.balanceCents) : '—'), meta: { align: 'right' } },
    ],
    [data?.masterInvoices]
  )

  function exportCsv() {
    const f = state.current.filters ?? {}
    const p = new URLSearchParams()
    for (const k of ['status', 'period', 'customer'] as const) if (f[k]) p.set(k, f[k])
    if (state.current.search.trim()) p.set('q', state.current.search.trim())
    window.location.assign(`/api/invoices/export?${p.toString()}`)
  }

  if (error) return <p className="rounded-ui border border-surface-line bg-surface px-4 py-6 text-ui-base text-ink">Invoices couldn’t load. Refresh to try again.</p>
  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        loading={!data}
        tableKey="all-invoices"
        getRowId={(r) => r.id}
        filters={filters}
        systemViews={SYSTEM_VIEWS}
        initialSorting={[]}
        searchPlaceholder="Search invoice, customer, job or PO"
        empty={{ title: 'No invoices yet', body: 'Invoices you make appear here.' }}
        onStateChange={(s) => (state.current = s)}
        rowActions={(r) => (
          <Button size="sm" variant="secondary" onClick={() => setOpenId(r.id)}>Open</Button>
        )}
        toolbar={
          <>
            {data?.masterInvoices ? <Button size="sm" onClick={() => setBillSheet(true)}>Bill finished jobs</Button> : null}
            {data?.canExport ? <Button variant="secondary" size="sm" onClick={exportCsv}>Download CSV</Button> : null}
          </>
        }
      />
      {data?.capped ? <p className="mt-2 text-ui-sm text-ink">Showing the newest {rows.length.toLocaleString()} invoices.</p> : null}
      {billSheet ? (
        <BillFinishedJobsSheet
          onClose={() => setBillSheet(false)}
          onCreated={(id) => {
            setBillSheet(false)
            setOpenBatch(id)
            void load()
          }}
        />
      ) : null}
      {openBatch ? (
        <BatchDetailDialog
          batchId={openBatch}
          onClose={() => {
            setOpenBatch(null)
            void load()
          }}
        />
      ) : null}
      {openId ? (
        <InvoiceDetailModal
          invoiceId={openId}
          onClose={() => {
            setOpenId(null)
            void load()
          }}
        />
      ) : null}
    </>
  )
}
