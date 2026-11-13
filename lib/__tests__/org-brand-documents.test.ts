/** @jest-environment node */
/**
 * Multi-company slice 2a — golden tests. Every customer-facing document and email that moved onto the org brand must
 * render byte-identical for the original company (an org with no stored brand = today's prod row). The fixtures were
 * recorded from origin/main 0cdbd142 (PDFs as SHA-256 with the random /ID stripped and a fixed clock; copy as text).
 * The only allowed difference: HTML emails now escape the company name ("&" → "&amp;"), which renders the same.
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'

import pdfGolden from './fixtures/brand-documents-golden.json'
import copyGolden from './fixtures/brand-copy-golden.json'
import { generateContractPdf } from '@/lib/contracts/generatePdf'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import { buildCompletionCertificatePdfBuffer, completionCertificateCompany } from '@/lib/completion-certificate'
import { buildPayrollStatementPdfBuffer } from '@/lib/pdf/payroll-statement'
import {
  buildChangeOrderReadyEmail,
  buildChangeOrderSignedEmail,
  buildContractReadyEmail,
  buildContractSignedEmail,
} from '@/lib/contracts/customer-emails'
import { buildHomeownerEstimateEmailContent, buildHomeownerManualDesignEmailContent } from '@/lib/public-estimate-lead'
import { composeReviewMessage } from '@/lib/review-requests'
import { getPublicEstimateUnlockNextStepForPath } from '@/lib/public-estimate-config'
import { buildInstallEvent } from '@/lib/install-calendar'
import { brandDocument, DEFAULT_DOCUMENT_BRAND, DEFAULT_ORG_BRAND, resolveOrgBrand, staleDocumentSpellings, type OrgBrand } from '@/lib/org-brand'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { misconfiguredMessage, outOfServiceAreaMessage } from '@/lib/public-estimate-config'
import { formatPhoneDashed } from '@/lib/format'

const sha = (b: Buffer) =>
  createHash('sha256')
    .update(b.toString('latin1').replace(/\/ID \[ <[0-9A-F]+> <[0-9A-F]+> \]/, '/ID'), 'latin1')
    .digest('hex')

/** ARX's prod org row today: columns set, settings.brand null. */
const PROD_ROW = {
  name: 'ARX Roofing & Exteriors',
  phone: '(704) 313-8834',
  email: 'info@arxroofing.com',
  address: '4101 Woodbury Ter NW\nConcord, NC 28027',
  settings: { brand: null },
}
const PROD_ARX = resolveOrgBrand(PROD_ROW)
const PROD_DOC = brandDocument(PROD_ARX)

const OTHER: OrgBrand = resolveOrgBrand({
  name: 'Summit Roofing & Siding',
  phone: '555-010-0199',
  email: 'office@summit.example',
  address: '9 Pine Rd\nAsheville, NC 28801',
  settings: { brand: { legalName: 'Summit Roofing & Siding, Inc.', shortName: 'Summit', website: 'summit.example' } },
})
const OTHER_DOC = brandDocument(OTHER)

const htmlBrandEscaped = (s: string) =>
  s.replace(/ROOFING & EXTERIORS/g, 'ROOFING &amp; EXTERIORS').replace(/Roofing & Exteriors/g, 'Roofing &amp; Exteriors')

/** Strings from the original company that must never reach another company's document. */
const ARX_IDENTITY = [/ARX/, /arxroofing/i, /313-8834/, /Woodbury/, /28027/]

describe('brandDocument (letterhead spellings)', () => {
  it("the prod row and an empty org both give the contract's historical spellings", () => {
    for (const d of [PROD_DOC, DEFAULT_DOCUMENT_BRAND]) {
      expect(d).toEqual({
        name: 'ARX Roofing & Exteriors',
        nameUpper: 'ARX ROOFING & EXTERIORS',
        legalName: 'ARX Roofing & Exteriors LLC',
        legalNameUpper: 'ARX ROOFING & EXTERIORS LLC',
        casualName: 'ARX Roofing',
        shortName: 'ARX',
        phone: '704-313-8834',
        email: 'info@arxroofing.com',
        website: 'arxroofing.com',
        addressLines: ['4101 Woodbury Terrace NW', 'Concord, NC 28027'],
        addressLine: '4101 Woodbury Terrace NW, Concord, NC 28027',
      })
    }
  })

  it('another company prints exactly what it stored (no comma rewrite, no street-suffix rewrite)', () => {
    expect(OTHER_DOC.legalName).toBe('Summit Roofing & Siding, Inc.')
    expect(OTHER_DOC.addressLine).toBe('9 Pine Rd, Asheville, NC 28801')
    expect(OTHER_DOC.casualName).toBe('Summit Roofing')
    expect(OTHER_DOC.phone).toBe('555-010-0199')
  })

  it('an edited legal name or address stops using the historical spelling', () => {
    const edited = brandDocument(
      resolveOrgBrand({ ...PROD_ROW, address: '1 New St\nConcord, NC 28025', settings: { brand: { legalName: 'ARX Roofing & Exteriors, LLC.' } } })
    )
    expect(edited.legalName).toBe('ARX Roofing & Exteriors, LLC.')
    expect(edited.addressLine).toBe('1 New St, Concord, NC 28025')
  })

  it('formatPhoneDashed', () => {
    expect(formatPhoneDashed('(704) 313-8834')).toBe('704-313-8834')
    expect(formatPhoneDashed('+1 704.313.8834')).toBe('704-313-8834')
    expect(formatPhoneDashed('ext 12')).toBe('ext 12')
  })
})

describe('PDFs are byte-identical for the original company', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date(pdfGolden.now), doNotFake: ['nextTick', 'setImmediate'] }))
  afterEach(() => jest.useRealTimers())

  it.each(['installation', 'contingency', 'repair'])('contract: %s', async (t) => {
    const buf = await generateContractPdf({ ...pdfGolden.contractBase, agreement_type: t } as never, PROD_DOC)
    expect(sha(buf)).toBe((pdfGolden.sha256 as Record<string, string>)[`contract_${t}`])
  })

  it('change order', async () => {
    expect(sha(await generateChangeOrderPdf(pdfGolden.coInput as never, PROD_DOC))).toBe(pdfGolden.sha256.change_order)
  })

  it('completion certificate', () => {
    const buf = buildCompletionCertificatePdfBuffer({
      ...completionCertificateCompany(PROD_ARX),
      logoAbsolutePath: path.join(process.cwd(), 'public', 'brand', 'arx-shield.png'),
      ...pdfGolden.certInput,
    })
    expect(sha(buf)).toBe(pdfGolden.sha256.completion_certificate)
  })

  it('payroll statement', () => {
    const buf = buildPayrollStatementPdfBuffer(pdfGolden.statement as never, {
      statementUrl: 'https://example.com/commissions/statement/period-123',
      brand: PROD_ARX,
    })
    expect(sha(buf)).toBe(pdfGolden.sha256.payroll_statement)
  })
})

describe('PDFs carry another company’s identity', () => {
  it.each(['installation', 'contingency', 'repair'])('contract letterhead: %s (clause wording is slice 2b)', async (t) => {
    const pdf = (await generateContractPdf({ ...pdfGolden.contractBase, agreement_type: t } as never, OTHER_DOC)).toString('latin1')
    expect(pdf).toContain('SUMMIT ROOFING & SIDING, INC.')
    expect(pdf).toContain('9 Pine Rd, Asheville, NC 28801')
    // clause 15.3 of the installation terms still names the original LLC inside its sentence (slice 2b)
    expect(pdf).not.toMatch(/313-8834|Woodbury|ARX ROOFING|\| ARX Roofing/)
  })

  it('change order, certificate, payroll statement: no original-company identity at all', async () => {
    const outs = [
      await generateChangeOrderPdf(pdfGolden.coInput as never, OTHER_DOC),
      buildCompletionCertificatePdfBuffer({ ...completionCertificateCompany(OTHER), logoAbsolutePath: null, ...pdfGolden.certInput }),
      buildPayrollStatementPdfBuffer(pdfGolden.statement as never, { brand: OTHER }),
    ].map((b) => b.toString('latin1'))
    for (const pdf of outs) {
      expect(pdf).toContain('Summit Roofing & Siding')
      // the certificate footer still names the product ("… CRM") until slice 3; check identity strings only
      for (const re of [/arxroofing/i, /313-8834/, /Woodbury/, /ARX Roofing/, /Authorized ARX/]) expect(pdf).not.toMatch(re)
    }
  })
})

describe('customer emails are identical for the original company', () => {
  const g = copyGolden
  it('agreement ready to sign', () => {
    for (const [key, isContingency, label, cost] of [
      ['installation', false, 'Installation Agreement', g.inputs.readyInput.safeProjectCost],
      ['contingency', true, 'Insurance Contingency Agreement', 0],
    ] as const) {
      const e = buildContractReadyEmail({
        brand: PROD_DOC,
        agreementLabel: label,
        customerName: g.inputs.readyInput.customerName,
        signingUrl: g.inputs.readyInput.signingUrl,
        projectAddress: g.inputs.readyInput.projectAddress,
        isContingency,
        projectCost: cost,
        repName: g.inputs.readyInput.repName,
      })
      const old = g.contractReady[key]
      expect(e.subject).toBe(old.subject)
      expect(e.text).toBe(old.text)
      expect(e.html).toBe(htmlBrandEscaped(old.html))
    }
  })

  it('agreement signed', () => {
    for (const [key, isContingency, label, url] of [
      ['withPdf', false, 'Installation Agreement', 'https://crm.example.test/api/signed/contract/tok123'],
      ['contingencyNoPdf', true, 'Insurance Contingency Agreement', null],
    ] as const) {
      const e = buildContractSignedEmail({
        brand: PROD_DOC,
        agreementLabel: label,
        customerName: g.inputs.signedContract.customer_name,
        projectAddress: g.inputs.signedContract.project_address,
        isContingency,
        projectCost: g.inputs.signedContract.project_cost,
        customerPdfUrl: url,
      })
      const old = g.contractSigned[key]
      expect(e.subject).toBe(old.subject)
      expect(e.text).toBe(old.text)
      expect(e.html).toBe(htmlBrandEscaped(old.html))
    }
  })

  it('change order ready / signed', () => {
    const r = buildChangeOrderReadyEmail({ brand: PROD_DOC, ...g.inputs.coReadyInput })
    expect(r).toEqual({ ...g.coReady, html: htmlBrandEscaped(g.coReady.html) })
    const s1 = buildChangeOrderSignedEmail({ brand: PROD_DOC, coNumber: 'CO-002', customerPdfUrl: 'https://crm.example.test/api/signed/change-order/tok456' })
    expect(s1).toEqual({ ...g.coSigned.withPdf, html: htmlBrandEscaped(g.coSigned.withPdf.html) })
    const s2 = buildChangeOrderSignedEmail({ brand: PROD_DOC, coNumber: 'CO-002', customerPdfUrl: null })
    expect(s2).toEqual({ ...g.coSigned.noPdf, html: htmlBrandEscaped(g.coSigned.noPdf.html) })
  })

  it('website instant-estimate homeowner emails (already escaped before — fully byte-identical)', () => {
    const i = g.inputs.estimateInput
    expect(buildHomeownerEstimateEmailContent({ ...i, brand: PROD_ARX })).toEqual(g.homeownerEstimate.auto)
    expect(buildHomeownerEstimateEmailContent({ ...i, customerPath: 'fallback_unreliable', brand: PROD_ARX })).toEqual(g.homeownerEstimate.fallback)
    expect(buildHomeownerManualDesignEmailContent({ name: i.name, address: i.address, brand: PROD_ARX })).toEqual(g.homeownerEstimate.manual)
  })

  it('review request SMS', () => {
    const link = 'https://crm.example.test/api/r/abc'
    expect(composeReviewMessage({ customerName: 'Jane Homeowner', repName: 'Sam Rep', link, company: PROD_DOC })).toBe(g.reviewMessage.default)
    expect(composeReviewMessage({ customerName: 'Jane Homeowner', repName: null, link, company: PROD_DOC })).toBe(g.reviewMessage.noRep)
    expect(composeReviewMessage({ template: 'Hey {first_name} - {rep_first_name}: {link}', customerName: 'Jane', repName: null, link: 'L', company: PROD_DOC })).toBe(g.reviewMessage.custom)
  })

  it('instant-estimate next step copy', () => {
    expect(getPublicEstimateUnlockNextStepForPath('auto', PROD_ARX.shortName)).toBe(
      'An ARX team member will call you shortly to confirm details and schedule a free inspection.'
    )
    expect(getPublicEstimateUnlockNextStepForPath('silent_manual', PROD_ARX.shortName)).toBe(
      'One of our designers will reach out once they have manually drawn your roof. An ARX team member will call you shortly.'
    )
  })
})

describe('customer emails carry another company’s identity only', () => {
  it('no original-company identity in any builder', () => {
    const outs = [
      buildContractReadyEmail({ brand: OTHER_DOC, agreementLabel: 'Installation Agreement', customerName: 'J', signingUrl: 'u', projectAddress: 'a', isContingency: false, projectCost: 1, repName: 'R' }),
      buildContractSignedEmail({ brand: OTHER_DOC, agreementLabel: 'Installation Agreement', customerName: 'J', projectAddress: 'a', isContingency: false, projectCost: 1, customerPdfUrl: null }),
      buildChangeOrderReadyEmail({ brand: OTHER_DOC, coNumber: 'CO-1', customerName: 'J', signingUrl: 'u', projectAddress: 'a', updatedTotal: 1, repName: 'R' }),
      buildChangeOrderSignedEmail({ brand: OTHER_DOC, coNumber: 'CO-1', customerPdfUrl: null }),
      buildHomeownerEstimateEmailContent({ ...copyGolden.inputs.estimateInput, brand: OTHER }),
      buildHomeownerManualDesignEmailContent({ name: 'J', address: 'a', brand: OTHER }),
    ]
    for (const e of outs) {
      const all = `${e.subject}\n${e.text}\n${e.html}`
      for (const re of ARX_IDENTITY) expect(all).not.toMatch(re)
    }
    expect(outs[4].text).toContain('call 555-010-0199')
    expect(outs[4].html).toContain('href="tel:+15550100199"')
    expect(composeReviewMessage({ customerName: 'J', repName: null, link: 'L', company: OTHER_DOC })).toContain('the Summit team with Summit Roofing!')
  })

  it('escapes customer data in the agreement emails', () => {
    const e = buildContractSignedEmail({ brand: OTHER_DOC, agreementLabel: 'Installation Agreement', customerName: '<b>J</b>', projectAddress: 'a & b', isContingency: false, projectCost: 1, customerPdfUrl: null })
    expect(e.html).toContain('&lt;b&gt;J&lt;/b&gt;')
    expect(e.html).toContain('a &amp; b')
    expect(e.text).toContain('Dear <b>J</b>,')
  })

  it('crew invite names the company', () => {
    const base = { jobId: 'j', jobNumber: '26-1', customerName: 'C', addressText: 'A', scheduledDate: '2026-11-10' } as const
    const arx = buildInstallEvent({ ...base, orgPhone: '(704) 313-8834', orgShortName: PROD_ARX.shortName } as never)
    expect(arx.description).toContain('call ARX at (704) 313-8834.')
    expect(arx.description).toContain('ARX staff only: ')
    const other = buildInstallEvent({ ...base, orgPhone: '555-010-0199', orgShortName: 'Summit' } as never)
    expect(other.description).toContain('call Summit at 555-010-0199.')
    expect(other.description).toContain('Summit staff only: ')
    expect(other.description).not.toMatch(/ARX/)
  })
})

describe('slice-2a files carry no company literals', () => {
  // Contract/change-order clause wording (generatePdf.ts, the signing form) still names the company — slice 2b.
  const FILES = [
    'lib/contracts/customer-emails.ts',
    'lib/contracts/generateChangeOrderPdf.ts',
    'lib/completion-certificate.tsx',
    'lib/pdf/payroll-statement.ts',
    'lib/pdf/job-packet.ts',
    'lib/pdf/ProposalPDF.tsx',
    'lib/crew-link.ts',
    'lib/review-requests.ts',
    'lib/install-calendar.ts',
    'components/ProposalPDFv2.tsx',
    'app/contracts/sign/[token]/page.tsx',
    'app/change-orders/sign/[token]/page.tsx',
    'app/crew/[token]/page.tsx',
    'app/crew/[token]/CrewPhotoCapture.tsx',
    'app/invoices/[invoiceId]/print/page.tsx',
    'app/api/contracts/create/route.ts',
    'app/api/contracts/sign/route.ts',
    'app/api/change-orders/create/route.ts',
    'lib/change-orders-remote.ts',
    'app/api/change-orders/sign/route.ts',
    'app/api/crew/[token]/photos/finalize/route.ts',
    'app/api/crew/[token]/photos/register/route.ts',
    'app/api/public/estimate/preview/route.ts',
    'app/api/public/estimate/unlock/route.ts',
    'app/api/ops/jobs/[id]/completion-certificate/send/route.ts',
  ]
  it.each(FILES)('%s', (file) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(src).not.toMatch(/(?<![A-Za-z0-9])ARX(?![a-z0-9])(?! CRM)/)
    expect(src).not.toMatch(/arxroofing\.com/i)
    expect(src).not.toMatch(/313[-. ]8834|Woodbury/)
  })
})

/** ARX's row once supabase/data-fixes/2026-11-10_arx_brand_into_org_row.sql is applied (the values it writes). */
const ARX_AFTER_FIX_ROW = {
  ...PROD_ROW,
  settings: {
    brand: {
      legalName: 'ARX Roofing & Exteriors, LLC',
      shortName: 'ARX',
      website: 'arxroofing.com',
      serviceArea: 'Charlotte / Kannapolis, NC',
      documentLegalName: 'ARX Roofing & Exteriors LLC',
      documentAddress: '4101 Woodbury Terrace NW\nConcord, NC 28027',
      serviceRegion: 'Charlotte metro',
    },
  },
}

describe('neutral fallback on a fenced deployment (DEPLOYMENT_ORG_ID set)', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.DEPLOYMENT_ORG_ID = '00000000-0000-4000-8000-000000000001'
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('DEFAULT_ORG_BRAND carries no company at all', () => {
    for (const v of Object.values(DEFAULT_ORG_BRAND)) expect(v).toBe('')
    expect(resolveOrgBrand(null)).toEqual({ ...DEFAULT_ORG_BRAND })
  })

  it('an org with nothing but its columns prints only its own identity', () => {
    const b = resolveOrgBrand({ name: 'Green Leaf Landscapes', phone: '555-010-0100', email: 'a@green.example', address: '1 Oak St\nTown, ST 00000' })
    expect(b.legalName).toBe('Green Leaf Landscapes')
    expect(b.shortName).toBe('Green Leaf Landscapes')
    expect(b.website).toBe('')
    expect(b.documentLegalName).toBeUndefined()
    const flat = JSON.stringify([b, brandDocument(b)])
    for (const re of ARX_IDENTITY) expect(flat).not.toMatch(re)
  })

  it('ARX after the data fix resolves exactly as ARX does today (unfenced, settings.brand null)', () => {
    const fenced = resolveOrgBrand(ARX_AFTER_FIX_ROW)
    delete process.env.DEPLOYMENT_ORG_ID
    const today = resolveOrgBrand(PROD_ROW)
    expect(fenced).toEqual(today)
    expect(brandDocument(fenced)).toEqual(brandDocument(today))
  })

  it('ARX after the data fix, still unfenced: identical too (stored values equal the legacy ones)', () => {
    delete process.env.DEPLOYMENT_ORG_ID
    expect(resolveOrgBrand(ARX_AFTER_FIX_ROW)).toEqual(resolveOrgBrand(PROD_ROW))
  })

  it('partial brand: stored fields win, a missing short/legal name is the company name, blanks stay blank', () => {
    const b = resolveOrgBrand({ name: 'Green Leaf', phone: '555-010-0100', settings: { brand: { shortName: 'Green', website: '  ' } } })
    expect([b.shortName, b.legalName, b.website, b.serviceArea, b.email]).toEqual(['Green', 'Green Leaf', '', '', ''])
  })

  it('ARX after the data fix: contract PDFs keep their golden hashes', async () => {
    jest.useFakeTimers({ now: new Date(pdfGolden.now), doNotFake: ['nextTick', 'setImmediate'] })
    try {
      const doc = brandDocument(resolveOrgBrand(ARX_AFTER_FIX_ROW))
      for (const t of ['installation', 'contingency', 'repair']) {
        const buf = await generateContractPdf({ ...pdfGolden.contractBase, agreement_type: t } as never, doc)
        expect(sha(buf)).toBe((pdfGolden.sha256 as Record<string, string>)[`contract_${t}`])
      }
      expect(sha(await generateChangeOrderPdf(pdfGolden.coInput as never, doc))).toBe(pdfGolden.sha256.change_order)
    } finally {
      jest.useRealTimers()
    }
  })

  it('the From header (no company) comes from this deployment’s SMTP env, never a company literal', async () => {
    process.env.SMTP_FROM = 'Green Leaf <office@green.example>'
    expect(await getCrmEmailFrom(null)).toBe('Green Leaf <office@green.example>')
    delete process.env.SMTP_FROM
    process.env.SMTP_USER = 'mailer@green.example'
    expect(await getCrmEmailFrom(null)).toBe('mailer@green.example')
    delete process.env.SMTP_USER
    expect(await getCrmEmailFrom(null)).toBe('')
  })

  it('website-estimate errors read the org brand and drop blank parts', () => {
    expect(misconfiguredMessage(resolveOrgBrand(null).phone)).toBe('Public roof estimate is not configured.')
    expect(outOfServiceAreaMessage({ serviceArea: 'Anytown, ST', phone: '555-010-0100' })).toBe(
      'That address looks outside our service area (Anytown and nearby). Call 555-010-0100 and we can still help.'
    )
    expect(outOfServiceAreaMessage(resolveOrgBrand(null))).toBe('That address looks outside our service area.')
  })
})

describe('legacy gate (unfenced = ARX prod today) keeps the old strings', () => {
  it('From header and estimate errors are unchanged', async () => {
    const saved = process.env.SMTP_FROM
    delete process.env.SMTP_FROM
    expect(await getCrmEmailFrom(null)).toBe('ARX Roofing <info@arxroofing.com>')
    if (saved !== undefined) process.env.SMTP_FROM = saved
    expect(misconfiguredMessage(resolveOrgBrand(null).phone)).toBe('Public roof estimate is not configured. Please call (704) 313-8834.')
  })
  it('out-of-area copy is byte-identical for ARX (serviceRegion "Charlotte metro"), before and after the data fix', () => {
    const OLD = 'That address looks outside our service area (Charlotte metro and nearby). Call (704) 313-8834 and we can still help.'
    expect(outOfServiceAreaMessage(PROD_ARX)).toBe(OLD)
    expect(outOfServiceAreaMessage(resolveOrgBrand(ARX_AFTER_FIX_ROW))).toBe(OLD)
    process.env.DEPLOYMENT_ORG_ID = 'x'
    try {
      expect(outOfServiceAreaMessage(resolveOrgBrand(ARX_AFTER_FIX_ROW))).toBe(OLD)
    } finally {
      delete process.env.DEPLOYMENT_ORG_ID
    }
  })
  it('an edited service area drops the legacy region wording', () => {
    expect(resolveOrgBrand({ ...PROD_ROW, settings: { brand: { serviceArea: 'Raleigh, NC' } } }).serviceRegion).toBeUndefined()
  })
})

describe('staleDocumentSpellings', () => {
  it('a new legal name clears the stored contract legal name; a changed address clears the contract address', () => {
    expect(staleDocumentSpellings({ legalName: 'New Co, LLC' }, undefined, 'x')).toEqual({ documentLegalName: '' })
    expect(staleDocumentSpellings(null, '1 New St', '4101 Woodbury Ter NW')).toEqual({ documentAddress: '' })
    expect(staleDocumentSpellings(null, ' 1 New St ', '1 New St')).toBeNull()
    expect(staleDocumentSpellings({ website: 'x.example' }, undefined, 'a')).toBeNull()
    expect(staleDocumentSpellings({ serviceArea: 'Raleigh, NC' }, undefined, 'a')).toEqual({ serviceRegion: '' })
  })
})
