import type { Metadata } from 'next'

import SelectionClient from '@/components/selections/SelectionClient'
import { loadPublicSelectionView, resolveSelectionLink } from '@/lib/project-tools/selections-public'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Choose your selection', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** The customer's selection page (no login, no Nav, the company's brand only). */
export default async function SelectionPage({ params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const sel = await resolveSelectionLink(admin, params.token)
  const view = sel ? await loadPublicSelectionView(admin, sel) : null
  return <SelectionClient token={params.token} view={view} />
}
