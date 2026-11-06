/** @jest-environment node */
/**
 * DEPLOYMENT_ORG_ID: the per-copy fence in lib/auth.ts resolveAuth (behind requireAuth,
 * requireAuthApi and getAuthContext). Set → only that org's users sign in. Unset → unchanged.
 */
let profileRow: Record<string, unknown> | null = null

jest.mock('next/headers', () => ({
  headers: () => new Map([['authorization', 'Bearer good-token']]),
  cookies: () => ({ getAll: () => [] }),
}))
jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === 'good-token'
          ? { data: { user: { id: 'u-1', email: 'u1@example.test' } }, error: null }
          : { data: { user: null }, error: { message: 'bad' } },
    },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: profileRow ? [profileRow] : [], error: null }),
      }),
    }),
  }),
}))

import { requireAuth, requireAuthApi, getAuthContext, profileAllowedOnThisDeployment } from '@/lib/auth'

const ORIGINAL = process.env.DEPLOYMENT_ORG_ID
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})
beforeEach(() => {
  profileRow = { id: 'u-1', org_id: 'org-a', role: 'admin', active: true }
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DEPLOYMENT_ORG_ID
  else process.env.DEPLOYMENT_ORG_ID = ORIGINAL
  jest.restoreAllMocks()
})

describe('DEPLOYMENT_ORG_ID set to another org', () => {
  beforeEach(() => {
    process.env.DEPLOYMENT_ORG_ID = 'org-b'
  })
  test('requireAuthApi rejects as Unauthorized (→ 401)', async () => {
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })
  test('requireAuth redirects to /login', async () => {
    await expect(requireAuth()).rejects.toThrow('REDIRECT:/login')
  })
  test('getAuthContext returns null', async () => {
    await expect(getAuthContext()).resolves.toBeNull()
  })
  test('a profile with no org is rejected too', async () => {
    profileRow = { id: 'u-1', org_id: null, role: 'admin', active: true }
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })
})

describe('DEPLOYMENT_ORG_ID set to the same org', () => {
  test('signs in', async () => {
    process.env.DEPLOYMENT_ORG_ID = 'org-a'
    const ctx = await requireAuthApi()
    expect(ctx.profile.org_id).toBe('org-a')
    expect(ctx.authUser.id).toBe('u-1')
  })
  test('surrounding whitespace in the env value is ignored', async () => {
    process.env.DEPLOYMENT_ORG_ID = '  org-a\n'
    await expect(requireAuthApi()).resolves.toBeTruthy()
  })
})

describe('DEPLOYMENT_ORG_ID unset or blank — unchanged', () => {
  test.each([undefined, '', '   '])('value %p: any org signs in', async (value) => {
    if (value === undefined) delete process.env.DEPLOYMENT_ORG_ID
    else process.env.DEPLOYMENT_ORG_ID = value
    profileRow = { id: 'u-1', org_id: 'org-z', role: 'admin', active: true }
    await expect(requireAuthApi()).resolves.toMatchObject({ profile: { org_id: 'org-z' } })
  })
  test('an inactive user is still rejected as before', async () => {
    delete process.env.DEPLOYMENT_ORG_ID
    profileRow = { id: 'u-1', org_id: 'org-a', role: 'admin', active: false }
    await expect(requireAuthApi()).rejects.toThrow('Account disabled')
  })
})

test('profileAllowedOnThisDeployment', () => {
  delete process.env.DEPLOYMENT_ORG_ID
  expect(profileAllowedOnThisDeployment('anything')).toBe(true)
  process.env.DEPLOYMENT_ORG_ID = 'org-a'
  expect(profileAllowedOnThisDeployment('org-a')).toBe(true)
  expect(profileAllowedOnThisDeployment('org-b')).toBe(false)
  expect(profileAllowedOnThisDeployment(undefined)).toBe(false)
})
