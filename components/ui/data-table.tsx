'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Select } from '@/components/ui/field'
import { FilterBar } from '@/components/ui/filter-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'

/** Per-column display hints (put on `column.meta`). */
export type DataTableColumnMeta = {
  /** Right-align + tabular figures: use for every money / number column. */
  align?: 'right'
  /** On a phone each row is a card: 'title' is the card heading, 'hide' leaves the column out of the card. */
  mobile?: 'title' | 'hide'
  /** Label shown beside the value on the card (defaults to the column header). */
  mobileLabel?: string
}

export type TableView = { id: string; name: string; state: ViewState }
export type ViewState = { sorting: SortingState; search: string }

export type ViewStore = {
  list: () => Promise<TableView[]>
  save: (name: string, state: ViewState) => Promise<TableView>
  remove: (id: string) => Promise<void>
}

/** Saved views live in `table_views` (per user, per table key) behind /api/table-views. */
export function apiViewStore(tableKey: string): ViewStore {
  const url = `/api/table-views?table=${encodeURIComponent(tableKey)}`
  return {
    list: async () => {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error('views')
      const body = await r.json().catch(() => null)
      return (Array.isArray(body?.views) ? body.views : []) as TableView[]
    },
    save: async (name, state) => {
      const r = await fetch('/api/table-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: tableKey, name, state }),
      })
      if (!r.ok) throw new Error('save')
      return (await r.json()).view as TableView
    },
    remove: async (id) => {
      const r = await fetch(`/api/table-views?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('remove')
    },
  }
}

type Props<T> = {
  columns: ColumnDef<T, any>[]
  data: T[]
  /** Stable id for saved views, e.g. 'jobs'. Omit to turn saved views off. */
  tableKey?: string
  viewStore?: ViewStore
  loading?: boolean
  getRowId?: (row: T) => string
  /** Whole row (and card) links here. */
  getRowHref?: (row: T) => string
  searchPlaceholder?: string
  empty?: { title: string; body?: string; action?: React.ReactNode }
  toolbar?: React.ReactNode
  initialSorting?: SortingState
}

export function DataTable<T>({ columns, data, tableKey, viewStore, loading, getRowId, getRowHref, searchPlaceholder = 'Search', empty, toolbar, initialSorting = [] }: Props<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [search, setSearch] = React.useState('')
  const table = useReactTable({
    data,
    columns,
    getRowId: getRowId ? (r) => getRowId(r) : undefined,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
  })

  const store = React.useMemo(() => viewStore ?? (tableKey ? apiViewStore(tableKey) : null), [viewStore, tableKey])
  const [views, setViews] = React.useState<TableView[]>([])
  const [activeView, setActiveView] = React.useState('')
  const [naming, setNaming] = React.useState(false)
  const [viewName, setViewName] = React.useState('')
  React.useEffect(() => {
    store?.list().then(setViews).catch(() => setViews([]))
  }, [store])

  const applyView = (id: string) => {
    setActiveView(id)
    const v = views.find((x) => x.id === id)
    if (v) {
      setSorting(v.state.sorting ?? [])
      setSearch(v.state.search ?? '')
    }
  }
  const saveView = async () => {
    if (!store || !viewName.trim()) return
    try {
      const v = await store.save(viewName.trim(), { sorting, search })
      setViews((prev) => [...prev.filter((x) => x.id !== v.id), v])
      setActiveView(v.id)
      setNaming(false)
      setViewName('')
    } catch {
      toast.error('Could not save the view')
    }
  }
  const removeView = async () => {
    if (!store || !activeView) return
    try {
      await store.remove(activeView)
      setViews((prev) => prev.filter((x) => x.id !== activeView))
      setActiveView('')
    } catch {
      toast.error('Could not delete the view')
    }
  }

  const rows = table.getRowModel().rows
  const meta = (c: { columnDef: ColumnDef<T, any> }) => (c.columnDef.meta ?? {}) as DataTableColumnMeta
  const headers = table.getHeaderGroups()[0]?.headers ?? []
  const titleHeader = headers.find((h) => meta(h.column).mobile === 'title') ?? headers[0]

  return (
    <div className="flex flex-col gap-3">
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={searchPlaceholder}>
        {store ? (
          <>
            <Select value={activeView} onChange={(e) => applyView(e.target.value)} aria-label="Saved views" className="w-full sm:w-auto">
              <option value="">All (default view)</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" onClick={() => setNaming(true)}>Save view</Button>
            {activeView ? <Button variant="ghost" size="sm" onClick={removeView}>Delete view</Button> : null}
          </>
        ) : null}
        {toolbar}
      </FilterBar>

      {loading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={empty?.title ?? 'Nothing here yet'} body={empty?.body} action={empty?.action} />
      ) : (
        <>
          {/* Desktop / tablet: a real table */}
          <div className="hidden overflow-x-auto rounded-ui border border-surface-line sm:block">
            <table className="w-full border-collapse text-ui-base text-ink">
              <thead className="bg-surface-subtle">
                <tr>
                  {headers.map((h) => {
                    const m = meta(h.column)
                    const sorted = h.column.getIsSorted()
                    return (
                      <th key={h.id} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined} className={cn('whitespace-nowrap px-3 py-2 text-left text-ui-sm font-semibold', m.align === 'right' && 'text-right')}>
                        {h.column.getCanSort() ? (
                          <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex min-h-tap items-center gap-1 font-semibold">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <span aria-hidden>{sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}</span>
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-surface-line hover:bg-surface-subtle">
                    {row.getVisibleCells().map((cell, i) => {
                      const m = meta(cell.column)
                      const content = flexRender(cell.column.columnDef.cell, cell.getContext())
                      return (
                        <td key={cell.id} className={cn('px-3 py-2 align-middle', m.align === 'right' && 'text-right tabular-nums')}>
                          {i === 0 && getRowHref ? <Link href={getRowHref(row.original)} className="font-semibold underline-offset-2 hover:underline">{content}</Link> : content}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per row */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => {
              const cells = row.getVisibleCells()
              const title = cells.find((c) => c.column.id === titleHeader?.column.id) ?? cells[0]
              const rest = cells.filter((c) => c !== title && meta(c.column).mobile !== 'hide')
              const body = (
                <div className="flex flex-col gap-1.5 rounded-ui border border-surface-line bg-surface p-3">
                  <div className="text-ui-base font-semibold text-ink">{flexRender(title.column.columnDef.cell, title.getContext())}</div>
                  {rest.map((c) => {
                    const m = meta(c.column)
                    const header = typeof c.column.columnDef.header === 'string' ? c.column.columnDef.header : c.column.id
                    return (
                      <div key={c.id} className="flex items-baseline justify-between gap-3 text-ui-sm">
                        <span className="text-ink-muted">{m.mobileLabel ?? header}</span>
                        <span className={cn('text-right text-ink', m.align === 'right' && 'tabular-nums')}>{flexRender(c.column.columnDef.cell, c.getContext())}</span>
                      </div>
                    )
                  })}
                </div>
              )
              return (
                <li key={row.id}>{getRowHref ? <Link href={getRowHref(row.original)} className="block">{body}</Link> : body}</li>
              )
            })}
          </ul>
        </>
      )}

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent title="Save this view" description="Keeps the current search and sort under a name you can pick again.">
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Needs scheduling" aria-label="View name" maxLength={60} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNaming(false)}>Cancel</Button>
            <Button onClick={saveView} disabled={!viewName.trim()}>Save view</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
