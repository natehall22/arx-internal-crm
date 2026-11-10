/** @jest-environment node */
/**
 * resolveAuth (requireAuth / requireAuthApi / getAuthContext) behind a company web address: a profile from
 * another company — web cookie or iPhone Bearer token — is treated as no profile; unknown addresses refuse.
 */
let requestHeaders = new Map<string, string>()
let profileRow: Record<string, unknown> | null = null

jest.mock('next/headers', () => ({
  headers: () => requestHeaders,
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

import { getAuthContext, requireAuth, requireAuthApi } from '@/lib/auth'
import { __resetCompanyHostCacheForTests, signResolvedLookups } from '@/lib/company-host'

const ORGS: Record<string, string> = { acme: 'org-acme', roofco: 'org-roofco' }
const ENV_KEYS = ['APP_BASE_DOMAIN', 'DEPLOYMENT_ORG_ID'] as const
const saved: Record<string, string | undefined> = {}

function req(host: string, extra: Record<string, string> = {}) {
  requestHeaders = new Map(Object.entries({ authorization: 'Bearer good-token', host, ...extra }))
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.APP_BASE_DOMAIN = 'crm-product.test'
  delete process.env.DEPLOYMENT_ORG_ID
  __resetCompanyHostCacheForTests()
  profileRow = { id: 'u-1', org_id: 'org-acme', role: 'admin', active: true }
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init: { body: string }) => ({
    ok: true,
    status: 200,
    json: async () => ORGS[JSON.parse(init.body).p_subdomain] ?? null,
  }))
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

test('own company address → signed in', async () => {
  req('acme.crm-product.test')
  await expect(requireAuthApi()).resolves.toMatchObject({ profile: { org_id: 'org-acme' } })
})

test("another company's address → no profile (401 / login redirect), never that company's data", async () => {
  req('roofco.crm-product.test')
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  await expect(requireAuth()).rejects.toThrow('REDIRECT:/login')
  await expect(getAuthContext()).resolves.toBeNull()
})

test('unknown company address and the bare product domain refuse everyone', async () => {
  req('nobody.crm-product.test')
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  req('crm-product.test')
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
})

test('legacy address stays unfenced during the overlap', async () => {
  req('old-app.vercel.app')
  profileRow = { id: 'u-1', org_id: 'org-anything', role: 'admin', active: true }
  await expect(requireAuthApi()).resolves.toMatchObject({ profile: { org_id: 'org-anything' } })
})

test('iPhone company code on the legacy address fences the Bearer token', async () => {
  req('old-app.vercel.app', { 'x-company-code': 'roofco' })
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  req('old-app.vercel.app', { 'x-company-code': 'acme' })
  await expect(requireAuthApi()).resolves.toBeTruthy()
})

test('DEPLOYMENT_ORG_ID outranks the host: a disagreeing company address is refused', async () => {
  process.env.DEPLOYMENT_ORG_ID = 'org-acme'
  req('roofco.crm-product.test')
  profileRow = { id: 'u-1', org_id: 'org-roofco', role: 'admin', active: true }
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
})

test('a disabled user from another company gets the same answer as any outsider (no "disabled" hint)', async () => {
  req('roofco.crm-product.test')
  profileRow = { id: 'u-1', org_id: 'org-acme', role: 'admin', active: false }
  await expect(requireAuth()).rejects.toThrow('REDIRECT:/login')
})

test('company lookup failure is not a sign-out: distinct error with code company_lookup_unavailable', async () => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  req('acme.crm-product.test')
  await expect(requireAuthApi()).rejects.toMatchObject({ name: 'CompanyLookupUnavailableError', code: 'company_lookup_unavailable' })
})

test("with middleware's signed lookup, a DB outage at the route can't turn into 401", async () => {
  const signed = await signResolvedLookups('acme.crm-product.test', null, { host: { status: 'found', orgId: 'org-acme' } })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  req('acme.crm-product.test', { 'x-company-resolved': signed! })
  await expect(requireAuthApi()).resolves.toMatchObject({ profile: { org_id: 'org-acme' } })
})

test('a signed lookup for another host is ignored (route looks up itself)', async () => {
  const signed = await signResolvedLookups('roofco.crm-product.test', null, { host: { status: 'found', orgId: 'org-roofco' } })
  req('acme.crm-product.test', { 'x-company-resolved': signed! })
  profileRow = { id: 'u-1', org_id: 'org-roofco', role: 'admin', active: true }
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
})

test('iPhone code on the legacy address via signed lookup', async () => {
  const signed = await signResolvedLookups('old-app.vercel.app', 'acme', { code: { status: 'found', orgId: 'org-acme' } })
  req('old-app.vercel.app', { 'x-company-code': 'acme', 'x-company-resolved': signed! })
  await expect(requireAuthApi()).resolves.toBeTruthy()
  profileRow = { id: 'u-1', org_id: 'org-roofco', role: 'admin', active: true }
  await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
})
