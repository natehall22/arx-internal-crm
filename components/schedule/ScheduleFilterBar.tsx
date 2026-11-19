'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { apiViewStore, type TableView } from '@/components/ui/data-table'
import { Select } from '@/components/ui/field'
import { FilterBar } from '@/components/ui/filter-bar'
import { toast } from '@/components/ui/toast'
import {
  EMPTY_FILTERS,
  LAST_FILTER_VIEW,
  NO_TRADE_COLOR,
  filtersToViewState,
  isFiltering,
  viewStateToFilters,
  type FilterOption,
  type ScheduleFilters,
  type WorkType,
} from '@/lib/schedule-filters'

export type FilterBarOptions = { crews: FilterOption[]; techs: FilterOption[]; customers: FilterOption[]; developments: FilterOption[] }

const TYPE_LABELS: Record<WorkType, string> = { visit: 'Visits', job: 'Jobs & crews', appointment: 'Appointments' }

const chipClass = (on: boolean) =>
  `inline-flex min-h-tap items-center gap-2 rounded-full border px-3 text-ui-sm font-semibold ${on ? 'border-brand-700 bg-brand-700 text-white' : 'border-surface-line bg-surface text-ink hover:bg-surface-subtle'}`

/**
 * THE filter bar for every schedule screen (Board, Visits, All work): text search + crew / tech / customer / development
 * dropdowns, plus trade chips (multi-select) and type chips when the screen has them. With `viewsKey` it remembers each
 * person's last filter and offers named saved views — both stored in `table_views` (/api/table-views), the same store the
 * DataTable lists use. The rule that applies it is `filterWork` (lib/schedule-filters.ts).
 */
export default function ScheduleFilterBar({
  value,
  onChange,
  options,
  trades,
  typeChips = false,
  show = {},
  viewsKey,
  defaultFilters,
  searchPlaceholder = 'Search customer, address, job, crew',
  total,
  shown,
}: {
  value: ScheduleFilters
  onChange: (f: ScheduleFilters) => void
  options: FilterBarOptions
  /** Trade chips with the trade's color. */
  /** Inactive trades are listed only while one of them is selected (a saved view must not lose its chip). */
  trades?: Array<{ slug: string; label: string; color: string; active?: boolean }>
  typeChips?: boolean
  show?: { crew?: boolean; tech?: boolean; customer?: boolean }
  viewsKey?: string
  /** Used when the person has no remembered filter yet (e.g. a crew lead's own crew). */
  defaultFilters?: ScheduleFilters
  searchPlaceholder?: string
  /** Rows before / after the filter: drives the "Filtered — N hidden" banner. */
  total?: number
  shown?: number
}) {
  const store = React.useMemo(() => (viewsKey ? apiViewStore(viewsKey) : null), [viewsKey])
  const [views, setViews] = React.useState<TableView[]>([])
  const [activeView, setActiveView] = React.useState('')
  const [naming, setNaming] = React.useState(false)
  const [viewName, setViewName] = React.useState('')
  const hydrated = React.useRef(false)
  const lastSaved = React.useRef('')
  const changeRef = React.useRef(onChange)
  changeRef.current = onChange
  const defaultsRef = React.useRef(defaultFilters)
  defaultsRef.current = defaultFilters

  // Load the person's views once: apply their remembered filter, else the default.
  React.useEffect(() => {
    let alive = true
    const finish = (list: TableView[]) => {
      if (!alive) return
      const last = list.find((v) => v.name === LAST_FILTER_VIEW)
      const start = last ? viewStateToFilters(last.state) : (defaultsRef.current ?? null)
      if (start) {
        lastSaved.current = JSON.stringify(filtersToViewState(start))
        changeRef.current(start)
      }
      setViews(list.filter((v) => !v.name.startsWith('__')))
      hydrated.current = true
    }
    if (!store) {
      hydrated.current = true
      return
    }
    store.list().then(finish).catch(() => finish([]))
    return () => {
      alive = false
    }
  }, [store])

  // Remember the last filter (quietly, a moment after the person stops changing it).
  React.useEffect(() => {
    if (!store || !hydrated.current) return
    const state = filtersToViewState(value)
    const key = JSON.stringify(state)
    if (key === lastSaved.current) return
    const t = setTimeout(() => {
      lastSaved.current = key
      store.save(LAST_FILTER_VIEW, state).catch(() => undefined)
    }, 700)
    return () => clearTimeout(t)
  }, [store, value])

  const set = (patch: Partial<ScheduleFilters>) => {
    setActiveView('')
    onChange({ ...value, ...patch })
  }
  const toggle = <K extends 'trades' | 'types'>(key: K, v: ScheduleFilters[K][number]) => {
    const cur = value[key] as string[]
    set({ [key]: cur.includes(v as string) ? cur.filter((x) => x !== v) : [...cur, v as string] } as Partial<ScheduleFilters>)
  }
  const select = (key: 'crew' | 'tech' | 'customer' | 'development', label: string, opts: FilterOption[], extra?: FilterOption) => {
    // The selected value is always an option, even when nothing in this range / list carries it (else the box would read "All").
    const picked = value[key]
    const missing = picked && !extra && !opts.some((o) => o.value === picked) ? { value: picked, label: 'Selected (nothing here)' } : null
    return (
    <Select key={key} value={picked} onChange={(e) => set({ [key]: e.target.value } as Partial<ScheduleFilters>)} aria-label={label} className="w-full sm:w-auto">
      <option value="">{`All ${label.toLowerCase()}`}</option>
      {extra ? <option value={extra.value}>{extra.label}</option> : null}
      {missing ? <option value={missing.value}>{missing.label}</option> : null}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
    )
  }

  const tradeChips = [
    ...(trades ?? []).filter((t) => t.active !== false || value.trades.includes(t.slug)),
    ...value.trades.filter((s) => !(trades ?? []).some((t) => t.slug === s)).map((s) => ({ slug: s, label: s, color: NO_TRADE_COLOR })),
  ]
  const multiCrew = value.crew.includes(',')
  const saveView = async () => {
    if (!store || !viewName.trim()) return
    try {
      const v = await store.save(viewName.trim(), filtersToViewState(value))
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

  return (
    <div className="flex flex-col gap-2" data-schedule-filters>
      {isFiltering(value) ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-ui bg-ink px-3 py-2 text-ui-sm font-semibold text-white">
          <span>{typeof total === 'number' && typeof shown === 'number' ? `Filtered — ${Math.max(0, total - shown)} hidden` : 'Filtered'}</span>
          <button type="button" onClick={() => set({ ...EMPTY_FILTERS })} className="min-h-tap font-bold underline">
            Clear
          </button>
        </div>
      ) : null}
      {tradeChips.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Section">
          {tradeChips.map((t) => {
            const on = value.trades.includes(t.slug)
            return (
              <button key={t.slug} type="button" aria-pressed={on} onClick={() => toggle('trades', t.slug)} className={chipClass(on)}>
                <span aria-hidden="true" className="h-3 w-3 rounded-full border border-white/70" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            )
          })}
        </div>
      ) : null}
      {typeChips ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type of work">
          {(Object.keys(TYPE_LABELS) as WorkType[]).map((t) => {
            const on = value.types.includes(t)
            return (
              <button key={t} type="button" aria-pressed={on} onClick={() => toggle('types', t)} className={chipClass(on)}>
                {TYPE_LABELS[t]}
              </button>
            )
          })}
        </div>
      ) : null}
      <FilterBar search={value.q} onSearch={(q) => set({ q })} searchPlaceholder={searchPlaceholder}>
        {show.crew !== false ? select('crew', 'Crews', options.crews, multiCrew ? { value: value.crew, label: 'My crews' } : undefined) : null}
        {show.tech !== false && options.techs.length > 0 ? select('tech', 'Techs', options.techs) : null}
        {show.customer !== false ? select('customer', 'Customers', options.customers) : null}
        {options.developments.length > 0 ? select('development', 'Developments', options.developments) : null}
        {isFiltering(value) ? (
          <Button variant="ghost" size="sm" onClick={() => set({ ...EMPTY_FILTERS })}>
            Clear filters
          </Button>
        ) : null}
        {store ? (
          <>
            <Select
              value={activeView}
              onChange={(e) => {
                const v = views.find((x) => x.id === e.target.value)
                setActiveView(e.target.value)
                onChange(v ? viewStateToFilters(v.state) : EMPTY_FILTERS)
              }}
              aria-label="Saved views"
              className="w-full sm:w-auto"
            >
              <option value="">Saved views</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
            {naming ? (
              <span className="flex items-center gap-2">
                <input
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  placeholder="Name this view"
                  aria-label="View name"
                  maxLength={60}
                  className="min-h-tap rounded-ui border border-surface-line bg-surface px-3 text-base text-ink"
                />
                <Button size="sm" onClick={() => void saveView()} disabled={!viewName.trim()}>
                  Save
                </Button>
              </span>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setNaming(true)}>
                Save view
              </Button>
            )}
            {activeView ? (
              <Button variant="ghost" size="sm" onClick={() => void removeView()}>
                Delete view
              </Button>
            ) : null}
          </>
        ) : null}
      </FilterBar>
    </div>
  )
}
