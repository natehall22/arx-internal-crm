/** @jest-environment node */
/**
 * Company web address → company (lib/company-host.ts): host parsing, subdomain rules, the lookup cache and the
 * fence precedence DEPLOYMENT_ORG_ID > host > company-code header, with every disagreement failing closed.
 */
import fs from 'fs'
import path from 'path'

import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_RE,
  __resetCompanyHostCacheForTests,
  classifyHost,
  companyAppUrl,
  fenceAllowsOrg,
  hostnameFromHeader,
  lookupCompanyBySubdomain,
  lookupSubdomainAlias,
  normalizeSubdomain,
  resolveCompanyFence,
} from '@/lib/company-host'

const BASE = 'crm-product.test'
const ORGS: Record<string, string> = { acme: 'org-acme', roofco: 'org-roofco' }
let fetchMock: jest.Mock
let lookupFails = false

const ENV_KEYS = ['APP_BASE_DOMAIN', 'SUPABASE_SERVICE_ROLE_KEY', 'DEPLOYMENT_ORG_ID', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.APP_BASE_DOMAIN = BASE
  delete process.env.DEPLOYMENT_ORG_ID
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  lookupFails = false
  __resetCompanyHostCacheForTests()
  fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
    if (lookupFails) return { ok: false, status: 500, json: async () => ({}) }
    const { p_subdomain } = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ORGS[p_subdomain] ?? null }
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('hostnameFromHeader / classifyHost', () => {
  test('strips port, case and trailing dot', () => {
    expect(hostnameFromHeader('ACME.Crm-Product.test:443')).toBe('acme.crm-product.test')
    expect(hostnameFromHeader('acme.crm-product.test.')).toBe('acme.crm-product.test')
    expect(hostnameFromHeader('[::1]:3000')).toBe('[::1]')
    expect(hostnameFromHeader(null)).toBe('')
  })

  test('routing off when APP_BASE_DOMAIN is unset or not a domain', () => {
    delete process.env.APP_BASE_DOMAIN
    expect(classifyHost('acme.crm-product.test')).toEqual({ kind: 'off' })
    process.env.APP_BASE_DOMAIN = 'localhost'
    expect(classifyHost('acme.localhost')).toEqual({ kind: 'off' })
  })

  test('company, apex, www, legacy, nested, reserved, look-alike', () => {
    expect(classifyHost('acme.crm-product.test')).toEqual({ kind: 'company', subdomain: 'acme' })
    expect(classifyHost('crm-product.test')).toEqual({ kind: 'apex' })
    expect(classifyHost('www.crm-product.test')).toEqual({ kind: 'apex' })
    expect(classifyHost('old-app.vercel.app')).toEqual({ kind: 'legacy' })
    expect(classifyHost('localhost:3000')).toEqual({ kind: 'legacy' })
    expect(classifyHost('a.b.crm-product.test')).toEqual({ kind: 'invalid' })
    expect(classifyHost('api.crm-product.test')).toEqual({ kind: 'invalid' })
    expect(classifyHost('-x.crm-product.test')).toEqual({ kind: 'invalid' })
    // A different domain that merely ENDS with the base text is not under it.
    expect(classifyHost('evilcrm-product.test')).toEqual({ kind: 'legacy' })
  })

  test('normalizeSubdomain (the write-side rule)', () => {
    expect(normalizeSubdomain(' Acme ')).toBe('acme')
    expect(normalizeSubdomain('green-lawns2')).toBe('green-lawns2')
    expect(normalizeSubdomain('www')).toBeNull()
    expect(normalizeSubdomain('a_b')).toBeNull()
    expect(normalizeSubdomain('ends-')).toBeNull()
    expect(normalizeSubdomain('x'.repeat(64))).toBeNull()
    expect(normalizeSubdomain(42)).toBeNull()
  })
})

describe('lookup cache', () => {
  test('caches hits and misses for a short time; never caches errors', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    expect(await lookupCompanyBySubdomain('acme')).toEqual({ status: 'found', orgId: 'org-acme' })
    expect(await lookupCompanyBySubdomain('acme')).toEqual({ status: 'found', orgId: 'org-acme' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    jest.setSystemTime(1_000_000 + 61_000)
    await lookupCompanyBySubdomain('acme')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(await lookupCompanyBySubdomain('nobody')).toEqual({ status: 'not_found' })
    await lookupCompanyBySubdomain('nobody')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    lookupFails = true
    expect(await lookupCompanyBySubdomain('roofco')).toEqual({ status: 'error' })
    lookupFails = false
    expect(await lookupCompanyBySubdomain('roofco')).toEqual({ status: 'found', orgId: 'org-roofco' })
  })

  test('stale-on-error: a known company survives a DB blip for up to 10 minutes; unknown names do not', async () => {
    jest.useFakeTimers({ now: 5_000_000 })
    await lookupCompanyBySubdomain('acme')
    jest.setSystemTime(5_000_000 + 120_000)
    lookupFails = true
    expect(await lookupCompanyBySubdomain('acme')).toEqual({ status: 'found', orgId: 'org-acme' })
    jest.setSystemTime(5_000_000 + 11 * 60_000)
    expect(await lookupCompanyBySubdomain('acme')).toEqual({ status: 'error' })
    expect(await lookupCompanyBySubdomain('nobody')).toEqual({ status: 'error' })
  })

  test('concurrent lookups of one name share one DB call', async () => {
    await Promise.all([lookupCompanyBySubdomain('acme'), lookupCompanyBySubdomain('acme'), lookupCompanyBySubdomain('acme')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('separate bounded caches: a flood of unknown names never evicts a real company', async () => {
    await lookupCompanyBySubdomain('acme')
    for (let i = 0; i < 1200; i++) await lookupCompanyBySubdomain(`junk${i}`)
    const calls = fetchMock.mock.calls.length
    await lookupCompanyBySubdomain('acme')
    expect(fetchMock.mock.calls.length).toBe(calls) // still cached, untouched by the flood
    await lookupCompanyBySubdomain('junk1199') // most recent unknown: cached
    expect(fetchMock.mock.calls.length).toBe(calls)
    await lookupCompanyBySubdomain('junk0') // oldest unknown: evicted (cap 1000)
    expect(fetchMock.mock.calls.length).toBe(calls + 1)
  })

  test('anon key only — never the service role key', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret'
    await lookupCompanyBySubdomain('acme')
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(JSON.stringify(init.headers)).not.toContain('service-secret')
    expect(fetchMock.mock.calls[0][0]).toBe('https://proj.supabase.co/rest/v1/rpc/org_id_for_subdomain')
  })

  test('malformed names never reach the database', async () => {
    expect(await lookupCompanyBySubdomain('a.b')).toEqual({ status: 'not_found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('resolveCompanyFence precedence', () => {
  test('legacy host, routing off, no deployment id → open (unchanged behavior)', async () => {
    expect(await resolveCompanyFence({ host: 'old-app.vercel.app' })).toEqual({ kind: 'open' })
    delete process.env.APP_BASE_DOMAIN
    expect(await resolveCompanyFence({ host: 'acme.crm-product.test' })).toEqual({ kind: 'open' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('host company fences to that org', async () => {
    const f = await resolveCompanyFence({ host: 'acme.crm-product.test' })
    expect(f).toEqual({ kind: 'org', orgId: 'org-acme', source: 'host' })
    expect(fenceAllowsOrg(f, 'org-acme')).toBe(true)
    expect(fenceAllowsOrg(f, 'org-roofco')).toBe(false)
    expect(fenceAllowsOrg(f, null)).toBe(false)
  })

  test('unknown / reserved / nested company address and the bare domain refuse', async () => {
    expect(await resolveCompanyFence({ host: 'nobody.crm-product.test' })).toEqual({ kind: 'closed', reason: 'unknown_company' })
    expect(await resolveCompanyFence({ host: 'admin.crm-product.test' })).toEqual({ kind: 'closed', reason: 'unknown_company' })
    expect(await resolveCompanyFence({ host: 'a.acme.crm-product.test' })).toEqual({ kind: 'closed', reason: 'unknown_company' })
    expect(await resolveCompanyFence({ host: 'crm-product.test' })).toEqual({ kind: 'closed', reason: 'apex' })
  })

  test('lookup failure refuses (never falls back to open)', async () => {
    lookupFails = true
    const f = await resolveCompanyFence({ host: 'acme.crm-product.test' })
    expect(f).toEqual({ kind: 'closed', reason: 'lookup_error' })
    expect(fenceAllowsOrg(f, 'org-acme')).toBe(false)
  })

  test('DEPLOYMENT_ORG_ID alone fences on the legacy host', async () => {
    process.env.DEPLOYMENT_ORG_ID = ' org-acme \n'
    expect(await resolveCompanyFence({ host: 'old-app.vercel.app' })).toEqual({ kind: 'org', orgId: 'org-acme', source: 'deployment' })
  })

  test('DEPLOYMENT_ORG_ID wins and a host naming another company is refused', async () => {
    process.env.DEPLOYMENT_ORG_ID = 'org-acme'
    expect(await resolveCompanyFence({ host: 'acme.crm-product.test' })).toEqual({ kind: 'org', orgId: 'org-acme', source: 'deployment' })
    expect(await resolveCompanyFence({ host: 'roofco.crm-product.test' })).toEqual({ kind: 'closed', reason: 'conflict' })
  })

  test('company-code header narrows on the legacy host, must agree with the host, ignored while routing is off', async () => {
    expect(await resolveCompanyFence({ host: 'old-app.vercel.app', companyCode: 'ACME' })).toEqual({
      kind: 'org',
      orgId: 'org-acme',
      source: 'header',
    })
    expect(await resolveCompanyFence({ host: 'acme.crm-product.test', companyCode: 'acme' })).toEqual({
      kind: 'org',
      orgId: 'org-acme',
      source: 'host',
    })
    expect(await resolveCompanyFence({ host: 'acme.crm-product.test', companyCode: 'roofco' })).toEqual({
      kind: 'closed',
      reason: 'conflict',
    })
    expect(await resolveCompanyFence({ host: 'old-app.vercel.app', companyCode: 'nobody' })).toEqual({
      kind: 'closed',
      reason: 'unknown_company',
    })
    expect(await resolveCompanyFence({ host: 'old-app.vercel.app', companyCode: 'bad code!' })).toEqual({
      kind: 'closed',
      reason: 'unknown_company',
    })
    delete process.env.APP_BASE_DOMAIN
    expect(await resolveCompanyFence({ host: 'old-app.vercel.app', companyCode: 'acme' })).toEqual({ kind: 'open' })
  })
})

test('SQL migration mirrors the TS subdomain rule and reserved list', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/202611230090_reserve_arx_subdomain.sql'), 'utf8')
  expect(sql).toContain(`subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`)
  expect(SUBDOMAIN_RE.source).toBe('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
  const list = sql.match(/subdomain not in \(([\s\S]*?)\)/)?.[1] ?? ''
  const sqlReserved = Array.from(list.matchAll(/'([a-z0-9-]+)'/g), (m) => m[1]).sort()
  expect(sqlReserved).toEqual(Array.from(RESERVED_SUBDOMAINS).sort())
})

test('companyAppUrl: stored address → link origin; nothing when unset or routing off', () => {
  expect(companyAppUrl('Acme')).toBe('https://acme.crm-product.test')
  expect(companyAppUrl(null)).toBeNull()
  expect(companyAppUrl('www')).toBeNull()
  delete process.env.APP_BASE_DOMAIN
  expect(companyAppUrl('acme')).toBeNull()
})

describe('lookupSubdomainAlias (renamed companies)', () => {
  const ALIASES: Record<string, string> = { 'acme-old': 'acme', loop: 'loop' }
  beforeEach(() => {
    fetchMock.mockImplementation(async (u: string, init: { body: string }) => {
      if (lookupFails) return { ok: false, status: 500, json: async () => ({}) }
      const sub = JSON.parse(init.body).p_subdomain
      return { ok: true, status: 200, json: async () => (u.endsWith('/company_subdomain_for_alias') ? ALIASES[sub] ?? null : null) }
    })
  })

  test('old name → current name; unknown and self-pointing names are not aliases', async () => {
    expect(await lookupSubdomainAlias('acme-old')).toEqual({ status: 'moved', subdomain: 'acme' })
    expect(await lookupSubdomainAlias('nobody')).toEqual({ status: 'not_found' })
    expect(await lookupSubdomainAlias('loop')).toEqual({ status: 'not_found' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://proj.supabase.co/rest/v1/rpc/company_subdomain_for_alias')
  })

  test('cached (found and unknown), errors never cached, malformed never queried', async () => {
    await lookupSubdomainAlias('acme-old')
    await lookupSubdomainAlias('acme-old')
    await lookupSubdomainAlias('nobody')
    await lookupSubdomainAlias('nobody')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    lookupFails = true
    expect(await lookupSubdomainAlias('other')).toEqual({ status: 'error' })
    lookupFails = false
    expect(await lookupSubdomainAlias('other')).toEqual({ status: 'not_found' })
    expect(await lookupSubdomainAlias('a.b')).toEqual({ status: 'not_found' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  test('migration file: alias table, rename trigger, reuse guard, anon RPC that returns no org id', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/202611100095_org_subdomain_aliases.sql'), 'utf8')
    expect(sql).toMatch(/create table if not exists public\.org_subdomain_aliases/)
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/after update of subdomain on public\.orgs/)
    expect(sql).toMatch(/before insert or update of subdomain on public\.orgs/)
    expect(sql).toMatch(/function public\.company_subdomain_for_alias\(p_subdomain text\)\s+returns text/)
    expect(sql).toMatch(/grant execute on function public\.company_subdomain_for_alias\(text\) to anon/)
    // Same label rule as orgs.subdomain.
    expect(sql).toContain(`'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`)
    expect(SUBDOMAIN_RE.source).toBe('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
  })
})
