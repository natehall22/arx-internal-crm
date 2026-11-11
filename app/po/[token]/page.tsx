import type { Metadata } from 'next'

import PoConfirmClient from '@/components/po/PoConfirmClient'
import { loadVendorLinkView } from '@/lib/purchase-orders-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Purchase order', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** A vendor's confirm page (no login, no Nav): the company's name only, the order as sent, one button. */
export default async function PoPage({ params }: { params: { token: string } }) {
  const view = await loadVendorLinkView(createServiceClient(), params.token)
  return <PoConfirmClient token={params.token} view={view} />
}
