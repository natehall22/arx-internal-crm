'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Field, Select } from '@/components/ui'
import { shortYmd } from '@/lib/before-you'
import { NO_FILTERS, filterLots, groupByBuilderAndDevelopment, type BoardData, type BoardFilters, type BoardLot, type LotCell } from '@/lib/development-board'
import { developmentKey, lotLabel } from '@/lib/properties'

const STATE_TEXT: Record<LotCell['state'], (c: LotCell) => string> = {
  none: () => '—',
  not_scheduled: () => 'Not scheduled',
  scheduled: (c) => (c.date ? shortYmd(c.date) : 'Scheduled'),
  done: (c) => (c.date ? `Done ${shortYmd(c.date)}` : 'Done'),
}
const STATE_CLASS: Record<LotCell['state'], string> = {
  none: 'text-ink',
  not_scheduled: 'bg-amber-50 text-ink border-amber-600',
  scheduled: 'bg-indigo-50 text-ink border-indigo-700',
  done: 'bg-emerald-50 text-ink border-emerald-700',
}

function Cell({ cell, label }: { cell: LotCell; label?: string }) {
  const text = STATE_TEXT[cell.state](cell)
  const body = (
    <span className={`inline-flex min-h-tap w-full items-center rounded-ui px-2 text-ui-base font-semibold ${cell.state === 'none' ? '' : `border ${STATE_CLASS[cell.state]}`}`}>
      {label ? <span className="mr-2 font-normal">{label}</span> : null}
      {text}
    </span>
  )
  return cell.jobId && cell.state !== 'none' ? (
    <Link href={`/ops/jobs/${cell.jobId}`} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}

/**
 * Developments → builder → development (the default view: lot counts and per-trade progress) → lots. Filters: builder,
 * development, trade, "needs <trade> next". Wide screens: a table (lots down, the company's trades across). Phones: one
 * card per lot, each trade a full-width tap to the job. No money anywhere on this screen.
 */
export default function DevelopmentBoard({ board, customerId = '', development = '' }: { board: BoardData; customerId?: string; development?: string }) {
  const router = useRouter()
  // Builder and development are asked of the database (the page reloads with them in its address); trade and "needs next" narrow what is loaded.
  const [f, setF] = React.useState<BoardFilters>(NO_FILTERS)
  const go = (next: { customer?: string; development?: string }) => {
    const qs = new URLSearchParams()
    const c = next.customer ?? customerId
    const d = next.development ?? development
    if (c) qs.set('customer', c)
    if (d) qs.set('development', d)
    const q = qs.toString()
    router.push(`/ops/developments${q ? `?${q}` : ''}`)
  }
  const shown = React.useMemo(() => filterLots(board.lots, f), [board.lots, f])
  const groups = React.useMemo(() => groupByBuilderAndDevelopment(shown, board.trades), [shown, board.trades])
  const filtered = f.trade !== '' || f.needsNext !== '' || development !== ''
  const set = (patch: Partial<BoardFilters>) => setF((c) => ({ ...c, ...patch }))

  if (board.lots.length === 0 && !customerId && !development) {
    return <p className="rounded-ui border border-surface-line bg-surface p-4 text-ui-base text-ink">No lots yet. Open a builder’s Customer File and use Add lots.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {board.truncated ? (
        <p className="rounded-ui border border-amber-600 bg-amber-50 p-3 text-ui-base text-ink" data-testid="board-truncated">
          Showing the first {board.lots.length} of {board.total} lots. {development ? 'Pick a builder as well to see fewer.' : 'Pick a development (or a builder) above to see the rest.'}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Builder">
          {(p) => (
            <Select {...p} className="text-base" value={customerId} onChange={(e) => go({ customer: e.target.value, development: '' })}>
              <option value="">All builders</option>
              {board.options.builders.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Development">
          {(p) => (
            <Select {...p} className="text-base" value={board.options.developments.find((d) => developmentKey(d) === developmentKey(development)) ?? ''} onChange={(e) => go({ development: e.target.value })}>
              <option value="">All developments</option>
              {board.options.developments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Trade">
          {(p) => (
            <Select {...p} className="text-base" value={f.trade} onChange={(e) => set({ trade: e.target.value })}>
              <option value="">Any trade</option>
              {board.trades.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Needs next">
          {(p) => (
            <Select {...p} className="text-base" value={f.needsNext} onChange={(e) => set({ needsNext: e.target.value })}>
              <option value="">Anything</option>
              {board.trades.map((t) => (
                <option key={t.slug} value={t.slug}>
                  Needs {t.label} next
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {groups.length === 0 ? <p className="text-ui-base text-ink">No lots match.</p> : null}
      {groups.map((g) => (
        <details key={g.key} open={filtered || groups.length === 1} className="rounded-ui border border-surface-line bg-surface" data-testid="board-group">
          <summary className="flex min-h-tap cursor-pointer flex-col gap-1 px-4 py-3">
            <span className="text-ui-base font-bold text-ink">
              {g.customerName} · {g.development} · {g.lots.length} lot{g.lots.length === 1 ? '' : 's'}
            </span>
            <span className="text-ui-sm text-ink">{g.progress.length ? g.progress.map((p) => `${p.label} ${p.done}/${p.total} done`).join(' · ') : 'No crews yet'}</span>
          </summary>
          <div className="border-t border-surface-line">
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[40rem] text-left text-ui-base text-ink">
                <thead>
                  <tr className="border-b border-surface-line">
                    <th className="sticky left-0 bg-surface px-3 py-2 font-semibold">Lot</th>
                    {board.trades.map((t) => (
                      <th key={t.slug} className="px-2 py-2 font-semibold">
                        {t.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.lots.map((l) => (
                    <tr key={l.propertyId} className="border-b border-surface-line last:border-b-0">
                      <th scope="row" className="sticky left-0 bg-surface px-3 py-1 text-left font-semibold">
                        <span className="block">{lotLabel({ lot: l.lot }) ?? l.address}</span>
                        <span className="block text-ui-sm font-normal">{l.lot ? l.address : ''}</span>
                      </th>
                      {board.trades.map((t) => (
                        <td key={t.slug} className="px-2 py-1">
                          <Cell cell={l.cells[t.slug]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col divide-y divide-surface-line sm:hidden">
              {g.lots.map((l) => (
                <LotCard key={l.propertyId} lot={l} trades={board.trades} />
              ))}
            </ul>
          </div>
        </details>
      ))}
    </div>
  )
}

function LotCard({ lot, trades }: { lot: BoardLot; trades: BoardData['trades'] }) {
  const has = trades.filter((t) => lot.cells[t.slug].state !== 'none')
  return (
    <li className="flex flex-col gap-1 px-4 py-3" data-testid="lot-card">
      <p className="text-ui-base font-bold text-ink">{lotLabel({ lot: lot.lot }) ?? lot.address}</p>
      {lot.lot ? <p className="break-words text-ui-sm text-ink">{lot.address}</p> : null}
      {has.length === 0 ? <p className="text-ui-base text-ink">No crews yet</p> : has.map((t) => <Cell key={t.slug} cell={lot.cells[t.slug]} label={t.label} />)}
    </li>
  )
}
