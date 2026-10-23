export const dynamic = 'force-dynamic'

import OpportunityView from './OpportunityView'

export default function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  return <OpportunityView params={params} searchParams={searchParams} />
}
