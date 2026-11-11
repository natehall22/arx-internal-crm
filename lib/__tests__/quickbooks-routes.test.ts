/** @jest-environment node */
/** QuickBooks connect routes: owner-only, cross-site writes refused, the finish step only for the starting owner/browser. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { NextRequest } from 'next/server'

const ORG = 'org-acme'
let fake: ReturnType<typeof createFakeDb>
let mockProfile: Record<string, unknown> | null
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => fake.client }))
jest.mock('@/lib/auth', () => ({
  CompanyLookupUnavailableError: class extends Error {},
  profileAllowedOnThisDeployment: () => true,
  requireAuthApi: async () => {
    if (!mockProfile) throw new Error('no session')
    return { authUser: { id: mockProfile.id }, profile: mockProfile }
  },
}))
jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: async () => false }))

import { GET as adminGET, POST as adminPOST } from '@/app/api/admin/quickbooks/route'
import { GET as callbackGET } from '@/app/api/integrations/quickbooks/callback/route'
import { GET as finishGET } from '@/app/api/integrations/quickbooks/finish/route'
import { GET as cronGET } from '@/app/api/cron/quickbooks/route'
import { issueOAuthState, acceptOAuthCallback } from '@/lib/google-oauth-state'
import { packCallback } from '@/lib/quickbooks/connect-flow'

const env = ['SECRETS_ENCRYPTION_KEY', 'INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET', 'INTUIT_REDIRECT_URI', 'INTUIT_ENVIRONMENT', 'OAUTH_STATE_SECRET', 'CRON_SECRET', 'APP_BASE_DOMAIN'] as const
const saved: Record<string, string | undefined> = {}
const owner = { id: 'u-owner', org_id: ORG, is_super_admin: true, active: true, role: 'admin' }
const office = { id: 'u-office', org_id: ORG, is_super_admin: false, active: true, role: 'admin' }

beforeEach(() => {
  for (const k of env) saved[k] = process.env[k]
  Object.assign(process.env, { SECRETS_ENCRYPTION_KEY: 'k'.repeat(40), INTUIT_CLIENT_ID: 'cid', INTUIT_CLIENT_SECRET: 'sec', INTUIT_REDIRECT_URI: 'https://app.test/api/integrations/quickbooks/callback', INTUIT_ENVIRONMENT: 'sandbox', OAUTH_STATE_SECRET: 'state-secret', CRON_SECRET: 'cron' })
  delete process.env.APP_BASE_DOMAIN
  fake = createFakeDb({
    orgs: [{ id: ORG, subdomain: null, settings: { features: { quickbooks: true } } }],
    users: [{ id: 'u-owner', org_id: ORG, active: true }, { id: 'u-office', org_id: ORG, active: true }],
    oauth_states: [], qb_connections: [], qb_links: [],
  })
  mockProfile = owner
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of env) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  jest.restoreAllMocks()
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/admin/quickbooks', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, body: JSON.stringify(body) })

describe('/api/admin/quickbooks', () => {
  it('signed out 401; non-owner 403 on GET and POST', async () => {
    mockProfile = null
    expect((await adminGET()).status).toBe(401)
    mockProfile = office
    expect((await adminGET()).status).toBe(403)
    expect((await adminPOST(post({ action: 'connect' }))).status).toBe(403)
    expect(fake.tables.oauth_states).toHaveLength(0)
  })
  it('a cross-site POST is refused before anything happens', async () => {
    const res = await adminPOST(post({ action: 'connect' }, { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' }))
    expect(res.status).toBe(403)
    expect(fake.tables.oauth_states).toHaveLength(0)
  })
  it('GET never returns a token', async () => {
    const res = await adminGET()
    const text = JSON.stringify(await res.json())
    expect(text).toContain('"status":"not_connected"')
    expect(text).not.toMatch(/token|_ct/i)
  })
  it('connect: switch off → 409; not configured → 503; ok → Intuit URL with the signed ticket + httpOnly cookie', async () => {
    fake.tables.orgs[0].settings = { features: { quickbooks: false } }
    expect((await adminPOST(post({ action: 'connect' }))).status).toBe(409)
    fake.tables.orgs[0].settings = { features: { quickbooks: true } }
    delete process.env.SECRETS_ENCRYPTION_KEY
    expect((await adminPOST(post({ action: 'connect' }))).status).toBe(503)
    process.env.SECRETS_ENCRYPTION_KEY = 'k'.repeat(40)
    const res = await adminPOST(post({ action: 'connect' }))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    const u = new URL(url)
    expect(u.host).toBe('appcenter.intuit.com')
    expect(u.searchParams.get('state')).toContain('.')
    expect(fake.tables.oauth_states).toHaveLength(1)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('qb_connect_nonce=')
    expect(cookie.toLowerCase()).toContain('httponly')
  })
  it('unknown action 400', async () => {
    expect((await adminPOST(post({ action: 'nope' }))).status).toBe(400)
  })
})

describe('callback + finish', () => {
  async function ticket() {
    return (await issueOAuthState(fake.client as never, { userId: 'u-owner', orgId: ORG, returnHost: 'app.test', purpose: 'quickbooks' }))!
  }
  const cb = (q: Record<string, string>) => new NextRequest(`https://app.test/api/integrations/quickbooks/callback?${new URLSearchParams(q)}`)
  const fin = (nonce: string, cookie?: string) => new NextRequest(`https://app.test/api/integrations/quickbooks/finish?nonce=${nonce}`, { headers: cookie ? { cookie: `qb_connect_nonce=${cookie}` } : {} })

  it('callback: no / unsigned / Google-purpose state is refused without parking anything', async () => {
    expect((await callbackGET(cb({ code: 'c', realmId: '1234' }))).headers.get('location')).toContain('quickbooks=invalid_state')
    expect((await callbackGET(cb({ code: 'c', realmId: '1234', state: 'plain' }))).headers.get('location')).toContain('quickbooks=invalid_state')
    const g = (await issueOAuthState(fake.client as never, { userId: 'u-owner', orgId: ORG, returnHost: 'app.test' }))!
    expect((await callbackGET(cb({ code: 'c', realmId: '1234', state: g.state }))).headers.get('location')).toContain('quickbooks=invalid_state')
    expect(fake.tables.oauth_states.every((r) => !r.code_ciphertext)).toBe(true)
  })
  it('callback with a good ticket parks the code sealed and hands off to finish on the same host', async () => {
    const t = await ticket()
    const res = await callbackGET(cb({ code: 'secret-code', realmId: '9130', state: t.state }))
    expect(res.headers.get('location')).toBe(`https://app.test/api/integrations/quickbooks/finish?nonce=${t.nonce}`)
    expect(JSON.stringify(fake.tables.oauth_states)).not.toContain('secret-code')
  })
  it('callback: a legacy-host connect for a company that has its own address says so in plain words', async () => {
    fake.tables.orgs[0].subdomain = 'acme'
    process.env.APP_BASE_DOMAIN = 'crm-product.test'
    const t = await ticket()
    const res = await callbackGET(cb({ code: 'c', realmId: '1234', state: t.state }))
    expect(res.headers.get('location')).toContain('quickbooks=use_company_address')
  })
  it('callback: consent denied burns the ticket', async () => {
    const t = await ticket()
    const res = await callbackGET(cb({ error: 'access_denied', state: t.state }))
    expect(res.headers.get('location')).toContain('quickbooks=denied')
    expect(fake.tables.oauth_states[0].used_at).toBeTruthy()
  })
  async function parked() {
    const t = await ticket()
    await acceptOAuthCallback(fake.client as never, t.state, packCallback('code-1', '9130'), Date.now(), { purpose: 'quickbooks', sameOrigin: 'https://app.test' })
    return t
  }
  it('finish: a non-owner (even the starting user’s cookie) is refused and the ticket is burned', async () => {
    const t = await parked()
    mockProfile = office
    const res = await finishGET(fin(t.nonce, t.nonce))
    expect(res.headers.get('location')).toContain('quickbooks=owner_only')
    expect(fake.tables.oauth_states[0].code_ciphertext).toBeNull()
    expect(fake.tables.qb_connections).toHaveLength(0)
  })
  it('finish: no cookie (a forwarded link) or signed out stores nothing and burns the ticket', async () => {
    const t = await parked()
    expect((await finishGET(fin(t.nonce))).headers.get('location')).toContain('quickbooks=invalid_state')
    expect(fake.tables.qb_connections).toHaveLength(0)
    const t2 = await parked()
    mockProfile = null
    expect((await finishGET(fin(t2.nonce, t2.nonce))).headers.get('location')).toContain('quickbooks=invalid_state')
    expect(fake.tables.oauth_states.every((r) => !r.code_ciphertext)).toBe(true)
  })
  it('finish: the starting owner in the starting browser connects once; replay stores nothing more', async () => {
    const t = await parked()
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/tokens/bearer')) return { status: 200, ok: true, json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600, x_refresh_token_expires_in: 8_640_000 }) }
      return { status: 200, ok: true, json: async () => ({ CompanyInfo: { CompanyName: 'Sample Lawn Care' } }) }
    }) as never
    const res = await finishGET(fin(t.nonce, t.nonce))
    expect(res.headers.get('location')).toContain('quickbooks=connected')
    expect(fake.tables.qb_connections).toHaveLength(1)
    expect(fake.tables.qb_connections[0]).toMatchObject({ org_id: ORG, realm_id: '9130', company_name: 'Sample Lawn Care', status: 'connected' })
    expect(JSON.stringify(fake.tables.qb_connections[0])).not.toMatch(/"A"|"R"/)
    const again = await finishGET(fin(t.nonce, t.nonce))
    expect(again.headers.get('location')).toContain('quickbooks=invalid_state')
  })
  it('finish: Intuit refusing the token for that company revokes it and stores nothing', async () => {
    const t = await parked()
    const calls: string[] = []
    global.fetch = jest.fn(async (url: string) => {
      calls.push(String(url))
      if (String(url).includes('/tokens/bearer')) return { status: 200, ok: true, json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }) }
      if (String(url).includes('/revoke')) return { status: 200, ok: true, json: async () => ({}) }
      return { status: 403, ok: false, json: async () => ({}) }
    }) as never
    const res = await finishGET(fin(t.nonce, t.nonce))
    expect(res.headers.get('location')).toContain('quickbooks=intuit_refused')
    expect(calls.some((c) => c.includes('/revoke'))).toBe(true)
    expect(fake.tables.qb_connections).toHaveLength(0)
  })
})

describe('/api/cron/quickbooks', () => {
  it('needs the cron secret', async () => {
    expect((await cronGET(new Request('https://app.test/api/cron/quickbooks'))).status).toBe(401)
    expect((await cronGET(new Request('https://app.test/api/cron/quickbooks', { headers: { authorization: 'Bearer cron' } }))).status).toBe(200)
  })
})
