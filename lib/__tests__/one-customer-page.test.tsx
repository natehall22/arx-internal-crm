/** @jest-environment node */
import React from 'react'
import { readFileSync } from 'fs'
import path from 'path'

const getOrgFeatures = jest.fn()
const loadMessages = jest.fn()
const loadTexting = jest.fn()
const loadSalesTax = jest.fn()
const loadPriceLists = jest.fn()
const loadPortal = jest.fn()
const leadsRows = jest.fn()
const orgDbFrom = jest.fn()
const perms = jest.fn()
const visible = jest.fn()

jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ profile: { id: 'u', org_id: 'o', role: 'admin', custom_role_id: null } }) }))
jest.mock('@/lib/effective-permissions', () => ({ resolveEffectivePermissionNames: (...a: unknown[]) => perms(...a) }))
jest.mock('@/lib/threads/legacy-feed', () => ({ visibleActivities: (...a: unknown[]) => visible(...a) }))
jest.mock('@/lib/org-features-server', () => ({ getOrgFeatures: (...a: unknown[]) => getOrgFeatures(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/supabase/org-db', () => ({ orgDb: () => ({ from: (t: string) => orgDbFrom(t) }) }))
jest.mock('@/lib/customer-file/customer-access', () => { const actual = jest.requireActual('@/lib/customer-file/customer-access'); return { ...actual, resolveCustomerAccess: jest.fn(async (_a: unknown, v: ThreadViewer) => ({ customerId: 'c1', ...actual.customerAccessFor(v, true) })) } })
jest.mock('@/lib/customer-messages-db', () => ({ loadCustomerMessageState: (...a: unknown[]) => loadMessages(...a) }))
jest.mock('@/lib/sms/customer-state', () => ({ loadCustomerTextingState: (...a: unknown[]) => loadTexting(...a) }))
jest.mock('@/lib/sales-tax-server', () => ({ loadOrgSalesTax: (...a: unknown[]) => loadSalesTax(...a), loadCustomerTaxExemption: jest.fn(async () => ({})) }))
jest.mock('@/lib/price-list-server', () => ({ loadPriceLists: (...a: unknown[]) => loadPriceLists(...a), loadCustomerPriceListId: jest.fn(async () => null) }))
jest.mock('@/lib/portal/invite', () => ({ loadPortalAccessState: (...a: unknown[]) => loadPortal(...a) }))
jest.mock('@/lib/categories-db', () => ({ loadCustomerCategories: jest.fn(async () => new Map()), loadOrgCategories: jest.fn(async () => []) }))
jest.mock('@/components/ReferralsSection', () => ({ __esModule: true, default: function ReferralsSection() { return null } }))
jest.mock('@/components/customer/ContactActions', () => ({ __esModule: true, default: function ContactActions() { return null } }))
jest.mock('@/components/customer/CustomerMessagesCard', () => ({ __esModule: true, default: function CustomerMessagesCard() { return null } }))
jest.mock('@/components/customer/TextingCard', () => ({ __esModule: true, default: function TextingCard() { return null } }))
jest.mock('@/components/customer/PriceListCard', () => ({ __esModule: true, default: function PriceListCard() { return null } }))
jest.mock('@/components/customer/TaxExemptionCard', () => ({ __esModule: true, default: function TaxExemptionCard() { return null } }))
jest.mock('@/components/categories/CategoryField', () => ({ __esModule: true, default: function CategoryField() { return null } }))
jest.mock('@/components/customers/CreateAddOnOpportunityButton', () => ({ __esModule: true, default: function CreateAddOnOpportunityButton() { return null } }))
jest.mock('@/components/customers/LinkProjectToCustomerButton', () => ({ __esModule: true, default: function LinkProjectToCustomerButton() { return null } }))
jest.mock('@/components/customer-file/PortalAccessCard', () => ({ __esModule: true, default: function PortalAccessCard() { return null } }))
jest.mock('@/components/customers/CustomerInfoCard', () => ({ __esModule: true, default: function CustomerInfoCard() { return null } }))

import CustomerCards from '@/components/customer-file/CustomerCards'
import { customerHref } from '@/lib/customer-file/links'
import { customerFileDefaultFor } from '@/lib/customer-file/redirects'
import { hrefForHit } from '@/lib/global-search'
import { customerAccessFor } from '@/lib/customer-file/customer-access'
import type { ThreadViewer } from '@/lib/threads/visibility'

const base: ThreadViewer = { userId: 'u', orgId: 'o', ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: false, pricingBarred: false }
const owner: ThreadViewer = { ...base, ownerLike: true, jobBoard: true, jobEdit: true, jobFinancials: true }
const setter: ThreadViewer = { ...base, setterLike: true, pricingBarred: true }
const customer = { id: 'c1', name: 'Dana Whitfield', phone: '7045550101', email: 'd@x.com', address_text: '1 Main St' }

/** Names of every component element in the tree (and their props), depth-first. */
function walk(node: unknown, out: Array<{ name: string; props: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out))
  else if (React.isValidElement(node)) {
    const t = node.type as { name?: string; displayName?: string } | string
    if (typeof t !== 'string') out.push({ name: t.displayName || t.name || '', props: node.props as Record<string, unknown> })
    walk((node.props as { children?: unknown }).children, out)
    // Props that carry elements (CustomerInfoCard actions).
    const actions = (node.props as { actions?: unknown }).actions
    if (actions) walk(actions, out)
  }
  return out
}
const names = (tree: unknown) => walk(tree).map((n) => n.name)

beforeEach(() => {
  jest.clearAllMocks()
  perms.mockResolvedValue({ fullAccess: true, permissionNames: new Set<string>() })
  visible.mockImplementation(async (_a: unknown, _p: unknown, rows: unknown[]) => rows)
  getOrgFeatures.mockResolvedValue({ customerPortal: true, customerMessages: true, texting: true })
  loadMessages.mockResolvedValue({ off: false })
  loadTexting.mockResolvedValue({ status: 'ready' })
  loadSalesTax.mockResolvedValue({ rate: 0.07 })
  loadPriceLists.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
  loadPortal.mockResolvedValue({ inviteOnly: false, invitedAt: null })
  orgDbFrom.mockImplementation((t: string) => {
    const rows = t === 'leads' ? [{ id: 'l1', homeowner_name: 'Dana', address_text: '1 Main', status: 'new' }]
      : t === 'opportunities' ? [{ id: 'o1', lead_id: 'l2' }]
      : t === 'projects' ? [{ id: 'p1', project_type: 'roofing', address_text: '1 Main', lead_id: 'l1' }]
      : t === 'activities' ? [{ id: 'a1', type: 'note', body: 'Called', created_at: '2026-11-01T12:00:00Z', opportunity_id: 'o1', users: { full_name: 'Riley' } }]
      : []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit']) q[m] = () => q
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    return q
  })
})

describe('one customer page: a customer with no deal', () => {
  it('shows contact (edit + call/text/email), portal, emails opt-out, texting, price list, tax exempt and the account', async () => {
    const access = customerAccessFor(owner, false)
    const tree = await CustomerCards({ viewer: owner, customer, access: { customerId: 'c1', ...access }, canViewJobBilling: true, proposalWord: 'Proposal', dealId: null })
    const n = names(tree)
    for (const want of ['CustomerInfoCard', 'ContactActions', 'PortalAccessCard', 'CustomerMessagesCard', 'TextingCard', 'PriceListCard', 'TaxExemptionCard', 'AccountCard', 'ReferralsSection']) expect(n).toContain(want)
    const info = walk(tree).find((x) => x.name === 'CustomerInfoCard')!
    expect(info.props.canEdit).toBe(true)
    // No deal: nowhere to log, so the buttons only open the phone / text / mail apps.
    expect(walk(tree).find((x) => x.name === 'ContactActions')!.props.dealId).toBeNull()
  })

  it('on a deal Overview the header already carries the actions, so the card does not repeat them', async () => {
    const tree = await CustomerCards({ viewer: owner, customer, access: { customerId: 'c1', ...customerAccessFor(owner, true) }, canViewJobBilling: true, proposalWord: 'Proposal', dealId: 'd1' })
    expect(names(tree)).toContain('CustomerInfoCard')
    expect(names(tree)).not.toContain('ContactActions')
    // ...and so does Edit (FileHeader → EditCustomerButton), so the card doesn't offer a second one.
    expect(walk(tree).find((x) => x.name === 'CustomerInfoCard')!.props.canEdit).toBe(false)
  })
})

describe('one customer page: permissions are unchanged', () => {
  it('a field role (setter) can read but not edit; no money, portal, texting, account or referrals', async () => {
    const access = { customerId: 'c1', ...customerAccessFor(setter, true) }
    expect(access.edit).toBe(false)
    const tree = await CustomerCards({ viewer: setter, customer, access, canViewJobBilling: false, proposalWord: 'Proposal', dealId: 'd1' })
    const n = names(tree)
    expect(walk(tree).find((x) => x.name === 'CustomerInfoCard')!.props.canEdit).toBe(false)
    for (const no of ['PortalAccessCard', 'TextingCard', 'PriceListCard', 'TaxExemptionCard', 'AccountCard', 'ReferralsSection']) expect(n).not.toContain(no)
    // Money loaders never even run for someone without billing access.
    expect(loadSalesTax).not.toHaveBeenCalled()
    expect(loadPriceLists).not.toHaveBeenCalled()
    expect(loadPortal).not.toHaveBeenCalled()
  })

  it('money cards need billing access even for a company-wide viewer', async () => {
    const tree = await CustomerCards({ viewer: { ...base, jobBoard: true }, customer, access: { customerId: 'c1', ...customerAccessFor({ ...base, jobBoard: true }, false) }, canViewJobBilling: false, proposalWord: 'Proposal', dealId: null })
    expect(names(tree)).not.toContain('TaxExemptionCard')
    expect(names(tree)).not.toContain('PriceListCard')
  })

  it('the account lists are read org-scoped (orgDb), customer-keyed', async () => {
    await CustomerCards({ viewer: owner, customer, access: { customerId: 'c1', ...customerAccessFor(owner, false) }, canViewJobBilling: true, proposalWord: 'Proposal', dealId: null })
    expect(orgDbFrom).toHaveBeenCalledWith('leads')
    expect(orgDbFrom).toHaveBeenCalledWith('projects')
  })
})

describe('one customer page: review fixes', () => {
  const ownerAccess = { customerId: 'c1', ...customerAccessFor(owner, false) }
  const props = { viewer: owner, customer, access: ownerAccess, canViewJobBilling: true, proposalWord: 'Proposal' }

  it('referrals need customer-records access, like the referrals API (a rep without it gets no broken card)', async () => {
    perms.mockResolvedValue({ fullAccess: false, permissionNames: new Set<string>() })
    expect(names(await CustomerCards({ ...props, dealId: null }))).not.toContain('ReferralsSection')
    perms.mockResolvedValue({ fullAccess: false, permissionNames: new Set(['customers:view']) })
    expect(names(await CustomerCards({ ...props, dealId: null }))).toContain('ReferralsSection')
  })

  it('the no-deal Edit needs customers:edit, same as the header', async () => {
    perms.mockResolvedValue({ fullAccess: false, permissionNames: new Set(['customers:view']) })
    expect(walk(await CustomerCards({ ...props, dealId: null })).find((x) => x.name === 'CustomerInfoCard')!.props.canEdit).toBe(false)
    perms.mockResolvedValue({ fullAccess: false, permissionNames: new Set(['customers:edit']) })
    expect(walk(await CustomerCards({ ...props, dealId: null })).find((x) => x.name === 'CustomerInfoCard')!.props.canEdit).toBe(true)
  })

  it('Leads include those reached through deals and projects, deduped; activity runs through visibleActivities', async () => {
    const tree = await CustomerCards({ ...props, dealId: null })
    const card = walk(tree).find((x) => x.name === 'AccountCard')!
    const leads = card.props.leads as Array<{ id: string }>
    // own: l1 (customers.lead rows mock returns l1 for every leads query); linked l2 via the deal; l1 via the project is not repeated.
    expect(leads.filter((l) => l.id === 'l1')).toHaveLength(1)
    expect(orgDbFrom).toHaveBeenCalledWith('activities')
    expect(visible).toHaveBeenCalledTimes(1)
    expect((card.props.activities as unknown[]).length).toBe(1)
  })

  it('visibleActivities decides what shows: a hidden row never reaches the card', async () => {
    visible.mockResolvedValue([])
    const card = walk(await CustomerCards({ ...props, dealId: null })).find((x) => x.name === 'AccountCard')!
    expect(card.props.activities).toEqual([])
  })

  it('?tab=referrals on the old URL lands on the Overview Referrals card', () => {
    const r = readFileSync(path.join(process.cwd(), 'lib/customer-file/redirects.ts'), 'utf8')
    expect(r).toContain("/overview#referrals")
    expect(readFileSync(path.join(process.cwd(), 'components/customer-file/CustomerCards.tsx'), 'utf8')).toContain('id="referrals"')
  })

  it('the edit sheet offers the deal address, writes through the deal PATCH, and the customer PATCH only moves a lead that still holds the old value', () => {
    const sheet = readFileSync(path.join(process.cwd(), 'components/customers/EditCustomerSheet.tsx'), 'utf8')
    expect(sheet).toContain('Also update this deal’s address')
    expect(sheet).toContain('/api/opportunities/${deal.id}')
    const route = readFileSync(path.join(process.cwd(), 'app/api/customers/[id]/route.ts'), 'utf8')
    expect(route).toContain("textKey(held) === textKey(alsoLead.old_address)")
    expect(route).toContain(".eq('address_text', held)")
    expect(route).toContain(".eq('customer_id', params.id)")
  })
})

describe('one customer page: where a customer opens', () => {
  it('list rows and search open /c/<id> where the Customer File is the default', () => {
    expect(customerHref('c1', true)).toBe('/c/c1')
    expect(hrefForHit({ kind: 'customer', id: 'c1' }, true)).toBe('/c/c1')
  })
  it('roofing with the switch unset is unchanged: /customers/<id> everywhere', () => {
    expect(customerFileDefaultFor('admin', 'roofing', undefined)).toBe(false)
    expect(customerFileDefaultFor('admin', 'roofing', 'off')).toBe(false)
    expect(customerHref('c1', false)).toBe('/customers/c1')
    expect(hrefForHit({ kind: 'customer', id: 'c1' })).toBe('/customers/c1')
    // Other kinds never move.
    expect(hrefForHit({ kind: 'job', id: 'j1' }, true)).toBe('/ops/jobs/j1')
  })
  it('the switch (all, or a role list) or any non-roofing profile makes the Customer File the default', () => {
    expect(customerFileDefaultFor('admin', 'roofing', 'all')).toBe(true)
    expect(customerFileDefaultFor('operations', 'roofing', 'operations,admin')).toBe(true)
    expect(customerFileDefaultFor('setter', 'roofing', 'operations,admin')).toBe(false)
    for (const p of ['lawn_landscape', 'exterior_cleaning', 'home_builder']) expect(customerFileDefaultFor('admin', p, undefined)).toBe(true)
  })
})

describe('one customer page: wiring', () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
  it('the old page forwards after its own permission check; the list and search use the one link helper', () => {
    const old = read('app/customers/[id]/page.tsx')
    expect(old.indexOf('notFound()')).toBeLessThan(old.indexOf('await redirectCustomerToFile('))
    expect(read('components/customers/CustomersPageClient.tsx')).toContain('customerHref(c.id, customerFile)')
    expect(read('lib/global-search.ts')).toContain('customerHref(h.id, customerFileDefault)')
  })
  it('the file header offers one Edit sheet, gated like the PATCH route; the card shares the same sheet', () => {
    expect(read('components/customer-file/FileHeader.tsx')).toContain('canEditCustomer && <EditCustomerButton')
    expect(read('app/c/[customerId]/d/[dealId]/layout.tsx')).toContain('ctx.canEditCategory && customerAccessFor(ctx.viewer, true).edit')
    expect(read('components/customers/CustomerInfoCard.tsx')).toContain('EditCustomerButton')
    expect(read('components/customers/EditCustomerSheet.tsx')).toContain("method: 'PATCH'")
  })
  it('the no-deal customer page and the deal Overview render the same CustomerCards', () => {
    expect(read('app/c/[customerId]/page.tsx')).toContain('<CustomerCards')
    expect(read('components/customer-file/TabBody.tsx')).toContain('<CustomerCards')
  })
})
