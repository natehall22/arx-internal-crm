import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import PortalBatchBody from '@/components/portal/PortalBatchBody'
import PortalShell from '@/components/portal/PortalShell'
import { findBatch, loadBatchDocument } from '@/lib/invoice-batch-db'
import { loadPortalCompany } from '@/lib/portal/brand'
import { getPortalSession } from '@/lib/portal/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/**
 * A SENT master invoice of the signed-in customer: every house, one total, print / save. Only for the customer it was made for
 * (batch.customer_id), and only once it has been sent. Never notes or costs. (Online payment stays on each house's own invoice.)
 */
export default async function PortalBatchPage({ params }: { params: { id: string } }) {
  const admin = createServiceClient()
  const session = await getPortalSession(admin)
  if (!session) notFound()
  const batch = await findBatch(admin, session.orgId, params.id)
  if (!batch || batch.customer_id !== session.customerId || !batch.sent_at) notFound()
  const doc = await loadBatchDocument(admin, session.orgId, batch)
  if (!doc) notFound()
  const company = await loadPortalCompany(admin, session.orgId)
  return (
    <PortalShell company={company} wide signOut>
      <a href="/portal" className="mb-3 inline-flex min-h-[44px] items-center text-base font-bold underline print:hidden">← Back to my account</a>
      <PortalBatchBody doc={doc} />
    </PortalShell>
  )
}
