import Link from 'next/link'

import ReferralsSection from '@/components/ReferralsSection'
import CategoryField from '@/components/categories/CategoryField'
import CreateAddOnOpportunityButton from '@/components/customers/CreateAddOnOpportunityButton'
import CustomerInfoCard from '@/components/customers/CustomerInfoCard'
import LinkProjectToCustomerButton from '@/components/customers/LinkProjectToCustomerButton'
import ContactActions from '@/components/customer/ContactActions'
import CustomerMessagesCard from '@/components/customer/CustomerMessagesCard'
import PriceListCard from '@/components/customer/PriceListCard'
import TaxExemptionCard from '@/components/customer/TaxExemptionCard'
import TextingCard from '@/components/customer/TextingCard'
import PortalAccessCard from '@/components/customer-file/PortalAccessCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { loadCustomerCategories, loadOrgCategories } from '@/lib/categories-db'
import type { Category } from '@/lib/categories'
import { loadCustomerMessageState } from '@/lib/customer-messages-db'
import { resolveCustomerAccess, type CustomerAccess } from '@/lib/customer-file/customer-access'
import { getOrgFeatures } from '@/lib/org-features-server'
import { loadPortalAccessState } from '@/lib/portal/invite'
import { loadCustomerPriceListId, loadPriceLists } from '@/lib/price-list-server'
import { isReferralManagerRole } from '@/lib/referral-links'
import { loadCustomerTaxExemption, loadOrgSalesTax } from '@/lib/sales-tax-server'
import { loadCustomerTextingState } from '@/lib/sms/customer-state'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'
import type { ThreadViewer } from '@/lib/threads/visibility'

/** Automatic emails card (the "don't email this customer" switch): only for a company sending them, only for people who can open the customer. */
async function loadCustomerMessagesCard(viewer: ThreadViewer, customerId: string) {
  if (!(await getOrgFeatures(viewer.orgId)).customerMessages) return null
  const admin = createServiceClient()
  const access = await resolveCustomerAccess(admin, viewer, customerId)
  if (!access?.read) return null
  const state = await loadCustomerMessageState(admin, viewer.orgId, customerId)
  return state ? { state, canEdit: access.edit } : null
}

/** Texting card: only for a company with texting on, only for people who can open the customer (field roles never — no phone, no consent proof). */
async function loadTextingCard(viewer: ThreadViewer, customerId: string) {
  if (!(await getOrgFeatures(viewer.orgId)).texting) return null
  const admin = createServiceClient()
  const access = await resolveCustomerAccess(admin, viewer, customerId)
  if (!access?.read || !access.edit) return null
  return loadCustomerTextingState(admin, viewer.orgId, customerId)
}

async function loadTaxExemptionCard(orgId: string, customerId: string) {
  const admin = createServiceClient()
  if (!(await loadOrgSalesTax(admin, orgId))) return null
  const [initial, { data: docs }] = await Promise.all([
    loadCustomerTaxExemption(admin, orgId, customerId),
    orgDb(admin, orgId).from('documents').select('id, title, filename').eq('customer_id', customerId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
  ])
  const documents = ((docs ?? []) as Array<{ id: string; title: string | null; filename: string | null }>).map((d) => ({ id: d.id, label: d.title || d.filename || 'File' }))
  return { initial, documents }
}

/** Price list card: billing staff, and only once the company keeps more than one list (nothing to choose otherwise). */
async function loadPriceListCard(orgId: string, customerId: string) {
  const admin = createServiceClient()
  const lists = await loadPriceLists(admin, orgId)
  if (lists.length < 2) return null
  return { lists, listId: (await loadCustomerPriceListId(admin, orgId, customerId)) ?? '' }
}

type CustomerLike = { id: string; name: string | null; phone: string | null; email: string | null; address_text: string | null }

/**
 * THE customer-level cards of the Customer File — shown on every customer, with or without a deal (the deal Overview and the
 * no-deal customer page both render this; nothing here is deal-keyed). Contact (edit + call/text/email), work category,
 * portal, automatic emails (opt-out), texting, price list, tax exemption, and the account (start a deal, link a project, new
 * work order, leads, projects, referrals) that the old /customers/[id] page held.
 * Every gate is the one the card already had: customer access (lib/customer-file/customer-access.ts), billing for money
 * cards, company-wide viewers for the account. Everything is org-scoped.
 */
export default async function CustomerCards({
  viewer,
  customer,
  access,
  canViewJobBilling,
  proposalWord,
  role,
  dealId = null,
  category,
}: {
  viewer: ThreadViewer
  customer: CustomerLike
  access: CustomerAccess
  canViewJobBilling: boolean
  proposalWord: string
  role: string
  /** The deal the viewer is on. null = no deal: the contact card carries Call / Text / Email (there is no deal header, and nowhere to log). */
  dealId?: string | null
  /** Work category field, shown when the company uses categories or this customer has one. */
  category?: { value: string | null; list: Category[]; canEdit: boolean }
}) {
  const admin = createServiceClient()
  const companyWide = viewer.ownerLike || viewer.managerLike || viewer.jobBoard
  const features = await getOrgFeatures(viewer.orgId)
  const [taxExemption, priceList, messages, texting, portalState] = await Promise.all([
    // Sales tax exemption / price list: billing staff only.
    canViewJobBilling ? loadTaxExemptionCard(viewer.orgId, customer.id).catch(() => null) : Promise.resolve(null),
    canViewJobBilling ? loadPriceListCard(viewer.orgId, customer.id).catch(() => null) : Promise.resolve(null),
    loadCustomerMessagesCard(viewer, customer.id).catch(() => null),
    loadTextingCard(viewer, customer.id).catch(() => null),
    companyWide && features.customerPortal ? loadPortalAccessState(admin, viewer.orgId, customer.id).catch(() => null) : Promise.resolve(null),
  ])
  const showPortal = !!portalState
  const account = companyWide ? await loadAccount(viewer.orgId, customer.id) : null
  const showReferrals = access.edit

  return (
    <>
      <CustomerInfoCard
        customer={customer}
        // With a deal the file header carries Edit (every tab); with none there is no header, so the card does.
        canEdit={access.edit && !dealId}
        actions={dealId ? null : <ContactActions dealId={null} phone={customer.phone} email={customer.email} surface="overview" />}
      />

      {category && (category.list.some((c) => c.active) || category.value) ? (
        <Card>
          <CardContent>
            <CategoryField url={`/api/customers/${customer.id}`} value={category.value} readOnly={!category.canEdit} initialCategories={category.list} />
          </CardContent>
        </Card>
      ) : null}

      {showPortal && portalState && <PortalAccessCard customerId={customer.id} hasEmail={!!customer.email} {...portalState} />}

      {messages && <CustomerMessagesCard customerId={customer.id} initial={messages.state} canEdit={messages.canEdit} />}

      {texting && <TextingCard state={texting} />}

      {priceList && <PriceListCard proposalWord={proposalWord} customerId={customer.id} lists={priceList.lists} initialListId={priceList.listId} />}

      {taxExemption && <TaxExemptionCard proposalWord={proposalWord} customerId={customer.id} initial={taxExemption.initial} documents={taxExemption.documents} />}

      {account && (
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <CreateAddOnOpportunityButton customerId={customer.id} />
              <LinkProjectToCustomerButton customerId={customer.id} customerName={customer.name} />
              <Link href={`/work-orders/new?customer=${customer.id}`} className="inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink">New work order</Link>
            </div>
            {account.leads.length > 0 && (
              <div className="mt-4">
                <h3 className="text-ui-sm font-semibold text-ink">Leads</h3>
                <ul className="divide-y divide-surface-line">
                  {account.leads.map((l) => (
                    <li key={l.id}>
                      <Link href={`/leads/${l.id}`} className="flex min-h-tap flex-wrap items-center justify-between gap-2 py-2 text-ui-base text-brand-800 underline">
                        <span>{l.homeowner_name || 'Lead'}{l.address_text ? ` · ${l.address_text}` : ''}</span>
                        <span className="text-ui-sm capitalize text-ink">{String(l.status ?? '').replace(/_/g, ' ')}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {account.projects.length > 0 && (
              <div className="mt-4">
                <h3 className="text-ui-sm font-semibold text-ink">Projects</h3>
                <ul className="divide-y divide-surface-line">
                  {account.projects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="flex min-h-tap items-center py-2 text-ui-base text-brand-800 underline">
                        {p.project_type || 'Project'}{p.address_text ? ` · ${p.address_text}` : ''}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showReferrals && <ReferralsSection customerId={customer.id} customerName={customer.name || undefined} orgId={viewer.orgId} canManage={isReferralManagerRole(role)} />}
    </>
  )
}

/** Leads and projects of the customer (what the old account page's Leads / Projects tabs listed), org-scoped. Company-wide viewers only. */
async function loadAccount(orgId: string, customerId: string) {
  const admin = createServiceClient()
  const db = orgDb(admin, orgId)
  const [leads, projects] = await Promise.all([
    db.from('leads').select('id, homeowner_name, address_text, status').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    db.from('projects').select('id, project_type, address_text').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
  ])
  return {
    leads: (leads.data ?? []) as Array<{ id: string; homeowner_name: string | null; address_text: string | null; status: string | null }>,
    projects: (projects.data ?? []) as Array<{ id: string; project_type: string | null; address_text: string | null }>,
  }
}

/** Work-category state for the customer-level card. Rep-like roles may only change it on their own deals, so with no deal they may not. */
export async function loadCategoryState(orgId: string, customerId: string, canEdit: boolean) {
  const admin = createServiceClient()
  const [list, byCustomer] = await Promise.all([loadOrgCategories(admin, orgId), loadCustomerCategories(admin, orgId, [customerId])])
  return { value: byCustomer.get(customerId) ?? null, list, canEdit }
}
