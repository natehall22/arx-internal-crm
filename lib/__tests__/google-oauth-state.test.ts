/** @jest-environment node */
/**
 * Google Calendar connect from a company address: the signed single-use state (lib/google-oauth-state.ts) and the
 * callback that trusts it instead of a cookie. Legacy (user-id state + cookie) stays as it was.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  OAUTH_STATE_TTL_MS,
  acceptOAuthCallback,
  discardOAuthTicket,
  finishOAuthConnect,
  isSignedOAuthState,
  issueOAuthState,
} from '@/lib/google-oauth-state'

type Row = Record<string, unknown>
const db: { oauth_states: Row[]; users: Row[]; orgs: Row[] } = { oauth_states: [], users: [], orgs: [] }

/** Tiny in-memory stand-in for the service client (insert / delete / update / select with eq-is-gt-lt filters). */
function fakeAdmin(): SupabaseClient {
  return {
    from(table: keyof typeof db) {
      const filters: Array<(r: Row) => boolean> = []
      let patch: Row | null = null
      let del = false
      const api = {
        insert: async (row: Row) => {
          db[table].push({ used_at: null, code_ciphertext: null, ...row })
          return { error: null }
        },
        delete() {
          del = true
          return api
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
        lt(col: string, v: string) {
          filters.push((r) => String(r[col]) < v)
          return api
        },
        maybeSingle: async () => ({ data: db[table].find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        then(resolve: (v: unknown) => void) {
          const rows = db[table].filter((r) => filters.every((f) => f(r)))
          if (del) db[table] = db[table].filter((r) => !rows.includes(r)) as Row[]
          if (patch) rows.forEach((r) => Object.assign(r, patch))
          resolve({ data: rows.map((r) => ({ ...r })), error: null })
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

const finish = (nonce: string, over: Partial<{ cookieNonce: string | null; userId: string; orgId: string }> = {}) =>
  finishOAuthConnect(fakeAdmin(), { nonce, cookieNonce: nonce, userId: 'u-1', orgId: 'org-acme', ...over })

test('happy path: ticket → callback parks the code sealed → finish in the starting browser returns it once', async () => {
  const t = (await issue())!
  expect(isSignedOAuthState(t.state)).toBe(true)
  expect(isSignedOAuthState('3f1c2a1e-0000-4000-8000-000000000000')).toBe(false)
  const cb = await acceptOAuthCallback(fakeAdmin(), t.state, 'google-code-123')
  expect(cb).toEqual({ ok: true, nonce: t.nonce, userId: 'u-1', orgId: 'org-acme', returnOrigin: 'https://acme.crm-product.test' })
  expect(JSON.stringify(db.oauth_states)).not.toContain('google-code-123') // sealed at rest
  expect(await finish(t.nonce)).toEqual({ ok: true, code: 'google-code-123' })
  expect(db.oauth_states[0].code_ciphertext).toBeNull() // spent code not kept
  expect(await finish(t.nonce)).toEqual({ ok: false, reason: 'used' })
})

test('ATTACK: a consent link started by someone else never attaches the clicker’s Google account', async () => {
  // Attacker (u-1) starts a connect and forwards the Google consent link; the victim (u-2, same company) consents.
  db.users.push({ id: 'u-2', org_id: 'org-acme', active: true })
  const t = (await issue())!
  expect((await acceptOAuthCallback(fakeAdmin(), t.state, 'victims-google-code')).ok).toBe(true)
  // Victim's browser lands on finish: signed in as u-2, and without the attacker's nonce cookie.
  expect(await finish(t.nonce, { cookieNonce: null, userId: 'u-2' })).toEqual({ ok: false, reason: 'no_cookie' })
  expect(db.oauth_states[0].code_ciphertext).toBeNull() // the victim's code is wiped, not left at rest
  // The ticket is burned: the attacker can't finish it afterwards either.
  expect(await finish(t.nonce)).toEqual({ ok: false, reason: 'used' })
})

test('finish refuses another signed-in user even with a (copied) cookie, and burns the ticket', async () => {
  db.users.push({ id: 'u-2', org_id: 'org-acme', active: true })
  const t = (await issue())!
  await acceptOAuthCallback(fakeAdmin(), t.state, 'code')
  expect(await finish(t.nonce, { userId: 'u-2' })).toEqual({ ok: false, reason: 'wrong_user' })
  expect(await finish(t.nonce)).toEqual({ ok: false, reason: 'used' })
})

test('finish before the callback, wrong nonce shape, or a second callback → refused', async () => {
  const t = (await issue())!
  expect(await finish('not-a-uuid')).toEqual({ ok: false, reason: 'used' })
  expect(await acceptOAuthCallback(fakeAdmin(), t.state, 'c1')).toMatchObject({ ok: true })
  expect(await acceptOAuthCallback(fakeAdmin(), t.state, 'c2')).toEqual({ ok: false, reason: 'used' })
  const t2 = (await issue())!
  expect(await finish(t2.nonce)).toEqual({ ok: false, reason: 'used' }) // no code parked yet
})

test('consent denied (no code) discards the ticket', async () => {
  const t = (await issue())!
  expect((await acceptOAuthCallback(fakeAdmin(), t.state, null)).ok).toBe(true)
  expect(await acceptOAuthCallback(fakeAdmin(), t.state, 'late')).toEqual({ ok: false, reason: 'used' })
})

test('tampered payload or MAC is refused', async () => {
  const { state } = (await issue())!
  const [body, mac] = state.split('.')
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: 'u-other' })).toString('base64url')
  expect(await acceptOAuthCallback(fakeAdmin(), `${evil}.${mac}`, 'c')).toEqual({ ok: false, reason: 'bad_signature' })
  expect(await acceptOAuthCallback(fakeAdmin(), `${body}.${mac[0] === 'x' ? 'y' : 'x'}${mac.slice(1)}`, 'c')).toEqual({ ok: false, reason: 'bad_signature' })
  expect(await acceptOAuthCallback(fakeAdmin(), `${body}.${mac}.extra`, 'c')).toEqual({ ok: false, reason: 'bad_signature' })
  process.env.OAUTH_STATE_SECRET = 'rotated'
  expect(await acceptOAuthCallback(fakeAdmin(), state, 'c')).toEqual({ ok: false, reason: 'bad_signature' })
})

test('expired after 10 minutes; expired rows are pruned on the next ticket', async () => {
  const t0 = Date.now()
  const old = (await issue({}, t0))!
  expect(await acceptOAuthCallback(fakeAdmin(), old.state, 'c', t0 + OAUTH_STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
  expect(db.oauth_states).toHaveLength(1)
  await issue({}, t0 + OAUTH_STATE_TTL_MS + 1)
  expect(db.oauth_states.map((r) => r.nonce)).not.toContain(old.nonce)
})

test('user moved to another org or disabled → refused', async () => {
  const { state } = (await issue())!
  db.users[0].org_id = 'org-roofco'
  expect(await acceptOAuthCallback(fakeAdmin(), state, 'c')).toEqual({ ok: false, reason: 'wrong_user' })
  const off = (await issue({ userId: 'u-off' }))!
  expect(await acceptOAuthCallback(fakeAdmin(), off.state, 'c')).toEqual({ ok: false, reason: 'wrong_user' })
})

test('return host must be the org’s own address (not another company, not a stranger)', async () => {
  const other = (await issue({ returnHost: 'roofco.crm-product.test' }))!
  expect(await acceptOAuthCallback(fakeAdmin(), other.state, 'c')).toEqual({ ok: false, reason: 'wrong_host' })
  const stranger = (await issue({ returnHost: 'evil.example' }))!
  expect(await acceptOAuthCallback(fakeAdmin(), stranger.state, 'c')).toEqual({ ok: false, reason: 'wrong_host' })
  const s = (await issue())!
  db.orgs[0].subdomain = 'acme-new'
  expect(await acceptOAuthCallback(fakeAdmin(), s.state, 'c')).toEqual({ ok: false, reason: 'wrong_host' })
})

test('no key → no ticket (caller refuses; never falls back to the cookie flow)', async () => {
  delete process.env.OAUTH_STATE_SECRET
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  expect(await issue()).toBeNull()
})

test('derived key from the service-role key when OAUTH_STATE_SECRET is unset', async () => {
  delete process.env.OAUTH_STATE_SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  const t = (await issue())!
  expect((await acceptOAuthCallback(fakeAdmin(), t.state, 'c')).ok).toBe(true)
  expect(await finish(t.nonce)).toEqual({ ok: true, code: 'c' })
})

test('discard burns an unused ticket and wipes its parked code', async () => {
  const t = (await issue())!
  await acceptOAuthCallback(fakeAdmin(), t.state, 'code')
  await discardOAuthTicket(fakeAdmin(), t.nonce)
  expect(db.oauth_states[0]).toMatchObject({ code_ciphertext: null })
  expect(db.oauth_states[0].used_at).toBeTruthy()
  expect(await finish(t.nonce)).toEqual({ ok: false, reason: 'used' })
})
