/** @jest-environment node */
/** The crew day routes: a token reaches only its own crew's visits, re-checked on every call; no price field ever leaves. */
const mockCrew = jest.fn()
const mockVisit = jest.fn()
const mockRecord = jest.fn()
const mockMoney = jest.fn()
const mockTap = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/service-plans-access', () => ({ activeCrewDay: (...a: unknown[]) => mockCrew(...a) }))
jest.mock('@/lib/service-plans-db', () => ({ loadCrewVisit: (...a: unknown[]) => mockVisit(...a) }))
jest.mock('@/lib/visit-collections-db', () => ({ recordPendingCollection: (...a: unknown[]) => mockRecord(...a), loadCrewMoney: (...a: unknown[]) => mockMoney(...a) }))
jest.mock('@/lib/visit-checklist-db', () => ({ tapVisitChecklist: (...a: unknown[]) => mockTap(...a) }))

import { POST as collect } from '@/app/api/crew/day/[token]/visits/[id]/collect/route'
import { POST as checklist } from '@/app/api/crew/day/[token]/visits/[id]/checklist/route'

const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
const P = (token = 't1', id = 'v1') => ({ params: { token, id } })
const CREW = { orgId: 'o1', subId: 's1' }

beforeEach(() => {
  jest.resetAllMocks()
  mockCrew.mockImplementation(async (_a: unknown, t: string) => (t === 't1' ? CREW : null))
  mockVisit.mockImplementation(async (_a: unknown, _c: unknown, id: string) => (id === 'v1' ? { id: 'v1', customerId: 'c1' } : null))
  mockMoney.mockResolvedValue({ v1: { dueCents: 7000, pendingCents: 2000, canPayOnline: true } })
  mockRecord.mockResolvedValue({ ok: true })
  mockTap.mockResolvedValue({ ok: true, checklist: [] })
})

describe('crew collect route', () => {
  it('a bad or dead token is 404 and records nothing', async () => {
    const r = await collect(req({ amount: '10', method: 'cash' }), P('nope'))
    expect(r.status).toBe(404)
    expect(mockRecord).not.toHaveBeenCalled()
  })
  it("another crew's (or unknown) visit is 404 and records nothing", async () => {
    const r = await collect(req({ amount: '10', method: 'cash' }), P('t1', 'other'))
    expect(r.status).toBe(404)
    expect(mockRecord).not.toHaveBeenCalled()
  })
  it('a bad amount is 400; a good one records a pending row scoped to the token crew, and only the owed number comes back', async () => {
    expect((await collect(req({ amount: '-5', method: 'cash' }), P())).status).toBe(400)
    const r = await collect(req({ amount: '10', method: 'cash' }), P())
    expect(r.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith({}, 'o1', expect.objectContaining({ subId: 's1', visitId: 'v1', customerId: 'c1' }))
    const body = await r.json()
    expect(Object.keys(body.money).sort()).toEqual(['canPayOnline', 'dueCents', 'pendingCents'])
    expect(JSON.stringify(body)).not.toMatch(/price|cost|profit|margin|commission|phone|email/i)
  })
  it("a refusal from the writer (over what's owed) passes through with its status", async () => {
    mockRecord.mockResolvedValueOnce({ ok: false, status: 409, error: 'More than owed' })
    expect((await collect(req({ amount: '9999', method: 'cash' }), P())).status).toBe(409)
  })
})

describe('crew checklist route', () => {
  it('dead token and foreign visit are 404 and write nothing', async () => {
    expect((await checklist(req({ label: 'Mow', done: true }), P('nope'))).status).toBe(404)
    expect((await checklist(req({ label: 'Mow', done: true }), P('t1', 'other'))).status).toBe(404)
    expect(mockTap).not.toHaveBeenCalled()
  })
})
