import Link from 'next/link'

import GoalBar from '@/components/dashboard/GoalBar'
import MyDayList from '@/components/dashboard/MyDayList'
import { HEADED_GROUPS, formatCardValue, type CardData, type CardGroup, type LeaderboardData, type ListData, type TileData } from '@/lib/dashboard-cards'

/**
 * The card dashboard (lib/dashboard-cards.ts): one tile per number card, one table per leaderboard, in the owner's order.
 * Presentational only — every number was read from an existing source on the server and arrives ready; a failed read is "—".
 * Text is dark on white (contrast rule); no hover-only actions; tables scroll inside their own box with the name pinned.
 */
const BAR = 'bg-green-500'

function formatCell(format: LeaderboardData['columns'][number]['format'], v: number | null): string {
  if (v === null) return '—'
  if (format === 'money') return formatCardValue('money', v)
  if (format === 'hours') return `${v} h`
  if (format === 'percent') return `${v}%`
  return v.toLocaleString('en-US')
}

function Tile({ t }: { t: TileData }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 flex flex-col" data-card={t.key}>
      <p className="text-sm font-medium text-gray-800">{t.label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{formatCardValue(t.display, t.value)}</p>
      {t.unavailable && t.value === null ? <p className="text-sm text-gray-800 mt-1">{t.unavailable}</p> : null}
      {t.sub ? <p className="text-sm text-gray-800 mt-1">{t.sub}</p> : null}
      {t.goal !== null && t.value !== null ? (
        <div className="mt-3">
          <GoalBar label="Goal" current={t.value} goal={t.goal} color={BAR} format={(n) => formatCardValue(t.display, n)} />
        </div>
      ) : null}
    </div>
  )
}

function ListCard({ list }: { list: ListData }) {
  if (list.key === 'my-day') return <MyDayList list={list} />
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sm:col-span-2" data-card={list.key}>
      <h2 className="px-4 pt-4 pb-1 text-base sm:text-lg font-semibold text-gray-900">
        {list.label}
        {list.count > 0 ? <span className="ml-2 text-sm font-semibold text-gray-800">({list.count})</span> : null}
      </h2>
      {list.sub ? <p className="px-4 pb-2 text-sm text-gray-800">{list.sub}</p> : null}
      {list.failed ? (
        <p className="px-4 pb-4 text-sm text-gray-800">Couldn’t load this card.</p>
      ) : list.rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-gray-800">{list.empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {list.rows.map((r) => {
            const body = (
              <>
                <span className={`block text-base font-medium ${r.tone === 'warn' ? 'text-red-800' : 'text-gray-900'}`}>{r.title}</span>
                {r.detail ? <span className="block text-sm text-gray-800">{r.detail}</span> : null}
              </>
            )
            return (
              <li key={r.id}>
                {r.href ? <Link href={r.href} className="block min-h-[44px] px-4 py-3">{body}</Link> : <div className="px-4 py-3">{body}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Leaderboard({ lb }: { lb: LeaderboardData }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sm:col-span-2 lg:col-span-4" data-card={lb.key}>
      <h2 className="px-4 pt-4 pb-2 text-base sm:text-lg font-semibold text-gray-900">{lb.label}</h2>
      {lb.failed ? (
        <p className="px-4 pb-4 text-sm text-gray-800">Couldn’t load this card.</p>
      ) : lb.rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-gray-800">{lb.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-gray-100 text-left text-gray-800">
                <th scope="col" className="sticky left-0 bg-white px-4 py-2 font-semibold">Name</th>
                {lb.columns.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lb.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 bg-white px-4 py-3 text-left font-medium text-gray-900">{r.name}</th>
                  {r.values.map((v, i) => (
                    <td key={lb.columns[i]?.key ?? i} className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{formatCell(lb.columns[i]?.format ?? 'count', v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const GROUP_HEADINGS: Partial<Record<CardGroup, string>> = {
  Projects: 'Projects',
  Problems: 'Today’s problems',
  'My day': 'My day',
  Billing: 'Billing',
  'Off-season': 'Off-season: renewals and balances',
}

export default function CardGrid({ cards }: { cards: CardData[] }) {
  let lastGroup: CardGroup | undefined
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => {
        const heading = c.group && c.group !== lastGroup && HEADED_GROUPS.includes(c.group) ? GROUP_HEADINGS[c.group] : null
        lastGroup = c.group
        return (
          <div key={c.key} className="contents">
            {heading ? <h2 className="col-span-full text-lg font-bold text-gray-900 mt-2" data-group-heading>{heading}</h2> : null}
            {c.kind === 'leaderboard' ? <Leaderboard lb={c} /> : c.kind === 'list' ? <ListCard list={c} /> : <Tile t={c} />}
          </div>
        )
      })}
    </div>
  )
}
