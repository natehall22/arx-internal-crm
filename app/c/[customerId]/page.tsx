import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { pickDefaultDeal } from '@/lib/customer-file/load'

export const dynamic = 'force-dynamic'

export default async function CustomerFileIndex({ params }: { params: { customerId: string } }) {
  const dealId = await pickDefaultDeal(params.customerId)
  if (dealId) redirect(`/c/${params.customerId}/d/${dealId}`)
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-ui-xl font-bold text-ink">No deals to show</h1>
        <p className="mt-2 text-ui-base text-ink">This customer has no deals you can open.</p>
      </main>
    </div>
  )
}
