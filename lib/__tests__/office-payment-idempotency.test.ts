/** @jest-environment node */
/**
 * Money sweep 2026-11-13 #9: the office "Add payment" form sends one key per opening; the route passes it (namespaced to the job)
 * into the one writer, so a double tap or a retried request records the payment once. And the form really sends it.
 */
const recordJobPayment = jest.fn(async () => ({ ok: true, payment: { id: 'pay1' }, duplicate: false }))
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: { id: 'u1', org_id: 'org1', role: 'admin' } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: async () => true }))
jest.mock('@/lib/job-payment-record', () => ({ recordJobPayment: (...a: unknown[]) => (recordJobPayment as unknown as (...x: unknown[]) => unknown)(...a) }))

import { readFileSync } from 'fs'
import { POST } from '@/app/api/ops/jobs/[id]/payments/route'

const body = (extra: Record<string, unknown> = {}) =>
  new Request('http://x/api/ops/jobs/job1/payments', {
    method: 'POST',
    body: JSON.stringify({ paid_at: '2026-11-13', amount_cents: 250000, payment_type: 'deposit', method: 'check', payer: 'homeowner', ...extra }),
  })

describe('office Add payment idempotency', () => {
  beforeEach(() => recordJobPayment.mockClear())
  it('passes the form key through, namespaced to the job', async () => {
    const res = await POST(body({ idempotency_key: 'k-123' }), { params: { id: 'job1' } })
    expect(res.status).toBe(200)
    expect(recordJobPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: 'job1', idempotencyKey: 'office-pay:job1:k-123' }))
  })
  it('an old client with no key still works (no dedupe, as before)', async () => {
    await POST(body(), { params: { id: 'job1' } })
    expect(recordJobPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idempotencyKey: null }))
  })
  it('the form makes one key per opening and sends it', () => {
    const src = readFileSync('components/ops/AddPaymentModal.tsx', 'utf8')
    expect(src).toMatch(/const \[idempotencyKey\] = useState\(\(\) =>/)
    expect(src).toMatch(/idempotency_key: idempotencyKey/)
  })
})
