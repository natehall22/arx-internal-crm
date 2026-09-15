import type { Metadata } from 'next'

import { createServiceClient } from '@/lib/supabase/service'
import { crewLinkPhotoCounts, resolveCrewLink } from '@/lib/crew-link'
import { TRADE_LABELS } from '@/lib/job-trades'
import CrewPhotoCapture from './CrewPhotoCapture'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Job photos — ARX Roofing',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/**
 * Public crew photo page, opened from the link in a trade's calendar invite.
 * The token authorizes exactly one trade — see `lib/crew-link.ts`.
 */
export default async function CrewPhotoPage({ params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const link = await resolveCrewLink(admin, params.token)

  if (!link.ok) {
    return (
      <main className="min-h-screen bg-[#f7f6f2] px-4 py-10">
        <div className="mx-auto max-w-md rounded-xl border border-[#e5e3dc] bg-white p-6 text-center">
          <h1 className="text-xl font-bold text-[#2c2c2a]">
            {link.reason === 'expired' ? 'This photo link has expired' : 'This photo link isn’t active'}
          </h1>
          <p className="mt-2 text-base text-[#2c2c2a]">Call ARX for a new link.</p>
        </div>
      </main>
    )
  }

  const counts = await crewLinkPhotoCounts(admin, link.ctx)

  return (
    <CrewPhotoCapture
      token={params.token}
      tradeLabel={TRADE_LABELS[link.ctx.trade]}
      addressText={link.ctx.addressText}
      jobNumber={link.ctx.jobNumber}
      initialCounts={counts}
    />
  )
}
