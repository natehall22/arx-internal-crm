/** @jest-environment node */
/**
 * POST /api/change-orders/create writes with the service client (the "Send to customer" path), which skips the field-role
 * RLS deny (202610290020). The route itself must refuse setters / canvassers / inside sales / call center, before any write.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let barred = false
let calls: Array<[string, string]> = []
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => ({ authUser: { id: 'u1', email: null }, profile: { id: 'u1', org_id: 'org-a', role: 'setter', custom_role_id: null } })),
}))
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: jest.fn(async (_a: unknown, userId: string, profile: { role: string }) => { calls.push([userId, profile.role]); return barred }) }))
const createRemoteChangeOrder = jest.fn()
jest.mock('@/lib/change-orders-remote', () => ({ createRemoteChangeOrder: (...a: unknown[]) => createRemoteChangeOrder(...a) }))
jest.mock('@/lib/supabase/server', () => ({ createClient: () => ({ from: () => ({ insert: jest.fn() }) }) }))
jest.mock('@/lib/contracts/generateChangeOrderPdf', () => ({ generateChangeOrderPdf: jest.fn() }))
jest.mock('@/lib/job-commission-base', () => ({ syncJobSaleForProjectOrJob: jest.fn() }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({}) }))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST } from '@/app/api/change-orders/create/route'

const body = {
  projectId: 'p1', jobId: 'j1', coNumber: 'CO-001', description: 'Extra', originalAmount: 1000, updatedTotal: 1100, updatedRemaining: 1100,
  customerPrintName: 'Pat', repName: 'Rep', repSignature: 'data:image/png;base64,xx', customerName: 'Pat', projectAddress: '1 Main', signingMode: 'send_to_customer',
}
const post = () => POST(new Request('https://crm.example/api/change-orders/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)

beforeEach(() => {
  barred = false
  calls = []
  createRemoteChangeOrder.mockReset()
  createRemoteChangeOrder.mockResolvedValue({ ok: true, changeOrderId: 'co1', signingUrl: 'https://x/s', signingToken: 't', emailed: false })
  db = createFakeDb({ projects: [{ id: 'p1', org_id: 'org-a' }], production_jobs: [{ id: 'j1', org_id: 'org-a' }] })
})

test('a field role is refused with 403 and nothing is written', async () => {
  barred = true
  const res = await post()
  expect(res.status).toBe(403)
  expect(createRemoteChangeOrder).not.toHaveBeenCalled()
  expect(calls).toEqual([['u1', 'setter']])
})

test('an allowed role still sends the change order exactly as before', async () => {
  const res = await post()
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ success: true, changeOrderId: 'co1', signingUrl: 'https://x/s' })
  expect(createRemoteChangeOrder).toHaveBeenCalledTimes(1)
})

describe('in-person signing and the e-sign consent step', () => {
  const inPerson = (extra: Record<string, unknown> = {}) =>
    POST(new Request('https://crm.example/api/change-orders/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, signingMode: 'in_person', customerSignature: 'data:image/png;base64,xx', ...extra }) }) as never)
  const consentOn = () => { db = createFakeDb({ projects: [{ id: 'p1', org_id: 'org-a' }], production_jobs: [{ id: 'j1', org_id: 'org-a' }], orgs: [{ id: 'org-a', settings: { signing: { consentStep: true } } }] }) }

  it('refuses a customer signature taken on the rep\'s device without consent, before anything is made or written', async () => {
    consentOn()
    const res = await inPerson()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('consent_required')
    expect(db.writes).toEqual([])
  })
  it('an old notice version is refused too', async () => {
    consentOn()
    expect((await inPerson({ consent: { accepted: true, version: 'v0' } })).status).toBe(400)
  })
  it('with consent given it gets past the consent check', async () => {
    consentOn()
    const res = await inPerson({ consent: { accepted: true, version: 'v1-2026-11' } })
    expect((await res.json().catch(() => ({}))).code).not.toBe('consent_required')
  })
})
