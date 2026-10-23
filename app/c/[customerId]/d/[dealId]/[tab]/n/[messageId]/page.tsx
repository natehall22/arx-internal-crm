import TabBody from '@/components/customer-file/TabBody'

export const dynamic = 'force-dynamic'

/** Deep link to one message: the tab renders as usual and the thread (rail / Notes tab) scrolls to and flashes it. */
export default function FileTabMessagePage({ params }: { params: { customerId: string; dealId: string; tab: string } }) {
  return <TabBody customerId={params.customerId} dealId={params.dealId} tab={params.tab} />
}
