/** During a support session the staff member's own JWT must never back a user-token client (it is another company's). */
const store = new Map<string, string>()
jest.mock('next/headers', () => ({
  headers: () => new Headers(),
  cookies: () => ({
    get: (n: string) => (store.has(n) ? { name: n, value: store.get(n)! } : undefined),
    getAll: () => Array.from(store, ([name, value]) => ({ name, value })),
  }),
}))
jest.mock('@/lib/supabase/session-cookie', () => ({
  getSupabaseSessionFromCookieStore: () => ({ access_token: 'staff-own-jwt' }),
}))

import { getRequestAccessToken } from '@/lib/supabase/request-client'
import { SUPPORT_COOKIE } from '@/lib/support/token'

describe('getRequestAccessToken and support access', () => {
  beforeEach(() => store.clear())
  it('returns the session token normally', () => {
    expect(getRequestAccessToken()).toBe('staff-own-jwt')
  })
  it('returns nothing while a support session cookie is present', () => {
    store.set(SUPPORT_COOKIE, 'signed')
    expect(getRequestAccessToken()).toBeNull()
  })
})
