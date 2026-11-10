/** @jest-environment node */
/**
 * Google Calendar connect from a company address: the signed single-use state (lib/google-oauth-state.ts) and the
 * callback that trusts it instead of a cookie. Legacy (user-id state + cookie) stays as it was.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { OAUTH_STATE_TTL_MS, consumeOAuthState, isSignedOAuthState, issueOAuthState } from '@/lib/google-oauth-state'

type Row = Record<string, unknown>
const db: { oauth_states: Row[]; users: Row[]; orgs: Row[] } = { oauth_states: [], users: [], orgs: [] }

/** Tiny in-memory stand-in for the service client: insert, update+filters+select, select+eq+maybeSingle. */
function fakeAdmin(): SupabaseClient {
  return {
    from(table: keyof typeof db) {
      const filters: Array<(r: Row) => boolean> = []
      let patch: Row | null = null
      const api = {
        insert: async (row: Row) => {
          db[table].push({ used_at: null, ...row })
          return { error: null }
        },
        update(p: Row) {
          patch = p
          return api
        },
        select() {
          return api
        },
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v)
          return api
        },
        is(col: string, v: unknown) {
          filters.push((r) => (r[col] ?? null) === v)
          return api
        },
        gt(col: string, v: string) {
          filters.push((r) => String(r[col]) > v)
          return api
        },
        maybeSingle: async () => ({ data: db[table].find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        then(resolve: (v: unknown) => void) {
          const rows = db[table].filter((r) => filters.every((f) => f(r)))
          if (patch) rows.forEach((r) => Object.assign(r, patch))
          resolve({ data: rows.map((r) => ({ nonce: r.nonce })), error: null })
        },
      }
      return api
    },
  } as unknown as SupabaseClient
}

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ['APP_BASE_DOMAIN', 'OAUTH_STATE_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) saved[k] = process.env[k]
  process.env.APP_BASE_DOMAIN = 'crm-product.test'
  process.env.OAUTH_STATE_SECRET = 'test-secret'
  db.oauth_states = []
  db.users = [
    { id: 'u-1', org_id: 'org-acme', active: true },
    { id: 'u-off', org_id: 'org-acme', active: false },
  ]
  db.orgs = [
    { id: 'org-acme', subdomain: 'acme' },
    { id: 'org-roofco', subdomain: 'roofco' },
  ]
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  jest.restoreAllMocks()
})

const issue = (over: Partial<{ userId: string; orgId: string; returnHost: string }> = {}, now?: number) =>
  issueOAuthState(fakeAdmin(), { userId: 'u-1', orgId: 'org-acme', returnHost: 'acme.crm-product.test:443', ...over }, now)

test('round trip: signed, consumed once, returns to the org’s own address', async () => {
  const state = (await issue())!
  expect(isSignedOAuthState(state)).toBe(true)
  expect(isSignedOAuthState('3f1c2a1e-0000-4000-8000-000000000000')).toBe(false)
  expect(await consumeOAuthState(fakeAdmin(), state)).toEqual({
    ok: true,
    userId: 'u-1',
    orgId: 'org-acme',
    returnOrigin: 'https://acme.crm-product.test',
  })
  expect(await consumeOAuthState(fakeAdmin(), state)).toEqual({ ok: false, reason: 'used' })
})

test('tampered payload or MAC is refused', async () => {
  const state = (await issue())!
  const [body, mac] = state.split('.')
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: 'u-other' })).toString('base64url')
  expect(await consumeOAuthState(fakeAdmin(), `${evil}.${mac}`)).toEqual({ ok: false, reason: 'bad_signature' })
  expect(await consumeOAuthState(fakeAdmin(), `${body}.x${mac.slice(1)}`)).toEqual({ ok: false, reason: 'bad_signature' })
  expect(await consumeOAuthState(fakeAdmin(), `${body}.${mac}.extra`)).toEqual({ ok: false, reason: 'bad_signature' })
  process.env.OAUTH_STATE_SECRET = 'rotated'
  expect(await consumeOAuthState(fakeAdmin(), state)).toEqual({ ok: false, reason: 'bad_signature' })
})

test('expired after 10 minutes', async () => {
  const t0 = Date.now()
  const state = (await issue({}, t0))!
  expect(await consumeOAuthState(fakeAdmin(), state, t0 + OAUTH_STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
})

test('user moved to another org or disabled → refused', async () => {
  const state = (await issue())!
  db.users[0].org_id = 'org-roofco'
  expect(await consumeOAuthState(fakeAdmin(), state)).toEqual({ ok: false, reason: 'wrong_user' })
  const off = (await issue({ userId: 'u-off' }))!
  expect(await consumeOAuthState(fakeAdmin(), off)).toEqual({ ok: false, reason: 'wrong_user' })
})

test('return host must be the org’s own address (not another company, not a stranger)', async () => {
  const other = (await issue({ returnHost: 'roofco.crm-product.test' }))!
  expect(await consumeOAuthState(fakeAdmin(), other)).toEqual({ ok: false, reason: 'wrong_host' })
  const stranger = (await issue({ returnHost: 'evil.example' }))!
  expect(await consumeOAuthState(fakeAdmin(), stranger)).toEqual({ ok: false, reason: 'wrong_host' })
  // Address changed after the connect started → refused rather than sent to a stale host.
  const s = (await issue())!
  db.orgs[0].subdomain = 'acme-new'
  expect(await consumeOAuthState(fakeAdmin(), s)).toEqual({ ok: false, reason: 'wrong_host' })
})

test('no key → no state is issued (caller refuses; never falls back to the cookie flow)', async () => {
  delete process.env.OAUTH_STATE_SECRET
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  expect(await issue()).toBeNull()
})

test('derived key from the service-role key when OAUTH_STATE_SECRET is unset', async () => {
  delete process.env.OAUTH_STATE_SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  const state = (await issue())!
  expect((await consumeOAuthState(fakeAdmin(), state)).ok).toBe(true)
})
