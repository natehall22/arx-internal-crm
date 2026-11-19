/** @jest-environment node */
const findOrCreateProperty = jest.fn()
const addManualTrade = jest.fn()
const updateProperty = jest.fn()
const inserts: Array<[string, Record<string, unknown>]> = []
let existingJobs: Array<{ property_id: string }> = []

jest.mock('@/lib/service-plans-db', () => ({ findOrCreateProperty: (...a: unknown[]) => findOrCreateProperty(...a) }))
jest.mock('@/lib/job-trades-db', () => ({ addManualTrade: (...a: unknown[]) => addManualTrade(...a) }))
jest.mock('@/lib/properties-db', () => ({
  loadCustomerProperties: async () => ({ ready: true, properties: [{ id: 'old', address_text: 'Lot 1, Oak Ridge', community: null, lot: null }] }),
  updateProperty: (...a: unknown[]) => updateProperty(...a),
}))
jest.mock('@/lib/developments-db', () => ({ listDevelopments: async () => [{ name: 'Oak Ridge', key: 'oak ridge', lots: 1, builders: [] }] }))
jest.mock('@/lib/org-trades', () => {
  const actual = jest.requireActual('@/lib/org-trades')
  return {
    ...actual,
    loadOrgTrades: async () => [
      { slug: 'grading', label: 'Grading', sort: 10, active: true, matchKeywords: null },
      { slug: 'sod', label: 'Sod', sort: 20, active: true, matchKeywords: null },
      { slug: 'old', label: 'Old', sort: 30, active: false, matchKeywords: null },
    ],
  }
})

import { addLots, readAddLotsBody } from '@/lib/lots-db'

function fakeAdmin() {
  return {
    from: (table: string) => ({
      select: () => {
        const q: any = { eq: () => q, in: () => q, is: () => q, then: (res: (v: unknown) => void) => res({ data: table === 'production_jobs' ? existingJobs : [], error: null }) }
        return q
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push([table, row])
        return { select: () => ({ single: async () => ({ data: { id: `${table}-${inserts.length}` }, error: null }) }) }
      },
    }),
  } as never
}

beforeEach(() => {
  findOrCreateProperty.mockReset()
  addManualTrade.mockReset().mockResolvedValue({ trade: {} })
  updateProperty.mockReset().mockResolvedValue({ ok: true })
  inserts.length = 0
  existingJobs = []
  let n = 0
  findOrCreateProperty.mockImplementation(async (_a, _o, _u, _c, address: string) => (address === 'Lot 1, Oak Ridge' ? { ok: true, propertyId: 'old', created: false } : { ok: true, propertyId: `new${++n}`, created: true }))
})

const input = (over = {}) => ({ development: 'Oak Ridge', rows: [{ lot: '1', address: '', city: '', state: '', zip: '' }, { lot: '2', address: '', city: '', state: '', zip: '' }], trades: [] as string[], createJobs: false, ...over })

describe('readAddLotsBody', () => {
  it('needs a development, lots, and at most one batch', () => {
    expect(readAddLotsBody({ rows: [{ lot: '1' }] }).ok).toBe(false)
    expect(readAddLotsBody({ development: 'A', rows: [] }).ok).toBe(false)
    expect(readAddLotsBody({ development: 'A', rows: [{ address: 'x' }] }).ok).toBe(false)
    expect(readAddLotsBody({ development: 'A', rows: Array.from({ length: 26 }, (_, i) => ({ lot: String(i) })) }).ok).toBe(false)
    expect(readAddLotsBody({ development: ' A  B ', rows: [{ lot: ' 1 ' }], createJobs: true, trades: ['x'] })).toEqual({ ok: true, value: { development: 'A B', rows: [{ lot: '1', address: '', city: '', state: '', zip: '' }], trades: ['x'], createJobs: true } })
  })
})

describe('addLots', () => {
  it('matches existing lots through findOrCreateProperty, fills a blank development once, counts added vs on file', async () => {
    const out = await addLots(fakeAdmin(), 'o1', 'u1', 'c1', input(), { accessNotes: false })
    expect(out).toMatchObject({ ok: true, result: { added: 1, existed: 1, jobsCreated: 0 } })
    expect(updateProperty).toHaveBeenCalledTimes(1)
    expect(findOrCreateProperty.mock.calls[1][4]).toBe('Lot 2, Oak Ridge')
    expect(inserts).toEqual([])
  })
  it('makes a job per lot with one crew per chosen trade in the company order; a lot with an open job gets none', async () => {
    existingJobs = [{ property_id: 'old' }]
    const out = await addLots(fakeAdmin(), 'o1', 'u1', 'c1', input({ createJobs: true, trades: ['sod', 'grading'] }), { accessNotes: false })
    expect(out).toMatchObject({ ok: true, result: { jobsCreated: 1, jobsSkipped: 1 } })
    const job = inserts.find(([t]) => t === 'production_jobs')![1]
    expect(job).toMatchObject({ org_id: 'o1', property_id: 'new1', job_type: 'mixed', customer_id: 'c1' })
    expect(addManualTrade.mock.calls.map((c) => c[3])).toEqual(['grading', 'sod'])
    expect(inserts.find(([t]) => t === 'projects')![1]).toMatchObject({ org_id: 'o1', customer_id: 'c1' })
  })
  it('one trade makes the job that trade; a trade the company does not use (or turned off) is refused; jobs need a trade', async () => {
    await addLots(fakeAdmin(), 'o1', 'u1', 'c1', input({ rows: [{ lot: '2', address: '', city: '', state: '', zip: '' }], createJobs: true, trades: ['grading'] }), { accessNotes: false })
    expect(inserts.find(([t]) => t === 'production_jobs')![1]).toMatchObject({ job_type: 'grading' })
    expect(await addLots(fakeAdmin(), 'o1', 'u1', 'c1', input({ trades: ['old'] }), { accessNotes: false })).toMatchObject({ ok: false, status: 400 })
    expect(await addLots(fakeAdmin(), 'o1', 'u1', 'c1', input({ createJobs: true }), { accessNotes: false })).toMatchObject({ ok: false, status: 400 })
  })
  it('a lot that fails is reported and the rest still go', async () => {
    findOrCreateProperty.mockReset().mockResolvedValueOnce({ ok: false, status: 409, error: 'dup' }).mockResolvedValueOnce({ ok: true, propertyId: 'n', created: true })
    const out = await addLots(fakeAdmin(), 'o1', 'u1', 'c1', input(), { accessNotes: false })
    expect(out).toMatchObject({ ok: true, result: { added: 1, failed: [{ lot: '1', error: 'dup' }] } })
  })
})
