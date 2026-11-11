/** @jest-environment node */
jest.mock('@react-pdf/renderer', () => ({ renderToBuffer: async () => Buffer.from('pdf'), Document: 'document', Page: 'page', Text: 'text', View: 'view', StyleSheet: { create: (s: unknown) => s } }))
jest.mock('@/lib/org-brand', () => ({ getOrgBrand: async () => ({ name: 'Precision', phone: '', email: '', address: '' }) }))
import { approvalPdfData, storeApprovalPdf } from '@/lib/quotes/pdf'
import { flagApprovalBlocked, listBlockedQuotes } from '@/lib/quotes/blocked'
import { withHeldQuotes } from '@/lib/today'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const approval = {
  id: 'a1', typed_name: 'Pat Doe', approved_at: '2026-11-01T12:00:00Z', approved_ip: '1.2.3.4', subtotal_cents: 100, discount_cents: 0, tax_cents: 0, total_cents: 100, deposit_cents: 0,
  snapshot: { proposalNumber: 'P-1', title: 'T', terms: '', customer: { name: 'Pat As Approved', address: '1 Approved St' }, lines: [], declinedIds: [], taxLines: [], taxableCents: 0, legacyTax: true, deposit: { mode: 'none', percent: 0, cents: 0 } },
}

describe('approval PDF', () => {
  it('names the customer from the snapshot, not the live proposal', () => {
    const d = approvalPdfData(approval as never, { name: 'Co' }, { name: 'Edited Later', address: 'Elsewhere' })
    expect(d.customerName).toBe('Pat As Approved')
    expect(d.customerAddress).toBe('1 Approved St')
  })

  it('never overwrites a stored PDF: upsert is off and an existing file is reused', async () => {
    const upload = jest.fn(async () => ({ error: { message: 'The resource already exists', statusCode: '409' } }))
    const db = createFakeDb({ order_form_contracts: [{ id: 'c1', org_id: 'org1' }] })
    const admin = { storage: { from: () => ({ upload }) }, from: (t: string) => (db.client as never as { from: (t: string) => unknown }).from(t) }
    const path = await storeApprovalPdf(admin as never, 'org1', approval as never, 'c1', { name: 'x', address: 'y' })
    expect(upload).toHaveBeenCalledWith('org/org1/quotes/a1.pdf', expect.anything(), expect.objectContaining({ upsert: false }))
    expect(path).toBe('org/org1/quotes/a1.pdf')
    expect(db.tables.order_form_contracts[0].pdf_url).toBe(path)
  })
})

describe('held approval (link sent before the sale-credit rule)', () => {
  it('flags the link, lists it for its sender, and shows it first in Needs you', async () => {
    const db = createFakeDb(
      { quote_links: [{ id: 'l1', org_id: 'org1', proposal_id: 'p1', created_by: 'u1', approval_blocked_at: null, revoked_at: null, expires_at: '2099-01-01T00:00:00Z' }], proposals: [{ id: 'p1', org_id: 'org1', customer_name: 'Pat', proposal_number: 'P-1' }] },
      { relations: { quote_links: { proposals: { table: 'proposals', fk: 'proposal_id' } } } }
    )
    await flagApprovalBlocked(db.client, 'org1', 'l1')
    expect(db.tables.quote_links[0].approval_blocked_at).toBeTruthy()
    const held = await listBlockedQuotes(db.client, 'org1', { createdBy: 'u1' })
    expect(held).toEqual([{ proposalId: 'p1', customerName: 'Pat', proposalNumber: 'P-1' }])
    expect(await listBlockedQuotes(db.client, 'org1', { createdBy: 'someone-else' })).toEqual([])
    const q = withHeldQuotes({ id: 'unsigned-proposals', title: 'x', count: 1, empty: '', items: [{ id: 'a', title: 'A', detail: '', href: '/a', ref: 'r', note: '' }] }, held)
    expect(q.count).toBe(2)
    expect(q.items[0].id).toBe('held-p1')
  })
})
