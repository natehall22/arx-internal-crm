/** @jest-environment node */
import fs from 'fs'
import path from 'path'

import type { SupabaseClient } from '@supabase/supabase-js'

import { clientLinkBase, getAppUrl } from '@/lib/app-url'
import {
  __resetCompanyLinksCacheForTests,
  loadOrgForLinks,
  orgAppUrl,
  readOrgSubdomain,
  tryOrgAppUrl,
} from '@/lib/company-links'
import { customerSignedDocUrl } from '@/lib/files/files-object'
import { buildInstallEvent } from '@/lib/install-calendar'
import { crewLinkUrl } from '@/lib/job-trades'
import { buildNeedsYouHtml, buildTodayHtml } from '@/lib/morning-update-email'
import { buildPayrollStatementEmailUrl } from '@/lib/payroll-statement-email'
import { buildTrackedReviewLink } from '@/lib/review-requests'

const SHARED = 'https://crm.example.test'
const BASE = 'product.example.test'
const ACME = `https://acme.${BASE}`

type Row = { id: string; subdomain?: string | null }
function fakeClient(opts: { rows?: Row[]; error?: { code?: string; message?: string } | null; calls?: { n: number } } = {}) {
  const calls = opts.calls ?? { n: 0 }
  return {
    from(table: string) {
      expect(table).toBe('orgs')
      let id = ''
      const q = {
        select(cols: string) {
          expect(cols).toBe('subdomain')
          return q
        },
        eq(col: string, v: string) {
          expect(col).toBe('id')
          id = v
          return q
        },
        async maybeSingle() {
          calls.n += 1
          if (opts.error) return { data: null, error: opts.error }
          const row = (opts.rows ?? []).find((r) => r.id === id) ?? null
          return { data: row ? { subdomain: row.subdomain ?? null } : null, error: null }
        },
      }
      return q
    },
  } as unknown as SupabaseClient
}

const ORGS: Row[] = [
  { id: 'org-arx', subdomain: null },
  { id: 'org-acme', subdomain: 'acme' },
]

const env = { url: process.env.NEXT_PUBLIC_APP_URL, base: process.env.APP_BASE_DOMAIN }
let errorSpy: jest.SpyInstance
beforeEach(() => {
  __resetCompanyLinksCacheForTests()
  process.env.NEXT_PUBLIC_APP_URL = SHARED
  process.env.APP_BASE_DOMAIN = BASE
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  jest.useRealTimers()
  if (env.url === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = env.url
  if (env.base === undefined) delete process.env.APP_BASE_DOMAIN
  else process.env.APP_BASE_DOMAIN = env.base
})

describe('loadOrgForLinks / orgAppUrl', () => {
  it("gives a company with a web name its own address and the original company (none set) the shared one", async () => {
    const db = fakeClient({ rows: ORGS })
    expect(await orgAppUrl(db, 'org-acme')).toBe(ACME)
    expect(await orgAppUrl(db, 'org-arx')).toBe(SHARED)
    expect(await orgAppUrl(db, null)).toBe(SHARED)
  })

  it('is byte-identical to today while routing is off, even for a company with a web name', async () => {
    delete process.env.APP_BASE_DOMAIN
    const db = fakeClient({ rows: ORGS })
    expect(await orgAppUrl(db, 'org-acme')).toBe(getAppUrl())
    expect(await orgAppUrl(db, 'org-arx')).toBe(getAppUrl())
  })

  it('treats a missing column (migration not applied) as no web name and caches it', async () => {
    const calls = { n: 0 }
    const db = fakeClient({ error: { code: '42703', message: 'column orgs.subdomain does not exist' }, calls })
    expect(await readOrgSubdomain(db, 'org-acme')).toEqual({ ok: true, subdomain: null })
    expect(await orgAppUrl(db, 'org-acme')).toBe(SHARED)
    expect(await orgAppUrl(db, 'org-acme')).toBe(SHARED)
    expect(calls.n).toBe(2) // one uncached read + one cached load
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('caches for 60 s and dedupes concurrent loads', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    const calls = { n: 0 }
    const db = fakeClient({ rows: ORGS, calls })
    await Promise.all([loadOrgForLinks(db, 'org-acme'), loadOrgForLinks(db, 'org-acme')])
    expect(calls.n).toBe(1)
    jest.setSystemTime(1_000_000 + 59_000)
    await loadOrgForLinks(db, 'org-acme')
    expect(calls.n).toBe(1)
    jest.setSystemTime(1_000_000 + 61_000)
    await loadOrgForLinks(db, 'org-acme')
    expect(calls.n).toBe(2)
  })

  it('on a read error reuses a recent answer, never caches the error, else falls back to the shared address (logged)', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    const rows = [...ORGS]
    const good = fakeClient({ rows })
    expect(await orgAppUrl(good, 'org-acme')).toBe(ACME)
    jest.setSystemTime(1_000_000 + 5 * 60_000)
    const broken = fakeClient({ error: { code: '08006', message: 'connection reset' } })
    expect(await orgAppUrl(broken, 'org-acme')).toBe(ACME)
    jest.setSystemTime(1_000_000 + 11 * 60_000)
    expect(await orgAppUrl(broken, 'org-acme')).toBe(SHARED)
    expect(errorSpy).toHaveBeenCalled()
    // A throwing client is the same as an error.
    const throwing = { from: () => { throw new Error('boom') } } as unknown as SupabaseClient
    expect(await orgAppUrl(throwing, 'org-new')).toBe(SHARED)
    // Recovery is immediate (the error was not cached).
    expect(await orgAppUrl(good, 'org-acme')).toBe(ACME)
  })

  it('refuses a stored value that is not a valid web name', async () => {
    const db = fakeClient({ rows: [{ id: 'org-x', subdomain: 'www' }, { id: 'org-y', subdomain: 'a.b' }] })
    expect(await orgAppUrl(db, 'org-x')).toBe(SHARED)
    expect(await orgAppUrl(db, 'org-y')).toBe(SHARED)
  })

  it('tryOrgAppUrl returns null (logged) when nothing is configured; orgAppUrl throws', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const db = fakeClient({ rows: ORGS })
    expect(await tryOrgAppUrl(db, 'org-arx', 'test')).toBeNull()
    await expect(orgAppUrl(db, 'org-arx')).rejects.toThrow('App address is not configured')
    // A company with its own address still gets it.
    expect(await tryOrgAppUrl(db, 'org-acme', 'test')).toBe(ACME)
  })
})

describe('every link type uses the company address it is handed, and is unchanged for the original company', () => {
  const TOKEN = 'tok_123'
  const cases: Array<[string, (base: string) => string]> = [
    ['crew photo link', (b) => crewLinkUrl(TOKEN, b)],
    ['signed contract download', (b) => customerSignedDocUrl('contract', TOKEN, b) as string],
    ['signed change-order download', (b) => customerSignedDocUrl('change-order', TOKEN, b) as string],
    ['review link', (b) => buildTrackedReviewLink(b, TOKEN)],
    ['payroll statement', (b) => buildPayrollStatementEmailUrl('period-1', { appUrl: b })],
  ]

  it.each(cases)('%s', async (_name, build) => {
    const db = fakeClient({ rows: ORGS })
    const acme = build(await orgAppUrl(db, 'org-acme'))
    const arx = build(await orgAppUrl(db, 'org-arx'))
    expect(acme.startsWith(`${ACME}/`)).toBe(true)
    expect(arx.startsWith(`${SHARED}/`)).toBe(true)
    expect(acme.slice(ACME.length)).toBe(arx.slice(SHARED.length))
  })

  it('ARX (no web name) links are byte-identical to the pre-change builders', async () => {
    const arx = await orgAppUrl(fakeClient({ rows: ORGS }), 'org-arx')
    expect(crewLinkUrl(TOKEN, arx)).toBe(crewLinkUrl(TOKEN))
    expect(customerSignedDocUrl('contract', TOKEN, arx)).toBe(customerSignedDocUrl('contract', TOKEN))
    expect(buildPayrollStatementEmailUrl('p', await loadOrgForLinks(fakeClient({ rows: ORGS }), 'org-arx'))).toBe(
      buildPayrollStatementEmailUrl('p')
    )
    expect(buildTodayHtml([], arx)).toBe(buildTodayHtml([]))
    const report = { generatedAt: '', jobs: [], appointments: [], count: 0 }
    expect(buildNeedsYouHtml(report, arx)).toBe(buildNeedsYouHtml(report))
  })

  it('payroll statement takes the loaded company directly', async () => {
    const acme = await loadOrgForLinks(fakeClient({ rows: ORGS }), 'org-acme')
    expect(buildPayrollStatementEmailUrl('p', acme)).toBe(`${ACME}/commissions/statement/p`)
  })

  it('install invite: crew photo link and staff job link', () => {
    const base = {
      jobId: 'job-1',
      jobNumber: '26-0001',
      customerName: 'C',
      addressText: '1 Main St',
      scheduledDate: '2026-11-20',
      installDays: 1,
      crewLinkToken: TOKEN,
    }
    const acme = buildInstallEvent({ ...base, appUrl: ACME }).description ?? ''
    expect(acme).toContain(`${ACME}/crew/${TOKEN}`)
    expect(acme).toContain(`${ACME}/ops/jobs/job-1`)
    expect(acme).not.toContain(SHARED)
    expect(buildInstallEvent({ ...base, appUrl: SHARED })).toEqual(buildInstallEvent(base))
  })

  it('morning update Today + Needs you', () => {
    const q = { id: 'jobs', title: 'Jobs', count: 1, empty: 'none', items: [{ id: 'j1', title: 'Job', detail: '', ref: 'Job 26-0001', href: '/ops/jobs/1', note: '' }] }
    const html = buildTodayHtml([q], ACME)
    expect(html).toContain(`${ACME}/ops/jobs/1`)
    expect(html).not.toContain(SHARED)
  })
})

describe('clientLinkBase (browser copy buttons)', () => {
  it('uses the current address only when it is a company address under the shared one', () => {
    process.env.NEXT_PUBLIC_APP_URL = `https://${BASE}`
    expect(clientLinkBase('t', { host: `acme.${BASE}`, origin: ACME })).toBe(ACME)
    // The shared address itself, www, previews, localhost and nested names keep today's rule.
    expect(clientLinkBase('t', { host: BASE, origin: `https://${BASE}` })).toBe(`https://${BASE}`)
    expect(clientLinkBase('t', { host: `www.${BASE}`, origin: `https://www.${BASE}` })).toBe(`https://${BASE}`)
    expect(clientLinkBase('t', { host: 'preview-123.example.app', origin: 'https://preview-123.example.app' })).toBe(`https://${BASE}`)
    expect(clientLinkBase('t', { host: `a.b.${BASE}`, origin: `https://a.b.${BASE}` })).toBe(`https://${BASE}`)
  })

  it('is unchanged for the original company on its current address', () => {
    process.env.NEXT_PUBLIC_APP_URL = SHARED
    expect(clientLinkBase('t', { host: 'crm.example.test', origin: SHARED })).toBe(SHARED)
    // Not configured: the current origin, as before.
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(clientLinkBase('t', { host: 'localhost:3000', origin: 'http://localhost:3000' })).toBe('http://localhost:3000')
  })
})

describe('guard: server links are built for a company', () => {
  // Every server-side link must name the record's company (orgAppUrl / tryOrgAppUrl / loadOrgForLinks → getAppUrl(org)).
  // Allowed bare calls: the helpers themselves, the Google OAuth callback (one fixed return host by design) and the
  // signed-doc builder's fallback when no address is handed in.
  const ALLOWED = new Set(['lib/app-url.ts', 'lib/company-links.ts', 'lib/google-calendar.ts', 'lib/files/files-object.ts'])
  const root = path.resolve(__dirname, '..', '..')
  function walk(dir: string, out: string[]) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
  }
  it('has no bare getAppUrl() / tryGetAppUrl(context) outside the allow-list', () => {
    const files: string[] = []
    for (const d of ['app', 'lib', 'components', 'hooks']) walk(path.join(root, d), files)
    const offenders: string[] = []
    for (const f of files) {
      const rel = path.relative(root, f).split(path.sep).join('/')
      if (ALLOWED.has(rel)) continue
      const src = fs.readFileSync(f, 'utf8')
      if (/\bgetAppUrl\(\s*\)/.test(src) || /\btryGetAppUrl\(\s*['"`][^'"`]*['"`]\s*\)/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
