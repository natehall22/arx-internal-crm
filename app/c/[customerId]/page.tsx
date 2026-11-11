import Link from 'next/link'
import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { CustomerDocuments, CustomerRecords } from '@/components/customer-file/CustomerRecords'
import JobberHistoryCard from '@/components/jobber-import/JobberHistoryCard'
import { loadJobberHistory } from '@/lib/jobber-import/db'
import PhoneLink from '@/components/PhoneLink'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { loadCustomerExtras } from '@/lib/customer-file/customer-extras'
import { pickDefaultDeal } from '@/lib/customer-file/load'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'

export const dynamic = 'force-dynamic'

/**
 * A customer's file. With a deal the viewer can open → that deal's file (unchanged). With none (a customer added
 * without a deal — e.g. a commercial account or an imported customer), people who may see the customer's records get the
 * customer page itself: contact, properties, details and customer documents.
 */
export default async function CustomerFileIndex({ params }: { params: { customerId: string } }) {
  const dealId = await pickDefaultDeal(params.customerId)
  if (dealId) redirect(`/c/${params.customerId}/d/${dealId}`)

  const { profile } = await requireAuth()
  const admin = createServiceClient()
  const viewer = await resolveThreadViewer(admin, profile)
  const extras = await loadCustomerExtras(admin, viewer, params.customerId).catch(() => null)
  const { data: customer } = extras
    ? await orgDb(admin, viewer.orgId).from('customers').select('id, name, phone, email, address_text').eq('id', params.customerId).maybeSingle()
    : { data: null }

  if (!extras || !customer) {
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

  const c = customer as { id: string; name: string | null; phone: string | null; email: string | null; address_text: string | null }
  // Jobber history carries prices: the same people as the customer account link below (never field roles).
  const seesHistory = (viewer.ownerLike || viewer.managerLike || viewer.jobBoard) && !viewer.pricingBarred && !viewer.setterLike
  const jobberHistory = seesHistory ? await loadJobberHistory(admin, viewer.orgId, c.id) : []
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="break-words">{c.name || 'Customer'}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-ui-base text-ink">
              <dt className="font-semibold">Phone</dt>
              <dd><PhoneLink value={c.phone} /></dd>
              <dt className="font-semibold">Email</dt>
              <dd className="break-all">{c.email || '—'}</dd>
              <dt className="font-semibold">Address</dt>
              <dd className="break-words">{c.address_text || '—'}</dd>
            </dl>
            <p className="mt-3 text-ui-base text-ink">No deals yet.</p>
            {/* Same people the deal Overview offers the customer account to. */}
            {viewer.ownerLike || viewer.managerLike || viewer.jobBoard ? (
              <Link href={`/customers/${c.id}?tab=opportunities`} className="mt-2 inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">
                Customer account (start a deal) ▸
              </Link>
            ) : null}
          </CardContent>
        </Card>
        <CustomerRecords customerId={c.id} extras={extras} />
        <CustomerDocuments customerId={c.id} orgId={viewer.orgId} extras={extras} />
        <JobberHistoryCard entries={jobberHistory} />
      </main>
    </div>
  )
}
