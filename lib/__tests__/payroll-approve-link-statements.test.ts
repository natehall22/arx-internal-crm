/** @jest-environment node */
/** Phone one-tap approve = the main Approve: same approvePayWeek, then the same emailWeekStatements (statements go out by default). */
const approvePayWeek = jest.fn()
const emailWeekStatements = jest.fn()
const consumeApprovalLink = jest.fn(async () => true)
jest.mock('@/lib/payroll-approve', () => ({ approvePayWeek: (...a: unknown[]) => approvePayWeek(...a), emailWeekStatements: (...a: unknown[]) => emailWeekStatements(...a) }))
jest.mock('@/lib/payroll-approve-link', () => ({
  consumeApprovalLink: (...a: unknown[]) => consumeApprovalLink(...(a as [])),
  findApprovalLink: async () => ({ id: 'l1', org_id: 'org-a', payroll_period_id: 'per-1', user_id: 'owner1', notified_total: 1234.5, notified_people: 3, expires_at: '2099-01-01', used_at: null }),
}))
jest.mock('@/lib/payroll-flag', () => ({ isPayWeekEnabled: () => true }))
jest.mock('@/lib/payroll-pay-week', () => ({ loadPayWeek: async () => ({ totals: { amount: 1234.5, people: 3 } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: { id: 'owner1', org_id: 'org-a' } }) }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/payroll/approve-link/route'

const req = () => new NextRequest('http://x/api/payroll/approve-link', { method: 'POST', body: JSON.stringify({ token: 'a'.repeat(43), expectedTotal: 1234.5 }) })

beforeEach(() => { approvePayWeek.mockReset(); emailWeekStatements.mockReset(); consumeApprovalLink.mockClear() })

test('approve, then email the statements for that week (same function as the Pay screen)', async () => {
  approvePayWeek.mockResolvedValue({ ok: true, total: 1234.5, people: 3, message: 'ok' })
  emailWeekStatements.mockResolvedValue({ sent: 3, skipped: 0, failed: 0 })
  const res = (await POST(req()))!
  const body = await res.json()
  expect(res.status).toBe(200)
  expect(body).toMatchObject({ ok: true, total: 1234.5, people: 3, emailed: { sent: 3 } })
  expect(emailWeekStatements).toHaveBeenCalledTimes(1)
  expect(emailWeekStatements.mock.calls[0].slice(1)).toEqual(['org-a', 'per-1'])
  expect(approvePayWeek.mock.invocationCallOrder[0]).toBeLessThan(emailWeekStatements.mock.invocationCallOrder[0])
})

test('a mail failure never undoes the approval and says so', async () => {
  approvePayWeek.mockResolvedValue({ ok: true, total: 1234.5, people: 3, message: 'ok' })
  emailWeekStatements.mockRejectedValue(new Error('smtp'))
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const body = await (await POST(req()))!.json()
  spy.mockRestore()
  expect(body).toMatchObject({ ok: true, emailed: { error: expect.any(String) } })
  expect(consumeApprovalLink).toHaveBeenCalledTimes(1)
})

test('nothing is emailed when the approval was refused', async () => {
  approvePayWeek.mockResolvedValue({ ok: false, status: 409, body: { error: 'changed', code: 'changed' } })
  const res = (await POST(req()))!
  expect(res.status).toBe(409)
  expect(emailWeekStatements).not.toHaveBeenCalled()
  expect(consumeApprovalLink).not.toHaveBeenCalled()
})
