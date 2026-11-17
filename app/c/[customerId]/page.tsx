import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { CustomerDocuments, CustomerRecords } from '@/components/customer-file/CustomerRecords'
import JobberHistoryCard from '@/components/jobber-import/JobberHistoryCard'
import { loadJobberHistory } from '@/lib/jobber-import/db'
import CustomerCards, { loadCategoryState } from '@/components/customer-file/CustomerCards'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canEditCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { loadOrgProfile } from '@/lib/org-profile'
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
  const [canViewJobBilling, orgProfile, perms] = await Promise.all([
    callerCanAccessJobBilling(admin, profile),
    loadOrgProfile(admin, viewer.orgId),
    resolveEffectivePermissionNames(admin, profile.id, profile),
  ])
  const canEditRecords = canEditCustomerRecordsFromPermissionNames(perms)
  const jobberHistory = seesHistory ? await loadJobberHistory(admin, viewer.orgId, c.id) : []
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
        {/* Same customer-level cards a deal's Overview shows (contact + actions, portal, emails, texting, tax, account…). */}
        <CustomerCards
          viewer={viewer}
          customer={c}
          access={extras.access}
          canViewJobBilling={canViewJobBilling}
          proposalWord={orgProfile.terms.proposal}
          category={await loadCategoryState(viewer.orgId, c.id, extras.access.edit && canEditRecords && !isRepLikeCustomerRecordRole(profile.role))}
        />
        <p className="px-1 text-ui-base text-ink">No deals yet.</p>
        <CustomerRecords customerId={c.id} extras={extras} />
        <CustomerDocuments customerId={c.id} orgId={viewer.orgId} extras={extras} />
        <JobberHistoryCard entries={jobberHistory} />
      </main>
    </div>
  )
}
