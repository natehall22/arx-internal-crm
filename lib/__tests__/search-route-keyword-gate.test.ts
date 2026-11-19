/** @jest-environment node */
/** Cmd-K keyword search over the work itself is only for companies with service plans or project tools; everyone else is unchanged. */
const runSearch = jest.fn(async (..._a: unknown[]) => [] as unknown[])
const features = { servicePlans: false, projectTools: false }
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ authUser: { id: 'viewer-1' }, profile: { org_id: 'org-1', role: 'admin' } }) }))
jest.mock('@/lib/global-search', () => ({ cleanQuery: (q: string | null) => (q ?? '').trim(), hrefForHit: () => '/x', runSearch: (...a: unknown[]) => runSearch(...a) }))
jest.mock('@/lib/global-search-server', () => ({ searchGroupsForCaller: async () => [{ kinds: ['job'], owner: null }] }))
jest.mock('@/lib/threads/search', () => ({ searchMessages: async () => [] }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/customer-file/redirects', () => ({ customerFileDefaultFor: () => null }))
jest.mock('@/lib/org-profile', () => ({ loadOrgProfile: async () => ({ id: 'org-1', features }) }))
import { GET } from '@/app/api/search/route'

const call = () => GET({ nextUrl: new URL('http://x/api/search?q=sprinkler') } as never)

beforeEach(() => runSearch.mockClear())

test('a company without service plans / project tools gets no viewer id (no keyword leg)', async () => {
  features.servicePlans = false
  features.projectTools = false
  await call()
  expect(runSearch.mock.calls[0][5]).toBeUndefined()
})

test('service plans or project tools turn the keyword leg on', async () => {
  features.servicePlans = true
  await call()
  expect(runSearch.mock.calls[0][5]).toBe('viewer-1')
  features.servicePlans = false
  features.projectTools = true
  await call()
  expect(runSearch.mock.calls[1][5]).toBe('viewer-1')
})
