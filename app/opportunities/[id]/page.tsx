export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'

import OpportunityView from './OpportunityView'
import { requireAuth } from '@/lib/auth'
import { dealHiddenFrom } from '@/lib/category-scope'
import { createServiceClient } from '@/lib/supabase/service'
import { redirectOpportunityToFile } from '@/lib/customer-file/redirects'

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  // Limited to some work categories: a deal outside them is "not found" — the old view below is never rendered for it.
  const { profile } = await requireAuth()
  if (await dealHiddenFrom(createServiceClient(), profile, params.id)) notFound()
  await redirectOpportunityToFile(params.id, searchParams)
  return <OpportunityView params={params} searchParams={searchParams} />
}
