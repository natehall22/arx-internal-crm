/** @jest-environment node */
import { describeLastContact, loadLastContacts } from '@/lib/customer-last-contact'

describe('last contact wording', () => {
  test('"Nov 12 · call by Jake" — first name only, the kind in lower case', () => {
    expect(describeLastContact({ at: '2026-11-12T15:00:00Z', kind: 'call', byName: 'Jake Miller' })).toBe('Nov 12 · call by Jake')
    expect(describeLastContact({ at: '2026-11-12T15:00:00Z', kind: 'visit', byName: null })).toBe('Nov 12 · visit')
    expect(describeLastContact(null)).toBe('No contact logged')
  })
})

describe('loadLastContacts', () => {
  test('asks once per chunk with the viewer, maps by customer, and never throws when the function is missing', async () => {
    const rpc = jest.fn(async () => ({ data: [{ customer_id: 'c1', at: '2026-11-12T15:00:00Z', kind: 'text', by_name: 'Ann' }], error: null }))
    const m = await loadLastContacts({ rpc } as never, 'org', 'viewer', ['c1', 'c1', 'c2'])
    expect(rpc).toHaveBeenCalledWith('customer_last_contact', { p_org: 'org', p_viewer: 'viewer', p_customer_ids: ['c1', 'c2'] })
    expect(m.get('c1')).toEqual({ at: '2026-11-12T15:00:00Z', kind: 'text', byName: 'Ann' })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await loadLastContacts({ rpc: async () => ({ data: null, error: { message: 'missing' } }) } as never, 'o', 'v', ['c1'])).size).toBe(0)
    expect(await loadLastContacts({ rpc } as never, 'o', 'v', [])).toEqual(new Map())
  })
})
