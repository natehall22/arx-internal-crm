import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import PortalShell, { Panel } from '@/components/portal/PortalShell'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { loadPortalCompany } from '@/lib/portal/brand'
import { portalOrgForRequest } from '@/lib/portal/server'
import { isWellFormedPortalToken } from '@/lib/portal/tokens'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Open your account', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/**
 * The emailed link lands here. Opening this page does NOT use the link (a mail scanner or a link preview would burn it):
 * only the one tap on "Open my account" does (POST /api/portal/enter).
 */
export default async function PortalEnterPage({ searchParams }: { searchParams: { t?: string } }) {
  const orgId = await portalOrgForRequest()
  if (!orgId || !(await isOrgFeatureOn(orgId, 'customerPortal'))) notFound()
  const company = await loadPortalCompany(createServiceClient(), orgId)
  const t = searchParams.t
  return (
    <PortalShell company={company}>
      <Panel>
        {isWellFormedPortalToken(t) ? (
          <form method="post" action="/api/portal/enter">
            <input type="hidden" name="t" value={t} />
            <h1 className="text-2xl font-bold">Open your account</h1>
            <p className="mt-2 text-lg">Tap the button to sign in.</p>
            <button type="submit" className="mt-4 min-h-[52px] w-full rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white">Open my account</button>
          </form>
        ) : (
          <>
            <h1 className="text-2xl font-bold">This link is not complete</h1>
            <a href="/portal" className="mt-3 inline-flex min-h-[48px] items-center text-lg font-bold underline">Get a new sign-in link</a>
          </>
        )}
      </Panel>
    </PortalShell>
  )
}
