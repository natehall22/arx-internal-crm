export const dynamic = 'force-dynamic'

import OpportunityView from './OpportunityView'
import { redirectOpportunityToFile } from '@/lib/customer-file/redirects'

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  await redirectOpportunityToFile(params.id, searchParams)
  return <OpportunityView params={params} searchParams={searchParams} />
}
