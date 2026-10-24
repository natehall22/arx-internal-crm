/** @jest-environment node */
import { isPayWeekEnabled } from '@/lib/payroll-flag'

describe('PAYROLL_PAY_WEEK_ENABLED', () => {
  const prev = process.env.PAYROLL_PAY_WEEK_ENABLED
  afterEach(() => {
    if (prev === undefined) delete process.env.PAYROLL_PAY_WEEK_ENABLED
    else process.env.PAYROLL_PAY_WEEK_ENABLED = prev
  })
  it('defaults OFF', () => {
    delete process.env.PAYROLL_PAY_WEEK_ENABLED
    expect(isPayWeekEnabled()).toBe(false)
  })
  it.each(['', 'false', '0', 'yes', '1'])('%p is OFF', (v) => {
    process.env.PAYROLL_PAY_WEEK_ENABLED = v
    expect(isPayWeekEnabled()).toBe(false)
  })
  it.each(['true', 'TRUE', ' true '])('%p is ON', (v) => {
    process.env.PAYROLL_PAY_WEEK_ENABLED = v
    expect(isPayWeekEnabled()).toBe(true)
  })
  it('gates the pay-week API helper with a 404 while off', async () => {
    delete process.env.PAYROLL_PAY_WEEK_ENABLED
    const { requirePayrollAdminApi } = await import('@/lib/payroll-admin-api')
    const r = await requirePayrollAdminApi()
    expect('error' in r && r.error?.status).toBe(404)
  })
})
