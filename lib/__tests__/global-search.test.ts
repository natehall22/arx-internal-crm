import { cleanQuery, hrefForHit, runSearch, searchGroupsFor } from '@/lib/global-search'

const base = { userId: 'me', role: 'sales_rep', isSuperuser: false, canCustomers: true, customersRepScoped: true, canJobBoard: false, canProposals: true, canOpportunities: true }

describe('global search permissions', () => {
  it('a rep finds only their own customers, proposals and opportunities', () => {
    expect(searchGroupsFor(base)).toEqual([{ kinds: ['customer', 'proposal', 'opportunity'], owner: 'me' }])
  })
  it('an owner searches everything, unscoped', () => {
    expect(searchGroupsFor({ ...base, role: 'owner', isSuperuser: true, customersRepScoped: false, canJobBoard: true })).toEqual([{ kinds: ['customer', 'job', 'proposal', 'opportunity'], owner: null }])
  })
  it('ops sees customers and jobs but only their own proposals', () => {
    expect(searchGroupsFor({ ...base, role: 'operations', customersRepScoped: false, canJobBoard: true })).toEqual([
      { kinds: ['customer', 'job', 'opportunity'], owner: null },
      { kinds: ['proposal'], owner: 'me' },
    ])
  })
  it('a setter never finds opportunities or proposals; barred roles find no proposals', () => {
    expect(searchGroupsFor({ ...base, role: 'setter', canCustomers: false, canProposals: false })).toEqual([])
  })
  it('no permissions → no groups, so nothing is queried', () => {
    expect(searchGroupsFor({ ...base, canCustomers: false, canProposals: false, canOpportunities: false })).toEqual([])
  })
})

describe('query + results', () => {
  it('rejects too-short and too-long queries, collapses whitespace', () => {
    expect(cleanQuery('a')).toBeNull()
    expect(cleanQuery('x'.repeat(81))).toBeNull()
    expect(cleanQuery('  ashley   gaines ')).toBe('ashley gaines')
    expect(cleanQuery(undefined)).toBeNull()
  })
  it('merges groups by score and links each kind', async () => {
    const rpc = jest.fn(async (_fn: string, a: { p_owner: string | null }) => ({
      data: a.p_owner ? [{ kind: 'proposal', id: 'p1', title: 'P', subtitle: null, score: 0.5 }] : [{ kind: 'job', id: 'j1', title: 'Job 26-0040', subtitle: 'x', score: 0.95 }],
      error: null,
    }))
    const hits = await runSearch({ rpc } as never, 'org', 'abc', [{ kinds: ['job'], owner: null }, { kinds: ['proposal'], owner: 'me' }])
    expect(hits.map((h) => h.id)).toEqual(['j1', 'p1'])
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(hrefForHit(hits[0])).toBe('/ops/jobs/j1')
    expect(hrefForHit({ kind: 'customer', id: 'c' })).toBe('/customers/c')
  })
  it('a failed search throws (the route answers 500), never an empty "no matches"', async () => {
    await expect(runSearch({ rpc: async () => ({ data: null, error: new Error('boom') }) } as never, 'o', 'abc', [{ kinds: ['job'], owner: null }])).rejects.toThrow('boom')
  })
})
