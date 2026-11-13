/** @jest-environment node */
/** Lead category: matched to the company's list, set on a lead, and carried to the customer only when the customer has none. */
import { matchLeadCategory, setLeadCategory } from '@/lib/categories-db'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import { customerIdForLead } from '@/lib/customer-file/ensure-customer'
import { createLeadRecord } from '@/lib/leads-create'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

jest.mock('@/lib/integrations', () => ({ enqueueCustomerUpserted: jest.fn(async () => undefined) }))

const ORG = 'org-1'
const OTHER = 'org-2'

const seed = () =>
  createFakeDb({
    orgs: [{ id: ORG, settings: {} }, { id: OTHER, settings: {} }],
    leads: [
      { id: 'l1', org_id: ORG, category: 'commercial', homeowner_name: 'Acme Plaza', phone: '7045550101', address_text: '1 Main St' },
      { id: 'l2', org_id: ORG, category: 'commercial', homeowner_name: 'Pat Lee', phone: '7045550102', address_text: '2 Oak St', customer_id: 'c-existing' },
      { id: 'l3', org_id: ORG, category: null, homeowner_name: 'No Category', phone: '7045550103', address_text: '3 Elm St' },
      { id: 'lx', org_id: OTHER, category: null },
    ],
    customers: [
      { id: 'c-existing', org_id: ORG, name: 'Pat Lee', category: null },
      { id: 'c-chosen', org_id: ORG, name: 'Chosen', phone: '7045550104', phone_normalized: '7045550104', category: 'residential' },
    ],
  })

describe('matchLeadCategory', () => {
  const list = [...DEFAULT_CATEGORIES.map((c) => ({ ...c })), { slug: 'old', label: 'Old stuff', sort: 90, active: false }]
  it('takes a slug or a label of a turned-on category, nothing else', () => {
    expect(matchLeadCategory(list, 'commercial')).toBe('commercial')
    expect(matchLeadCategory(list, ' New Build ')).toBe('new_build')
    expect(matchLeadCategory(list, 'Commercial')).toBe('commercial')
    expect(matchLeadCategory(list, 'spa day')).toBeNull()
    expect(matchLeadCategory(list, 'old')).toBeNull() // turned off: never handed out again
    expect(matchLeadCategory(list, '')).toBeNull()
    expect(matchLeadCategory(list, 42)).toBeNull()
  })
})

describe('setLeadCategory', () => {
  it('sets, clears, and refuses what is not on the list or another company’s lead', async () => {
    const d = seed()
    expect(await setLeadCategory(d.client, ORG, 'l3', 'residential')).toEqual({ ok: true, category: 'residential' })
    expect(d.tables.leads.find((l) => l.id === 'l3')?.category).toBe('residential')
    expect(await setLeadCategory(d.client, ORG, 'l3', null)).toEqual({ ok: true, category: null })
    expect(await setLeadCategory(d.client, ORG, 'l3', 'spa_day')).toMatchObject({ ok: false, status: 400 })
    expect(await setLeadCategory(d.client, ORG, 'lx', 'residential')).toMatchObject({ ok: false, status: 404 })
  })
})

describe('createLeadRecord', () => {
  it('writes the category only when given (and nothing for a blank)', async () => {
    const d = seed()
    const a = await createLeadRecord(d.client, ORG, 'u1', { homeowner_name: 'A', category: 'commercial' })
    const b = await createLeadRecord(d.client, ORG, 'u1', { homeowner_name: 'B', category: null })
    if (!a.ok || !b.ok) throw new Error('create failed')
    expect(d.tables.leads.find((l) => l.id === a.id)?.category).toBe('commercial')
    expect(d.tables.leads.find((l) => l.id === b.id)).not.toHaveProperty('category')
  })
})

describe('carried to the customer at deal creation', () => {
  it('a NEW customer takes the lead’s category', async () => {
    const d = seed()
    const id = await customerIdForLead(d.client, ORG, { id: 'l1', homeowner_name: 'Acme Plaza', phone: '7045550101', address_text: '1 Main St' })
    expect(id).toBeTruthy()
    expect(d.tables.customers.find((c) => c.id === id)?.category).toBe('commercial')
  })
  it('an existing customer with no category gets it; one that already has a category keeps it', async () => {
    const d = seed()
    await customerIdForLead(d.client, ORG, { id: 'l2', customer_id: 'c-existing' })
    expect(d.tables.customers.find((c) => c.id === 'c-existing')?.category).toBe('commercial')
    // l1 matches the already-chosen customer by phone: the person's choice stands
    d.tables.leads.find((l) => l.id === 'l1')!.phone = '7045550104'
    const id = await customerIdForLead(d.client, ORG, { id: 'l1', homeowner_name: 'Chosen', phone: '7045550104' })
    expect(id).toBe('c-chosen')
    expect(d.tables.customers.find((c) => c.id === 'c-chosen')?.category).toBe('residential')
  })
  it('a category turned off since the lead was made is still copied (off hides it from pickers, never erases it)', async () => {
    const d = seed()
    d.tables.orgs[0].settings = { categories: { items: DEFAULT_CATEGORIES.map((c) => ({ ...c, active: c.slug !== 'commercial' })) } }
    const id = await customerIdForLead(d.client, ORG, { id: 'l1', homeowner_name: 'Acme Plaza', phone: '7045550101', address_text: '1 Main St' })
    expect(d.tables.customers.find((c) => c.id === id)?.category).toBe('commercial')
    // A hand pick of the turned-off category is still refused.
    const { setCustomerCategory } = await import('@/lib/categories-db')
    expect(await setCustomerCategory(d.client, ORG, 'c-existing', 'commercial')).toMatchObject({ ok: false, status: 400 })
  })
  it('a lead with no category leaves the customer blank (blank is not Residential)', async () => {
    const d = seed()
    const id = await customerIdForLead(d.client, ORG, { id: 'l3', homeowner_name: 'No Category', phone: '7045550103' })
    expect(d.tables.customers.find((c) => c.id === id)?.category ?? null).toBeNull()
  })
  it('never blocks the deal: a lead the company does not own carries nothing', async () => {
    const d = seed()
    const id = await customerIdForLead(d.client, ORG, { id: 'lx', homeowner_name: 'X', phone: '7045550109' })
    expect(id).toBeTruthy()
    expect(d.tables.customers.find((c) => c.id === id)?.category ?? null).toBeNull()
  })
})
