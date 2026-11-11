/** @jest-environment node */
/** AI connector: sign-in server (PKCE, audience, one-time codes, rotating refresh keys with reuse detection, revocation). */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { pkceChallenge, sha256Hex, signConsentTicket, verifyConsentTicket, verifyPkce } from '@/lib/ai-connector/crypto'
import { createAuthCode, exchangeCode, refreshTokens, revokeGrant, revokeByToken } from '@/lib/ai-connector/store'
import { type EndpointDeps, handleRegister, handleRevoke, handleToken, handleConsent, makeConsentTicket } from '@/lib/ai-connector/endpoints'
import { checkAuthorizeRequest } from '@/lib/ai-connector/authorize'
import { fetchClientMetadata, isAllowedRedirectUri, isPublicIp, validateRegistration } from '@/lib/ai-connector/clients'
import { authorizationServerMetadata, protectedResourceMetadata } from '@/lib/ai-connector/metadata'
import { mcpResource } from '@/lib/ai-connector/urls'
import { resetPublicEstimateRateLimitForTests } from '@/lib/public-estimate-rate-limit'
import type { CompanyFence } from '@/lib/company-host'

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

const ORG = 'org-a'
const USER = 'user-1'
const ORIGIN = 'https://acme.crm.test'
const RESOURCE = mcpResource(ORIGIN)
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0)

function world(over: { userActive?: boolean } = {}) {
  const db = createFakeDb({
    users: [{ id: USER, org_id: ORG, active: over.userActive ?? true, role: 'admin' }],
    ai_oauth_clients: [{ client_id: 'aic_1', client_name: 'Claude', redirect_uris: [CLAUDE], kind: 'dcr', metadata_url: null, last_seen_at: new Date(T0).toISOString() }],
    orgs: [{ id: ORG, settings: {} }],
  })
  const fence: CompanyFence = { kind: 'org', orgId: ORG, source: 'host' }
  const deps: EndpointDeps = { admin: db.client as never, fence: async (): Promise<CompanyFence> => fence, featureOn: async () => true, now: T0 }
  return { db, admin: db.client as never, deps }
}

const form = (o: Record<string, string>) =>
  new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'acme.crm.test' }, body: new URLSearchParams(o).toString() })

async function issueCode(w: ReturnType<typeof world>, over: Partial<{ resource: string; scopes: string[] }> = {}) {
  return createAuthCode(w.admin, { clientId: 'aic_1', orgId: ORG, userId: USER, redirectUri: CLAUDE, codeChallenge: CHALLENGE, resource: over.resource ?? RESOURCE, scopes: over.scopes ?? ['crm:read'] }, T0)
}
const exchange = (w: ReturnType<typeof world>, code: string, o: Partial<{ verifier: string; redirect: string; client: string; resource: string | null; now: number }> = {}) =>
  exchangeCode(w.admin, { code, clientId: o.client ?? 'aic_1', redirectUri: o.redirect ?? CLAUDE, codeVerifier: o.verifier ?? VERIFIER, resource: o.resource === undefined ? RESOURCE : o.resource }, o.now ?? T0 + 1000)

beforeEach(() => resetPublicEstimateRateLimitForTests())

describe('PKCE + consent tickets', () => {
  it('matches the RFC 7636 example and rejects a wrong or malformed verifier', () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE)
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
    expect(verifyPkce('x'.repeat(43), CHALLENGE)).toBe(false)
    expect(verifyPkce('short', CHALLENGE)).toBe(false)
    expect(verifyPkce(undefined, CHALLENGE)).toBe(false)
  })
  it('a consent ticket is bound to the person, expires and cannot be edited', () => {
    const t = signConsentTicket({ a: '1' }, 'u1', T0 + 1000)
    expect(verifyConsentTicket(t, 'u1', T0)).toEqual({ a: '1' })
    expect(verifyConsentTicket(t, 'u2', T0)).toBeNull()
    expect(verifyConsentTicket(t, 'u1', T0 + 2000)).toBeNull()
    const [b, s] = t.split('.')
    expect(verifyConsentTicket(`${b}x.${s}`, 'u1', T0)).toBeNull()
  })
})

describe('authorization code exchange', () => {
  it('issues opaque keys, stores only hashes, and binds the grant to person, company, app and address', async () => {
    const w = world()
    const code = await issueCode(w)
    const r = await exchange(w, code)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens.access_token.startsWith('aat_')).toBe(true)
    expect(r.tokens.refresh_token.startsWith('art_')).toBe(true)
    expect(r.tokens.expires_in).toBe(3600)
    const grant = w.db.tables.ai_oauth_grants[0]
    expect(grant).toMatchObject({ org_id: ORG, user_id: USER, client_id: 'aic_1', resource: RESOURCE, scopes: ['crm:read'] })
    expect(grant.access_hash).toBe(sha256Hex(r.tokens.access_token))
    expect(JSON.stringify(w.db.tables)).not.toContain(r.tokens.access_token)
    expect(JSON.stringify(w.db.tables)).not.toContain(r.tokens.refresh_token)
    expect(JSON.stringify(w.db.tables)).not.toContain(code)
  })
  it('refuses a wrong verifier, redirect, app, audience, an expired code', async () => {
    for (const bad of [{ verifier: 'y'.repeat(43) }, { redirect: 'https://evil.test/cb' }, { client: 'aic_2' }, { resource: 'https://other.crm.test/mcp' }, { now: T0 + 11 * 60_000 }]) {
      const w = world()
      const r = await exchange(w, await issueCode(w), bad)
      expect(r.ok).toBe(false)
      expect(w.db.tables.ai_oauth_grants ?? []).toHaveLength(0)
    }
  })
  it('a code works once; showing it again revokes what it made', async () => {
    const w = world()
    const code = await issueCode(w)
    expect((await exchange(w, code)).ok).toBe(true)
    const again = await exchange(w, code)
    expect(again).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(w.db.tables.ai_oauth_grants[0].revoked_at).toBeTruthy()
  })
  it('an unknown code is refused', async () => {
    const w = world()
    expect(await exchange(w, 'aac_nope')).toMatchObject({ ok: false, error: 'invalid_grant' })
  })
})

describe('refresh keys', () => {
  async function granted(w: ReturnType<typeof world>) {
    const r = await exchange(w, await issueCode(w))
    if (!r.ok) throw new Error('setup')
    return r.tokens
  }
  it('rotates: a new pair, and the old refresh key is dead', async () => {
    const w = world()
    const t = await granted(w)
    const r = await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_1', resource: RESOURCE }, T0 + 5000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens.refresh_token).not.toBe(t.refresh_token)
    expect(w.db.tables.ai_oauth_grants[0].access_hash).toBe(sha256Hex(r.tokens.access_token))
  })
  it('reuse of an old refresh key revokes the whole grant, including the newest key', async () => {
    const w = world()
    const t = await granted(w)
    const r1 = await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_1', resource: null }, T0 + 5000)
    if (!r1.ok) throw new Error('setup')
    expect(await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_1', resource: null }, T0 + 6000)).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(w.db.tables.ai_oauth_grants[0].revoked_reason).toBe('refresh_reuse')
    expect(await refreshTokens(w.admin, { refreshToken: r1.tokens.refresh_token, clientId: 'aic_1', resource: null }, T0 + 7000)).toMatchObject({ ok: false })
  })
  it('refuses another app, another audience, a revoked grant, an expired key', async () => {
    const w = world()
    const t = await granted(w)
    expect(await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_9', resource: null }, T0 + 1)).toMatchObject({ ok: false })
    expect(await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_1', resource: 'https://x.test/mcp' }, T0 + 1)).toMatchObject({ ok: false, error: 'invalid_target' })
    expect(await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_1', resource: null }, T0 + 31 * 86_400_000)).toMatchObject({ ok: false })
    await revokeGrant(w.admin, ORG, w.db.tables.ai_oauth_grants[0].id as string, 'test', T0 + 2)
    expect(await refreshTokens(w.admin, { refreshToken: t.refresh_token, clientId: 'aic_1', resource: null }, T0 + 3)).toMatchObject({ ok: false })
  })
  it('only the app a key was issued to can revoke it', async () => {
    const w = world()
    const t = await granted(w)
    await revokeByToken(w.admin, t.access_token, 'aic_other', T0 + 1)
    expect(w.db.tables.ai_oauth_grants[0].revoked_at ?? null).toBeNull()
    await revokeByToken(w.admin, t.access_token, 'aic_1', T0 + 2)
    expect(w.db.tables.ai_oauth_grants[0].revoked_at).toBeTruthy()
  })
})

describe('token endpoint', () => {
  async function code(w: ReturnType<typeof world>) {
    return issueCode(w)
  }
  it('issues tokens for a good code and answers no-store JSON', async () => {
    const w = world()
    const res = await handleToken(form({ grant_type: 'authorization_code', code: await code(w), client_id: 'aic_1', redirect_uri: CLAUDE, code_verifier: VERIFIER, resource: RESOURCE }), w.deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).token_type).toBe('Bearer')
  })
  it('refuses a resource that is not this address', async () => {
    const w = world()
    const res = await handleToken(form({ grant_type: 'authorization_code', code: await code(w), client_id: 'aic_1', redirect_uri: CLAUDE, code_verifier: VERIFIER, resource: 'https://other.crm.test/mcp' }), w.deps)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_target')
  })
  it('an unknown app is invalid_client; an unknown grant type is refused', async () => {
    const w = world()
    expect((await handleToken(form({ grant_type: 'authorization_code', client_id: 'nope' }), w.deps)).status).toBe(401)
    expect((await handleToken(form({ grant_type: 'password', client_id: 'aic_1' }), w.deps)).status).toBe(400)
  })
  it('a person turned off, another company address, or a switched-off company get no tokens and the grant is revoked', async () => {
    for (const mk of [
      () => ({ ...world({ userActive: false }) }),
      () => {
        const w = world()
        return { ...w, deps: { ...w.deps, fence: async () => ({ kind: 'org', orgId: 'org-b', source: 'host' }) as CompanyFence } }
      },
      () => {
        const w = world()
        return { ...w, deps: { ...w.deps, featureOn: async () => false } }
      },
    ]) {
      const w = mk()
      const res = await handleToken(form({ grant_type: 'authorization_code', code: await code(w), client_id: 'aic_1', redirect_uri: CLAUDE, code_verifier: VERIFIER }), w.deps)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_grant')
      expect(w.db.tables.ai_oauth_grants[0].revoked_reason).toBe('principal_unusable')
    }
  })
  it('rate limits by app (the hardening test covers shared addresses)', async () => {
    const w = world()
    let last = 200
    for (let i = 0; i < 121; i++) last = (await handleToken(form({ grant_type: 'x', client_id: 'aic_1' }), { ...w.deps, now: T0 })).status
    expect(last).toBe(429)
  })
  it('revoke always answers 200', async () => {
    const w = world()
    expect((await handleRevoke(form({ token: 'whatever', client_id: 'aic_1' }), w.deps)).status).toBe(200)
  })
})

describe('authorize request rules', () => {
  const good = { response_type: 'code', client_id: 'aic_1', redirect_uri: CLAUDE, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz', resource: RESOURCE }
  const run = (w: ReturnType<typeof world>, sp: Record<string, string>) => checkAuthorizeRequest(w.admin, sp, { issuer: ORIGIN, resource: RESOURCE, orgId: ORG })
  it('accepts a good request and defaults the scope to read-only', async () => {
    const r = await run(world(), good)
    expect(r).toMatchObject({ ok: true, scopes: ['crm:read'], resource: RESOURCE })
  })
  it('never redirects for an unknown app or a redirect address that is not registered / allowed', async () => {
    const w = world()
    expect(await run(w, { ...good, client_id: 'nope' })).toMatchObject({ ok: false, fatal: expect.any(String) })
    expect(await run(w, { ...good, redirect_uri: 'https://evil.test/cb' })).toMatchObject({ ok: false, fatal: expect.any(String) })
    expect(await run(w, { ...good, redirect_uri: `${CLAUDE}/` })).toMatchObject({ ok: false, fatal: expect.any(String) })
    expect(await run(w, { ...good, redirect_uri: `${CLAUDE}?x=1` })).toMatchObject({ ok: false, fatal: expect.any(String) })
  })
  it('PKCE S256 is required; a wrong audience goes back to the app as invalid_target with iss', async () => {
    const w = world()
    const noPkce = await run(w, { ...good, code_challenge: '' })
    expect(noPkce).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(await run(w, { ...good, code_challenge_method: 'plain' })).toMatchObject({ ok: false, error: 'invalid_request' })
    const wrong = await run(w, { ...good, resource: 'https://other.crm.test/mcp' })
    expect(wrong).toMatchObject({ ok: false, error: 'invalid_target' })
    if (!wrong.ok && 'redirectTo' in wrong) {
      const u = new URL(wrong.redirectTo)
      expect(u.searchParams.get('iss')).toBe(ORIGIN)
      expect(u.searchParams.get('state')).toBe('xyz')
    }
  })
})

describe('registration + redirect allow-list', () => {
  it('allows the verified Claude and ChatGPT callbacks only (exact), and what an owner adds', () => {
    expect(isAllowedRedirectUri(CLAUDE)).toBe(true)
    expect(isAllowedRedirectUri('https://claude.com/api/mcp/auth_callback')).toBe(true)
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true)
    expect(isAllowedRedirectUri('https://chatgpt.com/connector/oauth/abc_123')).toBe(true)
    expect(isAllowedRedirectUri('https://chatgpt.com.evil.test/connector/oauth/abc')).toBe(false)
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback.evil')).toBe(false)
    expect(isAllowedRedirectUri('http://localhost:8080/cb')).toBe(false)
    expect(isAllowedRedirectUri('http://localhost:8080/cb', ['http://localhost:8080/cb'])).toBe(true)
  })
  it('validateRegistration refuses other addresses, odd grants and gives clean names', () => {
    expect(validateRegistration({ redirect_uris: ['https://evil.test/cb'] }, [])).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateRegistration({ redirect_uris: [] }, [])).toMatchObject({ ok: false })
    expect(validateRegistration({ redirect_uris: [CLAUDE], grant_types: ['password'] }, [])).toMatchObject({ ok: false, error: 'invalid_client_metadata' })
    const ok = validateRegistration({ redirect_uris: [CLAUDE], client_name: '<b>Claude</b>' }, [])
    expect(ok).toMatchObject({ ok: true, value: { client_name: 'bClaude/b' } })
  })
  it('POST /oauth/register stores the app and answers 201; off company → 403', async () => {
    const w = world()
    const req = () => new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CLAUDE], client_name: 'Claude' }) })
    const res = await handleRegister(req(), w.deps)
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.token_endpoint_auth_method).toBe('none')
    expect(w.db.tables.ai_oauth_clients.some((c) => c.client_id === j.client_id)).toBe(true)
    expect((await handleRegister(req(), { ...w.deps, featureOn: async () => false })).status).toBe(403)
  })
})

describe('client ID metadata documents + private-address guard', () => {
  const url = 'https://app.example.test/oauth/client.json'
  const doc = (o: Record<string, unknown> = {}) => JSON.stringify({ client_id: url, client_name: 'App', redirect_uris: [CLAUDE], ...o })
  it('accepts a matching document', async () => {
    expect(await fetchClientMetadata(url, [], async () => ({ status: 200, body: doc() }))).toMatchObject({ client_id: url, kind: 'cimd' })
  })
  it('refuses a mismatched id, a secret-based client, an unallowed redirect, a bad status, no answer', async () => {
    for (const f of [async () => ({ status: 200, body: doc({ client_id: 'https://x.test/y' }) }), async () => ({ status: 200, body: doc({ token_endpoint_auth_method: 'client_secret_basic' }) }), async () => ({ status: 200, body: doc({ redirect_uris: ['https://evil.test/cb'] }) }), async () => ({ status: 404, body: '' }), async () => null]) {
      expect(await fetchClientMetadata(url, [], f)).toBeNull()
    }
    expect(await fetchClientMetadata('http://app.example.test/x', [], async () => ({ status: 200, body: doc() }))).toBeNull()
  })
  it('isPublicIp refuses private, loopback, link-local and cloud-metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', 'not-an-ip']) expect(isPublicIp(ip)).toBe(false)
    for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) expect(isPublicIp(ip)).toBe(true)
  })
})

describe('consent', () => {
  const raw = { response_type: 'code', client_id: 'aic_1', redirect_uri: CLAUDE, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's1', resource: RESOURCE }
  const post = (ticket: string, decision: string) => new Request(`${ORIGIN}/api/oauth/consent`, { method: 'POST', headers: { host: 'acme.crm.test', 'content-type': 'application/json' }, body: JSON.stringify({ ticket, decision }) })
  it('allow: writes a code and redirects to the app with code, state and iss; the audit log gets a row', async () => {
    const w = world()
    const res = await handleConsent(post(makeConsentTicket(raw, USER, T0), 'allow'), w.deps, { userId: USER, orgId: ORG })
    const { redirect } = await res.json()
    const u = new URL(redirect)
    expect(u.origin + u.pathname).toBe(CLAUDE)
    expect(u.searchParams.get('code')?.startsWith('aac_')).toBe(true)
    expect(u.searchParams.get('state')).toBe('s1')
    expect(u.searchParams.get('iss')).toBe(ORIGIN)
    expect(w.db.tables.ai_oauth_codes).toHaveLength(1)
    expect(w.db.tables.ai_audit_log[0]).toMatchObject({ tool: 'oauth.allow', org_id: ORG, user_id: USER })
  })
  it('deny: access_denied, no code', async () => {
    const w = world()
    const { redirect } = await (await handleConsent(post(makeConsentTicket(raw, USER, T0), 'deny'), w.deps, { userId: USER, orgId: ORG })).json()
    expect(new URL(redirect).searchParams.get('error')).toBe('access_denied')
    expect(w.db.tables.ai_oauth_codes ?? []).toHaveLength(0)
  })
  it("another person's ticket, a forged ticket and an expired one are refused", async () => {
    const w = world()
    expect((await handleConsent(post(makeConsentTicket(raw, 'someone-else', T0), 'allow'), w.deps, { userId: USER, orgId: ORG })).status).toBe(400)
    expect((await handleConsent(post('x.y', 'allow'), w.deps, { userId: USER, orgId: ORG })).status).toBe(400)
    expect((await handleConsent(post(makeConsentTicket(raw, USER, 0), 'allow'), { ...w.deps, now: T0 }, { userId: USER, orgId: ORG })).status).toBe(400)
    expect(w.db.tables.ai_oauth_codes ?? []).toHaveLength(0)
  })
  describe('crm:write scope', () => {
    const rawW = { ...raw, scope: 'crm:read crm:write' }
    const postW = (allowWrites: unknown) => new Request(`${ORIGIN}/api/oauth/consent`, { method: 'POST', headers: { host: 'acme.crm.test', 'content-type': 'application/json' }, body: JSON.stringify({ ticket: makeConsentTicket(rawW, USER, T0), decision: 'allow', allowWrites }) })
    const scopesOf = async (res: Response, w: ReturnType<typeof world>) => { await res.json(); return w.db.tables.ai_oauth_codes?.[0]?.scopes }
    it('granted only when asked, ticked and the company switch is on', async () => {
      const w = world()
      expect(await scopesOf(await handleConsent(postW(true), { ...w.deps, writesOn: async () => true }, { userId: USER, orgId: ORG }), w)).toEqual(['crm:read', 'crm:write'])
    })
    it('not ticked, or switch off, or ticked with a non-true value: read only', async () => {
      for (const [tick, on] of [[false, true], [true, false], ['yes', true], [undefined, true]] as const) {
        const w = world()
        expect(await scopesOf(await handleConsent(postW(tick), { ...w.deps, writesOn: async () => on }, { userId: USER, orgId: ORG }), w)).toEqual(['crm:read'])
      }
    })
    it('an app that never asked for write cannot get it by ticking', async () => {
      const w = world()
      const res = await handleConsent(new Request(`${ORIGIN}/api/oauth/consent`, { method: 'POST', headers: { host: 'acme.crm.test', 'content-type': 'application/json' }, body: JSON.stringify({ ticket: makeConsentTicket(raw, USER, T0), decision: 'allow', allowWrites: true }) }), { ...w.deps, writesOn: async () => true }, { userId: USER, orgId: ORG })
      expect(await scopesOf(res, w)).toEqual(['crm:read'])
    })
  })
  it('switch off → 403, no code', async () => {
    const w = world()
    const res = await handleConsent(post(makeConsentTicket(raw, USER, T0), 'allow'), { ...w.deps, featureOn: async () => false }, { userId: USER, orgId: ORG })
    expect(res.status).toBe(403)
    expect(w.db.tables.ai_oauth_codes ?? []).toHaveLength(0)
  })
})

describe('discovery documents', () => {
  it('advertise PKCE S256 only, public clients, CIMD + iss support; issuer equals the address; resource is the MCP address', () => {
    const as = authorizationServerMetadata(ORIGIN)
    expect(as.issuer).toBe(ORIGIN)
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(as.client_id_metadata_document_supported).toBe(true)
    expect(as.authorization_response_iss_parameter_supported).toBe(true)
    const pr = protectedResourceMetadata(ORIGIN)
    expect(pr).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], scopes_supported: ['crm:read', 'crm:write'] })
  })
})
