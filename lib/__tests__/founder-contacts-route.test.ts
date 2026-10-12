/** @jest-environment node */
import { NextRequest } from 'next/server'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => { if (!authResult) throw new Error('Unauthorized'); return authResult }),
  getAuthContext: jest.fn(async () => authResult),
}))
jest.mock('@/lib/setter-email', () => ({ getCrmEmailFrom: () => '', getMailTransport: () => ({ sendMail: jest.fn() }) }))
const fetchTally = jest.fn()
jest.mock('@/lib/founder-week-tally', () => ({ fetchFounderWeekTally: (...a: unknown[]) => fetchTally(...a) }))

const insert = jest.fn()
const upsert = jest.fn()
const listFilters: string[][] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        insert: async (row: unknown) => { insert(row); return { error: null } },
        upsert: async (row: unknown, opts: unknown) => { upsert(row, opts); return { error: null } },
        select: () => q,
        eq: (c: string, v: string) => { listFilters.push([c, v]); return q },
        order: () => q,
        limit: async () => ({ data: [{ id: 'c1', name: 'Jane' }], error: null }),
      }
      return q
    },
  }),
}))

import { GET as tallyGET } from '@/app/api/founder-week/tally/route'
import { GET as contactsGET, POST as contactsPOST } from '@/app/api/founder-week/contacts/route'
import { GET as pageGET } from '@/app/foundercalendar/route'

const admin = { profile: { id: '0a1b2c3d-0000-4000-8000-00000000abcd', org_id: 'org-1', role: 'admin' } }
const rep = { profile: { id: 'u-rep', org_id: 'org-1', role: 'sales_rep' } }
const post = (body: unknown) =>
  new NextRequest('https://crm.example/api/founder-week/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => { authResult = admin; insert.mockReset(); upsert.mockReset(); fetchTally.mockReset().mockResolvedValue({ doors: 3 }); listFilters.length = 0 })

describe('contacts', () => {
  it('POST saves with org + created_by from the session, never from the body', async () => {
    const res = await contactsPOST(post({ kind: 'recruit', name: 'Rob', org_id: 'evil', created_by: 'evil' }))
    expect(res.status).toBe(201)
    expect(insert.mock.calls[0][0]).toMatchObject({ org_id: 'org-1', created_by: '0a1b2c3d-0000-4000-8000-00000000abcd', kind: 'recruit', name: 'Rob', client_id: null })
  })

  it('POST rejects non-JSON content types (CSRF guard)', async () => {
    const req = new NextRequest('https://crm.example/api/founder-week/contacts', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"kind":"realtor","name":"x"}' })
    expect((await contactsPOST(req)).status).toBe(415)
    expect(insert).not.toHaveBeenCalled()
  })

  it('POST 400s on bad JSON / invalid fields', async () => {
    expect((await contactsPOST(post('{nope'))).status).toBe(400)
    expect(await (await contactsPOST(post({ kind: 'realtor', name: '' }))).json()).toEqual({ error: 'Name is required' })
  })

  it('clientId → idempotent upsert; blank clientId ignored', async () => {
    await contactsPOST(post({ kind: 'realtor', name: 'Jane', clientId: 'abc' }))
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'org_id,client_id', ignoreDuplicates: true })
    await contactsPOST(post({ kind: 'realtor', name: 'Jo', clientId: '  ' }))
    expect(insert.mock.calls[0][0]).toMatchObject({ client_id: null })
  })

  it('GET lists only the caller’s own contacts in their org', async () => {
    const res = await contactsGET()
    expect(await res.json()).toEqual({ contacts: [{ id: 'c1', name: 'Jane' }] })
    expect(listFilters).toEqual([['org_id', 'org-1'], ['created_by', '0a1b2c3d-0000-4000-8000-00000000abcd']])
  })
})
