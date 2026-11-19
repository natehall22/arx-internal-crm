/**
 * The Development board: rows = lots, columns = the company's trades, each cell = that lot's crew for the trade
 * (not scheduled / a date / done). Pure and client-safe; the read is lib/development-board-db.ts.
 * "Needs <trade> next" = the first trade in the company's own order (org_trades.sort) that the lot has and has not finished.
 */
import { developmentKey } from '@/lib/properties'

export type CellState = 'none' | 'not_scheduled' | 'scheduled' | 'done'
export type LotCell = { state: CellState; /** Day booked, or day done. YYYY-MM-DD */ date: string | null; jobId: string | null }
export type BoardTrade = { slug: string; label: string }

export type BoardLot = {
  propertyId: string
  customerId: string
  customerName: string
  community: string
  lot: string | null
  address: string
  /** Any job on this lot (to open when the lot has no crew rows yet). */
  jobId: string | null
  cells: Record<string, LotCell>
  nextTrade: string | null
}

export type BoardData = { trades: BoardTrade[]; lots: BoardLot[]; truncated: boolean }

export type BoardProperty = { id: string; customer_id: string; community: string; lot: string | null; address_text: string }
export type BoardCrew = { id: string; job_id: string | null; property_id: string | null; trade: string | null; status: string; scheduled_date: string | null; completed_at: string | null }

const naturally = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Pure. `jobsOpen` = ids of jobs that are not cancelled; `doneDay` turns a completed timestamp into the company's calendar day. */
export function buildBoard(
  properties: readonly BoardProperty[],
  crews: readonly BoardCrew[],
  jobsOpen: ReadonlySet<string>,
  customerNames: ReadonlyMap<string, string>,
  trades: readonly BoardTrade[],
  doneDay: (at: string) => string
): BoardLot[] {
  const byProperty = new Map<string, BoardCrew[]>()
  for (const c of crews) {
    if (!c.property_id || !c.trade || c.status === 'cancelled' || (c.job_id && !jobsOpen.has(c.job_id))) continue
    byProperty.set(c.property_id, [...(byProperty.get(c.property_id) ?? []), c])
  }
  const lots: BoardLot[] = properties.map((p) => {
    const mine = byProperty.get(p.id) ?? []
    const cells: Record<string, LotCell> = {}
    for (const t of trades) {
      const rows = mine.filter((c) => c.trade === t.slug)
      if (rows.length === 0) {
        cells[t.slug] = { state: 'none', date: null, jobId: null }
        continue
      }
      const open = rows.filter((c) => c.status !== 'completed')
      if (open.length > 0) {
        const booked = open.filter((c) => c.scheduled_date).sort((a, b) => (a.scheduled_date as string).localeCompare(b.scheduled_date as string))
        const pick = booked[0] ?? open[0]
        cells[t.slug] = { state: booked[0] ? 'scheduled' : 'not_scheduled', date: booked[0]?.scheduled_date ?? null, jobId: pick.job_id }
      } else {
        const done = rows.filter((c) => c.completed_at).sort((a, b) => (a.completed_at as string).localeCompare(b.completed_at as string))
        const last = done[done.length - 1]
        cells[t.slug] = { state: 'done', date: last?.completed_at ? doneDay(last.completed_at) : null, jobId: (last ?? rows[0]).job_id }
      }
    }
    const next = trades.find((t) => cells[t.slug].state === 'not_scheduled' || cells[t.slug].state === 'scheduled')
    return {
      propertyId: p.id,
      customerId: p.customer_id,
      customerName: customerNames.get(p.customer_id) ?? 'Customer',
      community: p.community,
      lot: p.lot,
      address: p.address_text,
      jobId: mine.find((c) => c.job_id)?.job_id ?? null,
      cells,
      nextTrade: next?.slug ?? null,
    }
  })
  return lots.sort((a, b) => naturally(a.customerName, b.customerName) || naturally(a.community, b.community) || naturally(a.lot ?? a.address, b.lot ?? b.address))
}

export type BoardFilters = { customerId: string; development: string; trade: string; needsNext: string }
export const NO_FILTERS: BoardFilters = { customerId: '', development: '', trade: '', needsNext: '' }

/** Pure. Builder + development narrow the lots; "trade" keeps lots that have that trade; "needs next" keeps lots whose next trade is it. */
export function filterLots(lots: readonly BoardLot[], f: BoardFilters): BoardLot[] {
  return lots.filter(
    (l) =>
      (!f.customerId || l.customerId === f.customerId) &&
      (!f.development || developmentKey(l.community) === developmentKey(f.development)) &&
      (!f.trade || l.cells[f.trade]?.state !== 'none') &&
      (!f.needsNext || l.nextTrade === f.needsNext)
  )
}

export type DevelopmentGroup = {
  key: string
  customerId: string
  customerName: string
  development: string
  lots: BoardLot[]
  /** Per trade: lots that have the trade, and how many of those are done ("Sod 40/120 done"). */
  progress: Array<{ slug: string; label: string; done: number; total: number }>
}

/** Pure. Builder, then development (the default view): lot counts and per-trade progress. */
export function groupByBuilderAndDevelopment(lots: readonly BoardLot[], trades: readonly BoardTrade[]): DevelopmentGroup[] {
  const groups = new Map<string, DevelopmentGroup>()
  for (const l of lots) {
    const key = `${l.customerId}|${developmentKey(l.community)}`
    const g = groups.get(key) ?? { key, customerId: l.customerId, customerName: l.customerName, development: l.community, lots: [], progress: [] }
    g.lots.push(l)
    groups.set(key, g)
  }
  for (const g of Array.from(groups.values())) {
    g.progress = trades
      .map((t) => ({ slug: t.slug, label: t.label, total: g.lots.filter((l) => l.cells[t.slug].state !== 'none').length, done: g.lots.filter((l) => l.cells[t.slug].state === 'done').length }))
      .filter((p) => p.total > 0)
  }
  return Array.from(groups.values())
}
