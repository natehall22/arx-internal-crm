/** @jest-environment node */
/**
 * AI connector phase 2 — what each write tool does with the person's own rules (review fixes): AI-written text is tagged and
 * never pings anyone; a duplicate the person cannot open is never named; money previews use the SQL writer's cents math; an AI
 * purchase-order draft never replaces an order made on screen.
 */
import { randomUUID } from 'crypto'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { ToolError, type ToolContext } from '@/lib/ai-connector/tools/types'

const mockPost = jest.fn(async (..._a: unknown[]) => ({ ok: true, message: { id: 'm1' } }))
jest.mock('@/lib/threads/post-message', () => ({ postMessage: (...a: unknown[]) => mockPost(...a) }))
jest.mock('@/lib/threads/viewer', () => ({ resolveThreadViewer: async () => ({ orgId: 'org-a', userId: 'u1' }) }))
jest.mock('@/lib/threads/get-thread', () => ({ loadDeal: async () => ({ id: 'd1', address_text: '1 Main St', customer_id: 'c1', lead_id: null }), dealRefOf: () => ({}) }))
jest.mock('@/lib/threads/api', () => ({ canOpenDeal: () => true }))
jest.mock('@/lib/threads/visibility', () => ({ ...jest.requireActual('@/lib/threads/visibility'), isFieldRole: () => false, writableAudiences: () => ['team', 'sales'] }))
const mockFind = jest.fn()
jest.mock('@/lib/customers', () => ({ findExistingCustomer: (...a: unknown[]) => mockFind(...a), upsertCustomer: jest.fn() }))
const mockOwn = jest.fn()
jest.mock('@/lib/ai-connector/tools/contact-scope', () => ({ ownCustomerIds: (...a: unknown[]) => mockOwn(...a) }))
jest.mock('@/lib/effective-permissions', () => ({ resolveEffectivePermissionNames: async () => ['x'], effectiveHasPermission: () => true }))
jest.mock('@/lib/permissions', () => ({ ...jest.requireActual('@/lib/permissions'), canEditCustomerRecordsFromPermissionNames: () => true }))
jest.mock('@/lib/service-billing-access', () => ({ canBillService: async () => ({ feature: true, bill: true }) }))
jest.mock('@/lib/sales-tax-server', () => ({
  computeCustomerSalesTax: async (_a: unknown, _o: unknown, _c: unknown, lines: Array<{ amountCents: number }>) => ({ subtotalCents: lines.reduce((s, l) => s + l.amountCents, 0), taxCents: 0, taxableCents: 0, taxLines: [] }),
}))

import { addNote, createCustomer, createLead, draftInvoice, logContact } from '@/lib/ai-connector/tools/writes'
import { savePoDraft } from '@/lib/purchase-orders-db'

const ORG = 'org-a'
const DEAL = randomUUID()
const CUST = randomUUID()
const mkCtx = (over: Partial<ToolContext> = {}): ToolContext => {
  const db = createFakeDb({ customers: [{ id: CUST, org_id: ORG, name: 'Dana Customer' }] })
  return { admin: db.client, profile: { id: 'u1', org_id: ORG } as never, userId: 'u1', orgId: ORG, clientName: 'Claude', now: Date.UTC(2026, 10, 15), ...over }
}
const fail = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (e) {
    return e as ToolError
  }
}

beforeEach(() => {
  mockPost.mockClear()
  mockFind.mockReset()
  mockOwn.mockReset()
})

describe('notes and contact logs from an AI app', () => {
  it('a note is written tagged "Written by AI (via <app>)", with mentions off, idempotent on the change id', async () => {
    const out = await addNote.write.apply(mkCtx(), { deal_id: DEAL, text: '@Steve Potts call them' }, 'chg-1')
    expect(out.summary).toBe('Note added.')
    const [, , , draft] = mockPost.mock.calls[0] as [unknown, unknown, unknown, Record<string, unknown>]
    expect(draft.body).toBe('Written by AI (via Claude): @Steve Potts call them')
    expect(draft).toMatchObject({ noMentions: true, clientId: 'chg-1', source: 'ai_connector' })
    expect(addNote.write.idempotent).toBe(true)
  })
  it('a contact log carries the tag too (with or without a note) and never mentions', async () => {
    await logContact.write.apply(mkCtx(), { deal_id: DEAL, kind: 'call', outcome: 'reached' }, 'chg-2')
    await logContact.write.apply(mkCtx(), { deal_id: DEAL, kind: 'call', outcome: 'reached', note: 'left word' }, 'chg-3')
    const bodies = mockPost.mock.calls.map((c) => (c[3] as { body: string; noMentions: boolean }))
    expect(bodies[0].body).toBe('Written by AI (via Claude)')
    expect(bodies[1].body).toBe('left word (Written by AI (via Claude))')
    expect(bodies.every((b) => b.noMentions)).toBe(true)
  })
  it('the preview tells the person it will be marked and that nobody is pinged', async () => {
    const p = await addNote.write.prepare(mkCtx(), { deal_id: DEAL, text: 'hi' })
    expect(p.warnings?.join(' ')).toMatch(/Written by AI/)
  })
})

describe('duplicate lookup never reveals a customer the person cannot open', () => {
  const secret = { id: CUST, name: 'Secret Homeowner', email: null, phone: null, address_text: null }
  it('create_customer: a hidden duplicate is refused with no name, id or link', async () => {
    mockFind.mockResolvedValue(secret)
    mockOwn.mockResolvedValue(new Set())
    const e = await fail(createCustomer.write.prepare(mkCtx(), { name: 'Secret Homeowner', phone: '7045550100' }))
    expect(e).toBeInstanceOf(ToolError)
    expect(e?.reason).toBe('possible_duplicate')
    expect(e?.message).toMatch(/ask the office/i)
    expect(JSON.stringify(e?.message)).not.toMatch(/Secret|Homeowner/)
    expect(mockOwn).toHaveBeenCalled()
  })
  it('create_lead: a hidden duplicate is only a generic warning (no name, no id, no link)', async () => {
    mockFind.mockResolvedValue(secret)
    mockOwn.mockResolvedValue(new Set())
    const p = await createLead.write.prepare(mkCtx(), { name: 'x', phone: '7045550100' })
    expect(JSON.stringify(p)).not.toMatch(/Secret|Homeowner/)
    expect(JSON.stringify(p)).not.toContain(CUST)
    expect(p.links).toEqual([])
    expect(p.recordIds).toEqual([])
    expect(p.warnings?.join(' ')).toMatch(/ask the office/i)
  })
  it('a duplicate the person CAN open (not contact-scoped, or their own) is shown as before', async () => {
    mockFind.mockResolvedValue(secret)
    mockOwn.mockResolvedValue(null)
    const a = await createCustomer.write.prepare(mkCtx(), { name: 'Secret Homeowner', phone: '7045550100' })
    expect(a.lines[0].value).toBe('Secret Homeowner')
    mockOwn.mockResolvedValue(new Set([CUST]))
    const b = await createLead.write.prepare(mkCtx(), { name: 'x', phone: '7045550100' })
    expect(b.links[0].path).toBe(`/c/${CUST}`)
  })
})

describe('draft invoice previews use the SQL writer cents math', () => {
  it('0.69 × $45.50 is $31.40 (not the floating-point $31.39), and the total agrees', async () => {
    const p = await draftInvoice.write.prepare(mkCtx(), { customer_id: CUST, lines: [{ description: 'Gutter clean', qty: 0.69, unit_price: 45.5 }] })
    expect(p.lines.find((l) => l.label === 'Line 1')?.value).toContain('$31.40')
    expect(p.lines.find((l) => l.label === 'Total')?.value).toBe('$31.40')
  })
  it('more than 2 decimals of quantity or cents of price is refused at the door', () => {
    const bad = draftInvoice.schema.safeParse({ customer_id: CUST, lines: [{ description: 'x', qty: 1.005, unit_price: 5 }] })
    const bad2 = draftInvoice.schema.safeParse({ customer_id: CUST, lines: [{ description: 'x', qty: 1, unit_price: 5.001 }] })
    expect(bad.success).toBe(false)
    expect(bad2.success).toBe(false)
  })
})

describe('an AI purchase-order draft only ever STARTS an order', () => {
  it('createOnly: an order for that vendor on that job (made or edited on screen meanwhile) is left untouched', async () => {
    const jobId = randomUUID()
    const vendorId = randomUUID()
    const existing = { id: randomUUID(), org_id: ORG, kind: 'general', vendor_id: vendorId, job_id: jobId, work_order_id: null, status: 'draft', po_number: 'P-1' }
    const db = createFakeDb({ vendors: [{ id: vendorId, org_id: ORG, active: true, deleted_at: null }], supplier_orders: [existing] })
    const res = await savePoDraft(db.client as never, { orgId: ORG, jobId, workOrderId: null, cancelled: false, reference: 'J1' } as never, 'u1', { vendorId, lines: [{ description: 'x', quantity: 1, unitCostCents: 0, costType: 'material' }], date: null, dateKind: 'delivery', note: null } as never, null, { createOnly: true })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(db.writes).toEqual([])
  })
})
