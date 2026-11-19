'use client'

import * as React from 'react'
import Link from 'next/link'

import ScheduleFilterBar from '@/components/schedule/ScheduleFilterBar'
import { Button } from '@/components/ui/button'
import { formatDateWeekday } from '@/lib/format'
import type { WorkItem } from '@/lib/all-work-db'
import { addDaysYmd, weekdayOfYmd } from '@/lib/service-plans'
import { EMPTY_FILTERS, NO_TRADE_COLOR, filterOptions, filterWork, tradeColor, type ScheduleFilters } from '@/lib/schedule-filters'
import { rolledLabel } from '@/lib/work-order-rolls'

type Load = { items: WorkItem[]; trades: Array<{ slug: string; label: string; active: boolean }>; today: string; myCrewIds: string[]; appointments: boolean; from: string; to: string }
type Mode = 'month' | 'week' | 'day'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthKey = (ymd: string) => ymd.slice(0, 7)
const mondayOf = (ymd: string) => addDaysYmd(ymd, -((weekdayOfYmd(ymd) + 6) % 7))
/** The 6-week grid (Monday first) that holds a month: the range one fetch covers, so month → week → day never refetches. */
const gridStart = (ymd: string) => mondayOf(`${monthKey(ymd)}-01`)
const monthLabel = (ymd: string) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey(ymd)}-15T12:00:00Z`))

export const onDay = (items: readonly WorkItem[], day: string) => items.filter((i) => i.date <= day && i.endDate >= day)

/**
 * Jobs → Schedule → All work: the owner's big picture. Month = a count per section on each day (in the section's color); tap a
 * day for that day's list grouped by crew; Week shows every item. Tap an item to open its job / visit / appointment. Read-only.
 * Data: /api/ops/all-work. Filters: the shared ScheduleFilterBar (remembered per person; saved views in table_views).
 */
export default function AllWorkCalendar() {
  const [mode, setMode] = React.useState<Mode>('month')
  const [anchor, setAnchor] = React.useState<string | null>(null)
  const [data, setData] = React.useState<Load | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [filters, setFilters] = React.useState<ScheduleFilters>(EMPTY_FILTERS)
  const gridKey = anchor ? monthKey(anchor) : ''
  const loadedKey = React.useRef('')

  React.useEffect(() => {
    // The first answer already covers today's month (the server's default window is that month's grid).
    if (anchor && loadedKey.current === gridKey) return
    let alive = true
    const start = anchor ? gridStart(anchor) : null
    const q = start ? `?from=${start}&to=${addDaysYmd(start, 41)}` : ''
    fetch(`/api/ops/all-work${q}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('load')
        return (await res.json()) as Load
      })
      .then((d) => {
        if (!alive) return
        setFailed(false)
        setData(d)
        // First load without a day: open on today's month (the server fetched the month the day sits in).
        loadedKey.current = anchor ? gridKey : monthKey(d.today)
        setAnchor((a) => a ?? d.today)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // Refetch only when the month on screen changes (anchor null = the very first load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKey])

  const trades = React.useMemo(() => (data?.trades ?? []).filter((t) => t.active), [data])
  const color = React.useCallback((slug: string | null) => tradeColor(slug, data?.trades ?? []), [data])
  const shown = React.useMemo(() => filterWork(data?.items ?? [], filters), [data, filters])
  const options = React.useMemo(() => filterOptions(data?.items ?? []), [data])
  const day = anchor ?? data?.today ?? ''

  const step = (dir: 1 | -1) => {
    if (!anchor) return
    if (mode === 'month') {
      const [y, m] = anchor.split('-').map(Number)
      const d = new Date(Date.UTC(y, m - 1 + dir, 1, 12))
      setAnchor(d.toISOString().slice(0, 10))
    } else setAnchor(addDaysYmd(anchor, dir * (mode === 'week' ? 7 : 1)))
  }
  const openDay = (d: string) => {
    setAnchor(d)
    setMode('day')
  }
  const tab = (m: Mode, label: string) => (
    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`inline-flex min-h-tap items-center rounded-ui px-4 text-ui-sm font-semibold ${mode === m ? 'bg-brand-700 text-white' : 'border border-surface-line bg-surface text-ink'}`}>
      {label}
    </button>
  )

  if (failed && !data) return <div className="mx-auto max-w-[1800px] px-4 py-6 text-ui-sm text-danger">Couldn’t load the calendar. Reload to try again.</div>
  if (!data) return <div className="mx-auto max-w-[1800px] px-4 py-6 text-ui-sm text-ink">Loading…</div>

  const title = mode === 'month' ? monthLabel(day) : mode === 'week' ? `Week of ${formatDateWeekday(mondayOf(day))}` : formatDateWeekday(day)

  const item = (i: WorkItem) => (
    <Link
      key={i.key}
      href={i.href}
      className="flex min-h-tap flex-col justify-center rounded-ui border border-surface-line bg-surface px-2 py-1 text-ui-sm text-ink hover:bg-surface-subtle"
      style={{ borderLeft: `6px solid ${color(i.trade)}` }}
    >
      <span className="font-semibold">
        {i.time ? `${i.time} · ` : ''}
        {i.title}
      </span>
      <span className="text-ink">{[i.customerName, i.subtitle].filter(Boolean).join(' · ')}</span>
      {i.rolls > 0 ? <span className="font-semibold text-[#7c2d12]">{rolledLabel(i.rolls)}</span> : null}
    </Link>
  )

  const start = gridStart(day)
  const week = mondayOf(day)
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-4">
      <ScheduleFilterBar
        value={filters}
        onChange={setFilters}
        options={options}
        trades={trades.map((t) => ({ slug: t.slug, label: t.label, color: color(t.slug) }))}
        typeChips
        viewsKey="sched_all"
        defaultFilters={data.myCrewIds.length ? { ...EMPTY_FILTERS, crew: data.myCrewIds.join(',') } : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Previous" onClick={() => step(-1)}>
          ‹
        </Button>
        <h2 className="min-w-[10rem] text-center text-base font-semibold text-ink">{title}</h2>
        <Button variant="secondary" size="icon" aria-label="Next" onClick={() => step(1)}>
          ›
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(data.today)}>
          Today
        </Button>
        <span className="ml-auto flex gap-2">
          {tab('month', 'Month')}
          {tab('week', 'Week')}
          {tab('day', 'Day')}
        </span>
      </div>

      {mode === 'month' ? (
        <div className="overflow-hidden rounded-ui border border-surface-line bg-surface">
          <div className="grid grid-cols-7 border-b border-surface-line bg-surface-subtle text-center text-ui-sm font-semibold text-ink">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, n) => addDaysYmd(start, n)).map((d) => {
              const here = onDay(shown, d)
              const bySection = new Map<string, number>()
              for (const i of here) bySection.set(i.trade ?? '', (bySection.get(i.trade ?? '') ?? 0) + 1)
              const inMonth = monthKey(d) === monthKey(day)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => openDay(d)}
                  aria-label={`${formatDateWeekday(d)}: ${here.length} item${here.length === 1 ? '' : 's'}`}
                  className={`flex min-h-[64px] flex-col items-start gap-1 border-b border-r border-surface-line p-1 text-left ${inMonth ? 'bg-surface' : 'bg-surface-subtle'} ${d === data.today ? 'ring-2 ring-inset ring-brand-600' : ''}`}
                >
                  <span className="text-ui-sm font-semibold text-ink">{Number(d.slice(8))}</span>
                  <span className="flex flex-wrap gap-1">
                    {Array.from(bySection, ([slug, n]) => (
                      <span key={slug || 'none'} className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-ui-sm font-bold text-white" style={{ backgroundColor: slug ? color(slug) : NO_TRADE_COLOR }}>
                        {n}
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {mode === 'week' ? (
        <div className="grid gap-2 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, n) => addDaysYmd(week, n)).map((d) => (
            <section key={d} className="flex flex-col gap-1 rounded-ui border border-surface-line bg-surface p-2">
              <button type="button" onClick={() => openDay(d)} className={`min-h-tap text-left text-ui-sm font-semibold ${d === data.today ? 'text-brand-800' : 'text-ink'}`}>
                {formatDateWeekday(d)}
              </button>
              {onDay(shown, d).length === 0 ? <p className="text-ui-sm text-ink">Nothing</p> : onDay(shown, d).map(item)}
            </section>
          ))}
        </div>
      ) : null}

      {mode === 'day' ? <DayList items={onDay(shown, day)} render={item} /> : null}
    </div>
  )
}

/** A day's items grouped by crew (people's own appointments under "Office"; work with no crew under "No crew"). */
function DayList({ items, render }: { items: WorkItem[]; render: (i: WorkItem) => React.ReactNode }) {
  if (items.length === 0) return <p className="rounded-ui border border-surface-line bg-surface p-4 text-ui-sm text-ink">Nothing on this day.</p>
  const groups = new Map<string, WorkItem[]>()
  for (const i of items) {
    const g = i.crewName ?? (i.type === 'appointment' ? 'Office' : i.techName ? i.techName : 'No crew')
    groups.set(g, [...(groups.get(g) ?? []), i])
  }
  return (
    <div className="flex flex-col gap-3">
      {Array.from(groups, ([name, list]) => (
        <section key={name} className="rounded-ui border border-surface-line bg-surface p-3">
          <h3 className="mb-2 text-base font-semibold text-ink">
            {name} <span className="font-normal">({list.length})</span>
          </h3>
          <div className="flex flex-col gap-2">{list.map(render)}</div>
        </section>
      ))}
    </div>
  )
}
