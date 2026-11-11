import type { Metadata } from 'next'

import PoConfirmClient from '@/components/po/PoConfirmClient'
import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { loadVendorLinkView } from '@/lib/purchase-orders-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Purchase order', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** A vendor's confirm page (no login, no Nav): the company's name only, the order as sent, one button. */
export default async function PoPage({ params }: { params: { token: string } }) {
  const fence = await getRequestHostFence()
  const view = await loadVendorLinkView(createServiceClient(), params.token, (orgId) => fenceAllowsOrg(fence, orgId))
  return <PoConfirmClient token={params.token} view={view} />
}
