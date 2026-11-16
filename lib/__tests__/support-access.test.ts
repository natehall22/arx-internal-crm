/** @jest-environment node */
/**
 * Support access: the one audited door into another company. Covers the grant rules, the signed session, resolveAuth (fences,
 * re-check every request, view vs full, write log), the routes, the outbound blocks and the structural rules (who may write
 * the staff list / always-on flag, where the support cookie may be read, the migration).
 */
import fs from 'node:fs'
import { join } from 'node:path'
import nodemailer from 'nodemailer'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

type Row = Record<string, unknown>
let db: ReturnType<typeof createFakeDb>
let requestHeaders = new Map<string, string>()
let cookieList: Array<{ name: string; value: string }> = []
let failLogInsert = false
const TOKENS: Record<string, { id: string; email: string }> = {
  'staff-token': { id: 'staff-1', email: 'staff@arx.test' },
  'acme-owner-token': { id: 'owner-acme', email: 'o@acme.test' },
  'acme-rep-token': { id: 'rep-acme', email: 'r@acme.test' },
}

jest.mock('next/headers', () => ({
  headers: () => ({ get: (k: string) => requestHeaders.get(k.toLowerCase()) ?? null }),
  cookies: () => ({ getAll: () => cookieList, get: (n: string) => cookieList.find((c) => c.name === n) }),
}))
jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
  notFound: jest.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (t: string) => (TOKENS[t] ? { data: { user: TOKENS[t] }, error: null } : { data: { user: null }, error: { message: 'bad' } }),
    },
    from: (t: string) => guarded(t),
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: (t: string) => guarded(t) }) }))

function guarded(t: string) {
  const b = (db.client as { from: (t: string) => unknown }).from(t) as { insert: (rows: Row | Row[]) => unknown }
  if (t === 'support_access_log' && failLogInsert) return { ...b, insert: () => Promise.resolve({ data: null, error: { message: 'log table missing' } }) }
  return b
}

import { getAuthContext, requireAuth, requireAuthApi } from '@/lib/auth'
import { __resetCompanyHostCacheForTests } from '@/lib/company-host'
import {
  GRANT_DURATIONS,
  checkSupportSession,
  endSupportAccess,
  enterSupportSession,
  grantSupportAccess,
  listSupportCompanies,
  listSupportLog,
} from '@/lib/support/access'
import { SUPPORT_COOKIE, SUPPORT_REQUEST_HEADER, signSupportToken, verifySupportToken, type SupportSessionPayload } from '@/lib/support/token'
import { supportBlocksSend } from '@/lib/support/send-guard'
import { POST as enterPost } from '@/app/api/support/enter/route'
import { POST as exitPost } from '@/app/api/support/exit/route'
import { POST as upgradePost } from '@/app/api/support/upgrade/route'
import { GET as handoffGet } from '@/app/api/support/handoff/route'
import { GET as saGet, POST as saPost } from '@/app/api/admin/support-access/route'
import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'

const ARX = 'org-arx'
const ACME = 'org-acme'
const ROOFCO = 'org-roofco'
const HOUR = 3600_000
const ROOT = join(__dirname, '..', '..')

function seed(extra: Partial<Record<string, Row[]>> = {}) {
  db = createFakeDb({
    orgs: [
      { id: ARX, name: 'ARX', support_access_always: true, subdomain: 'arxhome' },
      { id: ACME, name: 'Acme Roofing', support_access_always: null, subdomain: 'acme' },
      { id: ROOFCO, name: 'RoofCo', support_access_always: null, subdomain: 'roofco' },
    ],
    users: [
      { id: 'staff-1', org_id: ARX, role: 'admin', active: true, full_name: 'Sam Support', email: 'staff@arx.test', is_super_admin: false },
      { id: 'owner-acme', org_id: ACME, role: 'admin', active: true, full_name: 'Olive Owner', email: 'o@acme.test', is_super_admin: true, created_at: '2026-01-01' },
      { id: 'rep-acme', org_id: ACME, role: 'sales_rep', active: true, full_name: 'Rex Rep', email: 'r@acme.test', is_super_admin: false, created_at: '2026-02-01' },
      { id: 'owner-arx', org_id: ARX, role: 'admin', active: true, full_name: 'Nate Owner', email: 'n@arx.test', is_super_admin: true, created_at: '2026-01-01' },
      { id: 'owner-roofco', org_id: ROOFCO, role: 'admin', active: true, full_name: 'Rita', email: 'r@roofco.test', is_super_admin: true, created_at: '2026-01-01' },
    ],
    platform_support_staff: [{ user_id: 'staff-1' }],
    support_access_grants: [{ id: 'g1', org_id: ACME, granted_by: 'owner-acme', granted_at: new Date(Date.now() - HOUR).toISOString(), expires_at: new Date(Date.now() + 24 * HOUR).toISOString(), ended_at: null }],
    support_access_log: [],
    ...extra,
  } as Record<string, Row[]>)
}

const tbl = (n: string): Row[] => (db.tables[n] ??= [])
const logRows = () => tbl('support_access_log')
const events = () => logRows().map((r) => r.event)

async function sessionCookie(over: Partial<SupportSessionPayload> = {}) {
  const p: SupportSessionPayload = { k: 'session', s: 'staff-1', o: ACME, a: 'owner-acme', l: 'view', exp: Date.now() + HOUR, ...over }
  return { name: SUPPORT_COOKIE, value: (await signSupportToken(p))! }
}
function req(host = 'old-app.vercel.app', headers: Record<string, string> = {}) {
  requestHeaders = new Map(Object.entries({ host, ...headers }))
}
const asApi = (method: string, path = '/api/ops/jobs/x') => req('old-app.vercel.app', { [SUPPORT_REQUEST_HEADER]: `${method} ${path}` })

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})
const ENV = ['APP_BASE_DOMAIN', 'DEPLOYMENT_ORG_ID'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  delete process.env.APP_BASE_DOMAIN
  delete process.env.DEPLOYMENT_ORG_ID
  __resetCompanyHostCacheForTests()
  failLogInsert = false
  cookieList = []
  req()
  seed()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

describe('who may enter', () => {
  test('no grant → refused, nothing logged', async () => {
    const r = await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ROOFCO, actingAsUserId: null })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(logRows()).toHaveLength(0)
  })

  test('live grant → view-only session as the owner, logged, never past the grant or 8 hours', async () => {
    const r = await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload).toMatchObject({ o: ACME, a: 'owner-acme', l: 'view', s: 'staff-1' })
    expect(r.payload.exp).toBeLessThanOrEqual(Date.now() + 8 * HOUR + 1000)
    expect(events()).toEqual(['enter'])
    expect(logRows()[0]).toMatchObject({ org_id: ACME, staff_user_id: 'staff-1', acting_as_user_id: 'owner-acme', level: 'view' })
  })

  test('a one-day grant caps the session at the grant', async () => {
    tbl('support_access_grants')[0].expires_at = new Date(Date.now() + 2 * HOUR).toISOString()
    const r = await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: null })
    expect(r.ok && r.payload.exp).toBeLessThanOrEqual(Date.now() + 2 * HOUR + 1000)
  })

  test('as a specific user: only an active user of THAT company', async () => {
    expect((await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: 'rep-acme' })).ok).toBe(true)
    expect(await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: 'owner-roofco' })).toMatchObject({ ok: false, status: 404 })
    tbl('users').find((u) => u.id === 'rep-acme')!.active = false
    expect(await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: 'rep-acme' })).toMatchObject({ ok: false })
  })

  test('ARX is always on: no grant row needed', async () => {
    tbl('support_access_grants').length = 0
    const r = await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ARX, actingAsUserId: null })
    expect(r).toMatchObject({ ok: true, access: { kind: 'always' } })
  })

  test('a company owner or rep is not staff and cannot enter (even their own or another company)', async () => {
    for (const who of ['owner-acme', 'rep-acme', 'owner-arx']) {
      expect(await enterSupportSession(db.client, { staffUserId: who, orgId: ACME, actingAsUserId: null })).toMatchObject({ ok: false, status: 403 })
    }
  })

  test('staff whose account is disabled cannot enter', async () => {
    tbl('users').find((u) => u.id === 'staff-1')!.active = false
    expect(await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: null })).toMatchObject({ ok: false })
  })

  test('no log, no session: a log failure refuses the entry', async () => {
    failLogInsert = true
    expect(await enterSupportSession({ from: (t: string) => guarded(t) } as never, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: null })).toMatchObject({ ok: false, status: 500 })
  })

  test('the staff list only shows companies that allow it right now', async () => {
    const list = await listSupportCompanies(db.client)
    expect(list.map((c) => c.name).sort()).toEqual(['ARX', 'Acme Roofing'])
    expect(list.find((c) => c.orgId === ACME)!.users.map((u) => u.id).sort()).toEqual(['owner-acme', 'rep-acme'])
    await endSupportAccess(db.client, ACME, 'owner-acme')
    expect((await listSupportCompanies(db.client)).map((c) => c.name)).toEqual(['ARX'])
  })
})

describe('the signed cookie', () => {
  test('forged, edited, wrong-kind and expired tokens are all refused', async () => {
    const good = (await sessionCookie()).value
    expect(await verifySupportToken(good, 'session')).toBeTruthy()
    const [body, mac] = good.split('.')
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), l: 'full' })).toString('base64url')
    expect(await verifySupportToken(`${edited}.${mac}`, 'session')).toBeNull()
    expect(await verifySupportToken(good, 'handoff')).toBeNull()
    expect(await verifySupportToken(`${body}.AAAA`, 'session')).toBeNull()
    expect(await verifySupportToken('garbage', 'session')).toBeNull()
    expect(await verifySupportToken((await sessionCookie({ exp: Date.now() - 1 })).value, 'session')).toBeNull()
  })

  test('a token signed with another key is refused', async () => {
    const value = (await sessionCookie()).value
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'another-key'
    expect(await verifySupportToken(value, 'session')).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  })
})

describe('resolveAuth with a support session', () => {
  test('valid session → the acting-as profile plus a support marker (requireAuth and requireAuthApi both)', async () => {
    cookieList = [await sessionCookie()]
    asApi('GET')
    const api = await requireAuthApi()
    expect(api.profile).toMatchObject({ id: 'owner-acme', org_id: ACME })
    expect(api.support).toMatchObject({ staffUserId: 'staff-1', orgId: ACME, level: 'view', actingAsUserId: 'owner-acme' })
    expect((await requireAuth()).support?.level).toBe('view')
  })

  test('no cookie → ordinary behaviour, no support marker', async () => {
    req('old-app.vercel.app', { authorization: 'Bearer acme-owner-token' })
    const c = await requireAuthApi()
    expect(c.support).toBeUndefined()
    expect(c.profile.id).toBe('owner-acme')
  })

  test('no grant → the session does nothing (signed out)', async () => {
    cookieList = [await sessionCookie({ o: ROOFCO, a: 'owner-roofco' })]
    asApi('GET')
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
    await expect(requireAuth()).rejects.toThrow('REDIRECT:/login')
    await expect(getAuthContext()).resolves.toBeNull()
  })

  test('grant ended mid-session → refused on the very next request', async () => {
    cookieList = [await sessionCookie()]
    asApi('GET')
    await expect(requireAuthApi()).resolves.toBeTruthy()
    await endSupportAccess(db.client, ACME, 'owner-acme')
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })

  test('grant expired mid-session → refused', async () => {
    cookieList = [await sessionCookie()]
    asApi('GET')
    tbl('support_access_grants')[0].expires_at = new Date(Date.now() - 1000).toISOString()
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })

  test('staff removed mid-session → refused', async () => {
    cookieList = [await sessionCookie()]
    asApi('GET')
    tbl('platform_support_staff').length = 0
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })

  test('acting-as user disabled mid-session → refused', async () => {
    cookieList = [await sessionCookie()]
    asApi('GET')
    tbl('users').find((u) => u.id === 'owner-acme')!.active = false
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })

  test("a signed cookie for a company the acting-as user is NOT in is refused (cannot pair staff with another company's user)", async () => {
    cookieList = [await sessionCookie({ a: 'owner-roofco' })]
    asApi('GET')
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
  })

  test('a forged cookie is ignored: a non-staff company user cannot become anyone else', async () => {
    cookieList = [{ name: SUPPORT_COOKIE, value: 'aaa.bbb' }]
    req('old-app.vercel.app', { authorization: 'Bearer acme-rep-token', [SUPPORT_REQUEST_HEADER]: 'GET /x' })
    const c = await requireAuthApi()
    expect(c.profile.id).toBe('rep-acme')
    expect(c.support).toBeUndefined()
  })

  test("DEPLOYMENT_ORG_ID: a company's own copy admits support into that company only", async () => {
    process.env.DEPLOYMENT_ORG_ID = ROOFCO
    cookieList = [await sessionCookie()]
    asApi('GET')
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
    process.env.DEPLOYMENT_ORG_ID = ACME
    await expect(requireAuthApi()).resolves.toMatchObject({ profile: { org_id: ACME } })
  })

  test("host fence: another company's address refuses the session; the company's own admits it", async () => {
    process.env.APP_BASE_DOMAIN = 'crm-product.test'
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init: { body: string }) => ({ ok: true, status: 200, json: async () => ({ acme: ACME, roofco: ROOFCO }[JSON.parse(init.body).p_subdomain as string] ?? null) }))
    cookieList = [await sessionCookie()]
    req('roofco.crm-product.test', { [SUPPORT_REQUEST_HEADER]: 'GET /x' })
    await expect(requireAuthApi()).rejects.toThrow('Unauthorized')
    req('acme.crm-product.test', { [SUPPORT_REQUEST_HEADER]: 'GET /x' })
    await expect(requireAuthApi()).resolves.toMatchObject({ profile: { org_id: ACME } })
  })

  test("staff keep their own identity on their own token (the support cookie is not involved)", async () => {
    // the staff member\'s OWN token still works as themselves, and the support cookie never changes who a Bearer-less staff is on another address
    req('old-app.vercel.app', { authorization: 'Bearer staff-token' })
    expect((await requireAuthApi()).profile.id).toBe('staff-1')
  })
})

describe('view vs full', () => {
  test('view: every write is refused with "Support view mode", reads pass, nothing is logged for writes', async () => {
    cookieList = [await sessionCookie()]
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      asApi(m)
      await expect(requireAuthApi()).rejects.toThrow('Support view mode')
    }
    asApi('GET')
    await expect(requireAuthApi()).resolves.toBeTruthy()
    expect(events()).not.toContain('write')
  })

  test('view: a missing method header inside a support session fails closed', async () => {
    cookieList = [await sessionCookie()]
    req('old-app.vercel.app')
    await expect(requireAuthApi()).rejects.toThrow('Support view mode')
  })

  test('full: writes go through and each is logged with route + method; reads are not', async () => {
    cookieList = [await sessionCookie({ l: 'full' })]
    asApi('POST', '/api/ops/jobs/j1/cancel')
    await expect(requireAuthApi()).resolves.toBeTruthy()
    asApi('GET', '/api/ops/jobs')
    await requireAuthApi()
    expect(logRows().filter((r) => r.event === 'write')).toHaveLength(1)
    expect(logRows()[0]).toMatchObject({ org_id: ACME, staff_user_id: 'staff-1', acting_as_user_id: 'owner-acme', level: 'full', event: 'write', detail: { method: 'POST', route: '/api/ops/jobs/j1/cancel' } })
  })

  test('full: a write that cannot be logged is refused', async () => {
    cookieList = [await sessionCookie({ l: 'full' })]
    asApi('POST')
    failLogInsert = true
    await expect(requireAuthApi()).rejects.toThrow('could not be recorded')
  })

  test("full: staff can never change the company's own support-access settings", async () => {
    cookieList = [await sessionCookie({ l: 'full' })]
    asApi('POST', '/api/admin/support-access')
    await expect(requireAuthApi()).rejects.toThrow('cannot change')
    expect(events()).not.toContain('write')
  })
})

describe('middleware', () => {
  const mk = (method: string, path: string, cookie?: string, headers: Record<string, string> = {}) =>
    new NextRequest(`https://old-app.vercel.app${path}`, { method, headers: { host: 'old-app.vercel.app', ...(cookie ? { cookie: `${SUPPORT_COOKIE}=${cookie}` } : {}), ...headers } })

  test('view session: a write is a 403 "Support view mode" before any route runs; exit and upgrade stay open', async () => {
    const c = (await sessionCookie()).value
    const blocked = await middleware(mk('POST', '/api/ops/jobs/1/cancel', c))
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toEqual({ error: 'Support view mode' })
    expect((await middleware(mk('POST', '/ops/jobs', c))).status).toBe(403)
    expect((await middleware(mk('POST', '/api/support/exit', c))).status).not.toBe(403)
    expect((await middleware(mk('POST', '/api/support/upgrade', c))).status).not.toBe(403)
  })

  test('full session: writes pass, and the method + path header is set for resolveAuth', async () => {
    const c = (await sessionCookie({ l: 'full' })).value
    const res = await middleware(mk('POST', '/api/ops/jobs/1/cancel', c))
    expect(res.status).not.toBe(403)
    expect(res.headers.get('x-middleware-request-' + SUPPORT_REQUEST_HEADER)).toBe('POST /api/ops/jobs/1/cancel')
  })

  test('a client-sent method header is replaced, and a forged cookie sets nothing and is no session', async () => {
    const c = (await sessionCookie({ l: 'full' })).value
    const res = await middleware(mk('GET', '/api/x', c, { [SUPPORT_REQUEST_HEADER]: 'GET /pretend' }))
    expect(res.headers.get('x-middleware-request-' + SUPPORT_REQUEST_HEADER)).toBe('GET /api/x')
    const forged = await middleware(mk('GET', '/api/x', 'aaa.bbb', { [SUPPORT_REQUEST_HEADER]: 'GET /pretend' }))
    expect(forged.headers.get('x-middleware-request-' + SUPPORT_REQUEST_HEADER)).toBeNull()
    const page = await middleware(mk('GET', '/ops', 'aaa.bbb'))
    expect(page.status).toBe(307) // no real session → login
  })

  test('a valid support cookie counts as the session for a page (no Supabase cookie needed)', async () => {
    const page = await middleware(mk('GET', '/ops', (await sessionCookie()).value))
    expect(page.status).toBe(200)
  })
})

describe('routes', () => {
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`https://old-app.vercel.app${url}`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'old-app.vercel.app', ...headers }, body: JSON.stringify(body) })

  test('/api/support/enter: signed-out and non-staff get 404 and no cookie, no log', async () => {
    req('old-app.vercel.app')
    expect((await enterPost(post('/api/support/enter', { orgId: ACME }))).status).toBe(404)
    for (const t of ['acme-owner-token', 'acme-rep-token']) {
      req('old-app.vercel.app', { authorization: `Bearer ${t}` })
      const res = await enterPost(post('/api/support/enter', { orgId: ACME }))
      expect(res.status).toBe(404)
      expect(res.headers.get('set-cookie')).toBeNull()
    }
    expect(logRows()).toHaveLength(0)
  })

  test('/api/support/enter: staff with a grant get a view-only cookie that works; without a grant they get 403', async () => {
    req('old-app.vercel.app', { authorization: 'Bearer staff-token' })
    const ok = await enterPost(post('/api/support/enter', { orgId: ACME }))
    expect(ok.status).toBe(200)
    const set = ok.headers.get('set-cookie') ?? ''
    expect(set).toMatch(new RegExp(`${SUPPORT_COOKIE}=`))
    expect(set).toMatch(/HttpOnly/i)
    expect(set).not.toMatch(/Domain=/i)
    const value = /arx_support=([^;]+)/.exec(set)![1]
    expect(await verifySupportToken(decodeURIComponent(value), 'session')).toMatchObject({ l: 'view', o: ACME })
    expect((await enterPost(post('/api/support/enter', { orgId: ROOFCO }))).status).toBe(403)
  })

  test('/api/support/enter refuses a cross-site request', async () => {
    req('old-app.vercel.app', { authorization: 'Bearer staff-token' })
    const res = await enterPost(post('/api/support/enter', { orgId: ACME }, { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' }))
    expect(res.status).toBe(403)
  })

  test('/api/support/enter on a company-fenced copy hands off to the company address; the hand-off sets the cookie only there', async () => {
    process.env.APP_BASE_DOMAIN = 'crm-product.test'
    process.env.DEPLOYMENT_ORG_ID = ARX
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init: { body: string }) => ({ ok: true, status: 200, json: async () => ({ acme: ACME, roofco: ROOFCO, arxhome: ARX }[JSON.parse(init.body).p_subdomain as string] ?? null) }))
    req('arxhome.crm-product.test', { authorization: 'Bearer staff-token' })
    const res = await enterPost(post('/api/support/enter', { orgId: ACME }, { host: 'arxhome.crm-product.test' }))
    const { redirect } = (await res.json()) as { redirect: string }
    if (!redirect) throw new Error(`no redirect: ${res.status}`)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(redirect).toMatch(/^https:\/\/acme\.crm-product\.test\/api\/support\/handoff\?t=/)
    const t = new URL(redirect).searchParams.get('t')!
    // the token is no session
    expect(await verifySupportToken(t, 'session')).toBeNull()
    delete process.env.DEPLOYMENT_ORG_ID
    // opened on another company's address: nothing
    req('roofco.crm-product.test')
    expect((await handoffGet(new Request(`https://roofco.crm-product.test/api/support/handoff?t=${encodeURIComponent(t)}`, { headers: { host: 'roofco.crm-product.test' } }))).status).toBe(404)
    // on the unfenced address: nothing (hand-offs only land on a company's own address)
    req('old-app.vercel.app')
    expect((await handoffGet(new Request(`https://old-app.vercel.app/api/support/handoff?t=${encodeURIComponent(t)}`, { headers: { host: 'old-app.vercel.app' } }))).status).toBe(404)
    // on the company's own address: cookie
    req('acme.crm-product.test')
    const landed = await handoffGet(new Request(`https://acme.crm-product.test/api/support/handoff?t=${encodeURIComponent(t)}`, { headers: { host: 'acme.crm-product.test' } }))
    expect(landed.status).toBe(303)
    expect(landed.headers.get('set-cookie')).toMatch(/arx_support=/)
    // a forged / session-kind token is refused
    expect((await handoffGet(new Request(`https://acme.crm-product.test/api/support/handoff?t=${encodeURIComponent((await sessionCookie()).value)}`, { headers: { host: 'acme.crm-product.test' } }))).status).toBe(404)
  })

  test('upgrade: switches view → full, logs "upgrade" first; without a log row it does not switch', async () => {
    cookieList = [await sessionCookie()]
    failLogInsert = true
    expect((await upgradePost(post('/api/support/upgrade', {}))).status).toBe(500)
    failLogInsert = false
    const res = await upgradePost(post('/api/support/upgrade', {}))
    expect(res.status).toBe(200)
    expect(events()).toEqual(['upgrade'])
    expect(logRows()[0]).toMatchObject({ level: 'full', event: 'upgrade' })
    const value = decodeURIComponent(/arx_support=([^;]+)/.exec(res.headers.get('set-cookie')!)![1])
    expect((await verifySupportToken(value, 'session'))!.l).toBe('full')
  })

  test('upgrade after the grant ended, or with no session: refused', async () => {
    cookieList = [await sessionCookie()]
    await endSupportAccess(db.client, ACME, 'owner-acme')
    expect((await upgradePost(post('/api/support/upgrade', {}))).status).toBe(403)
    cookieList = []
    expect((await upgradePost(post('/api/support/upgrade', {}))).status).toBe(401)
  })

  test('exit: logs "exit" and clears the cookie, even after the grant ended', async () => {
    cookieList = [await sessionCookie()]
    await endSupportAccess(db.client, ACME, 'owner-acme')
    const res = await exitPost(post('/api/support/exit', {}))
    expect(res.status).toBe(200)
    expect(events()).toEqual(['exit'])
    expect(res.headers.get('set-cookie')).toMatch(/arx_support=;/)
  })
})

describe("the company's side: Settings → Support access", () => {
  const owner = (t = 'acme-owner-token') => req('old-app.vercel.app', { authorization: `Bearer ${t}` })
  const body = (b: unknown) => new Request('https://old-app.vercel.app/api/admin/support-access', { method: 'POST', headers: { 'content-type': 'application/json', host: 'old-app.vercel.app' }, body: JSON.stringify(b) })

  test.each(['day', 'week', 'month', 'year'] as const)('an owner can grant for 1 %s: one live grant, right expiry', async (d) => {
    tbl('support_access_grants').length = 0
    owner()
    const before = Date.now()
    const res = await saPost(body({ duration: d }))
    expect(res.status).toBe(200)
    const rows = tbl('support_access_grants')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ org_id: ACME, granted_by: 'owner-acme' })
    const ms = new Date(String(rows[0].expires_at)).getTime() - before
    expect(ms).toBeGreaterThanOrEqual(GRANT_DURATIONS[d].ms - 2000)
    expect(ms).toBeLessThanOrEqual(GRANT_DURATIONS[d].ms + 5000)
  })

  test('a new grant ends the earlier one (one live grant at a time)', async () => {
    owner()
    await saPost(body({ duration: 'week' }))
    expect(tbl('support_access_grants').filter((g) => !g.ended_at)).toHaveLength(1)
    expect(tbl('support_access_grants').filter((g) => g.ended_at)).toHaveLength(1)
  })

  test('End access now: ends it and support is out', async () => {
    owner()
    expect((await saPost(body({ end: true }))).status).toBe(200)
    expect(tbl('support_access_grants')[0]).toMatchObject({ ended_by: 'owner-acme' })
    expect(await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: null })).toMatchObject({ ok: false, status: 403 })
  })

  test('a bad duration is refused; only the caller\'s OWN company is ever granted (an org id in the body is ignored)', async () => {
    owner()
    expect((await saPost(body({ duration: 'forever' }))).status).toBe(400)
    tbl('support_access_grants').length = 0
    await saPost(body({ duration: 'day', orgId: ROOFCO, org_id: ROOFCO }))
    expect(tbl('support_access_grants').map((g) => g.org_id)).toEqual([ACME])
  })

  test('only a company owner: a rep, staff and signed-out people are refused', async () => {
    for (const t of ['acme-rep-token', 'staff-token']) {
      owner(t)
      expect((await saGet(new Request('https://old-app.vercel.app/api/admin/support-access'))).status).toBe(403)
      expect((await saPost(body({ duration: 'day' }))).status).toBe(403)
    }
    req('old-app.vercel.app')
    expect((await saPost(body({ duration: 'day' }))).status).toBe(401)
    expect(tbl('support_access_grants')).toHaveLength(1)
  })

  test('an owner cannot make the company always-on or add staff through this route', async () => {
    owner()
    await saPost(body({ duration: 'day', support_access_always: true, always: true, staff: ['owner-acme'], user_id: 'owner-acme' }))
    expect(tbl('orgs').find((o) => o.id === ACME)!.support_access_always).toBeNull()
    expect(tbl('platform_support_staff').map((r) => r.user_id)).toEqual(['staff-1'])
  })

  test('ARX: always on, no controls (GET says so, POST is refused)', async () => {
    tbl('users').find((u) => u.id === 'owner-arx')!.org_id = ARX
    TOKENS['arx-owner-token'] = { id: 'owner-arx', email: 'n@arx.test' }
    owner('arx-owner-token')
    const j = (await (await saGet(new Request('https://old-app.vercel.app/api/admin/support-access'))).json()) as { always: boolean }
    expect(j.always).toBe(true)
    expect((await saPost(body({ duration: 'day' }))).status).toBe(409)
    expect((await saPost(body({ end: true }))).status).toBe(409)
  })

  test('inside a support session (even full) the settings are not available', async () => {
    cookieList = [await sessionCookie({ l: 'full' })]
    req('old-app.vercel.app', { [SUPPORT_REQUEST_HEADER]: 'POST /api/admin/support-access' })
    expect((await saPost(body({ duration: 'year' }))).status).toBe(403)
    expect(tbl('support_access_grants')).toHaveLength(1)
  })

  test('the company sees its own support log with names', async () => {
    await enterSupportSession(db.client, { staffUserId: 'staff-1', orgId: ACME, actingAsUserId: 'rep-acme' })
    owner()
    const j = (await (await saGet(new Request('https://old-app.vercel.app/api/admin/support-access'))).json()) as { log: Array<{ staff: string; actingAs: string; event: string }> }
    expect(j.log[0]).toMatchObject({ staff: 'Sam Support', actingAs: 'Rex Rep', event: 'enter' })
    // another company's log is not visible
    expect(await listSupportLog(db.client, ROOFCO)).toEqual([])
  })

  test('check helper sanity: a live session checks ok', async () => {
    const p: SupportSessionPayload = { k: 'session', s: 'staff-1', o: ACME, a: 'owner-acme', l: 'view', exp: Date.now() + HOUR }
    expect((await checkSupportSession(db.client, p)).status).toBe('ok')
    expect(await grantSupportAccess(db.client, ACME, 'owner-acme', 'day')).toHaveProperty('expiresAt')
  })
})

describe('nothing leaves a company during a support session', () => {
  test('mail: refused (not faked as sent), the real transport is never called, a blocked_send is logged', async () => {
    const sendMail = jest.fn(async () => ({ messageId: 'real' }))
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never)
    const { createGuardedTransport } = await import('@/lib/demo-org-mail')
    cookieList = [await sessionCookie({ l: 'full' })]
    await expect(createGuardedTransport({}, ACME).sendMail({ to: 'customer@example.org', subject: 'Hi' })).rejects.toThrow('Support session')
    expect(sendMail).not.toHaveBeenCalled()
    expect(logRows()).toEqual([expect.objectContaining({ event: 'blocked_send', org_id: ACME, level: 'full', detail: expect.objectContaining({ what: 'email' }) })])
    // the same call without a support cookie goes through untouched (cron, webhook, an ordinary user)
    cookieList = []
    await expect(createGuardedTransport({}, ACME).sendMail({ to: 'customer@example.org', subject: 'Hi' })).resolves.toMatchObject({ messageId: 'real' })
  })

  test('payment links, Stripe writes, supplier orders, QuickBooks pushes and calendar invites', async () => {
    cookieList = [await sessionCookie()]
    const { createPaymentLink } = await import('@/lib/online-payments/links')
    await expect(createPaymentLink(db.client, ACME, { kind: 'invoice', invoiceId: 'i1' }, 'owner-acme')).rejects.toThrow('Support session')
    expect(tbl('payment_links') ?? []).toHaveLength(0)

    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }))
    ;(global as unknown as { fetch: unknown }).fetch = fetchSpy
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    const { stripeRequest } = await import('@/lib/stripe/api')
    await expect(stripeRequest('POST', '/v1/refunds', {})).rejects.toThrow('Support session')
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(stripeRequest('GET', '/v1/accounts/acct_1')).resolves.toBeTruthy()

    const { sendOrderToSupplier } = await import('@/lib/suppliers/send-order')
    await expect(sendOrderToSupplier({ orgId: ACME } as never)).rejects.toThrow('Support session')

    const { enqueueIntegrationEvent } = await import('@/lib/integrations')
    await expect(enqueueIntegrationEvent(db.client, { orgId: ACME, provider: 'quickbooks', eventType: 'payment.recorded', entityTable: 'job_payments', entityId: 'p1', payload: {} } as never)).resolves.toBeNull()
    expect(tbl('integration_outbox') ?? []).toHaveLength(0)

    const { calendarSendUpdates } = await import('@/lib/demo-org')
    await expect(calendarSendUpdates(db.client, ACME, 'all')).resolves.toBe('none')
    expect(logRows().map((r) => (r.detail as { what: string }).what)).toEqual(['payment_link', 'payment_charge', 'supplier_order', 'quickbooks_push', 'calendar_invite'])
    expect(logRows().every((r) => r.event === 'blocked_send')).toBe(true)
  })

  test('outside a support session nothing is blocked or logged', async () => {
    cookieList = []
    expect(await supportBlocksSend('email')).toBe(false)
    const { calendarSendUpdates } = await import('@/lib/demo-org')
    await expect(calendarSendUpdates(db.client, ACME, 'all')).resolves.toBe('all')
    expect(logRows()).toHaveLength(0)
  })

  test('every outbound door carries the guard (source check)', () => {
    const must: Array<[string, string]> = [
      ['lib/demo-org-mail.ts', 'assertNoSupportSend'],
      ['lib/customer-messages-db.ts', 'supportBlocksSend'],
      ['lib/customer-message-channels.ts', 'supportBlocksSend'],
      ['lib/push-apns.ts', 'supportBlocksSend'],
      ['lib/demo-org.ts', 'supportBlocksSend'],
      ['lib/online-payments/links.ts', 'assertNoSupportSend'],
      ['lib/stripe/api.ts', 'assertNoSupportSend'],
      ['lib/suppliers/send-order.ts', 'assertNoSupportSend'],
      ['lib/integrations.ts', 'supportBlocksSend'],
    ]
    for (const [f, word] of must) expect(fs.readFileSync(join(ROOT, f), 'utf8')).toContain(word)
  })
})

describe('structure: the wall stays intact except through this one door', () => {
  const read = (f: string) => fs.readFileSync(join(ROOT, f), 'utf8')
  const sources = (dirs: string[]) => {
    const out: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__' || e.name === '.next') continue
          walk(rel)
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(rel)
      }
    }
    dirs.forEach(walk)
    return out
  }

  test('the support cookie is read only by auth, middleware, the support modules/routes and the banner', () => {
    const allowed = (f: string) => f === 'lib/auth.ts' || f.startsWith('lib/support/') || f.startsWith('app/api/support/') || f === 'components/support/SupportBanner.tsx'
    const offenders = sources(['app', 'lib', 'components']).filter((f) => /SUPPORT_COOKIE|supportCookieFrom|arx_support/.test(read(f)) && !allowed(f))
    expect(offenders).toEqual([])
    expect(read('middleware.ts')).toContain('supportCookieFrom')
  })

  test('hand-rolled-cookie routes (Known Redundancy 3b) never touch a support session: they authenticate the real token only', () => {
    const hand = sources(['app/api']).filter((f) => /function (getSessionFromRequest|getAuthClient)\(/.test(read(f)))
    expect(hand.length).toBeGreaterThan(10)
    for (const f of hand) expect(read(f)).not.toMatch(/lib\/support|SUPPORT_COOKIE|arx_support/)
  })

  test('nothing in the app writes the staff list or the always-on flag', () => {
    for (const f of sources(['app', 'lib', 'components', 'scripts'].filter((d) => fs.existsSync(join(ROOT, d))))) {
      const s = read(f)
      if (/platform_support_staff/.test(s)) expect(s).not.toMatch(/platform_support_staff'\)\s*\.(insert|upsert|update|delete)/)
      expect(s).not.toMatch(/support_access_always\s*:/)
      expect(s).not.toMatch(/update\(\{[^}]*support_access_always/)
    }
  })

  test('the migration: additive, no destructive words, service-role only, guards in place', () => {
    const sql = read('supabase/migrations/202611260010_support_access.sql')
    expect(sql).not.toMatch(/drop|delete|truncate/i)
    expect(sql).not.toMatch(/create policy/i)
    for (const t of ['platform_support_staff', 'support_access_grants', 'support_access_log']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated`))
    }
    expect(sql).toContain('support_access_always boolean')
    expect(sql).toContain("RAISE EXCEPTION 'support_access_always can only be set by the server'")
    expect(sql).toMatch(/BEFORE UPDATE ON public\.support_access_log/)
    expect(sql).toMatch(/GRANT SELECT, INSERT ON public\.support_access_log TO service_role/)
    expect(sql).toMatch(/REVOKE ALL ON public\.support_access_log FROM PUBLIC, anon, authenticated, service_role/)
  })

  test('the support routes are the only app routes that issue the session cookie', () => {
    const offenders = sources(['app']).filter((f) => /setSupportCookie/.test(read(f)) && !f.startsWith('app/api/support/'))
    expect(offenders).toEqual([])
  })
})
