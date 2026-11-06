/**
 * Contract terms have ONE source (lib/contracts/terms.ts). Nathan, 2026-11-06: the PDF wording wins.
 * For every agreement type and the change order, the words on the signing screen must equal the words in the PDF the
 * customer receives (whitespace normalized only). The PDF side is read out of the real generated PDF, not from terms.ts,
 * so a generator that stops using the shared text fails here. The exact strings are pinned so a wording change is deliberate.
 */
import { createHash } from 'crypto'
import { fireEvent, render, screen } from '@testing-library/react'

// jsdom would resolve jsPDF's browser ES build; use the Node build the server uses (it needs Node's TextEncoder).
jest.mock('jspdf', () => {
  const { TextEncoder, TextDecoder } = require('util')
  Object.assign(globalThis, { TextEncoder, TextDecoder })
  return jest.requireActual('jspdf/dist/jspdf.node.min.js')
})
// jsdom has no canvas; the signature pad is not under test here.
jest.mock('@/components/contracts/SignaturePad', () => ({ __esModule: true, default: () => null }))

import pdfGolden from './fixtures/brand-documents-golden.json'
import ContractSigningForm from '@/app/contracts/sign/[token]/CustomerSigningForm'
import ChangeOrderSigningForm from '@/app/change-orders/sign/[token]/CustomerSigningForm'
import { generateContractPdf } from '@/lib/contracts/generatePdf'
import { generateChangeOrderPdf } from '@/lib/contracts/generateChangeOrderPdf'
import {
  CHANGE_ORDER_AGREEMENT,
  CONTINGENCY_TERMS,
  INSTALLATION_TERMS,
  noticeOfCancellation,
  REPAIR_TERMS,
} from '@/lib/contracts/terms'
import { brandDocument, resolveOrgBrand } from '@/lib/org-brand'

const DOC = brandDocument(
  resolveOrgBrand({
    name: 'ARX Roofing & Exteriors',
    phone: '(704) 313-8834',
    email: 'info@arxroofing.com',
    address: '4101 Woodbury Ter NW\nConcord, NC 28027',
    settings: { brand: null },
  }),
)

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
/** Visible text of a screen block: each heading/paragraph is its own line (textContent alone glues blocks together). */
const blockText = (el: HTMLElement) => norm(Array.from(el.querySelectorAll('h3, p')).map((n) => n.textContent ?? '').join(' '))

// jsPDF standard fonts write WinAnsi bytes; map back the few non-ASCII characters the terms use.
const WIN_ANSI: Record<string, string> = { '\x91': '‘', '\x92': '’', '\x93': '“', '\x94': '”', '\x96': '–', '\x97': '—' }

/** Every text run the PDF draws, in order (uncompressed jsPDF content streams). */
function pdfTextRuns(buf: Buffer): string[] {
  const src = buf.toString('latin1')
  const runs: string[] = []
  const re = /\(((?:\\.|[^\\)])*)\) Tj/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    runs.push(
      m[1]
        .replace(/\\([()\\])/g, '$1')
        .replace(/[\x91-\x97]/g, (c) => WIN_ANSI[c] ?? c),
    )
  }
  return runs
}

/** PDF text between the run equal to `from` (exclusive) and the first run starting with `to` (exclusive). */
function pdfBetween(buf: Buffer, from: string, to: (run: string) => boolean): string {
  const runs = pdfTextRuns(buf)
  const start = runs.indexOf(from)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = runs.findIndex((r, i) => i > start && to(r))
  expect(end).toBeGreaterThan(start)
  return norm(runs.slice(start + 1, end).filter((r) => !/^Page \d+ of \d+ \|/.test(r)).join(' '))
}

const contract = (t: string) =>
  ({ ...pdfGolden.contractBase, agreement_type: t, rep_signature_data: '', rep_name: 'Sam Rep' }) as never

const notice = noticeOfCancellation(pdfGolden.contractBase.customer_signed_at, DOC)

function screenTerms(t: string): string {
  render(<ContractSigningForm contract={contract(t)} token="tok" brand={DOC} cancellationNotice={notice} />)
  fireEvent.click(screen.getByRole('button', { name: /View Full Terms and Conditions/ }))
  return blockText(screen.getByTestId('agreement-terms'))
}

describe('signing screen shows exactly the PDF terms', () => {
  it('installation', async () => {
    const pdf = pdfBetween(await generateContractPdf(contract('installation'), DOC), 'Terms And Conditions', (r) => r === 'Customer Acknowledgements')
    expect(screenTerms('installation')).toBe(pdf)
  })

  it('contingency', async () => {
    const pdf = pdfBetween(await generateContractPdf(contract('contingency'), DOC), 'Terms', (r) => r.startsWith('Customer Initials:'))
    expect(screenTerms('contingency')).toBe(pdf)
  })

  it('repair', async () => {
    const pdf = pdfBetween(await generateContractPdf(contract('repair'), DOC), 'Terms', (r) => r.startsWith('Initials:'))
    expect(screenTerms('repair')).toBe(pdf)
  })

  it('installation Notice of Cancellation (collapsed until tapped)', async () => {
    const buf = await generateContractPdf(contract('installation'), DOC)
    const runs = pdfTextRuns(buf)
    const start = runs.lastIndexOf('Notice of Cancellation')
    const end = runs.indexOf('I HEREBY CANCEL THIS TRANSACTION.')
    const pdfNotice = norm(runs.slice(start, end + 1).join(' '))

    render(<ContractSigningForm contract={contract('installation')} token="tok" brand={DOC} cancellationNotice={notice} />)
    expect(screen.queryByTestId('notice-of-cancellation')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Notice of Cancellation' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(blockText(screen.getByTestId('notice-of-cancellation'))).toBe(pdfNotice)
    // same deadline rule as the PDF: 3 business days after Thu Nov 5 2026 → Tue Nov 10 2026
    expect(notice.deadline).toBe('November 10, 2026')
    expect(pdfNotice).toContain('NOT LATER THAN MIDNIGHT OF: November 10, 2026')
  })

  it('repair and contingency screens do not show the installation notice', () => {
    for (const t of ['repair', 'contingency']) {
      const { unmount } = render(<ContractSigningForm contract={contract(t)} token="tok" brand={DOC} cancellationNotice={notice} />)
      expect(screen.queryByRole('button', { name: 'Notice of Cancellation' })).toBeNull()
      unmount()
    }
  })

  it('change order agreement sentence', async () => {
    const buf = await generateChangeOrderPdf(pdfGolden.coInput as never, DOC)
    const runs = pdfTextRuns(buf)
    const start = runs.findIndex((r) => r.startsWith('By signing below, both parties'))
    const end = runs.findIndex((r, i) => i > start && r === 'Customer')
    const pdf = norm(runs.slice(start, end).join(' '))
    render(
      <ChangeOrderSigningForm
        changeOrder={{ co_number: 'CO-1', description: 'x', customer_print_name: 'Pat', updated_total: 1 }}
        token="tok"
      />,
    )
    expect(norm(screen.getByTestId('change-order-agreement').textContent ?? '')).toBe(pdf)
  })
})

describe('pinned wording (PDF wording, 2026-11-06)', () => {
  it('repair terms', () => {
    expect(REPAIR_TERMS).toEqual([
      '1. Only the work and price on this page count. That can be roofing, gutters, siding, or other repairs—whatever is listed. Not a whole new roof or whole building unless we say so in writing.',
      '2. Anything not listed needs a written change order before we do it.',
      "3. ARX only stands behind the work ARX does here—not old damage, hidden issues, other parts of the home, or other companies' work.",
      '4. Dates are approximate. Rain, supplies, permits, or access can slow things down.',
      '5. You pay what this page says. With insurance, you still pay deductible, upgrades, and what insurance does not pay unless we agree in writing.',
      '6. You let us into the work area. We may take photos or measurements for the job and our files.',
      '7. Signing on a phone or computer still counts.',
    ])
  })

  it('contingency terms', () => {
    expect(CONTINGENCY_TERMS).toEqual([
      '1. Purpose. Customer authorizes ARX to inspect, document, estimate, and communicate with the insurance carrier about exterior storm damage. This agreement does not authorize construction work.',
      '2. Contingency. Customer has no obligation to move forward unless the insurance carrier approves the claim and ARX accepts the approved scope and price.',
      '3. Contractor Selection. If the claim, scope, and price are approved, Customer agrees to use ARX for the approved exterior work, subject to a final Installation Agreement before construction starts.',
      '4. Customer Costs. Customer remains responsible for the deductible, upgrades, non-covered work, code items not paid by insurance, and signed change orders. ARX will not waive deductibles or offer improper inducements.',
      '5. Claim Help. ARX may provide photos, measurements, estimates, supplements, and meeting support. ARX is not a public adjuster and does not decide coverage.',
      '6. No Construction Start. Materials are not ordered and work does not start until the final Installation Agreement is signed.',
      '7. Cancellation. Customer may cancel within any required 3-business-day cancellation period and before the final Installation Agreement. If Customer asks ARX to incur outside costs, Customer will reimburse documented costs.',
      '8. Photos And Communication. Customer authorizes ARX to take photos/video for claim documentation, quality control, training, and project records.',
    ])
  })

  it('change order agreement', () => {
    expect(CHANGE_ORDER_AGREEMENT).toBe(
      'By signing below, both parties agree to the changes described above. The customer acknowledges that the updated total project cost and remaining balance are accurate.',
    )
  })

  it('installation terms: 15 sections, first and last clause pinned, whole text fingerprinted', () => {
    expect(INSTALLATION_TERMS.map((s) => s.title.split(' — ')[0])).toEqual(
      Array.from({ length: 15 }, (_, i) => `Section ${i + 1}`),
    )
    expect(INSTALLATION_TERMS[0].content[0]).toBe(
      '1.1 ARX will furnish labor and materials necessary to perform the checked Scope of Work above, in a workmanlike manner, and in reasonable compliance with applicable North Carolina codes and permitting requirements.',
    )
    expect(INSTALLATION_TERMS[14].content.at(-1)).toBe('15.5 Signatures may be executed electronically and will be treated as original signatures.')
    const all = INSTALLATION_TERMS.map((s) => [s.title, ...s.content].join('\n')).join('\n\n')
    expect(createHash('sha256').update(all).digest('hex')).toBe('1144d5ffff56eadc0c89c212a554aed3bb962f756751ba9ffc5b62a138a7df40')
  })
})
