import type { Metadata } from 'next'

import { messagePhotos } from '@/lib/customer-messages-db'
import { resolvePublicMessage } from '@/lib/customer-messages-public'
import { getDocumentBrand } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'
import StopEmails from './StopEmails'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Your visit', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/**
 * A customer's link from an automatic email (no login, no Nav, the company's brand only): the visit's photos for a
 * "done" email, and "Stop these emails" (prominent when they came from the email's unsubscribe link, `?stop=1`).
 */
export default async function MessagePage({ params, searchParams }: { params: { token: string }; searchParams: { stop?: string } }) {
  const admin = createServiceClient()
  const row = await resolvePublicMessage(admin, params.token)
  if (!row) {
    return (
      <main className="min-h-dvh bg-[#f7f6f2] px-4 py-10 text-[#2c2c2a]">
        <div className="mx-auto max-w-md rounded-xl border border-[#e5e3dc] bg-white p-6 text-center">
          <h1 className="text-xl font-bold">This link isn’t active</h1>
          <p className="mt-2 text-base">If you need anything, reply to the email it came in.</p>
        </div>
      </main>
    )
  }
  const brand = await getDocumentBrand(admin, row.org_id)
  const company = brand.casualName || brand.name
  const photos = await messagePhotos(admin, row)
  const stop = searchParams.stop === '1'
  return (
    <main className="min-h-dvh bg-[#f7f6f2] px-4 pb-10 pt-6 text-[#2c2c2a]">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <header>
          <p className="text-lg font-bold">{company}</p>
          {brand.phone ? <p className="text-base">{brand.phone}</p> : null}
        </header>
        {stop ? <StopEmails token={params.token} companyName={company} prominent /> : null}
        {row.kind === 'visit_done' ? (
          <section className="rounded-xl border border-[#e5e3dc] bg-white p-4">
            <h1 className="text-xl font-bold">Photos from your visit</h1>
            {photos.length === 0 ? (
              <p className="mt-2 text-base">No photos for this visit (or they are no longer available).</p>
            ) : (
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {photos.map((src, i) => (
                  <li key={i}>
                    <a href={src} target="_blank" rel="noopener noreferrer">
                      {/* Signed, short-lived storage URLs: next/image can't optimise them. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Visit photo ${i + 1}`} className="w-full rounded-lg border border-[#e5e3dc]" loading="lazy" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {!stop ? <StopEmails token={params.token} companyName={company} prominent={false} /> : null}
      </div>
    </main>
  )
}
