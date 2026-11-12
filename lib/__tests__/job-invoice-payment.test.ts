/** @jest-environment node */
/** "Mark paid" on a job invoice: the job payment and its application happen together, never more than the balance. */
const recordJobPayment = jest.fn()
const applyPaymentToInvoice = jest.fn()
const computeInvoiceBalance = jest.fn()
jest.mock('@/lib/job-payment-record', () => ({ recordJobPayment: (...a: unknown[]) => recordJobPayment(...a) }))
jest.mock('@/lib/invoices', () => ({
  CUSTOMER_PAYMENT_METHODS: ['cash', 'check', 'card', 'ach', 'other'],
  applyPaymentToInvoice: (...a: unknown[]) => applyPaymentToInvoice(...a),
  computeInvoiceBalance: (...a: unknown[]) => computeInvoiceBalance(...a),
}))
import { recordJobInvoicePayment } from '@/lib/job-invoice-payment'

const admin = (kind = 'final') => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { invoice_kind: kind } }) }) }) }) }) as never
const inv = { id: 'inv-1', job_id: 'job-1', status: 'sent' }
const pay = { amountCents: 500000, paidAt: '2026-11-10', method: 'check' as const, createdBy: 'u1' }

beforeEach(() => {
  jest.clearAllMocks()
  computeInvoiceBalance.mockResolvedValueOnce({ balance_cents: 800000 }).mockResolvedValue({ balance_cents: 300000 })
  recordJobPayment.mockResolvedValue({ ok: true, payment: { id: 'pay-1' }, duplicate: false })
  applyPaymentToInvoice.mockResolvedValue({})
})

test('records the job payment then applies it to the invoice, to the cent', async () => {
  const r = await recordJobInvoicePayment(admin(), 'org-a', inv, pay)
  expect(r).toEqual({ ok: true, paymentId: 'pay-1', balanceCents: 300000 })
  expect(recordJobPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgId: 'org-a', jobId: 'job-1', amountCents: 500000, paymentType: 'final', payer: 'homeowner' }))
  expect(applyPaymentToInvoice).toHaveBeenCalledWith(expect.anything(), 'org-a', 'inv-1', 'pay-1', 500000, 'u1')
})

test('a deposit invoice records a deposit', async () => {
  await recordJobInvoicePayment(admin('deposit'), 'org-a', inv, pay)
  expect(recordJobPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ paymentType: 'deposit' }))
})

test('nothing is written for more than the balance, a draft, a void or a paid invoice', async () => {
  expect((await recordJobInvoicePayment(admin(), 'o', inv, { ...pay, amountCents: 800001 })).ok).toBe(false)
  expect((await recordJobInvoicePayment(admin(), 'o', { ...inv, status: 'draft' }, pay)).ok).toBe(false)
  expect((await recordJobInvoicePayment(admin(), 'o', { ...inv, status: 'void' }, pay)).ok).toBe(false)
  computeInvoiceBalance.mockReset().mockResolvedValue({ balance_cents: 0 })
  expect((await recordJobInvoicePayment(admin(), 'o', inv, pay)).ok).toBe(false)
  expect((await recordJobInvoicePayment(admin(), 'o', inv, { ...pay, amountCents: 0 })).ok).toBe(false)
  expect(recordJobPayment).not.toHaveBeenCalled()
})

test('a failed apply keeps the saved payment and says so', async () => {
  applyPaymentToInvoice.mockRejectedValue(new Error('boom'))
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const r = await recordJobInvoicePayment(admin(), 'o', inv, pay)
  spy.mockRestore()
  expect(r).toMatchObject({ ok: false, status: 500 })
  expect(recordJobPayment).toHaveBeenCalledTimes(1)
})
