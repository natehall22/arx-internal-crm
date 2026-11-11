/** @jest-environment node */
/**
 * The customer PDF prints the tax rows from the ONE pricing helper: a legacy quote prints exactly the old single row
 * ("Tax (7%)"), a quote priced with company rates prints one row per rate from its stored snapshot.
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
    id: 'p1',
    proposal_number: 'P-00001',
    customer_name: 'Pat Customer',
    customer_address: '1 Main St',
    title: 'Proposal',
    status: 'sent',
    subtotal: 25157.22,
    discount_amount: 800,
    discount_percent: 0,
    tax_rate: 7,
    tax_amount: 1705.01,
    total: 26062.23,
    created_at: '2026-11-01T12:00:00Z',
  },
  lineItems: [],
  company: { name: 'Company' },
}

const text = (data: ProposalPDFData) => renderToStaticMarkup(<ProposalPDFv2 data={data} />).replace(/<[^>]+>/g, '|')

describe('proposal PDF tax rows', () => {
  it('legacy single-rate quote: one "Tax (7%)" row, same amount and total as stored', () => {
    const t = text(base)
    expect(t).toContain('|Tax (7%)|')
    expect(t).toContain('$1,705.01')
    expect(t).toContain('$26,062.23')
    expect(t).not.toContain('NC state')
  })

  it('company-rate quote: a row per stored rate', () => {
    const t = text({
      ...base,
      proposal: {
        ...base.proposal,
        tax_rate: 7,
        tax_amount: 1705.02,
        total: 26062.24,
        tax_lines: [
          { id: 'nc', name: 'NC state', percent: 4.75, amount_cents: 115697 },
          { id: 'cab', name: 'Cabarrus County', percent: 2.25, amount_cents: 54805 },
        ],
      },
    })
    expect(t).toContain('|NC state (4.75%)|')
    expect(t).toContain('$1,156.97')
    expect(t).toContain('|Cabarrus County (2.25%)|')
    expect(t).toContain('$548.05')
    expect(t).not.toContain('Tax (7%)')
  })

  it('exempt customer: says so, charges nothing', () => {
    const t = text({ ...base, proposal: { ...base.proposal, tax_rate: 0, tax_amount: 0, total: 24357.22, tax_lines: [], tax_exempt: true } })
    expect(t).toContain('|Sales tax (exempt)|')
    expect(t).not.toContain('Tax (')
  })
})
