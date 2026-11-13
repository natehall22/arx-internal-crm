/** @jest-environment node */
/**
 * Money sweep 2026-11-13 #8: with the pay-week path on, the OLD period API must not write (create a week, move its cutoff /
 * pay date, mark paid, reopen, old hours writer). A moved cutoff made the Pay screen create a second week for the same days.
 * Flag off: the routes run as before. Cancel stays (one guarded SQL transaction; the way to clear a stray week).
 */
const rpc = jest.fn(async () => ({ data: { ok: true, status: 'cancelled', snapshots_deleted: 0 }, error: null }))
const from = jest.fn(() => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'or', 'update', 'insert', 'order', 'limit', 'in']) q[m] = () => q
  q.maybeSingle = async () => ({ data: { id: 'p1', status: 'open', locked_at: null }, error: null })
  q.single = async () => ({ data: { id: 'p1' }, error: null })
  return q
})
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: { id: 'u1', org_id: 'org1', role: 'admin' } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from, rpc }) }))

import { POST as createWeek } from '@/app/api/admin/payroll/periods/route'
import { PATCH as editWeek } from '@/app/api/admin/payroll/periods/[periodId]/route'
import { POST as oldHours } from '@/app/api/admin/payroll/[periodId]/hours/route'

const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never
const params = { params: { periodId: 'p1' } }

describe('old payroll period writers with the pay-week path ON', () => {
  beforeAll(() => {
    process.env.PAYROLL_PAY_WEEK_ENABLED = 'true'
  })
  afterAll(() => {
    delete process.env.PAYROLL_PAY_WEEK_ENABLED
  })
  it.each([
    ['create a week', () => createWeek(req({ period_label: 'W', cutoff_at: '2026-11-16T04:59:59Z', scheduled_pay_date: '2026-11-21' }))],
    ['move the cutoff', () => editWeek(req({ cutoff_at: '2026-11-17T04:59:59Z' }), params)],
    ['mark paid', () => editWeek(req({ action: 'mark_paid' }), params)],
    ['reopen', () => editWeek(req({ action: 'reopen' }), params)],
    ['lock', () => editWeek(req({ action: 'lock' }), params)],
    ['old hours writer', () => oldHours(req({ entries: [{ user_id: 'u2', regular_hours: 8, overtime_hours: 0 }] }), params)],
  ])('%s → 410, nothing written', async (_name, call) => {
    rpc.mockClear()
    const res = await call()
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ code: 'use_pay_this_week' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('cancel still works (clearing a stray week)', async () => {
    const res = await editWeek(req({ action: 'cancel' }), params)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalled()
  })
})

describe('flag OFF: the old routes run as before', () => {
  it('move the cutoff is not refused', async () => {
    delete process.env.PAYROLL_PAY_WEEK_ENABLED
    const res = await editWeek(req({ cutoff_at: '2026-11-17T04:59:59Z' }), params)
    expect(res.status).not.toBe(410)
  })
})
