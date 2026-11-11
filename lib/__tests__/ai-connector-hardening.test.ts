/** @jest-environment node */
/** AI connector hardening (security review): rate limits by app/person, request pinning, consent single-use, grant lifetime, audit, contact scope. */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import AuthorizeConsent from '@/app/oauth/authorize/AuthorizeConsent'
import { authenticateMcpRequest } from '@/lib/ai-connector/authenticate'
import { guardedFetchMetadata, isPublicIp, pinnedLookup, resolvePublicAddress } from '@/lib/ai-connector/clients'
import { GRANT_MAX_LIFETIME_SECONDS, RATE_LIMITS } from '@/lib/ai-connector/config'
import { type EndpointDeps, handleConsent, handleRegister, handleToken, makeConsentTicket } from '@/lib/ai-connector/endpoints'
import { dbOnceGate, dbRateGate, resetOnceForTests, type RateGate } from '@/lib/ai-connector/rate-limit'
import { createAuthCode, exchangeCode, refreshTokens } from '@/lib/ai-connector/store'
import { ownCustomerIds } from '@/lib/ai-connector/tools/contact-scope'
import { mcpResource } from '@/lib/ai-connector/urls'
import type { CompanyFence } from '@/lib/company-host'
import { resetPublicEstimateRateLimitForTests } from '@/lib/public-estimate-rate-limit'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

const ORG = 'org-a'
const USER = 'user-1'
const ORIGIN = 'https://acme.crm.test'
const RESOURCE = mcpResource(ORIGIN)
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const OWNER_URI = 'https://assistant.owner.test/callback'
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0)
const DAY = 86_400_000

function world(settings: Record<string, unknown> = {}) {
  const db = createFakeDb({
    users: [{ id: USER, org_id: ORG, active: true, role: 'admin', email: 'u@a.test' }],
    ai_oauth_clients: [
      { client_id: 'aic_1', client_name: 'Claude', redirect_uris: [CLAUDE], kind: 'dcr', metadata_url: null, last_seen_at: new Date(T0).toISOString() },
      { client_id: 'aic_2', client_name: 'Claude', redirect_uris: [CLAUDE], kind: 'dcr', metadata_url: null, last_seen_at: new Date(T0).toISOString() },
      { client_id: 'aic_own', client_name: 'Owner app', redirect_uris: [OWNER_URI], kind: 'dcr', metadata_url: null, last_seen_at: new Date(T0).toISOString() },
    ],
    orgs: [{ id: ORG, settings }],
  })
  const fence: CompanyFence = { kind: 'org', orgId: ORG, source: 'host' }
  const deps: EndpointDeps = { admin: db.client as never, fence: async (): Promise<CompanyFence> => fence, featureOn: async () => true, now: T0 }
  return { db, admin: db.client as never, deps }
}
const form = (o: Record<string, string>, ip = '1.1.1.1') =>
  new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'acme.crm.test', 'x-forwarded-for': ip }, body: new URLSearchParams(o).toString() })
const json = (url: string, body: unknown, ip = '1.1.1.1') => new Request(`${ORIGIN}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'acme.crm.test', 'x-forwarded-for': ip }, body: JSON.stringify(body) })

beforeEach(() => {
  resetPublicEstimateRateLimitForTests()
  resetOnceForTests()
})

describe('rate limits count per app / person, not per shared address', () => {
  it('token: many different apps from one address all pass; one app past its limit is refused', async () => {
    const w = world()
    for (let i = 0; i < 40; i++) {
      const id = i % 2 ? 'aic_1' : 'aic_2'
      expect((await handleToken(form({ grant_type: 'x', client_id: id }, '9.9.9.9'), w.deps)).status).toBe(400)
    }
    let last = 0
    for (let i = 0; i < RATE_LIMITS.clientTokenPerMinute + 1; i++) last = (await handleToken(form({ grant_type: 'x', client_id: 'aic_1' }, '9.9.9.9'), w.deps)).status
    expect(last).toBe(429)
    // the other app on the same address is unaffected
    expect((await handleToken(form({ grant_type: 'x', client_id: 'aic_2' }, '9.9.9.9'), w.deps)).status).toBe(400)
  })
  it('the per-address key is only a loose backstop', async () => {
    const w = world()
    const seen: Array<[string, number]> = []
    const rate: RateGate = async (key, limit) => (seen.push([key, limit]), { ok: true })
    await handleToken(form({ grant_type: 'x', client_id: 'aic_1' }), { ...w.deps, rate })
    const ip = seen.find(([k]) => k.includes(':ip:'))
    expect(ip?.[1]).toBeGreaterThanOrEqual(600)
    expect(seen.some(([k]) => k === 'oauth:token:client:aic_1')).toBe(true)
  })
  it('the counters live in the database (rpc), with the memory counter only as a fallback', async () => {
    const calls: string[] = []
    const db = createFakeDb({}, { rpc: { ai_rate_hit: (a) => (calls.push(String(a.p_key)), [{ allowed: false, retry_after: 7 }]) } })
    const gate = dbRateGate(db.client as never)
    expect(await gate('k1', 5, 60)).toEqual({ ok: false, retryAfterSec: 7 })
    expect(calls).toEqual(['k1'])
    const down = dbRateGate(createFakeDb({}).client as never, T0)
    for (let i = 0; i < 3; i++) expect((await down('k2', 3, 60)).ok).toBe(true)
    expect((await down('k2', 3, 60)).ok).toBe(false)
  })
  it('register: capped per address per day and for everyone per day', async () => {
    const w = world()
    const hits: Record<string, number> = {}
    const rate: RateGate = async (key, limit) => ((hits[key] = (hits[key] ?? 0) + 1) > (key.includes('global') ? 2 : key.includes('ip-day') ? 3 : 100) ? { ok: false, retryAfterSec: 5 } : { ok: true })
    const reg = (ip: string) => handleRegister(json('/oauth/register', { redirect_uris: [CLAUDE], client_name: 'Claude' }, ip), { ...w.deps, rate })
    expect((await reg('2.2.2.2')).status).toBe(201)
    expect((await reg('2.2.2.2')).status).toBe(201)
    expect((await reg('2.2.2.2')).status).toBe(429)
    expect((await reg('3.3.3.3')).status).toBe(429)
  })
})

describe('pinned fetch of a client metadata document', () => {
  it('resolves once and refuses when ANY answer is private (rebinding by a mixed answer)', async () => {
    expect(await resolvePublicAddress('app.example.test', async () => [{ address: '8.8.8.8', family: 4 }])).toEqual({ address: '8.8.8.8', family: 4 })
    expect(await resolvePublicAddress('app.example.test', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])).toBeNull()
    expect(await resolvePublicAddress('app.example.test', async () => [])).toBeNull()
    for (const h of ['localhost', '127.0.0.1', 'intranet', 'x.internal', 'x.local']) expect(await resolvePublicAddress(h, async () => [{ address: '8.8.8.8', family: 4 }])).toBeNull()
  })
  it('the connection uses the checked address whatever DNS says later (no rebinding window)', async () => {
    let calls = 0
    const rebinding = async () => (++calls === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '169.254.169.254', family: 4 }])
    const pin = await resolvePublicAddress('app.example.test', rebinding)
    expect(pin).not.toBeNull()
    const look = pinnedLookup(pin as never)
    const got: unknown[] = []
    look('app.example.test', {}, (_e, a, f) => got.push([a, f]))
    look('app.example.test', { all: true }, (_e, a) => got.push(a))
    expect(got).toEqual([['8.8.8.8', 4], [{ address: '8.8.8.8', family: 4 }].map((x) => x)])
    expect(calls).toBe(1)
  })
  it('the real fetcher refuses a private answer without connecting, and non-443 / credentials / http', async () => {
    const priv = async () => [{ address: '10.1.2.3', family: 4 }]
    expect(await guardedFetchMetadata('https://app.example.test/x', priv)).toBeNull()
    expect(await guardedFetchMetadata('https://app.example.test:8443/x', priv)).toBeNull()
    expect(await guardedFetchMetadata('https://u:p@app.example.test/x', priv)).toBeNull()
    expect(await guardedFetchMetadata('http://app.example.test/x', priv)).toBeNull()
  })
  it('addresses that wrap an IPv4 address are refused', () => {
    for (const ip of ['::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '::127.0.0.1']) expect(isPublicIp(ip)).toBe(false)
  })
})

describe('consent screen', () => {
  const html = (p: Partial<React.ComponentProps<typeof AuthorizeConsent>>) => renderToStaticMarkup(React.createElement(AuthorizeConsent, { ticket: 't', companyName: 'Acme Roofing', appLabel: null, claimedName: null, returnHost: 'x.test', ...p }))
  it('shows the "only continue if you started this" warning, the app name and the return host for EVERY app, Claude and ChatGPT included', () => {
    for (const p of [{ appLabel: 'Claude', claimedName: 'Claude', returnHost: 'claude.ai' }, { appLabel: 'ChatGPT', claimedName: 'Totally Official', returnHost: 'chatgpt.com' }, { appLabel: null, claimedName: 'Mystery', returnHost: 'evil.test' }]) {
      const out = html(p)
      expect(out).toContain('Only continue if you started this yourself')
      expect(out).toContain(p.returnHost)
      expect(out).toContain(p.appLabel ?? 'Mystery')
    }
    expect(html({ appLabel: 'ChatGPT', claimedName: 'Totally Official', returnHost: 'chatgpt.com' })).toContain('Totally Official')
  })
})

describe('owner-added redirect addresses are honoured at token time', () => {
  const CID = 'https://app.owner.test/client.json'
  it('an app (metadata document) whose callback the owner added finishes sign-in; without the owner setting it is refused', async () => {
    for (const [settings, status] of [[{ aiConnector: { redirectUris: [OWNER_URI] } }, 200], [{}, 401]] as const) {
      const w = world(settings as never)
      w.db.tables.ai_oauth_clients.push({ client_id: CID, client_name: 'Owner app', redirect_uris: [OWNER_URI], kind: 'cimd', metadata_url: CID, last_seen_at: new Date(0).toISOString() })
      const code = await createAuthCode(w.admin, { clientId: CID, orgId: ORG, userId: USER, redirectUri: OWNER_URI, codeChallenge: CHALLENGE, resource: RESOURCE, scopes: ['crm:read'] }, T0)
      const fetcher = async () => ({ status: 200, body: JSON.stringify({ client_id: CID, client_name: 'Owner app', redirect_uris: [OWNER_URI] }) })
      const res = await handleToken(form({ grant_type: 'authorization_code', code, client_id: CID, redirect_uri: OWNER_URI, code_verifier: VERIFIER }), { ...w.deps, fetcher })
      expect(res.status).toBe(status)
    }
  })
})

describe('consent approval is single-use', () => {
  const raw = { response_type: 'code', client_id: 'aic_1', redirect_uri: CLAUDE, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's1', resource: RESOURCE }
  const post = (ticket: string) => json('/api/oauth/consent', { ticket, decision: 'allow' })
  it('one approval mints one code, however many times it is sent', async () => {
    const w = world()
    const ticket = makeConsentTicket(raw, USER, T0)
    expect((await handleConsent(post(ticket), w.deps, { userId: USER, orgId: ORG })).status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await handleConsent(post(ticket), w.deps, { userId: USER, orgId: ORG })).status).toBe(400)
    expect(w.db.tables.ai_oauth_codes).toHaveLength(1)
    // a fresh approval works
    expect((await handleConsent(post(makeConsentTicket(raw, USER, T0)), w.deps, { userId: USER, orgId: ORG })).status).toBe(200)
    expect(w.db.tables.ai_oauth_codes).toHaveLength(2)
  })
  it('the database claim is used when present: first caller wins, the rest lose', async () => {
    const seen = new Set<string>()
    const db = createFakeDb({}, { rpc: { ai_claim_once: (a) => (seen.has(String(a.p_key)) ? false : (seen.add(String(a.p_key)), true)) } })
    const once = dbOnceGate(db.client as never)
    expect([await once('k', 60), await once('k', 60)]).toEqual([true, false])
  })
})

describe('a connection ends 90 days after approval, however often it refreshes', () => {
  async function grant() {
    const w = world()
    const code = await createAuthCode(w.admin, { clientId: 'aic_1', orgId: ORG, userId: USER, redirectUri: CLAUDE, codeChallenge: CHALLENGE, resource: RESOURCE, scopes: ['crm:read'] }, T0)
    const r = await exchangeCode(w.admin, { code, clientId: 'aic_1', redirectUri: CLAUDE, codeVerifier: VERIFIER, resource: null }, T0)
    if (!r.ok) throw new Error('setup')
    return { w, tokens: r.tokens }
  }
  it('refreshing every 29 days works until day 90, then the connection is refused', async () => {
    const { w, tokens } = await grant()
    let refresh = tokens.refresh_token
    let t = T0
    for (let i = 0; i < 3; i++) {
      t += 29 * DAY
      const r = await refreshTokens(w.admin, { refreshToken: refresh, clientId: 'aic_1', resource: null }, t)
      expect(r.ok).toBe(true)
      if (r.ok) refresh = r.tokens.refresh_token
    }
    // day 87: the new keys are capped at the absolute end (day 90)
    const g = w.db.tables.ai_oauth_grants[0]
    expect(new Date(g.refresh_expires_at as string).getTime()).toBeLessThanOrEqual(T0 + GRANT_MAX_LIFETIME_SECONDS * 1000)
    const late = await refreshTokens(w.admin, { refreshToken: refresh, clientId: 'aic_1', resource: null }, T0 + GRANT_MAX_LIFETIME_SECONDS * 1000 + 1000)
    expect(late).toMatchObject({ ok: false, error: 'invalid_grant' })
  })
  it('the access key stops working at the absolute end too', async () => {
    const { w, tokens } = await grant()
    const req = new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { host: 'acme.crm.test', authorization: `Bearer ${tokens.access_token}` } })
    const deps = (now: number) => ({ admin: w.admin, fence: async (): Promise<CompanyFence> => ({ kind: 'org', orgId: ORG, source: 'host' }), featureOn: async () => true, now })
    expect((await authenticateMcpRequest(req, deps(T0 + 1000))).ok).toBe(true)
    w.db.tables.ai_oauth_grants[0].access_expires_at = new Date(T0 + 200 * DAY).toISOString()
    expect((await authenticateMcpRequest(req, deps(T0 + GRANT_MAX_LIFETIME_SECONDS * 1000 + 1000))).ok).toBe(false)
  })
})

describe('the audit log records sign-in events and refused calls', () => {
  const tools = (w: ReturnType<typeof world>) => w.db.tables.ai_audit_log.map((r) => r.tool)
  it('token issue, refresh, reuse revocation, and a refused call by a known connection', async () => {
    const w = world()
    const code = await createAuthCode(w.admin, { clientId: 'aic_1', orgId: ORG, userId: USER, redirectUri: CLAUDE, codeChallenge: CHALLENGE, resource: RESOURCE, scopes: ['crm:read'] }, T0)
    const res = await handleToken(form({ grant_type: 'authorization_code', code, client_id: 'aic_1', redirect_uri: CLAUDE, code_verifier: VERIFIER }), w.deps)
    const t1 = (await res.json()) as { access_token: string; refresh_token: string }
    expect(tools(w)).toContain('oauth.token_issued')
    const r2 = await handleToken(form({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: 'aic_1' }), w.deps)
    expect(r2.status).toBe(200)
    const t2 = (await r2.json()) as { access_token: string; refresh_token: string }
    expect(tools(w)).toContain('oauth.refresh')
    // the old refresh key again = leaked copy
    const reuse = await handleToken(form({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: 'aic_1' }), w.deps)
    expect(reuse.status).toBe(400)
    expect(tools(w)).toContain('oauth.refresh_refused')
    expect(w.db.tables.ai_oauth_grants[0].revoked_reason).toBe('refresh_reuse')
    // a refused call by the (now revoked) connection
    const call = await authenticateMcpRequest(new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { host: 'acme.crm.test', authorization: `Bearer ${t2.access_token}` } }), { admin: w.admin, fence: w.deps.fence, featureOn: async () => true, now: T0 + 5000 })
    expect(call.ok).toBe(false)
    expect(w.db.tables.ai_audit_log.find((r) => r.tool === 'mcp.auth_refused')).toMatchObject({ result: 'denied', detail: 'revoked', user_id: USER })
    // no secrets in the log
    expect(JSON.stringify(w.db.tables.ai_audit_log)).not.toContain(t1.access_token)
    expect(JSON.stringify(w.db.tables.ai_audit_log)).not.toContain(t1.refresh_token)
    expect(JSON.stringify(w.db.tables.ai_audit_log)).not.toContain(t2.access_token)
  })
})

describe('setters and canvassers: customers that are not their own work stay hidden', () => {
  function ctxFor(role: string, mine: string[]) {
    const db = createFakeDb(
      {
        users: [{ id: USER, org_id: ORG, role, active: true }],
        leads: [
          { id: 'lead-1', org_id: ORG, customer_id: 'cust-mine' },
          { id: 'lead-2', org_id: ORG, customer_id: 'cust-other' },
          { id: 'lead-x', org_id: 'org-b', customer_id: 'cust-mine' },
        ],
      },
      { rpc: { my_lead_ids: (a) => (a.p_ids as string[]).filter((i) => mine.includes(i)) } }
    )
    return { admin: db.client as never, profile: db.tables.users[0] as never, userId: USER, orgId: ORG }
  }
  it('a setter keeps only customers with a lead of their own', async () => {
    const own = await ownCustomerIds(ctxFor('setter', ['lead-1']), ['cust-mine', 'cust-other', 'cust-none'])
    expect(Array.from(own ?? [])).toEqual(['cust-mine'])
  })
  it('a canvasser with no leads of their own gets nothing', async () => {
    expect(Array.from((await ownCustomerIds(ctxFor('canvasser', []), ['cust-mine', 'cust-other'])) ?? ['x'])).toEqual([])
  })
  it('an admin is not limited (null = no scope)', async () => {
    expect(await ownCustomerIds(ctxFor('admin', []), ['cust-mine'])).toBeNull()
  })
})
