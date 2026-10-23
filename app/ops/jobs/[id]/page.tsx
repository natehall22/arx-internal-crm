export const dynamic = 'force-dynamic'

import JobView from './JobView'
import { redirectJobToFile } from '@/lib/customer-file/redirects'

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  await redirectJobToFile(params.id)
  return <JobView params={params} />
}
