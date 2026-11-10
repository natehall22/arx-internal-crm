/** @jest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  isMissingFunction,
  brandNameRest,
  brandPatchFromGeneral,
  brandServiceRegion,
  brandWebsiteHref,
  BRAND_FIELD_MAX,
  brandPatchOps,
  contactPhone,
  getOrgBrand,
  getOrgBrandResult,
  getUserPhone,
  mergeBrandSettings,
  resolveOrgBrand,
  shortNameArticle,
} from '@/lib/org-brand'
import { mergeSettingsAt } from '@/lib/org-settings'
import { getPublicEstimateUnlockNextStepForPath } from '@/lib/public-estimate-config'
import { normalizeReportDoc, seedReportDoc } from '@/lib/inspection-report/types'
import {
  reportEmailFooterHtml,
  reportEmailHeaderHtml,
  reportFooterContact,
  reportFooterLine,
  reportShareTitle,
} from '@/lib/inspection-report/brand-copy'
import { telHref } from '@/lib/format'

// The exact literals these surfaces printed before slice 1 (`git show 22605711:<file>`). The ONLY intended
// change (Nathan, 2026-11-05): the phone is now the rep's, falling back to the company phone.
const OLD_PHONE = '(360) 485-9413'
const OLD = {
  footerLine: 'ARX Roofing & Exteriors  |  Charlotte / Kannapolis, NC  |  (360) 485-9413  |  arxroofing.com',
  footerContact: 'arxroofing.com   |   (360) 485-9413   |   info@arxroofing.com',
  preparedByFallback: 'ARX Roofing & Exteriors',
  emailHeader: 'ARX <span style="color:#B0904E;">Roofing &amp; Exteriors</span>',
  emailFooter:
    'ARX Roofing &amp; Exteriors &nbsp;|&nbsp; Charlotte / Kannapolis, NC &nbsp;|&nbsp; (360) 485-9413 &nbsp;|&nbsp; arxroofing.com',
  pageTitle: 'Roof Inspection Report — ARX Roofing & Exteriors',
  pageHeaderShort: 'ARX',
  pageHeaderRest: 'ROOFING & EXTERIORS',
  pageCtaRegion: 'Charlotte / Kannapolis',
  pageTel: 'tel:+13604859413',
  pageWebsiteHref: 'https://arxroofing.com',
  pageWebsite: 'arxroofing.com',
  pageFooterParts: ['ARX Roofing & Exteriors', 'Charlotte / Kannapolis, NC', '(360) 485-9413'],
}
const COMPANY_PHONE = '(704) 313-8834'
const withPhone = (s: string, phone: string) => s.split(OLD_PHONE).join(phone)

const defaults = resolveOrgBrand(null)
// orgs row as read from prod 2026-11-05 (settings.brand is null)
const prodRow = {
  name: 'ARX Roofing & Exteriors',
  phone: '(704) 313-8834',
  email: 'info@arxroofing.com',
  address: '4101 Woodbury Ter NW\nConcord, NC 28027',
  settings: { pricing: {}, logo_url: 'x' },
}

describe.each([
  ['no org row', defaults],
  ['prod ARX org row', resolveOrgBrand(prodRow)],
])('%s: every string is the old one, phone = rep or company', (_label, b) => {
  it('rep phone present → old strings byte-identical when the rep is the old number', () => {
    // every prod report's rep has users.phone '(360)485-9413' (formatted by formatPhone)
    const phone = contactPhone(b, '(360)485-9413')
    expect(phone).toBe(OLD_PHONE)
    expect(reportFooterLine(b, phone)).toBe(OLD.footerLine)
    expect(reportFooterContact(b, phone)).toBe(OLD.footerContact)
    expect(reportEmailFooterHtml(b, phone)).toBe(OLD.emailFooter)
    expect(telHref(phone)).toBe(OLD.pageTel)
    expect([b.name, b.serviceArea, phone]).toEqual(OLD.pageFooterParts)
    const seeded = seedReportDoc({ repPhone: '(360)485-9413' }, b)
    expect(seeded.footerLine).toBe(OLD.footerLine)
    expect(seeded.cover.footerContact).toBe(OLD.footerContact)
  })

  it('another rep phone shows that rep', () => {
    const phone = contactPhone(b, '7045550142')
    expect(phone).toBe('(704) 555-0142')
    expect(reportFooterLine(b, phone)).toBe(withPhone(OLD.footerLine, '(704) 555-0142'))
    expect(reportEmailFooterHtml(b, phone)).toBe(withPhone(OLD.emailFooter, '(704) 555-0142'))
  })

  it('no rep phone → old strings with the company phone', () => {
    for (const none of [null, undefined, '', '   ']) expect(contactPhone(b, none)).toBe(COMPANY_PHONE)
    expect(reportFooterLine(b, COMPANY_PHONE)).toBe(withPhone(OLD.footerLine, COMPANY_PHONE))
    expect(reportFooterContact(b, COMPANY_PHONE)).toBe(withPhone(OLD.footerContact, COMPANY_PHONE))
    expect(reportEmailFooterHtml(b, COMPANY_PHONE)).toBe(withPhone(OLD.emailFooter, COMPANY_PHONE))
    const seeded = seedReportDoc({}, b)
    expect(seeded.footerLine).toBe(withPhone(OLD.footerLine, COMPANY_PHONE))
    expect(seeded.cover.footerContact).toBe(withPhone(OLD.footerContact, COMPANY_PHONE))
  })

  it('phone-free strings are unchanged', () => {
    expect(b.name).toBe(OLD.preparedByFallback)
    expect(reportEmailHeaderHtml(b)).toBe(OLD.emailHeader)
    expect(reportShareTitle(b)).toBe(OLD.pageTitle)
    expect(b.shortName).toBe(OLD.pageHeaderShort)
    expect(brandNameRest(b)?.toUpperCase()).toBe(OLD.pageHeaderRest)
    expect(brandServiceRegion(b)).toBe(OLD.pageCtaRegion)
    expect(brandWebsiteHref(b)).toBe(OLD.pageWebsiteHref)
    expect(b.website).toBe(OLD.pageWebsite)
    expect(b.address).toBe('4101 Woodbury Ter NW\nConcord, NC 28027')
  })
})

describe('atomic brand save fallback', () => {
  it('falls back only when the merge function does not exist', () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.merge_org_brand_settings' })).toBe(true)
    expect(isMissingFunction({ code: '42883', message: 'function does not exist' })).toBe(true)
    expect(isMissingFunction({ code: '42501', message: 'permission denied for function merge_org_brand_settings' })).toBe(false)
  })
})

describe('legal name (invoices, contracts)', () => {
  it('defaults to the exact string invoices printed before', () => {
    expect(resolveOrgBrand(null).legalName).toBe('ARX Roofing & Exteriors, LLC')
    // ARX prod row: org name has no ", LLC" and settings.brand is null — invoices still show the legal name
    expect(resolveOrgBrand({ name: 'ARX Roofing & Exteriors', settings: null }).legalName).toBe('ARX Roofing & Exteriors, LLC')
  })
  it('comes from settings.brand.legalName and is editable from the General form', () => {
    expect(resolveOrgBrand({ settings: { brand: { legalName: 'Other Co, Inc.' } } }).legalName).toBe('Other Co, Inc.')
    expect(brandPatchFromGeneral({ brand_legal_name: 'Other Co, Inc.' })).toEqual({ legalName: 'Other Co, Inc.' })
  })
})

describe('resolveOrgBrand precedence', () => {
  it('orgs columns always win; settings.brand only supplies fields with no column', () => {
    const b = resolveOrgBrand({
      name: 'Column Co',
      phone: '(111) 222-3333',
      settings: { brand: { name: 'Brand Co', phone: '999', email: 'stale@x.test', address: 'Stale', website: 'brand.example' } },
    })
    expect(b.name).toBe('Column Co')
    expect(b.phone).toBe('(111) 222-3333')
    // a column-backed key in settings.brand never fills in, even when the column is empty
    expect(b.email).toBe(defaults.email)
    expect(b.address).toBe(defaults.address)
    expect(b.website).toBe('brand.example')
    expect(b.serviceArea).toBe(defaults.serviceArea)
  })

  it('accepts the brand selected directly as `brand`', () => {
    expect(resolveOrgBrand({ brand: { shortName: 'ZZ' } }).shortName).toBe('ZZ')
  })

  it('blank and whitespace strings count as missing', () => {
    const b = resolveOrgBrand({ name: '   ', settings: { brand: { name: '', website: ' \t ', phone: null } } })
    expect(b.name).toBe(defaults.name)
    expect(b.website).toBe(defaults.website)
    expect(b.phone).toBe(defaults.phone)
  })

  it('ignores junk brand values', () => {
    expect(resolveOrgBrand({ settings: { brand: 'nope' } })).toEqual(defaults)
    expect(resolveOrgBrand({ settings: { brand: [1, 2] } })).toEqual(defaults)
    expect(resolveOrgBrand({ settings: { brand: { name: 42 } } }).name).toBe(defaults.name)
  })

  it('a second company gets its own footer and header', () => {
    const b = resolveOrgBrand({
      name: 'Acme Roofing',
      phone: '512-555-0100',
      settings: { brand: { shortName: 'Acme', website: 'acme.test', serviceArea: 'Austin, TX', email: 'hi@acme.test' } },
    })
    const phone = contactPhone(b, null)
    expect(reportFooterLine(b, phone)).toBe('Acme Roofing  |  Austin, TX  |  512-555-0100  |  acme.test')
    expect(reportEmailHeaderHtml(b)).toBe('Acme <span style="color:#B0904E;">Roofing</span>')
    expect(brandServiceRegion(b)).toBe('Austin')
    expect(telHref(phone)).toBe('tel:+15125550100')
    // name not starting with the short name → whole name, escaped
    expect(reportEmailHeaderHtml({ ...b, name: 'Roofs <&> Co' })).toBe('Roofs &lt;&amp;&gt; Co')
  })
})

describe('normalizeReportDoc keeps stored footer values (sent reports never change)', () => {
  it('stored footerLine / footerContact win over brand and rep phone', () => {
    const stored = JSON.parse(JSON.stringify(seedReportDoc({ repPhone: '(360)485-9413' })))
    const other = resolveOrgBrand({ settings: { brand: { name: 'Other', website: 'other.test' } } })
    const n = normalizeReportDoc(stored, { repPhone: '9995550000' }, other)
    expect(n.footerLine).toBe(OLD.footerLine)
    expect(n.cover.footerContact).toBe(OLD.footerContact)
  })

  it('missing footer fields are filled from brand + rep phone', () => {
    const stored = JSON.parse(JSON.stringify(seedReportDoc()))
    delete stored.footerLine
    delete stored.cover.footerContact
    const n = normalizeReportDoc(stored, { repPhone: '3604859413' }, defaults)
    expect(n.footerLine).toBe(OLD.footerLine)
    expect(n.cover.footerContact).toBe(OLD.footerContact)
    expect(normalizeReportDoc(JSON.parse(JSON.stringify(stored))).footerLine).toBe(withPhone(OLD.footerLine, COMPANY_PHONE))
  })
})

describe('settings.brand merge', () => {
  it('keeps other brand keys and unknown keys; blank removes a key', () => {
    const current = { website: 'old.test', serviceArea: 'Somewhere', futureKey: 'keep' }
    const next = mergeBrandSettings(current, { website: ' new.test ', serviceArea: '  ', bogus: 'x' })
    expect(next).toEqual({ website: 'new.test', futureKey: 'keep' })
    expect(current).toEqual({ website: 'old.test', serviceArea: 'Somewhere', futureKey: 'keep' })
  })

  it('rejects column keys (name/phone/email/address) and unknown keys', () => {
    expect(brandPatchOps({ name: 'X', phone: '1', email: 'e', address: 'a', bogus: 'b', website: 'w' })).toEqual({ set: { website: 'w' }, remove: [] })
    expect(mergeBrandSettings({}, { name: 'X', phone: '1', email: 'e', address: 'a' })).toEqual({})
  })

  it(`caps each field at ${BRAND_FIELD_MAX} characters`, () => {
    const long = 'a'.repeat(BRAND_FIELD_MAX + 50)
    const { set } = brandPatchOps({ website: long, shortName: ` ${'b'.repeat(BRAND_FIELD_MAX)} ` })
    expect(set.website).toHaveLength(BRAND_FIELD_MAX)
    expect(set.shortName).toBe('b'.repeat(BRAND_FIELD_MAX))
  })

  it('handles missing / junk current values', () => {
    expect(mergeBrandSettings(undefined, { shortName: 'X' })).toEqual({ shortName: 'X' })
    expect(mergeBrandSettings('junk', { shortName: 'X' })).toEqual({ shortName: 'X' })
  })

  it('maps General form fields and skips when none were sent', () => {
    expect(brandPatchFromGeneral({ company_name: 'A', timezone: 'x' })).toBeNull()
    expect(brandPatchFromGeneral({ brand_website: 'w', brand_service_area: '' })).toEqual({ website: 'w', serviceArea: '' })
  })

  it('whole-settings update keeps every other settings key (logo included)', () => {
    const current = { pricing: { a: 1 }, logo_url: 'l', brand: { futureKey: '1', website: 'old' } }
    const { set, remove } = brandPatchOps({ website: 'new', shortName: '' })
    expect(mergeSettingsAt(current, ['brand'], set, remove)).toEqual({
      pricing: { a: 1 },
      logo_url: 'l',
      brand: { futureKey: '1', website: 'new' },
    })
  })
})

describe('contactPhone uses the rep phone only when it is dialable', () => {
  const brand = { phone: COMPANY_PHONE }
  it.each([
    ['7045551234', '(704) 555-1234'],
    ['+1 (704) 555-1234', '(704) 555-1234'],
  ])('dialable %s → rep', (rep, shown) => {
    expect(contactPhone(brand, rep)).toBe(shown)
  })
  it.each([null, undefined, '', '   ', 'n/a', '555-1234', 'ext 12', '12345678901234'])('not dialable %p → company phone', (rep) => {
    expect(contactPhone(brand, rep as string | null | undefined)).toBe(COMPANY_PHONE)
  })
  it('the shown phone always has a call link when the rep phone is used', () => {
    expect(telHref(contactPhone(brand, '704.555.1234'))).toBe('tel:+17045551234')
  })
})

describe('getUserPhone', () => {
  function client(row: Record<string, unknown> | null) {
    const eqs: Array<[string, unknown]> = []
    let selected = ''
    const q = {
      select: (cols: string) => ((selected = cols), q),
      eq: (col: string, v: unknown) => (eqs.push([col, v]), q),
      maybeSingle: async () => ({ data: row, error: null }),
    }
    return { c: { from: () => q } as never, eqs, cols: () => selected }
  }
  it('scopes to the org and reads active', async () => {
    const { c, eqs, cols } = client({ phone: ' 7045551234 ', active: true })
    expect(await getUserPhone(c, 'u1', 'org-1')).toBe('7045551234')
    expect(eqs).toEqual([['id', 'u1'], ['org_id', 'org-1']])
    expect(cols()).toContain('active')
  })
  it('inactive user → null', async () => {
    expect(await getUserPhone(client({ phone: '7045551234', active: false }).c, 'u1', 'org-1')).toBeNull()
  })
  it('no row (other org / deleted), no user or no org → null', async () => {
    expect(await getUserPhone(client(null).c, 'u1', 'org-1')).toBeNull()
    expect(await getUserPhone(client({ phone: '7045551234', active: true }).c, null, 'org-1')).toBeNull()
    expect(await getUserPhone(client({ phone: '7045551234', active: true }).c, 'u1', null)).toBeNull()
  })
})

describe('getOrgBrand never throws', () => {
  const ROW = { name: 'Summit Roofing', phone: '555-010-0199', email: 'hi@summit.test', address: '1 Main St', brand: { shortName: 'Summit' } }
  /** A client whose org read answers each call from `answers` in turn (a function throws, an object is returned). */
  function client(answers: Array<(() => never) | { data: unknown; error: unknown }>) {
    let calls = 0
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => {
        const a = answers[Math.min(calls++, answers.length - 1)]
        return typeof a === 'function' ? a() : a
      },
    }
    return { c: { from: () => q } as never, calls: () => calls }
  }
  let errorSpy: jest.SpyInstance
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errorSpy.mockRestore())

  it('a client that throws → defaults, retried once, logged with the org id', async () => {
    const { c, calls } = client([
      () => {
        throw new Error('fetch failed')
      },
    ])
    expect(await getOrgBrandResult(c, 'org-1')).toEqual({ brand: resolveOrgBrand(null), ok: false })
    expect(calls()).toBe(2)
    expect(errorSpy.mock.calls.some((args) => args.includes('org-1'))).toBe(true)
  })
  it('a client that returns {error} → defaults without throwing', async () => {
    const { c, calls } = client([{ data: null, error: { message: 'timeout' } }])
    expect(await getOrgBrand(c, 'org-1')).toEqual(defaults)
    expect(calls()).toBe(2)
  })
  it('a transient error then success → the real row', async () => {
    const { c } = client([{ data: null, error: { message: 'timeout' } }, { data: ROW, error: null }])
    const result = await getOrgBrandResult(c, 'org-1')
    expect(result.ok).toBe(true)
    expect(result.brand.shortName).toBe('Summit')
    expect(result.brand.phone).toBe('555-010-0199')
  })
  it('a missing row or no org id → defaults, not ok', async () => {
    expect((await getOrgBrandResult(client([{ data: null, error: null }]).c, 'org-1')).ok).toBe(false)
    expect(await getOrgBrandResult(client([{ data: ROW, error: null }]).c, null)).toEqual({
      brand: resolveOrgBrand(null),
      ok: false,
    })
  })
})

describe('article before the short name', () => {
  it.each([
    ['ARX', 'an'],
    ['Summit', 'a'],
    ['Apex', 'an'],
    ['FMR', 'an'],
    ['MRX', 'an'],
    ['BRX', 'a'],
    ['Faber', 'a'],
    ['UBR', 'an'],
  ])('%s → %s', (name, article) => {
    expect(shortNameArticle(name)).toBe(article)
  })
  it('capitalises at the start of a sentence; ARX copy is unchanged', () => {
    expect(getPublicEstimateUnlockNextStepForPath('auto', 'ARX')).toBe(
      'An ARX team member will call you shortly to confirm details and schedule a free inspection.'
    )
    expect(getPublicEstimateUnlockNextStepForPath('auto', 'Summit')).toBe(
      'A Summit team member will call you shortly to confirm details and schedule a free inspection.'
    )
    expect(getPublicEstimateUnlockNextStepForPath('silent_manual', 'Summit')).toContain('. A Summit team member')
  })
})

describe('slice-1 files carry no company literals', () => {
  const FILES = [
    'lib/inspection-report/types.ts',
    'lib/inspection-report/brand-copy.ts',
    'lib/inspection-report/server.ts',
    'app/api/inspection-reports/[id]/route.ts',
    'app/api/inspection-reports/[id]/send/route.ts',
    'app/r/[token]/page.tsx',
  ]
  it.each(FILES)('%s', (file) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(src).not.toMatch(/arxroofing\.com/i)
    expect(src).not.toContain('485-9413')
    expect(src).not.toContain('Charlotte / Kannapolis')
    expect(src).not.toContain('13604859413')
  })
})
