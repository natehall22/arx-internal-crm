export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'

import Nav from '@/components/Nav'
import CrewScoreboardCard from '@/components/crew/CrewScoreboardCard'
import { requireAuth } from '@/lib/auth'
import { loadScoreboard } from '@/lib/crew-incentives-db'
import { createServiceClient } from '@/lib/supabase/service'

/** My crew's bonuses this week (phone page). Lawn & landscape companies with crew incentives on only; everyone else gets a 404. */
export default async function CrewBonusesPage() {
  const { profile } = await requireAuth()
  const data = await loadScoreboard(createServiceClient(), profile.org_id, { userId: profile.id })
  if (!data) notFound()
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-xl px-4 py-4">
        {data.crews.length ? <CrewScoreboardCard data={data} /> : <p className="text-base text-[#2c2c2a]">You are not on a crew yet.</p>}
      </main>
    </div>
  )
}
