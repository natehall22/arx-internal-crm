export const dynamic = 'force-dynamic'

import JobView from './JobView'

export default function JobDetailPage({ params }: { params: { id: string } }) {
  return <JobView params={params} />
}
