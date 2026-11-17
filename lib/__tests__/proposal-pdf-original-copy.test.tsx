/** @jest-environment node */
/**
 * The warranties list, Ways to Pay page and insurance line are the original company's own promises (ARX): another
 * company's proposal PDF never prints them, and has no blank page or "of 7" gap. ARX output stays as it was.
 */
jest.mock('@react-pdf/renderer', () => ({
  Document: 'document',
  Page: 'page',
  Text: 'text',
  View: 'view',
  StyleSheet: { create: (styles: unknown) => styles },
  Image: 'image',
}))

import { renderToStaticMarkup } from 'react-dom/server'
import { ProposalPDFv2, type ProposalPDFData } from '@/components/ProposalPDFv2'

const base: ProposalPDFData = {
  proposal: {
    id: 'p1', proposal_number: 'P-00001', customer_name: 'Pat', customer_address: '1 Main St', title: 'Proposal', status: 'sent',
    subtotal: 1000, discount_amount: 0, discount_percent: 0, tax_rate: 0, tax_amount: 0, total: 1000, created_at: '2026-11-01T12:00:00Z',
  },
  lineItems: [],
  company: { name: 'Company' },
}
const render = (company: ProposalPDFData['company']) => renderToStaticMarkup(<ProposalPDFv2 data={{ ...base, company }} />)
const text = (html: string) => html.replace(/<[^>]+>/g, '|')
const pages = (html: string) => (html.match(/<page/g) ?? []).length

describe('proposal PDF: original-company copy', () => {
  it('the original company prints all 7 pages with warranties, Ways to Pay and the insurance line', () => {
    const html = render({ name: 'Company', original: true })
    const t = text(html)
    expect(pages(html)).toBe(7)
    expect(t).toContain('Our Warranties')
    expect(t).toContain('5-Year Workmanship Warranty')
    expect(t).toContain('Ways to Pay')
    expect(t).toContain('Insurance coverage decisions')
    expect(t).toContain('Page 7 of 7')
  })

  it('a snapshot from before the flag existed prints exactly as the original always did', () => {
    expect(render({ name: 'Company' })).toBe(render({ name: 'Company', original: true }))
  })

  it('another company gets no warranty, financing or insurance copy, 6 pages, numbered 1..6', () => {
    const html = render({ name: 'Company', original: false })
    const t = text(html)
    expect(pages(html)).toBe(6)
    for (const s of ['Our Warranties', 'Workmanship Warranty', 'No-Leak', 'Manufacturer Warranty', 'Ways to Pay', 'Monthly payment plans', 'no-payment', 'Insurance coverage decisions', 'lender']) {
      expect(t).not.toContain(s)
    }
    expect(t).toContain('Your Investment')
    expect(t).toContain('Page 6 of 6')
    expect(t).not.toContain('of 7')
  })
})
