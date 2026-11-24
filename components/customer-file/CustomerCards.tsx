import ReferralsSection from '@/components/ReferralsSection'
import { selectWithVisibleCol } from '@/lib/threads/private-columns'
import CategoryField from '@/components/categories/CategoryField'
import CustomerInfoCard from '@/components/customers/CustomerInfoCard'
import AccountCard, { type AccountActivity, type AccountLead, type AccountProject } from '@/components/customer-file/AccountCard'
import ContactActions from '@/components/customer/ContactActions'
import CustomerMessagesCard from '@/components/customer/CustomerMessagesCard'
import PriceListCard from '@/components/customer/PriceListCard'
import TaxExemptionCard from '@/components/customer/TaxExemptionCard'
import TextingCard from '@/components/customer/TextingCard'
import PortalAccessCard from '@/components/customer-file/PortalAccessCard'
import { Card, CardContent } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessCustomerRecordsFromPermissionNames, canEditCustomerRecordsFromPermissionNames } from '@/lib/permissions'
import { visibleActivities } from '@/lib/threads/legacy-feed'
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
  dealId = null,
  category,
}: {
  viewer: ThreadViewer
  customer: CustomerLike
  access: CustomerAccess
  canViewJobBilling: boolean
  proposalWord: string
  /** The deal the viewer is on. null = no deal: the contact card carries Call / Text / Email (there is no deal header, and nowhere to log). */
  dealId?: string | null
  /** Work category field, shown when the company uses categories or this customer has one. */
  category?: { value: string | null; list: Category[]; canEdit: boolean }
}) {
  const admin = createServiceClient()
  const { profile } = await requireAuth()
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  // The same two gates the customer APIs use: referrals need records access (as /api/referrals does), editing needs customers:edit (as PATCH /api/customers/[id]).
  const canAccessRecords = canAccessCustomerRecordsFromPermissionNames(perms)
  const canEditRecords = canEditCustomerRecordsFromPermissionNames(perms)
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
  const account = companyWide ? await loadAccount(admin, profile, viewer.orgId, customer.id).catch((e) => { console.error('account card failed', e); return null }) : null
  const showReferrals = access.edit && canAccessRecords

  return (
    <>
      <CustomerInfoCard
        customer={customer}
        // With a deal the file header carries Edit (every tab); with none there is no header, so the card does.
        canEdit={access.edit && canEditRecords && !dealId}
        actions={dealId ? null : <ContactActions dealId={null} phone={customer.phone} email={customer.email} surface="overview" />}
      />

      {category && (category.list.some((c) => c.active) || category.value) ? (
        <Card>
          <CardContent>
            <CategoryField url={`/api/customers/${customer.id}`} value={category.value} readOnly={!category.canEdit} initialCategories={category.list} />
          </CardContent>
        </Card>
      ) : null}

      {showPortal && portalState && <PortalAccessCard customerId={customer.id} hasEmail={!!customer.email} {...portalState} canCopyLink={viewer.ownerLike} />}

      {messages && <CustomerMessagesCard customerId={customer.id} initial={messages.state} canEdit={messages.canEdit} />}

      {texting && <TextingCard state={texting} />}

      {priceList && <PriceListCard proposalWord={proposalWord} customerId={customer.id} lists={priceList.lists} initialListId={priceList.listId} />}

      {taxExemption && <TaxExemptionCard proposalWord={proposalWord} customerId={customer.id} initial={taxExemption.initial} documents={taxExemption.documents} />}

      {account && <AccountCard customerId={customer.id} customerName={customer.name} leads={account.leads} projects={account.projects} activities={account.activities} />}

      {showReferrals && <div id="referrals"><ReferralsSection customerId={customer.id} customerName={customer.name || undefined} orgId={viewer.orgId} canManage={isReferralManagerRole(profile.role)} /></div>}
    </>
  )
}

/**
 * What the old account page's Leads / Projects / Activity tabs listed, org-scoped, company-wide viewers only. Leads are the
 * customer's own plus those reached through their deals and projects (opportunities.lead_id / projects.lead_id), deduped.
 * Activity spans the customer, those leads, projects and deals and goes through visibleActivities (the thread audience rules).
 */
async function loadAccount(admin: ReturnType<typeof createServiceClient>, profile: Parameters<typeof visibleActivities>[1], orgId: string, customerId: string) {
  const db = orgDb(admin, orgId)
  const [ownLeads, projects, deals] = await Promise.all([
    db.from('leads').select('id, homeowner_name, address_text, status').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    db.from('projects').select('id, project_type, address_text, lead_id').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    db.from('opportunities').select('id, lead_id').eq('customer_id', customerId).limit(100),
  ])
  const projectRows = (projects.data ?? []) as Array<AccountProject & { lead_id: string | null }>
  const dealRows = (deals.data ?? []) as Array<{ id: string; lead_id: string | null }>
  const own = (ownLeads.data ?? []) as AccountLead[]
  const have = new Set(own.map((l) => l.id))
  const linkedIds = Array.from(new Set([...projectRows, ...dealRows].map((r) => r.lead_id).filter((x): x is string => !!x && !have.has(x))))
  const linked = linkedIds.length ? (((await db.from('leads').select('id, homeowner_name, address_text, status').in('id', linkedIds).limit(50)).data ?? []) as AccountLead[]) : []
  const leads = Array.from(new Map([...own, ...linked].map((l): [string, AccountLead] => [l.id, l])).values())

  const parts = [`customer_id.eq.${customerId}`]
  const addIn = (col: string, ids: string[]) => { if (ids.length) parts.push(`${col}.in.(${ids.join(',')})`) }
  addIn('lead_id', leads.map((l) => l.id))
  addIn('project_id', projectRows.map((p) => p.id))
  addIn('opportunity_id', dealRows.map((d) => d.id))
  const { data: acts } = await selectWithVisibleCol('id, type, body, created_at, opportunity_id, user_id, audience, restricted_pricing, visible_user_ids, deleted_at, users(full_name)', (cols) =>
    db
      .from('activities')
      .select(cols)
      .is('deleted_at', null)
      .or(parts.join(','))
      .order('created_at', { ascending: false })
      .limit(100)
  )
  const activities = (await visibleActivities(admin, profile, (acts ?? []) as unknown as Array<AccountActivity & { opportunity_id: string | null; audience: never; restricted_pricing: boolean | null; deleted_at: string | null }>)).slice(0, 50)
  return { leads, projects: projectRows.map(({ id, project_type, address_text }) => ({ id, project_type, address_text })), activities: activities as AccountActivity[] }
}

/** Work-category state for the customer-level card. Rep-like roles may only change it on their own deals, so with no deal they may not. */
export async function loadCategoryState(orgId: string, customerId: string, canEdit: boolean) {
  const admin = createServiceClient()
  const [list, byCustomer] = await Promise.all([loadOrgCategories(admin, orgId), loadCustomerCategories(admin, orgId, [customerId])])
  return { value: byCustomer.get(customerId) ?? null, list, canEdit }
}
