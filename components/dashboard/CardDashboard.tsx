import Link from 'next/link'

import CardGrid from '@/components/dashboard/CardGrid'
import type { CardData } from '@/lib/dashboard-cards'

/**
 * The card dashboard (lib/dashboard-cards.ts): the owner's order, each person's role cards. Presentational only — every number
 * was read from an existing source on the server; the cards themselves are drawn by CardGrid (also used by Today's My day).
 */

/** What a brand-new company sees instead of rows of zeros: the next steps, not numbers. */
function EmptyStart() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sm:p-6" data-empty-start>
      <h2 className="text-lg font-semibold text-gray-900">Nothing to report yet — let’s get you started</h2>
      <p className="text-gray-800 mt-1">Your numbers show up here as soon as there is work to count. The quickest way to get there:</p>
      <ol className="list-decimal pl-5 mt-3 space-y-1 text-gray-900">
        <li>Finish setup (logo, price book, your first customer).</li>
        <li>Add a customer and a quote or a plan.</li>
        <li>Schedule the first visit or job.</li>
      </ol>
      <Link href="/today" className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold">Finish setup</Link>
    </div>
  )
}

export default function CardDashboard({ firstName, cards, canEdit, emptyStart = false }: { firstName: string; cards: CardData[]; canEdit: boolean; emptyStart?: boolean }) {
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
      {emptyStart ? (
        <EmptyStart />
      ) : cards.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-gray-800">
          There are no dashboard cards for your role yet.{canEdit ? ' Add some in Settings → Dashboard settings.' : ''}
        </div>
      ) : (
        <CardGrid cards={cards} />
      )}
    </div>
  )
}
