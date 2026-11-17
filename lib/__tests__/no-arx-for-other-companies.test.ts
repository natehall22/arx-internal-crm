/**
 * Owner rule: a company that is not ARX never sees ARX material (name, site, phone, address, artwork, wording) on any screen,
 * PDF, email or print piece. The only allowed ARX text is the product name in staff chrome and staff emails (lib/product.ts).
 */
import fs from 'fs'
import path from 'path'

import { PRODUCT_NAME } from '@/lib/product'
import { getOrgBrandResult, resolveOrgBrand, usesOriginalCompanyAssets } from '@/lib/org-brand'
import { seedReportDoc } from '@/lib/inspection-report/types'
import { printKitBrand } from '@/lib/print-kit'
import { builtInContractsAvailable } from '@/lib/org-profile'
import { morningUpdateTitle } from '@/lib/morning-update-email'

const ARX_PATTERNS = [/\bARX\b/, /arxroofing/i, /313-8834/, /Woodbury/i, /Kannapolis/i, /28027/]
const clean = (s: string) => s.split(PRODUCT_NAME).join('')
const mentionsArx = (s: string) => ARX_PATTERNS.some((re) => re.test(clean(s)))

const OTHER = { name: 'Precision Maintenance', phone: '(555) 010-0100' }

describe('another company never gets ARX identity', () => {
  it('a blank field stays blank, never the original company value', () => {
    const b = resolveOrgBrand({ name: OTHER.name })
    expect(mentionsArx(JSON.stringify(b))).toBe(false)
    expect(b.name).toBe(OTHER.name)
    expect(b.email).toBe('')
    expect(b.website).toBe('')
    expect(usesOriginalCompanyAssets(b)).toBe(false)
  })

  it('the original company keeps its fallback exactly', () => {
    const b = resolveOrgBrand({ name: 'ARX Roofing & Exteriors', original_brand: true })
    expect(b.website).toBe('arxroofing.com')
    expect(usesOriginalCompanyAssets(b)).toBe(true)
    expect(resolveOrgBrand({ original_brand: true }).name).toBe('ARX Roofing & Exteriors')
    // no row at all is never the original company
    expect(resolveOrgBrand(null).name).toBe('')
    expect(usesOriginalCompanyAssets(resolveOrgBrand(null))).toBe(false)
  })

  it('a name or an email is not the marker: "ARX Lawn" (even holding the original alias) gets nothing of the original company', () => {
    const b = resolveOrgBrand({ name: 'ARX Lawn', email: 'hello@arxlawn.example' })
    expect(b.website).toBe('')
    expect(b.phone).toBe('')
    expect(usesOriginalCompanyAssets(b)).toBe(false)
    expect(builtInContractsAvailable({ id: 'roofing' }, usesOriginalCompanyAssets(b))).toBe(false)
    expect(resolveOrgBrand({ name: 'ARX Lawn' }).email).toBe('')
    // a manager-writable column cannot claim the original company
    const spoof = resolveOrgBrand({ name: 'ARX Lawn', email: 'info@arxroofing.com', original_brand: false })
    expect(spoof.website).toBe('')
    expect(usesOriginalCompanyAssets(spoof)).toBe(false)
  })

  it('fails closed: an unreadable or missing org row is neutral and not original', async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('down') }) }) }) }) }
    const missing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
    jest.spyOn(console, 'error').mockImplementation(() => {})
    for (const client of [failing, missing]) {
      const r = await getOrgBrandResult(client as never, 'org-1')
      expect(r.ok).toBe(false)
      expect(r.brand.phone).toBe('')
      expect(mentionsArx(JSON.stringify(r.brand))).toBe(false)
      expect(usesOriginalCompanyAssets(r.brand)).toBe(false)
    }
  })

  it('the roof report default copy uses the company, and the original text is unchanged for ARX', () => {
    const other = seedReportDoc({}, resolveOrgBrand({ ...OTHER, settings: { brand: { shortName: 'Precision' } } }))
    expect(mentionsArx(JSON.stringify(other))).toBe(false)
    expect(JSON.stringify(other)).toContain('Precision Maintenance performed a detailed roof inspection')
    const arx = JSON.stringify(seedReportDoc({}, resolveOrgBrand({ original_brand: true })))
    expect(arx).toContain('ARX Roofing & Exteriors performed a detailed roof inspection')
    expect(arx).toContain('ARX respectfully requests')
  })

  it('print kit: a roofing company that is not the original gets its own words', () => {
    const profile = { id: 'roofing', label: 'Roofing', terms: { inspection: 'Inspection' } } as never
    expect(mentionsArx(JSON.stringify(printKitBrand(profile, { name: OTHER.name, logoHref: null, original: false })))).toBe(false)
    expect(printKitBrand(profile, { name: 'ARX', logoHref: null, original: true }).companyName).toBe('ARX Roofing & Exteriors')
  })

  it('built-in contracts (their terms name the original company) are offered to it only', () => {
    expect(builtInContractsAvailable({ id: 'roofing' }, false)).toBe(false)
    expect(builtInContractsAvailable({ id: 'roofing' }, true)).toBe(true)
    expect(builtInContractsAvailable({ id: 'roofing' })).toBe(false) // unknown = not original
  })

  it('the morning update is titled with the recipient company', () => {
    expect(morningUpdateTitle('ARX Roofing & Exteriors')).toBe('ARX Roofing & Exteriors Morning Update')
    expect(morningUpdateTitle(OTHER.name)).toBe('Precision Maintenance Morning Update')
  })
})

/** Source guard: the customer-facing and staff-facing render paths carry no ARX literal (comments excluded). */
const ROOT = path.resolve(__dirname, '..', '..')
const RENDER_PATHS = [
  'lib/pdf', 'lib/inspection-report', 'lib/signing', 'lib/completion-certificate.tsx', 'lib/crew-link.ts',
  'lib/setter-email.ts', 'lib/admin-sale-email.ts', 'lib/closer-briefing-email.ts', 'lib/payroll-statement-email.ts',
  'app/crew', 'app/r', 'app/portal', 'app/c', 'app/signing', 'app/contracts/sign', 'app/change-orders', 'app/comp-agreements',
  'app/admin/print-kit', 'app/admin/page.tsx', 'app/login', 'app/api/login', 'components/Nav.tsx', 'components/contracts',
  'components/signing', 'components/customer-file', 'components/employee-agreements', 'components/change-orders',
  'components/inspection-report', 'app/layout.tsx', 'lib/morning-update-email.ts', 'lib/ai/crm-navigation-guide.ts',
]
function files(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [abs]
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : files(path.join(rel, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(abs, e.name)] : []))
}
const codeLines = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))

describe('render paths carry no ARX literal', () => {
  it.each(RENDER_PATHS)('%s', (rel) => {
    const hits = files(rel).flatMap((f) => codeLines(fs.readFileSync(f, 'utf8')).filter((l) => mentionsArx(l)).map((l) => `${path.relative(ROOT, f)}: ${l.trim().slice(0, 100)}`))
    expect(hits).toEqual([])
  })

  it('the product is ARX Capitol everywhere; "ARX CRM" appears only on the public ARX marketing pages', () => {
    expect(PRODUCT_NAME).toBe('ARX Capitol')
    const hits = ['app', 'lib', 'components', 'public/manifest.json'].flatMap((d) => files(d)).filter((f) => !/app\/(terms|privacy|trial)\//.test(f) && !f.endsWith('lib/product.ts') && /ARX CRM/.test(fs.readFileSync(f, 'utf8')))
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([])
  })
})
