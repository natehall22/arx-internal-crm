import Link from 'next/link'

import GoalBar from '@/components/dashboard/GoalBar'
import { formatCardValue, type CardData, type LeaderboardData, type TileData } from '@/lib/dashboard-cards'

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
  return v.toLocaleString('en-US')
}

function Tile({ t }: { t: TileData }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 flex flex-col" data-card={t.key}>
      <p className="text-sm font-medium text-gray-800">{t.label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{formatCardValue(t.display, t.value)}</p>
      {t.sub ? <p className="text-sm text-gray-700 mt-1">{t.sub}</p> : null}
      {t.goal !== null && t.value !== null ? (
        <div className="mt-3">
          <GoalBar label="Goal" current={t.value} goal={t.goal} color={BAR} format={(n) => formatCardValue(t.display, n)} />
        </div>
      ) : null}
    </div>
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

export default function CardDashboard({ firstName, cards, canEdit }: { firstName: string; cards: CardData[]; canEdit: boolean }) {
  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Welcome back, {firstName || 'there'}!</h1>
          <p className="text-gray-700 text-sm sm:text-base mt-1">Here’s how the week is going.</p>
        </div>
        {canEdit ? (
          <Link href="/admin/dashboard-settings" className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-900">
            Customize cards
          </Link>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-gray-800">
          There are no dashboard cards for your role yet.{canEdit ? ' Add some in Settings → Dashboard settings.' : ''}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {cards.map((c) => (c.kind === 'leaderboard' ? <Leaderboard key={c.key} lb={c} /> : <Tile key={c.key} t={c} />))}
        </div>
      )}
    </div>
  )
}
