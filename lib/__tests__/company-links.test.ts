/** @jest-environment node */
import fs from 'fs'
import path from 'path'

import type { SupabaseClient } from '@supabase/supabase-js'

// The helper creates its own service client; tests swap in a fake one (installed by fakeClient / installClient).
let currentClient: SupabaseClient | null = null
const serviceCalls = { n: 0 }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    serviceCalls.n += 1
    if (!currentClient) throw new Error('no client')
    return currentClient
  },
}))
function installClient(c: SupabaseClient): SupabaseClient {
  currentClient = c
  return c
}

import { __resetAppUrlWarningsForTests, clientLinkBase, getAppUrl } from '@/lib/app-url'
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
import { isPublicPath } from '@/lib/public-paths'

const ROOT = path.resolve(__dirname, '..', '..')
const SHARED = 'https://crm.example.test'
const BASE = 'product.example.test'
const ACME = `https://acme.${BASE}`

type Row = { id: string; subdomain?: string | null }
function fakeClient(opts: { rows?: Row[]; error?: { code?: string; message?: string } | null; calls?: { n: number } } = {}) {
  const calls = opts.calls ?? { n: 0 }
  return installClient({
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
  } as unknown as SupabaseClient)
}

const ORGS: Row[] = [
  { id: 'org-arx', subdomain: null },
  { id: 'org-acme', subdomain: 'acme' },
]

const env = { url: process.env.NEXT_PUBLIC_APP_URL, base: process.env.APP_BASE_DOMAIN }
let errorSpy: jest.SpyInstance
let warnSpy: jest.SpyInstance
beforeEach(() => {
  __resetCompanyLinksCacheForTests()
  __resetAppUrlWarningsForTests()
  currentClient = null
  serviceCalls.n = 0
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  process.env.NEXT_PUBLIC_APP_URL = SHARED
  process.env.APP_BASE_DOMAIN = BASE
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  jest.useRealTimers()
  if (env.url === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = env.url
  if (env.base === undefined) delete process.env.APP_BASE_DOMAIN
  else process.env.APP_BASE_DOMAIN = env.base
})

describe('loadOrgForLinks / orgAppUrl', () => {
  it("gives a company with a web name its own address and the original company (none set) the shared one", async () => {
    fakeClient({ rows: ORGS })
    expect(await orgAppUrl('org-acme')).toBe(ACME)
    expect(await orgAppUrl('org-arx')).toBe(SHARED)
    expect(await orgAppUrl(null)).toBe(SHARED)
  })

  it('is byte-identical to today while routing is off, even for a company with a web name', async () => {
    delete process.env.APP_BASE_DOMAIN
    fakeClient({ rows: ORGS })
    expect(await orgAppUrl('org-acme')).toBe(getAppUrl())
    expect(await orgAppUrl('org-arx')).toBe(getAppUrl())
  })

  it('treats a missing column (migration not applied) as no web name and caches it', async () => {
    const calls = { n: 0 }
    fakeClient({ error: { code: '42703', message: 'column orgs.subdomain does not exist' }, calls })
    expect(await readOrgSubdomain('org-acme')).toEqual({ ok: true, subdomain: null })
    expect(await orgAppUrl('org-acme')).toBe(SHARED)
    expect(await orgAppUrl('org-acme')).toBe(SHARED)
    expect(calls.n).toBe(2) // one uncached read + one cached load
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('caches for 60 s and dedupes concurrent loads', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    const calls = { n: 0 }
    fakeClient({ rows: ORGS, calls })
    await Promise.all([loadOrgForLinks('org-acme'), loadOrgForLinks('org-acme')])
    expect(calls.n).toBe(1)
    jest.setSystemTime(1_000_000 + 59_000)
    await loadOrgForLinks('org-acme')
    expect(calls.n).toBe(1)
    jest.setSystemTime(1_000_000 + 61_000)
    await loadOrgForLinks('org-acme')
    expect(calls.n).toBe(2)
  })

  it('on a read error reuses a recent answer, never caches the error, else falls back to the shared address (logged)', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    const rows = [...ORGS]
    fakeClient({ rows })
    expect(await orgAppUrl('org-acme')).toBe(ACME)
    jest.setSystemTime(1_000_000 + 5 * 60_000)
    fakeClient({ error: { code: '08006', message: 'connection reset' } })
    expect(await orgAppUrl('org-acme')).toBe(ACME)
    jest.setSystemTime(1_000_000 + 11 * 60_000)
    expect(await orgAppUrl('org-acme')).toBe(SHARED)
    expect(errorSpy).toHaveBeenCalled()
    // A throwing client is the same as an error.
    installClient({ from: () => { throw new Error('boom') } } as unknown as SupabaseClient)
    expect(await orgAppUrl('org-new')).toBe(SHARED)
    // Recovery is immediate (the error was not cached).
    fakeClient({ rows })
    expect(await orgAppUrl('org-acme')).toBe(ACME)
  })

  it('refuses a stored value that is not a valid web name', async () => {
    fakeClient({ rows: [{ id: 'org-x', subdomain: 'www' }, { id: 'org-y', subdomain: 'a.b' }] })
    expect(await orgAppUrl('org-x')).toBe(SHARED)
    expect(await orgAppUrl('org-y')).toBe(SHARED)
  })

  it('tryOrgAppUrl returns null (logged) when nothing is configured; orgAppUrl throws', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    fakeClient({ rows: ORGS })
    expect(await tryOrgAppUrl('org-arx', 'test')).toBeNull()
    await expect(orgAppUrl('org-arx')).rejects.toThrow('App address is not configured')
    // A company with its own address still gets it.
    expect(await tryOrgAppUrl('org-acme', 'test')).toBe(ACME)
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
    fakeClient({ rows: ORGS })
    const acme = build(await orgAppUrl('org-acme'))
    const arx = build(await orgAppUrl('org-arx'))
    expect(acme.startsWith(`${ACME}/`)).toBe(true)
    expect(arx.startsWith(`${SHARED}/`)).toBe(true)
    expect(acme.slice(ACME.length)).toBe(arx.slice(SHARED.length))
  })

  it('ARX (no web name) links are byte-identical to the pre-change builders', async () => {
    fakeClient({ rows: ORGS })
    const arx = await orgAppUrl('org-arx')
    expect(crewLinkUrl(TOKEN, arx)).toBe(crewLinkUrl(TOKEN))
    expect(customerSignedDocUrl('contract', TOKEN, arx)).toBe(customerSignedDocUrl('contract', TOKEN))
    expect(buildPayrollStatementEmailUrl('p', await loadOrgForLinks('org-arx'))).toBe(
      buildPayrollStatementEmailUrl('p')
    )
    expect(buildTodayHtml([], arx)).toBe(buildTodayHtml([]))
    const report = { generatedAt: '', jobs: [], appointments: [], count: 0 }
    expect(buildNeedsYouHtml(report, arx)).toBe(buildNeedsYouHtml(report))
  })

  it('payroll statement takes the loaded company directly', async () => {
    fakeClient({ rows: ORGS })
    const acme = await loadOrgForLinks('org-acme')
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
  // signed-doc builder's and the morning-email builders' fallback when no address is handed in (their one sender
  // passes the company's address — checked below).
  const ALLOWED = new Set([
    'lib/app-url.ts',
    'lib/company-links.ts',
    'lib/google-calendar.ts',
    'lib/files/files-object.ts',
    'lib/morning-update-email.ts',
  ])
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

  it('the morning email sender hands its builders the company address', () => {
    const src = fs.readFileSync(path.join(root, 'lib/morning-update-email.ts'), 'utf8')
    expect(src).toMatch(/await tryOrgAppUrl\(params\.orgId,/)
    expect(src).toMatch(/buildMorningUpdateHtml\(metrics, \{[^}]*\bappUrl\b[^}]*\}\)/)
  })
})

describe('wiring: each sent link is built on the record company address', () => {
  // Route-level links are inline strings; this pins each one to the company-links helper and the org that owns the
  // record (or the signed-in user's own org, which is the record's org because every record read is org-scoped).
  const root = path.resolve(__dirname, '..', '..')
  const WIRING: Array<[string, string, RegExp]> = [
    ['signing link: contract created', 'app/api/contracts/create/route.ts', /orgAppUrl\(profile\.org_id\)[\s\S]*\$\{appUrl\}\/contracts\/sign\//],
    ['signing link: contract re-sent', 'app/api/contracts/[id]/send/route.ts', /\$\{await orgAppUrl\(contract\.org_id\)\}\/contracts\//],
    ['signing link: change order', 'lib/change-orders-remote.ts', /orgAppUrl\(input\.orgId\)[\s\S]*\$\{appUrl\}\/change-orders\/sign\//],
    ['signed contract download', 'app/api/contracts/sign/route.ts', /customerSignedDocUrl\('contract', [^\n]*tryOrgAppUrl\(contract\.org_id,/],
    ['contract signed: admin sale email', 'app/api/contracts/sign/route.ts', /tryOrgAppUrl\(contract\.org_id, 'contract signed: admin sale email'\)/],
    ['signed change-order download', 'app/api/change-orders/sign/route.ts', /tryOrgAppUrl\(changeOrder\.org_id,/],
    ['quote link', 'lib/quotes/approve.ts', /\$\{await orgAppUrl\(orgId\)\}\/q\//],
    ['/r report link', 'app/api/inspection-reports/[id]/send/route.ts', /\$\{await orgAppUrl\(profile\.org_id\)\}\/r\//],
    ['review link (SMS)', 'app/api/jobs/[id]/review-request/route.ts', /orgAppUrl\(job\.org_id\)/],
    ['password reset', 'app/api/admin/users/route.ts', /orgAppUrl\(targetUser\.org_id\)[\s\S]*\$\{appUrl\}\/reset-password/],
    ['employee agreement', 'app/api/admin/employee-agreements/route.ts', /orgAppUrl\(claimed\.org_id as string\)/],
    ['crew links (crews list)', 'app/api/ops/jobs/[id]/trades/route.ts', /tryOrgAppUrl\(orgId,[\s\S]*crewLinkUrl\(t\.crew_link_token, appUrl\)/],
    ['calendar invite', 'lib/install-calendar.ts', /params\.appUrl \?\? \(await orgAppUrl\(trade\.org_id\)\)/],
    ['sub work order complete', 'app/api/subs/work-orders/[id]/complete/route.ts', /orgAppUrl\(workOrder\.org_id\)/],
    ['canvass lead emails', 'app/api/canvass/lead/route.ts', /orgAppUrl\(profile\.org_id\)/],
    ['webhook lead email', 'app/api/webhooks/leads/route.ts', /orgAppUrl\(org_id\)/],
    ['appointment email', 'app/api/appointments/[id]/route.ts', /orgAppUrl\(profile\.org_id\)/],
    ['website estimate lead', 'lib/public-estimate-lead.ts', /\$\{await orgAppUrl\(orgId\)\}\/leads\//],
    ['payment email', 'lib/job-payment-email.ts', /\$\{await orgAppUrl\(params\.orgId\)\}\/ops\/jobs\//],
    ['thread notifications', 'lib/threads/notify.ts', /\$\{await orgAppUrl\(input\.orgId\)\}\$\{path\}/],
    ['payroll statement (manual)', 'app/api/admin/payroll/statements/email/route.ts', /linkOrg: await loadOrgForLinks\(orgId\)/],
    ['payroll statement (approve)', 'lib/payroll-approve.ts', /loadOrgForLinks\(orgId\)/],
    ['morning update (cron)', 'lib/morning-update-email.ts', /tryOrgAppUrl\(params\.orgId,/],
  ]
  it.each(WIRING)('%s', (_name, file, pattern) => {
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toMatch(pattern)
  })

  it('browser copy buttons go through clientLinkBase', () => {
    for (const f of [
      'components/inspection-report/CopyShareLinkButton.tsx',
      'components/inspection-report/ReportBuilder.tsx',
      'components/contracts/ContractListItem.tsx',
      'components/change-orders/ChangeOrdersSection.tsx',
      'app/admin/campaigns/page.tsx',
    ]) {
      const src = fs.readFileSync(path.join(root, f), 'utf8')
      expect(src).toMatch(/clientLinkBase\(/)
      expect(src).not.toMatch(/window\.location\.origin|NEXT_PUBLIC_APP_URL/)
    }
  })
})

describe('review fixes', () => {
  it('reads with the service client it creates itself; callers cannot hand in a client', async () => {
    expect(loadOrgForLinks.length).toBe(1)
    expect(orgAppUrl.length).toBe(1)
    expect(tryOrgAppUrl.length).toBe(2)
    expect(readOrgSubdomain.length).toBe(1)
    fakeClient({ rows: ORGS })
    await loadOrgForLinks('org-acme')
    expect(serviceCalls.n).toBe(1)
    // A missing service key is a read error (shared address, logged), never a thrown request.
    __resetCompanyLinksCacheForTests()
    currentClient = null
    expect(await orgAppUrl('org-acme')).toBe(SHARED)
    expect(errorSpy).toHaveBeenCalled()
  })

  describe('cutover guard: routing on, company has no web name', () => {
    it('falls back to the legacy shared address and says so', async () => {
      fakeClient({ rows: ORGS })
      expect(await orgAppUrl('org-arx')).toBe(SHARED)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has no web name'))
    })
    it('builds no link when the fallback is the bare product domain or another company address', async () => {
      fakeClient({ rows: ORGS })
      for (const fallback of [`https://${BASE}`, `https://www.${BASE}`, ACME]) {
        process.env.NEXT_PUBLIC_APP_URL = fallback
        await expect(orgAppUrl('org-arx')).rejects.toThrow('no web name')
        expect(await tryOrgAppUrl('org-arx', 't')).toBeNull()
        // A company with its own name is unaffected.
        expect(await orgAppUrl('org-acme')).toBe(ACME)
      }
    })
    it('no warning or change while routing is off, and bare getAppUrl() is untouched', async () => {
      fakeClient({ rows: ORGS })
      delete process.env.APP_BASE_DOMAIN
      expect(await orgAppUrl('org-arx')).toBe(SHARED)
      expect(warnSpy).not.toHaveBeenCalled()
      process.env.APP_BASE_DOMAIN = BASE
      process.env.NEXT_PUBLIC_APP_URL = `https://${BASE}`
      expect(getAppUrl()).toBe(`https://${BASE}`)
    })
  })

  it('compensation agreement pages are public token pages and print the company, not a fixed brand', () => {
    expect(isPublicPath('/comp-agreements/sign/tok')).toBe(true)
    expect(isPublicPath('/comp-agreements/receipt/tok')).toBe(true)
    expect(isPublicPath('/comp-agreements')).toBe(false)
    for (const f of ['app/comp-agreements/sign/[token]/page.tsx', 'app/comp-agreements/receipt/[token]/page.tsx']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      expect(src).not.toMatch(/ARX/)
      expect(src).toMatch(/getOrgBrand\(admin, data\.org_id\)/)
    }
    const send = fs.readFileSync(path.join(ROOT, 'app/api/admin/employee-agreements/route.ts'), 'utf8')
    expect(send).not.toMatch(/`ARX /)
  })
})
