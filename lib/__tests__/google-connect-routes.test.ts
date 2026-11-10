/** @jest-environment node */
/** Google connect routes: legacy address unchanged; company address uses the signed state and returns home. */
import { NextRequest } from 'next/server'

class CompanyLookupUnavailableError extends Error {}
const requireAuthApi = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: () => requireAuthApi(), CompanyLookupUnavailableError }))
const saved: unknown[] = []
jest.mock('@/lib/google-calendar', () => ({
  getGoogleAuthUrl: (state: string) => `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`,
  saveGoogleConnection: jest.fn(async (_a: unknown, code: string, userId: string, orgId: string) => {
    saved.push({ code, userId, orgId })
    return true
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const NONCE = '11111111-2222-4333-8444-555555555555'
const issueOAuthState = jest.fn(async () => ({ state: 'signed.payload', nonce: NONCE }))
const acceptOAuthCallback = jest.fn()
const finishOAuthConnect = jest.fn()
jest.mock('@/lib/google-oauth-state', () => ({
  GOOGLE_CONNECT_COOKIE: 'gcal_connect_nonce',
  GOOGLE_CONNECT_COOKIE_PATH: '/api/auth/google',
  OAUTH_STATE_TTL_MS: 600_000,
  issueOAuthState: (...a: unknown[]) => issueOAuthState(...(a as [])),
  acceptOAuthCallback: (...a: unknown[]) => acceptOAuthCallback(...(a as [])),
  finishOAuthConnect: (...a: unknown[]) => finishOAuthConnect(...(a as [])),
  isSignedOAuthState: (s: string) => s.includes('.'),
}))

import { GET as start } from '@/app/api/auth/google/route'
import { GET as callback } from '@/app/api/auth/google/callback/route'
import { GET as finishRoute } from '@/app/api/auth/google/finish/route'

const env: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ['APP_BASE_DOMAIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXT_PUBLIC_SUPABASE_URL']) env[k] = process.env[k]
  process.env.APP_BASE_DOMAIN = 'crm-product.test'
  process.env.GOOGLE_CLIENT_ID = 'id'
  process.env.GOOGLE_CLIENT_SECRET = 'secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  requireAuthApi.mockResolvedValue({ authUser: { id: 'u-1' }, profile: { org_id: 'org-acme' } })
  issueOAuthState.mockClear()
  acceptOAuthCallback.mockReset()
  finishOAuthConnect.mockReset()
  saved.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  jest.restoreAllMocks()
})

const at = (host: string, p: string, cookie?: string) =>
  new NextRequest(`https://${host}${p}`, { headers: { host, ...(cookie ? { cookie } : {}) } })

test('legacy address: state is the user id, exactly as before', async () => {
  const res = await start(at('old-app.vercel.app', '/api/auth/google'))
  expect(res.headers.get('location')).toBe('https://accounts.google.test/auth?state=u-1')
  expect(issueOAuthState).not.toHaveBeenCalled()
})

test('company address: signed ticket + httpOnly host-only nonce cookie in this browser', async () => {
  const res = await start(at('acme.crm-product.test', '/api/auth/google'))
  expect(res.headers.get('location')).toBe('https://accounts.google.test/auth?state=signed.payload')
  expect(issueOAuthState).toHaveBeenCalledWith(expect.anything(), { userId: 'u-1', orgId: 'org-acme', returnHost: 'acme.crm-product.test' })
  const sc = res.headers.get('set-cookie') ?? ''
  expect(sc).toContain(`gcal_connect_nonce=${NONCE}`)
  expect(sc).toMatch(/HttpOnly/i)
  expect(sc).toMatch(/Path=\/api\/auth\/google/)
  expect(sc).not.toMatch(/domain=/i)
})

test('company address: no ticket → 503, never the cookie flow', async () => {
  issueOAuthState.mockResolvedValueOnce(null as never)
  expect((await start(at('acme.crm-product.test', '/api/auth/google'))).status).toBe(503)
})

test('company lookup outage at start → 503 code, not a login redirect', async () => {
  requireAuthApi.mockRejectedValueOnce(new CompanyLookupUnavailableError())
  const res = await start(at('acme.crm-product.test', '/api/auth/google'))
  expect(res.status).toBe(503)
  expect(await res.json()).toMatchObject({ code: 'company_lookup_unavailable' })
})

test('not signed in → login', async () => {
  requireAuthApi.mockRejectedValueOnce(new Error('Unauthorized'))
  const res = await start(at('acme.crm-product.test', '/api/auth/google'))
  expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
})

test('callback (no cookie) stores NOTHING; it hands the browser to its company finish step', async () => {
  acceptOAuthCallback.mockResolvedValue({ ok: true, nonce: NONCE, userId: 'u-1', orgId: 'org-acme', returnOrigin: 'https://acme.crm-product.test' })
  const res = await callback(at('old-app.vercel.app', '/api/auth/google/callback?code=c&state=signed.payload'))
  expect(res.headers.get('location')).toBe(`https://acme.crm-product.test/api/auth/google/finish?nonce=${NONCE}`)
  expect(acceptOAuthCallback).toHaveBeenCalledWith(expect.anything(), 'signed.payload', 'c')
  expect(saved).toEqual([])
})

test('callback with a refused ticket stays on the callback host', async () => {
  acceptOAuthCallback.mockResolvedValue({ ok: false, reason: 'used' })
  const res = await callback(at('old-app.vercel.app', '/api/auth/google/callback?code=c&state=signed.payload'))
  expect(res.headers.get('location')).toBe('https://old-app.vercel.app/settings?error=invalid_state')
})

test('consent denied with a signed ticket → ticket burned, back to the company address', async () => {
  acceptOAuthCallback.mockResolvedValue({ ok: true, nonce: NONCE, userId: 'u-1', orgId: 'org-acme', returnOrigin: 'https://acme.crm-product.test' })
  const res = await callback(at('old-app.vercel.app', '/api/auth/google/callback?error=access_denied&state=signed.payload'))
  expect(acceptOAuthCallback).toHaveBeenCalledWith(expect.anything(), 'signed.payload', null)
  expect(res.headers.get('location')).toBe('https://acme.crm-product.test/settings?error=oauth_denied')
})

test('finish: passes cookie + signed-in user to the check; saves only on ok; clears the cookie', async () => {
  finishOAuthConnect.mockResolvedValue({ ok: true, code: 'the-code' })
  const res = await finishRoute(at('acme.crm-product.test', `/api/auth/google/finish?nonce=${NONCE}`, `gcal_connect_nonce=${NONCE}`))
  expect(finishOAuthConnect).toHaveBeenCalledWith(expect.anything(), { nonce: NONCE, cookieNonce: NONCE, userId: 'u-1', orgId: 'org-acme' })
  expect(saved).toEqual([{ code: 'the-code', userId: 'u-1', orgId: 'org-acme' }])
  expect(res.headers.get('location')).toBe('https://acme.crm-product.test/settings?success=calendar_connected')
  expect(res.headers.get('set-cookie')).toMatch(/gcal_connect_nonce=;/)
})

test('ATTACK via routes: the victim’s browser (other user, no cookie) gets nothing saved', async () => {
  requireAuthApi.mockResolvedValue({ authUser: { id: 'u-victim' }, profile: { org_id: 'org-acme' } })
  finishOAuthConnect.mockResolvedValue({ ok: false, reason: 'no_cookie' })
  const res = await finishRoute(at('acme.crm-product.test', `/api/auth/google/finish?nonce=${NONCE}`))
  expect(finishOAuthConnect).toHaveBeenCalledWith(expect.anything(), { nonce: NONCE, cookieNonce: undefined, userId: 'u-victim', orgId: 'org-acme' })
  expect(saved).toEqual([])
  expect(res.headers.get('location')).toBe('https://acme.crm-product.test/settings?error=invalid_state')
})

test('finish signed out → ticket burned, nothing saved; finish off a company address → 404', async () => {
  requireAuthApi.mockRejectedValueOnce(new Error('Unauthorized'))
  finishOAuthConnect.mockResolvedValue({ ok: false, reason: 'no_cookie' })
  await finishRoute(at('acme.crm-product.test', `/api/auth/google/finish?nonce=${NONCE}`))
  expect(finishOAuthConnect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cookieNonce: null, userId: '' }))
  expect(saved).toEqual([])
  expect((await finishRoute(at('old-app.vercel.app', `/api/auth/google/finish?nonce=${NONCE}`))).status).toBe(404)
})
