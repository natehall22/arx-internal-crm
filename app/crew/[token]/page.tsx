import type { Metadata } from 'next'
import { cache } from 'react'

import { createServiceClient } from '@/lib/supabase/service'
import { crewLinkPhotoCounts, resolveCrewLink } from '@/lib/crew-link'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { getDocumentBrand } from '@/lib/org-brand'
import { loadCrewNotes } from '@/lib/threads/crew-notes'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import CrewPhotoCapture from './CrewPhotoCapture'

export const dynamic = 'force-dynamic'

/** One link + company lookup per request, shared by the page and its <title>. Company-level page → company identity. */
const loadCrewLink = cache(async (token: string) => {
  const admin = createServiceClient()
  const link = await resolveCrewLink(admin, token)
  const brand = await getDocumentBrand(admin, link.ok ? link.ctx.orgId : link.orgId)
  return { admin, link, brand }
})

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const { brand } = await loadCrewLink(params.token)
  return {
    title: `Job photos — ${brand.casualName}`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  }
}

/**
 * Public crew photo page, opened from the link in a trade's calendar invite.
 * The token authorizes exactly one trade — see `lib/crew-link.ts`.
 */
export default async function CrewPhotoPage({ params }: { params: { token: string } }) {
  const { admin, link, brand } = await loadCrewLink(params.token)

  if (!link.ok) {
    return (
      <main className="min-h-screen bg-[#f7f6f2] px-4 py-10">
        <div className="mx-auto max-w-md rounded-xl border border-[#e5e3dc] bg-white p-6 text-center">
          <h1 className="text-xl font-bold text-[#2c2c2a]">
            {link.reason === 'expired' ? 'This photo link has expired' : 'This photo link isn’t active'}
          </h1>
          <p className="mt-2 text-base text-[#2c2c2a]">{`Call ${brand.shortName} for a new link.`}</p>
        </div>
      </main>
    )
  }

  const counts = await crewLinkPhotoCounts(admin, link.ctx)
  const notes = await loadCrewNotes(admin, link.ctx).catch(() => [])
  const orgTrades = await loadOrgTrades(admin, link.ctx.orgId)
  const dailyLog = await isOrgFeatureOn(link.ctx.orgId, 'projectTools')

  return (
    <CrewPhotoCapture
      token={params.token}
      tradeLabel={tradeLabel(link.ctx.trade, orgTrades)}
      addressText={link.ctx.addressText}
      jobNumber={link.ctx.jobNumber}
      initialCounts={counts}
      brand={{ casualName: brand.casualName, shortName: brand.shortName }}
      crewNotes={notes}
      dailyLog={dailyLog}
    />
  )
}
