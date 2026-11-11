import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import PortalHomeView from '@/components/portal/PortalHomeView'
import PortalSignIn from '@/components/portal/PortalSignIn'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { loadPortalCompany } from '@/lib/portal/brand'
import { loadPortalHome } from '@/lib/portal/data'
import { getPortalSession, portalOrgForRequest } from '@/lib/portal/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your account', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** The customer portal home (company's own address only; signed-out visitors get the email-me-a-link form). */
export default async function PortalPage({ searchParams }: { searchParams: { problem?: string } }) {
  const orgId = await portalOrgForRequest()
  if (!orgId || !(await isOrgFeatureOn(orgId, 'customerPortal'))) notFound()
  const admin = createServiceClient()
  const company = await loadPortalCompany(admin, orgId)
  const session = await getPortalSession(admin)
  const home = session ? await loadPortalHome(admin, session) : null
  if (!session || !home) return <PortalSignIn company={company} problem={searchParams.problem === 'link' ? 'link' : searchParams.problem === 'wait' ? 'wait' : null} />
  const op = await loadOnlinePayments(admin, orgId)
  return <PortalHomeView company={company} home={home} payOnline={op.featureOn && op.ready} texting={await isOrgFeatureOn(orgId, 'texting')} />
}
