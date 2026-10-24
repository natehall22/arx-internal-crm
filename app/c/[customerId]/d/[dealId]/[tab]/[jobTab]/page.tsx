import { notFound } from 'next/navigation'

import TabBody from '@/components/customer-file/TabBody'
import { isJobTab } from '@/lib/job-tabs'

export const dynamic = 'force-dynamic'

/** /c/…/job/materials: the Job tab, opened on one of its five sections. */
export default function FileJobTabPage({ params }: { params: { customerId: string; dealId: string; tab: string; jobTab: string } }) {
  if (params.tab !== 'job' || !isJobTab(params.jobTab)) notFound()
  return <TabBody customerId={params.customerId} dealId={params.dealId} tab={params.tab} jobTab={params.jobTab} />
}
