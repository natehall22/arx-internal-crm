/** @jest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { brandDocument, resolveOrgBrand } from '@/lib/org-brand'
import { clientBrandNames, coerceClientBrandNames, GENERIC_BRAND_NAMES } from '@/lib/org-brand-client'
import { brandFromEffectivePermissions } from '@/hooks/useOrgFeatures'

const src = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('company names on the contract screen, subs text and schedule board', () => {
  const OLD_ENV = process.env.DEPLOYMENT_ORG_ID
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.DEPLOYMENT_ORG_ID
    else process.env.DEPLOYMENT_ORG_ID = OLD_ENV
  })

  it('the original company (no fence, nothing stored) keeps the exact words the screen used to print', () => {
    delete process.env.DEPLOYMENT_ORG_ID
    const names = clientBrandNames(brandDocument(resolveOrgBrand(null)))
    expect(names).toEqual({ name: 'ARX Roofing & Exteriors', legalName: 'ARX Roofing & Exteriors LLC', shortName: 'ARX' })
  })

  it('another company sees its own names, never the original', () => {
    process.env.DEPLOYMENT_ORG_ID = '00000000-0000-0000-0000-000000000001'
    const names = clientBrandNames(
      brandDocument(resolveOrgBrand({ name: 'Summit Lawn Care', settings: { brand: { legalName: 'Summit Lawn Care, LLC', shortName: 'Summit' } } })),
    )
    expect(names).toEqual({ name: 'Summit Lawn Care', legalName: 'Summit Lawn Care, LLC', shortName: 'Summit' })
  })

  it('a company with only a name falls back to the name; nothing at all is generic', () => {
    expect(coerceClientBrandNames({ name: 'Acme' })).toEqual({ name: 'Acme', legalName: 'Acme', shortName: 'Acme' })
    expect(coerceClientBrandNames(null)).toEqual(GENERIC_BRAND_NAMES)
    expect(brandFromEffectivePermissions({ flags: {} })).toEqual(GENERIC_BRAND_NAMES)
    expect(brandFromEffectivePermissions({ flags: { brand: { name: 'Acme', shortName: 'Ac' } } })).toEqual({ name: 'Acme', legalName: 'Acme', shortName: 'Ac' })
  })

  it.each([
    'components/contracts/ContractModal.tsx',
    'app/admin/subs/page.tsx',
    'app/ops/schedule/InstallScheduleClient.tsx',
  ])('%s has no company-name literal', (file) => {
    expect(src(file)).not.toMatch(/\bARX\b/)
  })
})

describe('small screens cleaned up', () => {
  it('proposal builder: no debug panel; step bar lists the six real steps with Review', () => {
    const s = src('app/proposals/builder/page.tsx')
    expect(s).not.toContain('Order Debug')
    expect(s).toMatch(/label: 'Waste'[\s\S]*label: 'Roofing Type'[\s\S]*label: 'Items'[\s\S]*label: 'Add-Ons'[\s\S]*label: 'Review'/)
  })

  it('new lead form: no Status dropdown, schedule box after the contact fields and in the profile word', () => {
    const s = src('components/LeadFormWithReferral.tsx')
    expect(s).not.toContain('leadStatuses')
    expect(s).not.toContain('>Status<')
    expect(s).toContain('Schedule {inspectionWord}')
    expect(s.indexOf('Schedule {inspectionWord}</h3>')).toBeGreaterThan(s.indexOf('{nameLabel}</label>'))
    expect(src('app/leads/new/page.tsx')).toContain("t(profile_, 'inspection').toLowerCase()")
  })

  it('reports cards open their own report', () => {
    expect(src('app/reports/page.tsx')).toContain('/reports/explore?template=')
    expect(src('app/reports/explore/ExploreClient.tsx')).toContain("q.get('template')")
  })

  it('no coming-soon placeholders in company settings or the canvass sheet', () => {
    expect(src('app/admin/settings/page.tsx')).not.toMatch(/coming soon/i)
    expect(src('app/(canvass-app)/canvass/components/LeadModal.tsx')).not.toMatch(/coming soon/i)
  })
})
