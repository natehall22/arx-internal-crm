import { redirect } from 'next/navigation'

import { loadFile } from '@/lib/customer-file/load'

export const dynamic = 'force-dynamic'

/** Role-default tab (or the last tab this person used). */
export default async function DealIndex({ params }: { params: { customerId: string; dealId: string } }) {
  const ctx = await loadFile(params.customerId, params.dealId)
  redirect(`/c/${params.customerId}/d/${params.dealId}/${ctx.landing}`)
}
