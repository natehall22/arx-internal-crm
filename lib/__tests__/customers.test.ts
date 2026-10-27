import { normalizeIdentityEmail } from '@/lib/customers'

describe('normalizeIdentityEmail', () => {
  it('keeps real emails available for customer identity matching', () => {
    expect(normalizeIdentityEmail(' Justin@example.COM ')).toBe('justin@example.com')
  })

  it('does not use placeholder emails for customer identity matching', () => {
    expect(normalizeIdentityEmail('none@none.com')).toBeNull()
    expect(normalizeIdentityEmail(' NoEmail@NoEmail.com ')).toBeNull()
    expect(normalizeIdentityEmail('noemail@example.com')).toBeNull()
  })
})

// ---- one matching rule: exact on the stored normalized columns; concurrent creation settles on the oldest row ----
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { findExistingCustomer, upsertCustomer, isPlaceholderPhone, isTestCustomerName } from '@/lib/customers'

jest.mock('@/lib/integrations', () => ({ enqueueCustomerUpserted: jest.fn(async () => undefined) }))
import * as integrations from '@/lib/integrations'
const enqueueCustomerUpserted = integrations.enqueueCustomerUpserted as unknown as jest.Mock

const ORG = 'org1'
const cust = (id: string, extra: Record<string, unknown>) => ({ id, org_id: ORG, name: 'N', created_at: '2026-01-01T00:00:00Z', ...extra })

describe('findExistingCustomer', () => {
  it('matches a formatted stored phone on the normalized digits (the old LIKE on raw text missed it)', async () => {
    const db = createFakeDb({ customers: [cust('c1', { phone: '(704) 555-0142', phone_normalized: '7045550142' })] })
    expect((await findExistingCustomer(db.client, ORG, { name: 'x', phone: '704.555.0142' }))?.id).toBe('c1')
    expect((await findExistingCustomer(db.client, ORG, { name: 'x', phone: '+1 704 555 0142' }))?.id).toBe('c1')
  })

  it('also matches a stored 11-digit (1 + number) value, and never a different last-10', async () => {
    const db = createFakeDb({ customers: [cust('c1', { phone: '1-704-555-0142', phone_normalized: '17045550142' })] })
    expect((await findExistingCustomer(db.client, ORG, { name: 'x', phone: '7045550142' }))?.id).toBe('c1')
    expect(await findExistingCustomer(db.client, ORG, { name: 'x', phone: '7045550143' })).toBeNull()
  })

  it('never merges two people on a filler number (5555555555) or across orgs', async () => {
    const db = createFakeDb({ customers: [cust('c1', { phone_normalized: '5555555555' }), { ...cust('c2', { phone_normalized: '7045550142' }), org_id: 'other' }] })
    expect(await findExistingCustomer(db.client, ORG, { name: 'x', phone: '555-555-5555' })).toBeNull()
    expect(await findExistingCustomer(db.client, ORG, { name: 'x', phone: '7045550142' })).toBeNull()
  })

  it('email is an EXACT match: "_" in an address is not a wildcard', async () => {
    const db = createFakeDb({ customers: [cust('c1', { email: 'aXb@x.com', email_lower: 'axb@x.com' })] })
    expect(await findExistingCustomer(db.client, ORG, { name: 'x', email: 'a_b@x.com' })).toBeNull()
    expect((await findExistingCustomer(db.client, ORG, { name: 'x', email: ' AXB@x.com ' }))?.id).toBe('c1')
  })

  it('with two rows for one phone, every caller gets the OLDEST', async () => {
    const db = createFakeDb({ customers: [cust('new', { phone_normalized: '7045550142', created_at: '2026-05-01T00:00:00Z' }), cust('old', { phone_normalized: '7045550142', created_at: '2026-01-01T00:00:00Z' })] })
    expect((await findExistingCustomer(db.client, ORG, { name: 'x', phone: '7045550142' }))?.id).toBe('old')
  })
})

describe('upsertCustomer is idempotent under concurrent bookings', () => {
  beforeEach(() => enqueueCustomerUpserted.mockClear())

  it('a concurrent booking inserted an older row between our lookup and our insert: ours removes itself and returns theirs', async () => {
    const db = createFakeDb({ customers: [] })
    const realFrom = (db.client as unknown as { from: (t: string) => Record<string, unknown> }).from
    ;(db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = realFrom(t) as { insert: (p: unknown) => unknown }
      if (t === 'customers') {
        const insert = b.insert
        b.insert = (p: unknown) => {
          // the other booking lands first
          db.tables.customers.push({ id: 'theirs', org_id: ORG, name: 'Ashley', phone: '(704) 555-0142', phone_normalized: '7045550142', created_at: '2026-01-01T00:00:00Z' })
          return insert(p)
        }
      }
      return b
    }
    const res = await upsertCustomer(db.client, ORG, { name: 'Ashley Gaines', phone: '7045550142' })
    expect(res).toEqual({ customer_id: 'theirs', created: false })
    expect(db.tables.customers.map((c) => c.id)).toEqual(['theirs'])
    expect(enqueueCustomerUpserted).not.toHaveBeenCalled()
  })

  it('no competing row: creates once and enqueues once; skipIntegrations enqueues nothing', async () => {
    const db = createFakeDb({ customers: [] })
    const a = await upsertCustomer(db.client, ORG, { name: 'A', phone: '7045550101' })
    expect(a.created).toBe(true)
    expect(enqueueCustomerUpserted).toHaveBeenCalledTimes(1)
    enqueueCustomerUpserted.mockClear()
    await upsertCustomer(db.client, ORG, { name: 'B', phone: '7045550102' }, { skipIntegrations: true })
    expect(enqueueCustomerUpserted).not.toHaveBeenCalled()
  })
})

describe('placeholder phones and test customers never identify a person', () => {
  it('flags repeated and sequential filler numbers, not real ones', () => {
    for (const p of ['2222222222', '(222) 222-2222', '1234567890', '0000000000', '9876543210', '012-345-6789', '+1 555 555 5555']) expect(isPlaceholderPhone(p)).toBe(true)
    for (const p of ['7045550142', '2223334444', '', null]) expect(isPlaceholderPhone(p)).toBe(false)
  })

  it('a real customer typed with 2222222222 does not match the test customer that has it', async () => {
    const db = createFakeDb({ customers: [cust('t1', { name: 'testing', phone_normalized: '2222222222' })] })
    expect(await findExistingCustomer(db.client, ORG, { name: 'Carann Brown', phone: '2222222222' })).toBeNull()
  })

  it('skips a test-named row on a real phone or email, keeps looking', async () => {
    expect(isTestCustomerName('testing')).toBe(true)
    expect(isTestCustomerName('Tester Smith')).toBe(true)
    expect(isTestCustomerName('Testa Rossa')).toBe(false)
    const db = createFakeDb({ customers: [
      cust('t1', { name: 'testing', phone_normalized: '7045550142', created_at: '2026-01-01T00:00:00Z' }),
      cust('r1', { name: 'Real Person', phone_normalized: '7045550142', created_at: '2026-02-01T00:00:00Z' }),
    ] })
    expect((await findExistingCustomer(db.client, ORG, { name: 'x', phone: '7045550142' }))?.id).toBe('r1')
  })

  it('a new real customer on a real phone a test row also has is NOT merged into the test row', async () => {
    const db = createFakeDb({ customers: [cust('t1', { name: 'testing', phone: '7045550142', phone_normalized: '7045550142', created_at: '2026-01-01T00:00:00Z' })] })
    const r = await upsertCustomer(db.client, ORG, { name: 'Carann Brown', phone: '7045550142', email: null }, { skipIntegrations: true })
    expect(r.created).toBe(true)
    expect(r.customer_id).not.toBe('t1')
  })
})
