import TabBody from '@/components/customer-file/TabBody'

export const dynamic = 'force-dynamic'

export default function FileTabPage({ params }: { params: { customerId: string; dealId: string; tab: string } }) {
  return <TabBody customerId={params.customerId} dealId={params.dealId} tab={params.tab} />
}
