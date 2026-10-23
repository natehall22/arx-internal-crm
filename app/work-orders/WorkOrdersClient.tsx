'use client'

import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'

import Nav from '@/components/Nav'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { StatusPill } from '@/components/ui/badge'
import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'
import { formatDate } from '@/lib/format'

interface WorkOrder {
  id: string
  work_order_number: string
  title: string
  work_order_type: string
  status: string
  priority: string
  address: string
  city: string
  state: string
  scheduled_date: string | null
  created_at: string
  projects?: { id: string; address_text: string } | null
  customers?: { id: string; name: string } | null
  assigned_user?: { id: string; full_name: string } | null
  assigned_sub?: { id: string; company_name: string } | null
}

const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }
const typeLabels: Record<string, string> = {
  go_back: 'Go Back',
  repair: 'Repair',
  warranty: 'Warranty',
  punch_list: 'Punch List',
  inspection: 'Inspection',
  install: 'Install',
  service_call: 'Service Call',
}


const DONE = new Set(['completed', 'cancelled'])
const groupOf = (w: WorkOrder) => (DONE.has(w.status) ? 'done' : 'open')
const assignee = (w: WorkOrder) => w.assigned_user?.full_name ?? w.assigned_sub?.company_name ?? ''

const COLUMNS: ColumnDef<WorkOrder, any>[] = [
  {
    id: 'number',
    header: 'Work order',
    accessorFn: (w) => `${w.work_order_number} ${w.title}`,
    cell: (c) => (
      <span>
        <span className="font-semibold">{c.row.original.work_order_number}</span>
        <span className="block max-w-xs truncate text-ui-sm text-ink-muted">{c.row.original.title}</span>
      </span>
    ),
    meta: { mobile: 'title' },
  },
  { id: 'type', header: 'Type', accessorFn: (w) => typeLabels[w.work_order_type] ?? w.work_order_type },
  {
    id: 'where',
    header: 'Customer / location',
    accessorFn: (w) => `${w.customers?.name ?? ''} ${w.address ?? ''} ${w.city ?? ''} ${w.state ?? ''}`,
    cell: (c) => {
      const w = c.row.original
      return (
        <span>
          {w.customers?.name ? <span className="block font-semibold">{w.customers.name}</span> : null}
          <span className="text-ui-sm text-ink-muted">{[w.address, [w.city, w.state].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
        </span>
      )
    },
  },
  { id: 'assigned', header: 'Assigned to', accessorFn: (w) => assignee(w) || 'Unassigned' },
  { id: 'scheduled', header: 'Scheduled', accessorFn: (w) => w.scheduled_date ?? '', cell: (c) => (c.getValue() ? formatDate(`${c.getValue()}T12:00:00`) : 'Not scheduled') },
  { accessorKey: 'priority', header: 'Priority', cell: (c) => PRIORITY_LABEL[c.getValue()] ?? c.getValue(), meta: { mobile: 'hide' } },
  { accessorKey: 'status', header: 'Status', cell: (c) => <StatusPill domain="work_order" value={c.getValue()} /> },
]

const FILTERS: TableFilter<WorkOrder>[] = [
  { key: 'group', label: 'Open / done', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }], accessor: groupOf },
  { key: 'status', label: 'Status', options: ['pending', 'assigned', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })), accessor: (w) => w.status },
  { key: 'type', label: 'Type', options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })), accessor: (w) => w.work_order_type },
  { key: 'scheduled', label: 'Scheduled', options: [{ value: 'no', label: 'Not scheduled' }, { value: 'yes', label: 'Scheduled' }], accessor: (w) => (w.scheduled_date ? 'yes' : 'no') },
]

const SORT_NEWEST = [{ id: 'number', desc: true }]
const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys:open', name: 'Open', state: { sorting: SORT_NEWEST, search: '', filters: { group: 'open' } } },
  { id: 'sys:unscheduled', name: 'Needs scheduling', state: { sorting: SORT_NEWEST, search: '', filters: { group: 'open', scheduled: 'no' } } },
  { id: 'sys:done', name: 'Done', state: { sorting: SORT_NEWEST, search: '', filters: { group: 'done' } } },
]

interface WorkOrdersClientProps {
  initialWorkOrders: WorkOrder[]
}

export default function WorkOrdersClient({ initialWorkOrders }: WorkOrdersClientProps) {
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6">
        <PageHeader
          title="Work orders"
          subtitle="Go-backs, repairs and service calls"
          actions={<Button asChild><Link href="/work-orders/new">New work order</Link></Button>}
        />
        <DataTable
          columns={COLUMNS}
          data={initialWorkOrders}
          tableKey="work_orders"
          getRowId={(w) => w.id}
          getRowHref={(w) => `/work-orders/${w.id}`}
          searchPlaceholder="Search number, title, customer or address"
          filters={FILTERS}
          systemViews={SYSTEM_VIEWS}
          defaultViewId="sys:open"
          empty={{ title: 'No work orders match', body: 'Try another view, or create one.', action: <Button asChild><Link href="/work-orders/new">New work order</Link></Button> }}
        />
      </main>
    </div>
  )
}
