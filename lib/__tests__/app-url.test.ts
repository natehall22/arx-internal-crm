/** @jest-environment node */
import { AppUrlNotConfiguredError, configuredAppHost, getAppUrl, parseAppUrl, tryGetAppUrl } from '@/lib/app-url'
import { crewLinkUrl } from '@/lib/job-trades'
import { customerSignedDocLinkForPage, customerSignedDocUrl } from '@/lib/files/files-object'
import { buildNeedsYouHtml, buildTodayHtml } from '@/lib/morning-update-email'
import { readFileSync } from 'node:fs'

const OLD = process.env.NEXT_PUBLIC_APP_URL
let errorSpy: jest.SpyInstance
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = OLD
})

describe('parseAppUrl', () => {
  it('normalizes to the origin', () => {
    expect(parseAppUrl('https://crm.example.test/')).toBe('https://crm.example.test')
    expect(parseAppUrl('  https://CRM.Example.test  ')).toBe('https://crm.example.test')
    expect(parseAppUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('rejects blanks, missing schemes, paths and other protocols instead of trimming them', () => {
    for (const bad of [undefined, null, '', '   ', 'undefined', 'crm.example.test', 'https://crm.example.test/app', 'https://crm.example.test/?x=1', 'ftp://crm.example.test', 'javascript:alert(1)']) {
      expect(parseAppUrl(bad)).toBeNull()
    }
  })
})

describe('getAppUrl', () => {
  it("builds the company's address from its stored subdomain only while host routing is on", () => {
    const oldBase = process.env.APP_BASE_DOMAIN
    try {
      process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
      delete process.env.APP_BASE_DOMAIN
      expect(getAppUrl({ subdomain: 'acme' })).toBe('https://crm.example.test')
      process.env.APP_BASE_DOMAIN = 'product.example.test'
      expect(getAppUrl({ subdomain: 'Acme' })).toBe('https://acme.product.example.test')
      // An explicit address wins; a reserved or malformed name never becomes a link (falls back to the deployment's).
      expect(getAppUrl({ appUrl: 'https://own.example.test', subdomain: 'acme' })).toBe('https://own.example.test')
      expect(getAppUrl({ subdomain: 'www' })).toBe('https://crm.example.test')
      expect(getAppUrl({ subdomain: 'a.b' })).toBe('https://crm.example.test')
      expect(getAppUrl({ subdomain: null })).toBe('https://crm.example.test')
    } finally {
      if (oldBase === undefined) delete process.env.APP_BASE_DOMAIN
      else process.env.APP_BASE_DOMAIN = oldBase
    }
  })
  it('reads NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test/'
    expect(getAppUrl()).toBe('https://crm.example.test')
  })
  it("prefers the company's own address and falls back to the deployment's when it has none", () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
    expect(getAppUrl({ appUrl: 'https://acme.example.test' })).toBe('https://acme.example.test')
    expect(getAppUrl({ appUrl: null })).toBe('https://crm.example.test')
    expect(getAppUrl({ appUrl: '  ' })).toBe('https://crm.example.test')
    expect(getAppUrl(null)).toBe('https://crm.example.test')
  })
  it('throws loudly when missing, with no hidden fallback host', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(() => getAppUrl()).toThrow(AppUrlNotConfiguredError)
    expect(errorSpy).toHaveBeenCalled()
  })
  it("a malformed company address throws instead of falling back to another company's address", () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
    expect(() => getAppUrl({ appUrl: 'acme.example.test' })).toThrow(AppUrlNotConfiguredError)
  })
  it('tryGetAppUrl logs and returns null', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(tryGetAppUrl('test link')).toBeNull()
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('test link'))).toBe(true)
  })
  it('configuredAppHost never throws', () => {
    expect(configuredAppHost('https://crm.example.test:8443/')).toBe('crm.example.test:8443')
    expect(configuredAppHost('')).toBeNull()
  })
})

describe('callers', () => {
  it('crew links fail loudly rather than pointing at an old host', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(() => crewLinkUrl('tok')).toThrow(AppUrlNotConfiguredError)
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
    expect(crewLinkUrl('tok')).toBe('https://crm.example.test/crew/tok')
  })
  it('the signed-copy link after a customer signs degrades to null instead of throwing', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(customerSignedDocUrl('contract', 'tok')).toBeNull()
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
    expect(customerSignedDocUrl('contract', 'tok')).toMatch(/^https:\/\/crm\.example\.test\/api\/files\/signed\/contract\/tok$/)
  })
  it('the signing page keeps a (relative) download link without an app address', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(customerSignedDocLinkForPage('change-order', 'tok')).toBe('/api/files/signed/change-order/tok')
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
    expect(customerSignedDocLinkForPage('change-order', 'tok')).toBe('https://crm.example.test/api/files/signed/change-order/tok')
    for (const route of ['app/api/contracts/sign/route.ts', 'app/api/change-orders/sign/route.ts']) {
      expect(readFileSync(route, 'utf8')).toMatch(/pdfUrl: pdfUrl \? customerPdfUrl \?\? customerSignedDocLinkForPage\(/)
    }
  })
  it('the morning email still builds without an app address; its links turn into plain text', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const report = { generatedAt: '', count: 1, appointments: [], jobs: [{ jobId: 'j1', jobNumber: '26-0001', problems: [{ message: 'No crew', blocksPay: false, fixHref: '/ops/jobs/j1', fixLabel: 'Fix' }] }] }
    const html = buildNeedsYouHtml(report as never)
    expect(html).toContain('Job 26-0001')
    expect(html).not.toMatch(/href="/)
    expect(buildTodayHtml(null)).not.toMatch(/href="/)
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
    expect(buildNeedsYouHtml(report as never)).toContain('href="https://crm.example.test/ops/jobs/j1"')
  })
})
