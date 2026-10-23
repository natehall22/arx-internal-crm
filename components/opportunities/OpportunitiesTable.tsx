'use client'

import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'

import { StatusPill } from '@/components/ui/badge'
import { DataTable, type TableFilter, type TableView, type ViewState } from '@/components/ui/data-table'
import { buildOpportunityListQuery, type OpportunityListFilters } from '@/lib/opportunity-list-filters'
import type { InspectionOutcomeConfigRow } from '@/lib/inspection-outcomes'
import { getInspectionOutcomeDisplay, type OpportunityListRow } from '@/components/opportunities/opportunity-list-shared'

const nameOf = (o: OpportunityListRow) => o.leads?.homeowner_name || o.customers?.name || 'N/A'
const NEWEST = [{ enableGlobalFilter: false, id: 'created', desc: true }]

const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys:open', name: 'Open', state: { sorting: NEWEST, search: '', filters: { status: 'open' } } },
  { id: 'sys:in_progress', name: 'In progress', state: { sorting: NEWEST, search: '', filters: { status: 'in_progress' } } },
  { id: 'sys:no_inspection', name: 'No inspection yet', state: { sorting: NEWEST, search: '', filters: { outcome: 'none' } } },
  { id: 'sys:won', name: 'Won', state: { sorting: NEWEST, search: '', filters: { status: 'won' } } },
  { id: 'sys:lost', name: 'Lost', state: { sorting: NEWEST, search: '', filters: { status: 'lost' } } },
]

/**
 * The all-opportunities list on the shared DataTable. The list context (search + filters) rides on every row link as
 * the same query string the record page already reads for its queue navigation (?queue=1&status=…), so
 * "next opportunity" still follows the list you were looking at.
 */
export default function OpportunitiesTable({
  opportunities,
  loading,
  outcomeRows,
  outcomeLookup,
  initial,
}: {
  opportunities: OpportunityListRow[]
  loading: boolean
  outcomeRows: InspectionOutcomeConfigRow[]
  outcomeLookup: Map<string, InspectionOutcomeConfigRow>
  initial: OpportunityListFilters
}) {
  const [ctx, setCtx] = useState<ViewState>({ sorting: [], search: initial.q, filters: {} })
  const qs = useMemo(
    () =>
      buildOpportunityListQuery(
        { q: ctx.search, status: ctx.filters?.status ?? '', inspection_outcome: ctx.filters?.outcome ?? '', project_type: ctx.filters?.type ?? '' },
        { queue: '1' }
      ),
    [ctx]
  )

  const columns = useMemo<ColumnDef<OpportunityListRow, any>[]>(
    () => [
      { id: 'name', header: 'Lead / customer', accessorFn: (o) => `${nameOf(o)} ${o.address_text ?? ''}`, cell: (c) => <span>{nameOf(c.row.original)}<span className="block max-w-xs truncate text-ui-sm text-ink-muted">{c.row.original.address_text || 'No address'}</span></span>, meta: { mobile: 'title' } },
      { enableGlobalFilter: false, id: 'type', header: 'Type', accessorFn: (o) => o.project_type ?? '', cell: (c) => <span className="capitalize">{c.getValue() || '—'}</span> },
      { enableGlobalFilter: false, id: 'status', header: 'Status', accessorFn: (o) => o.status, cell: (c) => <StatusPill domain="opportunity" value={c.getValue()} /> },
      {
        id: 'outcome',
        header: 'Inspection result',
        accessorFn: (o) => o.inspection_outcome ?? '',
        cell: (c) => {
          const info = getInspectionOutcomeDisplay(c.row.original.inspection_outcome, outcomeLookup)
          return info ? <span className={`inline-flex rounded-full px-2.5 py-0.5 text-ui-sm font-medium text-ink ${info.style ? '' : info.color}`} style={info.style}>{info.label}</span> : <span className="text-ink-muted">No inspection yet</span>
        },
      },
      { enableGlobalFilter: false, id: 'assigned', header: 'Assigned', accessorFn: (o) => o.users?.full_name ?? 'Unassigned' },
      { id: 'created', header: 'Created', accessorFn: (o) => o.created_at, meta: { mobile: 'hide' }, cell: (c) => (c.getValue() ? new Date(c.getValue()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—') },
    ],
    [outcomeLookup]
  )

  const filters = useMemo<TableFilter<OpportunityListRow>[]>(
    () => [
      { key: 'status', label: 'Status', options: ['open', 'in_progress', 'negotiation', 'won', 'lost'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })), accessor: (o) => String(o.status || '').toLowerCase() },
      {
        key: 'outcome',
        label: 'Inspection result',
        options: [{ value: 'none', label: 'No inspection yet' }, ...outcomeRows.map((o) => ({ value: o.id.toLowerCase(), label: `${o.label}${o.active === false ? ' (inactive)' : ''}` }))],
        accessor: (o) => String(o.inspection_outcome || 'none').toLowerCase(),
      },
      { key: 'type', label: 'Project type', options: ['roofing', 'siding', 'windows', 'mixed'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), accessor: (o) => String(o.project_type || '').toLowerCase() },
    ],
    [outcomeRows]
  )

  return (
    <DataTable
      columns={columns}
      data={opportunities}
      loading={loading}
      tableKey="opportunities"
      getRowId={(o) => o.id}
      getRowHref={(o) => `/opportunities/${o.id}${qs ? `?${qs}` : ''}`}
      searchPlaceholder="Search name or address"
      filters={filters}
      systemViews={SYSTEM_VIEWS}
      initialSorting={NEWEST}
      initialSearch={initial.q}
      initialFilters={{ status: initial.status, outcome: initial.inspection_outcome, type: initial.project_type }}
      onStateChange={setCtx}
      empty={{ title: 'No opportunities match', body: 'Try another view or clear a filter.' }}
    />
  )
}
