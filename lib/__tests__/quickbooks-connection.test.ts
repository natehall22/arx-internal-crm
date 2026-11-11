/** @jest-environment node */
/**
 * QuickBooks connection (PR 2): sealed tokens, refresh with rotation under a lease, needs-reconnect rules, disconnect,
 * the owners' Needs-you card. Intuit is a mocked `fetch`; the database is the in-memory fake.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { integrationSecretKey, openWithKey, sealWithKey } from '@/lib/secret-seal'
import { buildAuthorizeUrl } from '@/lib/quickbooks/api'
import { packCallback, unpackCallback } from '@/lib/quickbooks/connect-flow'
import {
  disconnectQuickBooks,
  getQuickBooksAccess,
  keepQuickBooksWarm,
  loadConnection,
  loadQuickBooksNeedsYouQueue,
  publicView,
  saveNewConnection,
} from '@/lib/quickbooks/connection'

const ORG = 'org-acme'
const OTHER = 'org-other'
const KEY = 'k'.repeat(40)
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0)

const envKeys = ['SECRETS_ENCRYPTION_KEY', 'INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET', 'INTUIT_REDIRECT_URI', 'INTUIT_ENVIRONMENT'] as const
const saved: Record<string, string | undefined> = {}
let fetchMock: jest.Mock

type IntuitAnswer = { status: number; body: Record<string, unknown> }
function intuit(...answers: IntuitAnswer[]) {
  fetchMock = jest.fn(async () => {
    const a = answers.length > 1 ? answers.shift()! : answers[0]
    return { status: a.status, ok: a.status < 300, json: async () => a.body } as unknown as Response
  })
  global.fetch = fetchMock as unknown as typeof fetch
}
const tokens = (n: number) => ({ status: 200, body: { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, x_refresh_token_expires_in: 8_640_000 } })

beforeEach(() => {
  for (const k of envKeys) saved[k] = process.env[k]
  process.env.SECRETS_ENCRYPTION_KEY = KEY
  process.env.INTUIT_CLIENT_ID = 'cid'
  process.env.INTUIT_CLIENT_SECRET = 'csecret'
  process.env.INTUIT_REDIRECT_URI = 'https://app.test/api/integrations/quickbooks/callback'
  process.env.INTUIT_ENVIRONMENT = 'sandbox'
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

const t0 = { accessToken: 'access-0', refreshToken: 'refresh-0', accessExpiresInSec: 3600, refreshExpiresInSec: 8_640_000 }
async function connected(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const fake = createFakeDb({ qb_connections: [], qb_links: [], ...seed })
  const admin = fake.client as never
  const saved = await saveNewConnection(admin, ORG, { realmId: '9130', environment: 'sandbox', companyName: 'Sample Co', tokens: t0, userId: 'u-1' }, NOW)
  expect(saved).toEqual({ ok: true })
  return { fake, admin }
}
const noWait = async () => undefined

describe('secret seal', () => {
  it('round-trips, and a wrong key / tampering opens nothing', () => {
    const k = integrationSecretKey('a')!
    const sealed = sealWithKey(k, 'refresh-abc')
    expect(sealed).not.toContain('refresh-abc')
    expect(openWithKey(k, sealed)).toBe('refresh-abc')
    expect(openWithKey(integrationSecretKey('b')!, sealed)).toBeNull()
    const [iv, ct, tag] = sealed.split('.')
    expect(openWithKey(k, [iv, (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1), tag].join('.'))).toBeNull()
    expect(openWithKey(k, 'garbage')).toBeNull()
  })
  it('no key, or a short one, means no key (never a silent fallback)', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY
    expect(integrationSecretKey('a')).toBeNull()
    process.env.SECRETS_ENCRYPTION_KEY = 'too-short'
    expect(integrationSecretKey('a')).toBeNull()
  })
})

describe('connect flow helpers', () => {
  it('builds the consent URL with the signed ticket as state and nothing secret', () => {
    const u = new URL(buildAuthorizeUrl({ clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app.test/cb', environment: 'sandbox' }, 'TICKET'))
    expect(u.origin + u.pathname).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(u.searchParams.get('state')).toBe('TICKET')
    expect(u.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting')
    expect(u.toString()).not.toContain('csecret')
  })
  it('parked callback round-trips and refuses junk', () => {
    expect(unpackCallback(packCallback('code-1', '9130'))).toEqual({ code: 'code-1', realmId: '9130' })
    expect(unpackCallback(packCallback('code-1', 'abc'))).toBeNull()
    expect(unpackCallback('not json')).toBeNull()
    expect(unpackCallback('{"c":"","r":"9130"}')).toBeNull()
  })
})

describe('saveNewConnection', () => {
  it('stores both tokens sealed — no plaintext anywhere in the row', async () => {
    const { fake } = await connected()
    const row = fake.tables.qb_connections[0]
    expect(JSON.stringify(row)).not.toMatch(/access-0|refresh-0/)
    expect(row).toMatchObject({ org_id: ORG, realm_id: '9130', status: 'connected', company_name: 'Sample Co', refresh_version: 0 })
    expect(Date.parse(row.refresh_expires_at as string) - NOW).toBe(8_640_000 * 1000)
  })
  it('the same QuickBooks company reconnects in place (version moves on); a different one is refused once links exist', async () => {
    const { fake, admin } = await connected()
    expect(await saveNewConnection(admin, ORG, { realmId: '9130', environment: 'sandbox', companyName: 'Sample Co', tokens: { ...t0, refreshToken: 'refresh-9' }, userId: 'u-1' }, NOW)).toEqual({ ok: true })
    expect(fake.tables.qb_connections).toHaveLength(1)
    expect(fake.tables.qb_connections[0].refresh_version).toBe(1)
    // A different company, no links yet: fine (nothing points into the old books).
    expect(await saveNewConnection(admin, ORG, { realmId: '777', environment: 'sandbox', companyName: 'Other', tokens: t0, userId: 'u-1' }, NOW)).toEqual({ ok: true })
    fake.tables.qb_links.push({ id: 'l1', org_id: ORG, crm_table: 'customers', crm_id: 'c1', qb_type: 'Customer', qb_id: '5' })
    expect(await saveNewConnection(admin, ORG, { realmId: '9130', environment: 'sandbox', companyName: 'Sample Co', tokens: t0, userId: 'u-1' }, NOW)).toEqual({ ok: false, reason: 'different_company' })
  })
  it('another company’s links never block this company', async () => {
    const { admin, fake } = await connected({ qb_links: [{ id: 'l9', org_id: OTHER, crm_table: 'customers', crm_id: 'c9', qb_type: 'Customer', qb_id: '1' }] })
    expect(await saveNewConnection(admin, ORG, { realmId: '555', environment: 'sandbox', companyName: null, tokens: t0, userId: 'u-1' }, NOW)).toEqual({ ok: true })
    expect(fake.tables.qb_connections[0].realm_id).toBe('555')
  })
})

describe('publicView', () => {
  it('never carries a token, ciphertext or lease', async () => {
    const { fake } = await connected()
    const v = publicView(fake.tables.qb_connections[0] as never, true, NOW)
    expect(Object.keys(v).sort()).toEqual(['companyName', 'configured', 'connectedAt', 'environment', 'expiresSoon', 'reason', 'status'])
    expect(JSON.stringify(v)).not.toMatch(/token|_ct|lease/i)
    expect(v.status).toBe('connected')
    expect(publicView(null, true).status).toBe('not_connected')
  })
  it('warns when Intuit’s grant ends within 30 days', async () => {
    const { fake } = await connected()
    const row = { ...fake.tables.qb_connections[0], refresh_expires_at: new Date(NOW + 20 * 86_400_000).toISOString() }
    expect(publicView(row as never, true, NOW).expiresSoon).toBe(true)
  })
})

describe('getQuickBooksAccess — refresh with rotation', () => {
  it('a fresh token is returned without calling Intuit', async () => {
    const { admin } = await connected()
    intuit(tokens(1))
    const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 60_000, wait: noWait })
    expect(r).toEqual({ ok: true, accessToken: 'access-0', realmId: '9130', environment: 'sandbox' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an expiring token refreshes: BOTH new tokens stored, version +1, lease released, old refresh token sent', async () => {
    const { fake, admin } = await connected()
    intuit(tokens(1))
    const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })
    expect(r).toMatchObject({ ok: true, accessToken: 'access-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(String(init.body)).toContain('refresh_token=refresh-0')
    const row = fake.tables.qb_connections[0]
    expect(row.refresh_version).toBe(1)
    expect(row.refresh_lease_until).toBeNull()
    expect(JSON.stringify(row)).not.toMatch(/access-1|refresh-1/)
    // Next call uses the stored NEW pair (opens, no Intuit call).
    intuit(tokens(2))
    const again = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_600_000, wait: noWait })
    expect(again).toMatchObject({ ok: true, accessToken: 'access-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('two workers at once: Intuit is called once, both get a token', async () => {
    const { fake, admin } = await connected()
    intuit(tokens(1))
    const now = () => NOW + 3_500_000
    const [a, b] = await Promise.all([getQuickBooksAccess(admin, ORG, { now, wait: noWait }), getQuickBooksAccess(admin, ORG, { now, wait: noWait })])
    expect(a).toMatchObject({ ok: true, accessToken: 'access-1' })
    expect(b).toMatchObject({ ok: true, accessToken: 'access-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fake.tables.qb_connections[0].refresh_version).toBe(1)
  })

  it('invalid_grant on an unchanged row → needs reconnect, tokens wiped, never retried', async () => {
    const { fake, admin } = await connected()
    intuit({ status: 400, body: { error: 'invalid_grant' } })
    const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })
    expect(r).toEqual({ ok: false, reason: 'needs_reconnect' })
    const row = fake.tables.qb_connections[0]
    expect(row).toMatchObject({ status: 'needs_reconnect', access_token_ct: null, refresh_lease_until: null })
    expect(row.refresh_token_ct).toBeTruthy() // kept so a later look can still tell what happened; cleared on disconnect
    const again = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 7_000_000, wait: noWait })
    expect(again).toEqual({ ok: false, reason: 'needs_reconnect' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalid_grant because another worker already rotated → uses its tokens, NOT flagged', async () => {
    const { fake, admin } = await connected()
    // Simulate the other worker: when Intuit answers invalid_grant, the row has already moved to version 1 with a fresh pair.
    const other = await connected()
    const rotated = other.fake.tables.qb_connections[0]
    fetchMock = jest.fn(async () => {
      Object.assign(fake.tables.qb_connections[0], { refresh_version: 1, access_token_ct: rotated.access_token_ct, access_expires_at: new Date(NOW + 9_000_000).toISOString(), refresh_lease_until: null })
      return { status: 400, ok: false, json: async () => ({ error: 'invalid_grant' }) } as unknown as Response
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })
    expect(r).toMatchObject({ ok: true, accessToken: 'access-0' })
    expect(fake.tables.qb_connections[0].status).toBe('connected')
  })

  it('Intuit down / throttled / no answer is never judged: stays connected, lease released, "unavailable"', async () => {
    for (const answer of [{ status: 503, body: {} }, { status: 429, body: {} }]) {
      const { fake, admin } = await connected()
      intuit(answer)
      const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })
      expect(r).toEqual({ ok: false, reason: 'unavailable' })
      expect(fake.tables.qb_connections[0]).toMatchObject({ status: 'connected', refresh_lease_until: null })
    }
    const { fake, admin } = await connected()
    global.fetch = jest.fn(async () => { throw new Error('socket hang up') }) as unknown as typeof fetch
    expect(await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })).toEqual({ ok: false, reason: 'unavailable' })
    expect(fake.tables.qb_connections[0].status).toBe('connected')
  })

  it('a lease held by someone else is waited out, never stolen; an expired lease is taken', async () => {
    const { fake, admin } = await connected()
    fake.tables.qb_connections[0].refresh_lease_until = new Date(NOW + 3_500_000 + 20_000).toISOString()
    intuit(tokens(1))
    const waits: number[] = []
    const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: async (ms) => { waits.push(ms) } })
    expect(r).toEqual({ ok: false, reason: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(waits.length).toBeGreaterThan(0)
    fake.tables.qb_connections[0].refresh_lease_until = new Date(NOW + 3_500_000 - 1000).toISOString()
    expect(await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })).toMatchObject({ ok: true, accessToken: 'access-1' })
  })

  it('tokens that cannot be opened (encryption key changed) → needs reconnect, no Intuit call', async () => {
    const { fake, admin } = await connected()
    process.env.SECRETS_ENCRYPTION_KEY = 'z'.repeat(40)
    intuit(tokens(1))
    const r = await getQuickBooksAccess(admin, ORG, { now: () => NOW + 3_500_000, wait: noWait })
    expect(r).toEqual({ ok: false, reason: 'needs_reconnect' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.tables.qb_connections[0].status).toBe('needs_reconnect')
  })

  it('not connected / disconnected / another company → not_connected', async () => {
    const { admin } = await connected()
    expect(await getQuickBooksAccess(admin, OTHER, { wait: noWait })).toEqual({ ok: false, reason: 'not_connected' })
  })

  it('keep-warm refreshes only a stale connection (7+ days), and reports a dead one', async () => {
    const { fake, admin } = await connected()
    intuit(tokens(1))
    expect(await keepQuickBooksWarm(admin, ORG, NOW + 86_400_000)).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await keepQuickBooksWarm(admin, ORG, NOW + 8 * 86_400_000)).toBe('refreshed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    intuit({ status: 400, body: { error: 'invalid_grant' } })
    fake.tables.qb_connections[0].last_refreshed_at = new Date(NOW).toISOString()
    expect(await keepQuickBooksWarm(admin, ORG, NOW + 20 * 86_400_000)).toBe('needs_reconnect')
  })
})

describe('disconnect', () => {
  it('revokes the refresh token at Intuit, wipes both tokens, keeps the row and the links', async () => {
    const { fake, admin } = await connected({ qb_links: [{ id: 'l1', org_id: ORG, crm_table: 'customers', crm_id: 'c1', qb_type: 'Customer', qb_id: '5' }] })
    intuit({ status: 200, body: {} })
    expect(await disconnectQuickBooks(admin, ORG, 'u-1', NOW)).toEqual({ ok: true, revoked: true })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/revoke')
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('token=refresh-0')
    expect(fake.tables.qb_connections[0]).toMatchObject({ status: 'disconnected', access_token_ct: null, refresh_token_ct: null, disconnected_by: 'u-1' })
    expect(fake.tables.qb_links).toHaveLength(1)
    expect(await getQuickBooksAccess(admin, ORG, { wait: noWait })).toEqual({ ok: false, reason: 'not_connected' })
  })
  it('still disconnects here when Intuit cannot be reached (the owner’s intent wins)', async () => {
    const { fake, admin } = await connected()
    global.fetch = jest.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await disconnectQuickBooks(admin, ORG, 'u-1', NOW)).toEqual({ ok: true, revoked: false })
    expect(fake.tables.qb_connections[0].status).toBe('disconnected')
  })
  it('only ever touches its own company', async () => {
    const { fake, admin } = await connected()
    intuit({ status: 200, body: {} })
    expect(await disconnectQuickBooks(admin, OTHER, 'u-9', NOW)).toEqual({ ok: true, revoked: false })
    expect(fake.tables.qb_connections[0].status).toBe('connected')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('a disconnected company can connect again (same row)', async () => {
    const { fake, admin } = await connected()
    intuit({ status: 200, body: {} })
    await disconnectQuickBooks(admin, ORG, 'u-1', NOW)
    expect(await saveNewConnection(admin, ORG, { realmId: '9130', environment: 'sandbox', companyName: 'Sample Co', tokens: t0, userId: 'u-1' }, NOW)).toEqual({ ok: true })
    expect(fake.tables.qb_connections).toHaveLength(1)
    expect(fake.tables.qb_connections[0]).toMatchObject({ status: 'connected', disconnected_at: null })
  })
})

describe('Needs-you card', () => {
  it('nothing when healthy, never connected, or disconnected', async () => {
    const { admin } = await connected()
    expect(await loadQuickBooksNeedsYouQueue(admin, ORG, NOW)).toBeNull()
    expect(await loadQuickBooksNeedsYouQueue(admin, OTHER, NOW)).toBeNull()
  })
  it('needs-reconnect and expiring-soon each show one plain line for owners', async () => {
    const { fake, admin } = await connected()
    fake.tables.qb_connections[0].refresh_expires_at = new Date(NOW + 10 * 86_400_000).toISOString()
    expect((await loadQuickBooksNeedsYouQueue(admin, ORG, NOW))?.items[0].title).toBe('Reconnect QuickBooks soon')
    fake.tables.qb_connections[0].status = 'needs_reconnect'
    fake.tables.qb_connections[0].needs_reconnect_reason = 'QuickBooks stopped accepting this connection. Please reconnect.'
    const q = await loadQuickBooksNeedsYouQueue(admin, ORG, NOW)
    expect(q).toMatchObject({ id: 'quickbooks-reconnect', count: 1 })
    expect(q?.items[0].title).toBe('Reconnect QuickBooks')
    expect(JSON.stringify(q)).not.toMatch(/token/i)
  })
})
