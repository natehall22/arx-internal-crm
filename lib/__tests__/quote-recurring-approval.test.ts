/** @jest-environment node */
/**
 * Approving a quote with recurring (service plan) lines: the plan is made once, the sale amount is the one-time total + the
 * first-season plan value (through the one signed contract), a recurring-only quote still counts as a sale, and a company
 * without recurring lines (roofing) is exactly as before.
 */
const signContract = jest.fn()
jest.mock('@/app/api/contracts/sign/route', () => ({ POST: (...a: unknown[]) => signContract(...a) }))
const addInvoiceItem = jest.fn()
const finalizeAndSendInvoice = jest.fn()
jest.mock('@/lib/invoices', () => ({ addInvoiceItem: (...a: unknown[]) => addInvoiceItem(...a), finalizeAndSendInvoice: (...a: unknown[]) => finalizeAndSendInvoice(...a), computeInvoiceBalance: jest.fn() }))
jest.mock('@/lib/quotes/pdf', () => ({ storeApprovalPdf: jest.fn().mockResolvedValue('org/org-1/quotes/a.pdf') }))
const sendApprovalConfirmation = jest.fn()
jest.mock('@/lib/quotes/send', () => ({ sendApprovalConfirmation: (...a: unknown[]) => sendApprovalConfirmation(...a) }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://crm.example.test', tryOrgAppUrl: async () => 'https://crm.example.test' }))
jest.mock('@/lib/online-payments/accounts', () => ({ loadOnlinePayments: jest.fn() }))
jest.mock('@/lib/online-payments/links', () => ({ createPaymentLink: jest.fn(), tooManyLinks: jest.fn() }))
jest.mock('@/lib/online-payments/cards', () => ({ loadCardOnFile: jest.fn() }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/Chicago' }))
const upsertCustomer = jest.fn()
jest.mock('@/lib/customers', () => ({ upsertCustomer: (...a: unknown[]) => upsertCustomer(...a) }))
const createServicePlan = jest.fn()
const findOrCreateProperty = jest.fn()
const loadServicePlan = jest.fn()
jest.mock('@/lib/service-plans-db', () => ({
  createServicePlan: (...a: unknown[]) => createServicePlan(...a),
  findOrCreateProperty: (...a: unknown[]) => findOrCreateProperty(...a),
  loadServicePlan: (...a: unknown[]) => loadServicePlan(...a),
}))
let ctxForTest: unknown
jest.mock('@/lib/quotes/load', () => ({ ...jest.requireActual('@/lib/quotes/load'), loadQuoteContext: async () => ctxForTest }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { approveQuote, finalizeApproval } from '@/lib/quotes/approve'
import { buildQuoteView, fingerprintOf, type QuoteContext } from '@/lib/quotes/load'
import { recurringFacts, recurringKey } from '@/lib/quotes/recurring'
import { newSigningTokenColumns } from '@/lib/signing-tokens'

process.env.SIGNING_TOKEN_SECRET = 'test-signing-secret'
const ORG = 'org-1'
const seasons = [{ from: '04-01', to: '10-31', frequency: 'every_2_weeks' as const }]
const template = { id: 't1', version: 2, name: 'Bi-weekly mowing', billing_basis: 'per_visit' as const, seasons, allowCustom: true, active: true }
const settings = { depositMode: 'percent', depositPercent: 25, depositFixedCents: 0, linkDays: 30, terms: 'Terms.' }
const NOW = new Date('2027-03-20T15:00:00Z')

type L = Record<string, unknown>
const oneTime = (id: string, total: number, extra: L = {}): L => ({ id, name: `Item ${id}`, description: null, category: 'Cleanup', unit: 'each', quantity: 1, unit_price: total, line_total: total, taxable: null, show_to_customer: true, sort_order: 0, is_optional: false, optional_default_on: false, ...extra })
const recurring = (id: string, price: number, extra: L = {}): L => ({ ...oneTime(id, 0, { name: 'Bi-weekly mowing', unit: 'visit', unit_price: price, service_plan_template_id: 't1', plan_start_date: '2027-04-01', plan_weekday: null }), ...extra })

function makeCtx(lines: L[], withPlans = true): QuoteContext {
  const rec: QuoteContext['recurring'] = {}
  for (const l of lines) {
    if (!l.service_plan_template_id || !withPlans) continue
    rec[String(l.id)] = { template, facts: recurringFacts(template, l as never) }
    l.recurring_key = recurringKey(template, l as never)
  }
  return {
    proposal: { id: 'p1', org_id: ORG, opportunity_id: 'o1', status: 'sent', title: 'Spring', proposal_number: 'P-1', customer_name: 'Pat Doe', customer_email: 'pat@x.test', customer_phone: null, customer_address: '12 Maple Ct', discount_amount: 0, discount_percent: 0, tax_rate: 0, tax_lines: null, tax_exempt: false, total: 0, scope_of_work: null, terms_conditions: null, expires_at: null, deposit_mode: null, deposit_value: null, created_by: 'u1' },
    lines: lines as never,
    tax: { kind: 'legacy', percent: 0 },
    settings: settings as never,
    customerId: 'c1',
    recurring: rec,
  }
}

const relations = { job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true } } }
function setup(lines: L[], withPlans = true) {
  ctxForTest = makeCtx(lines, withPlans)
  const db = createFakeDb(
    {
      proposals: [{ id: 'p1', org_id: ORG, status: 'sent', opportunity_id: 'o1', proposal_number: 'P-1', customer_name: 'Pat Doe', customer_email: 'pat@x.test', customer_phone: null, customer_address: '12 Maple Ct', discount_percent: 0, created_by: 'u1' }],
      proposal_line_items: lines.map((l) => ({ ...l, org_id: ORG, proposal_id: 'p1' })),
      opportunities: [{ id: 'o1', org_id: ORG, owner_user_id: 'closer1', customer_id: 'c1' }],
      quote_links: [{ id: 'ql1', org_id: ORG, created_by: 'u1' }],
    },
    { relations, unique: { service_plans: [['quote_line_id']] } }
  )
  signContract.mockImplementation(async () => {
    const c = db.tables.order_form_contracts[0]
    c.status = 'completed'
    ;(db.tables.production_jobs ??= []).push({ id: 'j1', org_id: ORG, accepted_proposal_id: 'p1', sale_amount: c.project_cost })
    return { ok: true, json: async () => ({ success: true }) }
  })
  return db
}
const link = { id: 'ql1', org_id: ORG, proposal_id: 'p1' } as never
const approve = (db: ReturnType<typeof createFakeDb>, selectedIds: string[] = []) =>
  approveQuote(db.client, link, { typedName: 'Pat Doe', selectedIds, fingerprint: fingerprintOf(ctxForTest as QuoteContext), agreed: true, ip: '1.2.3.4', userAgent: null, pageUrl: 'https://crm.example.test/q/t' }, NOW)

beforeEach(() => {
  jest.clearAllMocks()
  addInvoiceItem.mockResolvedValue({})
  finalizeAndSendInvoice.mockResolvedValue({})
  sendApprovalConfirmation.mockResolvedValue(true)
  upsertCustomer.mockResolvedValue({ customer_id: 'c-new', created: true })
  findOrCreateProperty.mockResolvedValue({ ok: true, propertyId: 'prop1' })
  loadServicePlan.mockImplementation(async () => ({ start_date: '2027-04-01', end_date: null, status: 'active', paused_until: null, seasons, preferred_weekday: null }))
  createServicePlan.mockImplementation(async (admin: { from: (t: string) => { insert: (r: object) => unknown } }, _o: string, _u: string, customerId: string, body: { start_date: string }, _n: Date, opts: { quoteLineId?: string }) => {
    const r = (await (admin.from('service_plans').insert({ id: `plan-${opts.quoteLineId}`, org_id: 'org-1', customer_id: customerId, quote_line_id: opts.quoteLineId, status: 'active' }) as unknown as Promise<{ error?: unknown }>))
    if (r && (r as { error?: unknown }).error) return { ok: false, status: 500, error: 'dup' }
    return { ok: true, plan: { id: `plan-${opts.quoteLineId}`, start_date: body.start_date, end_date: null, status: 'active', paused_until: null, seasons, preferred_weekday: null } }
  })
})

describe('recurring-only quote', () => {
  it('counts as a sale: contract + job carry the first-season plan value, no deposit invoice, one plan', async () => {
    const db = setup([recurring('r1', 45)])
    const res = await approve(db)
    expect(res).toMatchObject({ ok: true, finalized: true })
    const value = 16 * 4500
    const a = db.tables.quote_approvals[0]
    expect(a.total_cents).toBe(value) // the SALE amount
    expect(a.subtotal_cents).toBe(0)
    expect(a.deposit_cents).toBe(0)
    const c = db.tables.order_form_contracts[0]
    expect(c.project_cost).toBe(value / 100) // what rpt_sales and the commission base read
    expect(c.deposit_amount).toBe(0)
    expect(c.status).toBe('completed')
    expect(db.tables.production_jobs[0].sale_amount).toBe(value / 100)
    expect(db.tables.proposals[0].total).toBe(0) // the proposal is the ONE-TIME part
    expect(addInvoiceItem).not.toHaveBeenCalled()
    expect(db.tables.job_invoices ?? []).toHaveLength(0)
    expect(createServicePlan).toHaveBeenCalledTimes(1)
    expect(createServicePlan.mock.calls[0][4]).toMatchObject({ template_id: 't1', property_id: 'prop1', start_date: '2027-04-01', price: 45 })
    expect(createServicePlan.mock.calls[0][6]).toEqual({ quoteLineId: 'r1' })
    // the customer's recurring terms are in the legal snapshot
    expect(a.snapshot).toMatchObject({ recurring: [{ lineId: 'r1', termsLine: 'Billed after each visit. Cancel anytime.', detail: '$45 per visit · Apr 1–Oct 31 · about 16 visits', chosen: true, firstSeasonCents: value }] })
    // the confirmation gets the plan (first visit date)
    expect(sendApprovalConfirmation.mock.calls[0][6]).toMatchObject([{ lineId: 'r1', firstVisit: '2027-04-01' }])
  })

  it('a retry (finalize stopped after the plan) never makes a second plan', async () => {
    const db = setup([recurring('r1', 45)])
    sendApprovalConfirmation.mockRejectedValueOnce(new Error('smtp down'))
    signContract.mockClear()
    await approve(db)
    // Simulate a stop before finalized: clear the stamp and run again.
    db.tables.quote_approvals[0].finalized_at = null
    db.tables.quote_approvals[0].finalize_claimed_at = null
    expect(await finalizeApproval(db.client, ORG, String(db.tables.quote_approvals[0].id), { now: new Date('2027-03-21T15:00:00Z') })).toBe(true)
    expect(createServicePlan).toHaveBeenCalledTimes(1)
    expect(db.tables.service_plans).toHaveLength(1)
    expect(db.tables.production_jobs).toHaveLength(1)
    expect(db.tables.order_form_contracts).toHaveLength(1)
  })

  it('refuses when the recurring line cannot be sold (plans off / template gone)', async () => {
    const db = setup([recurring('r1', 45)], false)
    expect(await approve(db)).toMatchObject({ ok: false, status: 409 })
    expect(db.tables.quote_approvals ?? []).toHaveLength(0)
    expect(createServicePlan).not.toHaveBeenCalled()
  })
})

describe('mixed quote (cleanup + mowing)', () => {
  it('sale = one-time total + first-season plan value; deposit and proposal stay one-time', async () => {
    const db = setup([oneTime('a', 400), recurring('r1', 45)])
    expect(await approve(db)).toMatchObject({ ok: true, finalized: true })
    const value = 16 * 4500
    const a = db.tables.quote_approvals[0]
    expect(a.total_cents).toBe(40000 + value)
    expect(a.deposit_cents).toBe(10000) // 25% of the ONE-TIME 400, never of the plan value
    expect(db.tables.order_form_contracts[0].project_cost).toBe((40000 + value) / 100)
    expect(db.tables.proposals[0].total).toBe(400)
    expect(addInvoiceItem).toHaveBeenCalledTimes(1)
    expect(addInvoiceItem.mock.calls[0][2]).toMatchObject({ unit_price_cents: 10000 })
    expect(createServicePlan).toHaveBeenCalledTimes(1)
    expect(db.tables.order_form_contracts[0].scope_other).toContain('Bi-weekly mowing (recurring)')
  })
})

describe('optional recurring line', () => {
  it('declined: no plan, the line is removed from the quote, and the sale is the one-time total', async () => {
    const db = setup([oneTime('a', 400), recurring('r1', 45, { is_optional: true, optional_default_on: false })])
    expect(await approve(db, [])).toMatchObject({ ok: true, finalized: true })
    expect(createServicePlan).not.toHaveBeenCalled()
    expect(db.tables.quote_approvals[0].total_cents).toBe(40000)
    expect(db.tables.proposal_line_items.map((l) => l.id)).toEqual(['a'])
    expect((db.tables.quote_approvals[0].snapshot as { recurring: Array<{ chosen: boolean }> }).recurring[0].chosen).toBe(false)
  })
  it('ticked: the plan is made', async () => {
    const db = setup([oneTime('a', 400), recurring('r1', 45, { is_optional: true })])
    expect(await approve(db, ['r1'])).toMatchObject({ ok: true })
    expect(createServicePlan).toHaveBeenCalledTimes(1)
  })
  it('a declined optional recurring line alone cannot be approved (nothing is sold)', async () => {
    const db = setup([recurring('r1', 45, { is_optional: true })])
    expect(await approve(db, [])).toMatchObject({ ok: false, status: 400 })
  })
})

describe('a quote with no recurring line (roofing / ARX) is exactly as before', () => {
  it('total_cents is the one-time total, the snapshot has no recurring key, no plan code runs', async () => {
    const db = setup([oneTime('a', 400)])
    expect(await approve(db)).toMatchObject({ ok: true, finalized: true })
    const a = db.tables.quote_approvals[0]
    expect(a.total_cents).toBe(40000)
    expect('recurring' in (a.snapshot as object)).toBe(false)
    expect(db.tables.order_form_contracts[0].project_cost).toBe(400)
    expect(db.tables.proposals[0].total).toBe(400)
    expect(createServicePlan).not.toHaveBeenCalled()
    expect(upsertCustomer).not.toHaveBeenCalled()
    expect(sendApprovalConfirmation.mock.calls[0][6]).toEqual([])
  })
})

describe('customer view', () => {
  const company = { name: 'Precision', phone: '', email: '', logoHref: null }
  it('shows one-time lines as today and the recurring part apart, with its terms line', () => {
    const v = buildQuoteView({ ctx: makeCtx([oneTime('a', 400), recurring('r1', 45), recurring('r2', 60, { is_optional: true, name: 'Shrub trimming' })]), state: 'open', company, approval: null })
    expect(v.required.map((l) => l.id)).toEqual(['a'])
    expect(v.options).toEqual([])
    expect(v.hasOneTime).toBe(true)
    expect(v.recurring.map((r) => [r.name, r.detail, r.optional])).toEqual([
      ['Bi-weekly mowing', '$45 per visit · Apr 1–Oct 31 · about 16 visits', false],
      ['Shrub trimming', '$60 per visit · Apr 1–Oct 31 · about 16 visits', true],
    ])
    expect(v.recurringTerms).toEqual(['Billed after each visit. Cancel anytime.'])
    // the page's live total sees the recurring lines as recurring (priceQuote leaves them out)
    expect(v.lines.filter((l) => l.service_plan_template_id).map((l) => l.id)).toEqual(['r1', 'r2'])
  })
  it('a quote with no recurring line has an empty recurring part (roofing page unchanged)', () => {
    const v = buildQuoteView({ ctx: makeCtx([oneTime('a', 400)]), state: 'open', company, approval: null })
    expect(v.recurring).toEqual([])
    expect(v.recurringTerms).toEqual([])
    expect(v.hasOneTime).toBe(true)
    expect(v.lines.some((l) => 'service_plan_template_id' in l)).toBe(false)
  })
  it('recurring-only: no one-time part; plans switched off makes the quote unavailable, not approvable', () => {
    expect(buildQuoteView({ ctx: makeCtx([recurring('r1', 45)]), state: 'open', company, approval: null }).hasOneTime).toBe(false)
    expect(buildQuoteView({ ctx: makeCtx([recurring('r1', 45)], false), state: 'open', company, approval: null }).state).toBe('unavailable')
  })
})
