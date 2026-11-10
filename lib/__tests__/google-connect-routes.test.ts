/** @jest-environment node */
/** Google connect routes: legacy address unchanged; company address uses the signed state and returns home. */
import { NextRequest } from 'next/server'

const requireAuthApi = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: () => requireAuthApi() }))
jest.mock('@/lib/google-calendar', () => ({
  getGoogleAuthUrl: (state: string) => `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`,
  exchangeCodeForTokens: jest.fn(async () => ({
    access_token: 'a',
    refresh_token: 'r',
    token_type: 'Bearer',
    expires_at: new Date(0),
    scope: 's',
  })),
}))
const upserts: unknown[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      upsert: async (row: unknown) => {
        upserts.push(row)
        return { error: null }
      },
    }),
  }),
}))
const issueOAuthState = jest.fn(async () => 'signed.payload')
const consumeOAuthState = jest.fn()
jest.mock('@/lib/google-oauth-state', () => ({
  issueOAuthState: (...a: unknown[]) => issueOAuthState(...(a as [])),
  consumeOAuthState: (...a: unknown[]) => consumeOAuthState(...(a as [])),
  isSignedOAuthState: (s: string) => s.includes('.'),
}))

import { GET as start } from '@/app/api/auth/google/route'
import { GET as callback } from '@/app/api/auth/google/callback/route'

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ['APP_BASE_DOMAIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXT_PUBLIC_SUPABASE_URL']) saved[k] = process.env[k]
  process.env.APP_BASE_DOMAIN = 'crm-product.test'
  process.env.GOOGLE_CLIENT_ID = 'id'
  process.env.GOOGLE_CLIENT_SECRET = 'secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  requireAuthApi.mockResolvedValue({ authUser: { id: 'u-1' }, profile: { org_id: 'org-acme' } })
  issueOAuthState.mockClear()
  consumeOAuthState.mockReset()
  upserts.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  jest.restoreAllMocks()
})

const at = (host: string, p: string) => new NextRequest(`https://${host}${p}`, { headers: { host } })

test('legacy address: state is the user id, exactly as before', async () => {
  const res = await start(at('old-app.vercel.app', '/api/auth/google'))
  expect(res.headers.get('location')).toBe('https://accounts.google.test/auth?state=u-1')
  expect(issueOAuthState).not.toHaveBeenCalled()
})

test('company address: signed ticket bound to user, org and this host', async () => {
  const res = await start(at('acme.crm-product.test', '/api/auth/google'))
  expect(res.headers.get('location')).toBe('https://accounts.google.test/auth?state=signed.payload')
  expect(issueOAuthState).toHaveBeenCalledWith(expect.anything(), {
    userId: 'u-1',
    orgId: 'org-acme',
    returnHost: 'acme.crm-product.test',
  })
})

test('company address: no ticket → 503, never the cookie flow', async () => {
  issueOAuthState.mockResolvedValueOnce(null as unknown as string)
  const res = await start(at('acme.crm-product.test', '/api/auth/google'))
  expect(res.status).toBe(503)
})

test('not signed in → login', async () => {
  requireAuthApi.mockRejectedValueOnce(new Error('Unauthorized'))
  const res = await start(at('acme.crm-product.test', '/api/auth/google'))
  expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
})

test('callback with a signed ticket (no cookie) stores tokens and returns to the company address', async () => {
  consumeOAuthState.mockResolvedValue({ ok: true, userId: 'u-1', orgId: 'org-acme', returnOrigin: 'https://acme.crm-product.test' })
  const res = await callback(at('old-app.vercel.app', '/api/auth/google/callback?code=c&state=signed.payload'))
  expect(res.headers.get('location')).toBe('https://acme.crm-product.test/settings?success=calendar_connected')
  expect(upserts).toEqual([expect.objectContaining({ user_id: 'u-1', org_id: 'org-acme' })])
})

test('callback with a refused ticket stays on the callback host and stores nothing', async () => {
  consumeOAuthState.mockResolvedValue({ ok: false, reason: 'used' })
  const res = await callback(at('old-app.vercel.app', '/api/auth/google/callback?code=c&state=signed.payload'))
  expect(res.headers.get('location')).toBe('https://old-app.vercel.app/settings?error=invalid_state')
  expect(upserts).toEqual([])
})

test('consent denied with a signed ticket → back to the company address', async () => {
  consumeOAuthState.mockResolvedValue({ ok: true, userId: 'u-1', orgId: 'org-acme', returnOrigin: 'https://acme.crm-product.test' })
  const res = await callback(at('old-app.vercel.app', '/api/auth/google/callback?error=access_denied&state=signed.payload'))
  expect(res.headers.get('location')).toBe('https://acme.crm-product.test/settings?error=oauth_denied')
})
