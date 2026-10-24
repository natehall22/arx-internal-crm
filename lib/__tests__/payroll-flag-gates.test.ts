/** @jest-environment node */
// PAYROLL_PAY_WEEK_ENABLED off (the ship default): every rep-facing door to the new payroll screens is a 404.
jest.mock('@/lib/auth', () => ({ requireAuthApi: jest.fn(async () => ({ profile: { id: 'u1', org_id: 'o1', role: 'sales_rep' } })) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/my-pay', () => ({ fileDispute: jest.fn(), loadMyPay: jest.fn() }))

import { GET as meGet } from '@/app/api/me/pay/route'
import { POST as disputePost } from '@/app/api/me/pay/dispute/route'
import { fileDispute } from '@/lib/my-pay'

describe('new payroll rep endpoints with the flag off', () => {
  const prev = process.env.PAYROLL_PAY_WEEK_ENABLED
  beforeEach(() => { delete process.env.PAYROLL_PAY_WEEK_ENABLED })
  afterAll(() => { if (prev !== undefined) process.env.PAYROLL_PAY_WEEK_ENABLED = prev })

  it('GET /api/me/pay is 404', async () => {
    expect((await meGet()).status).toBe(404)
  })
  it('POST /api/me/pay/dispute is 404 and files nothing', async () => {
    const res = await disputePost({ json: async () => ({ label: 'x', message: 'y' }) } as never)
    expect(res.status).toBe(404)
    expect(fileDispute).not.toHaveBeenCalled()
  })
})
