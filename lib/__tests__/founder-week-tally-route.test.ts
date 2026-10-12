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

describe('access', () => {
  it('signed out → 401 on the APIs, redirect to login on the page', async () => {
    authResult = null
    expect((await tallyGET()).status).toBe(401)
    expect((await contactsPOST(post({ kind: 'realtor', name: 'x' }))).status).toBe(401)
    const page = await pageGET(new NextRequest('https://crm.example/foundercalendar'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('https://crm.example/login?next=/foundercalendar')
  })

  it('non-admin roles get 404 everywhere (page stays invisible)', async () => {
    authResult = rep
    expect((await tallyGET()).status).toBe(404)
    expect((await contactsGET()).status).toBe(404)
    expect((await pageGET(new NextRequest('https://crm.example/foundercalendar'))).status).toBe(404)
    expect(insert).not.toHaveBeenCalled()
  })

  it('admin gets the page as private, no-store, noindex HTML', async () => {
    const page = await pageGET(new NextRequest('https://crm.example/foundercalendar'))
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('cache-control')).toBe('private, no-store')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const body = await page.text()
    expect(body).toContain('ARX Founder Week')
    expect(body).toContain('window.FW_UID="0a1b2c3d-0000-4000-8000-00000000abcd"') // per-user storage namespace
    expect(body).not.toContain('<!--FW_BOOT-->')
  })
})

describe('tally', () => {
  it('uses the signed-in user’s org', async () => {
    const res = await tallyGET()
    expect(res.status).toBe(200)
    expect(fetchTally.mock.calls[0][1]).toBe('org-1')
  })
})

