/** @jest-environment node */
/**
 * finalizeApproval: repeatable, never stuck. Covers the contract token expiry (a retry a month later), a signing step that
 * stopped after marking the contract completed (no job), the half-made deposit invoice, and the approval PDF + copy link.
 */
const signContract = jest.fn()
jest.mock('@/app/api/contracts/sign/route', () => ({ POST: (...a: unknown[]) => signContract(...a) }))
const addInvoiceItem = jest.fn()
const finalizeAndSendInvoice = jest.fn()
jest.mock('@/lib/invoices', () => ({
  addInvoiceItem: (...a: unknown[]) => addInvoiceItem(...a),
  finalizeAndSendInvoice: (...a: unknown[]) => finalizeAndSendInvoice(...a),
  computeInvoiceBalance: jest.fn(),
}))
const storeApprovalPdf = jest.fn()
jest.mock('@/lib/quotes/pdf', () => ({ storeApprovalPdf: (...a: unknown[]) => storeApprovalPdf(...a) }))
const sendApprovalConfirmation = jest.fn()
jest.mock('@/lib/quotes/send', () => ({ sendApprovalConfirmation: (...a: unknown[]) => sendApprovalConfirmation(...a) }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://crm.example.test', tryOrgAppUrl: async () => 'https://crm.example.test' }))
jest.mock('@/lib/online-payments/accounts', () => ({ loadOnlinePayments: jest.fn() }))
jest.mock('@/lib/online-payments/links', () => ({ createPaymentLink: jest.fn(), tooManyLinks: jest.fn() }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { APPROVAL_CONTRACT_TOKEN_DAYS, finalizeApproval } from '@/lib/quotes/approve'

const ORG = 'org-1'
const snapshot = {
  proposalNumber: 'P-1', title: 'Spring', terms: 'T', legacyTax: true, taxLines: [], taxableCents: 0, declinedIds: [],
  lines: [{ id: 'l1', name: 'Mowing', description: 'Weekly', quantity: 4, unit: 'visit', optional: false, chosen: true, cents: 40000 }],
  deposit: { mode: 'percent', percent: 25, cents: 10000 },
}
const approval = (over: Record<string, unknown> = {}) => ({
  id: 'a1', org_id: ORG, proposal_id: 'p1', opportunity_id: 'o1', link_id: null, typed_name: 'Pat Doe', approved_at: '2026-11-01T12:00:00Z', approved_ip: '1.2.3.4',
  selected_item_ids: [], snapshot, subtotal_cents: 40000, discount_cents: 0, tax_cents: 0, total_cents: 40000, deposit_cents: 10000,
  contract_id: null, job_id: null, deposit_invoice_id: null, proposal_rewritten_at: '2026-11-01T12:00:01Z', finalized_at: null, finalize_error: null, confirmation_sent_at: null, finalize_claimed_at: null, ...over,
})
const proposal = { id: 'p1', org_id: ORG, status: 'sent', opportunity_id: 'o1', proposal_number: 'P-1', customer_name: 'Pat Doe', customer_email: 'pat@x.test', customer_phone: null, customer_address: '1 Main', discount_percent: 0, created_by: 'u1' }
const relations = { job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true } } }

function setup(seed: Record<string, Array<Record<string, unknown>>>) {
  const db = createFakeDb({ quote_approvals: [approval()], proposals: [proposal], ...seed }, { relations })
  return db
}
const ok = () => ({ ok: true, json: async () => ({ success: true }) })

beforeEach(() => {
  jest.clearAllMocks()
  storeApprovalPdf.mockResolvedValue('org/org-1/quotes/a1.pdf')
  sendApprovalConfirmation.mockResolvedValue(true)
  addInvoiceItem.mockResolvedValue({})
  finalizeAndSendInvoice.mockResolvedValue({})
})

function signing(db: ReturnType<typeof createFakeDb>, opts: { makeJob?: boolean; projectCreateError?: string } = {}) {
  signContract.mockImplementation(async () => {
    const c = db.tables.order_form_contracts[0]
    c.status = 'completed'
    if (opts.projectCreateError) return { ok: true, json: async () => ({ success: true, projectCreateError: opts.projectCreateError }) }
    if (opts.makeJob !== false) (db.tables.production_jobs ??= []).push({ id: 'j1', org_id: ORG, accepted_proposal_id: 'p1', sale_amount: 400 })
    return ok()
  })
}

describe('approval contract', () => {
  it('is made with a far-out signing-token expiry, so a retry weeks later never meets an expired token', async () => {
    const db = setup({})
    signing(db)
    const now = new Date('2026-11-01T12:05:00Z')
    expect(await finalizeApproval(db.client, ORG, 'a1', { now })).toBe(true)
    const c = db.tables.order_form_contracts[0]
    const exp = Date.parse(String(c.token_expires_at))
    expect(exp - now.getTime()).toBeGreaterThan((APPROVAL_CONTRACT_TOKEN_DAYS - 1) * 86_400_000)
    expect(exp - Date.now()).toBeGreaterThan(365 * 86_400_000)
  })

  it('links the approval PDF on the contract and in the confirmation email', async () => {
    const db = setup({})
    signing(db)
    await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-11-01T12:05:00Z') })
    expect(storeApprovalPdf).toHaveBeenCalledTimes(1)
    expect(sendApprovalConfirmation.mock.calls[0][5]).toContain('/api/files/signed/contract/')
  })
})

describe('signing stopped half way', () => {
  it('a project/job failure is a failure (not a silent finish) and the retry finishes job creation', async () => {
    const db = setup({})
    signing(db, { projectCreateError: 'boom' })
    expect(await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-11-01T12:05:00Z') })).toBe(false)
    expect(db.tables.quote_approvals[0].finalized_at).toBeNull()
    // The route had marked the contract completed but made no job. The retry reopens it and runs the route again.
    expect(db.tables.order_form_contracts[0].status).toBe('completed')
    signing(db)
    expect(await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-12-15T12:00:00Z') })).toBe(true)
    expect(signContract).toHaveBeenCalledTimes(2)
    expect(db.tables.quote_approvals[0].job_id).toBe('j1')
  })

  it('a completed contract whose job exists is not signed again', async () => {
    const db = setup({ order_form_contracts: [{ id: 'c1', org_id: ORG, status: 'completed', signing_token: 't' }], production_jobs: [{ id: 'j1', org_id: ORG, accepted_proposal_id: 'p1', sale_amount: 400 }] })
    db.tables.quote_approvals[0].contract_id = 'c1'
    expect(await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-11-01T12:05:00Z') })).toBe(true)
    expect(signContract).not.toHaveBeenCalled()
  })
})

describe('deposit invoice', () => {
  const base = { order_form_contracts: [{ id: 'c1', org_id: ORG, status: 'completed', signing_token: 't', pdf_url: 'x.pdf' }], production_jobs: [{ id: 'j1', org_id: ORG, accepted_proposal_id: 'p1', sale_amount: 400 }] }
  const withContract = (db: ReturnType<typeof createFakeDb>) => { db.tables.quote_approvals[0].contract_id = 'c1' }

  it('an empty draft left by an earlier attempt gets its line and is sent, once', async () => {
    const db = setup({ ...base, job_invoices: [{ id: 'i1', org_id: ORG, job_id: 'j1', invoice_kind: 'deposit', status: 'draft' }] })
    withContract(db)
    expect(await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-11-01T12:05:00Z') })).toBe(true)
    expect(addInvoiceItem).toHaveBeenCalledTimes(1)
    expect(finalizeAndSendInvoice).toHaveBeenCalledTimes(1)
    expect(db.tables.quote_approvals[0].deposit_invoice_id).toBe('i1')
  })

  it('a draft that already has its line is only sent', async () => {
    const db = setup({ ...base, job_invoices: [{ id: 'i1', org_id: ORG, job_id: 'j1', invoice_kind: 'deposit', status: 'draft' }], job_invoice_items: [{ id: 'it1', invoice_id: 'i1', org_id: ORG }] })
    withContract(db)
    await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-11-01T12:05:00Z') })
    expect(addInvoiceItem).not.toHaveBeenCalled()
    expect(finalizeAndSendInvoice).toHaveBeenCalledTimes(1)
  })

  it('a complete (sent) invoice is left alone', async () => {
    const db = setup({ ...base, job_invoices: [{ id: 'i1', org_id: ORG, job_id: 'j1', invoice_kind: 'deposit', status: 'sent' }], job_invoice_items: [{ id: 'it1', invoice_id: 'i1', org_id: ORG }] })
    withContract(db)
    await finalizeApproval(db.client, ORG, 'a1', { now: new Date('2026-11-01T12:05:00Z') })
    expect(addInvoiceItem).not.toHaveBeenCalled()
    expect(finalizeAndSendInvoice).not.toHaveBeenCalled()
  })
})
