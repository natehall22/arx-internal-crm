export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'

import { redirectJobToFile } from '@/lib/customer-file/redirects'
import { isJobTab } from '@/lib/job-tabs'
import JobView from '../JobView'

/** /ops/jobs/[id]/materials etc.: the same job page, opened on that tab. (measure / orders / sheets are their own routes.) */
export default async function JobTabPage({ params }: { params: { id: string; tab: string } }) {
  if (!isJobTab(params.tab)) notFound()
  await redirectJobToFile(params.id)
  return <JobView params={{ id: params.id }} initialTab={params.tab} />
}
