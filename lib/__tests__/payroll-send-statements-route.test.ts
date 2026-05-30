/**
 * POST /api/admin/payroll/periods/[periodId]/send-statements — auth and period guards only.
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/payroll/periods/[periodId]/send-statements/route'

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({})),
}))

jest.mock('@/lib/payroll-period-guards', () => ({
  loadPayrollPeriodForOrg: jest.fn(),
}))

jest.mock('@/lib/payroll-statement-send', () => ({
  periodAllowsStatementEmailSend: jest.fn(),
  sendPayrollStatementsForPeriod: jest.fn(),
}))

import { requireAuthApi } from '@/lib/auth'
import { loadPayrollPeriodForOrg } from '@/lib/payroll-period-guards'
import {
  periodAllowsStatementEmailSend,
  sendPayrollStatementsForPeriod,
} from '@/lib/payroll-statement-send'

const mockAuth = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockLoadPeriod = loadPayrollPeriodForOrg as jest.MockedFunction<typeof loadPayrollPeriodForOrg>
const mockAllowsSend = periodAllowsStatementEmailSend as jest.MockedFunction<
  typeof periodAllowsStatementEmailSend
>
const mockSend = sendPayrollStatementsForPeriod as jest.MockedFunction<
  typeof sendPayrollStatementsForPeriod
>

const adminProfile = {
  id: 'admin-1',
  org_id: 'org-1',
  role: 'operations',
}

function postSendStatements(periodId = 'period-1', body: object = {}) {
  const req = new NextRequest(`https://app.example.com/api/admin/payroll/periods/${periodId}/send-statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: { periodId } })
}

describe('POST send-statements route', () => {
  const originalSmtp = process.env.SMTP_HOST

  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.test'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    mockAuth.mockReset()
    mockLoadPeriod.mockReset()
    mockAllowsSend.mockReset()
    mockSend.mockReset()
    mockAuth.mockResolvedValue({ profile: adminProfile } as Awaited<ReturnType<typeof requireAuthApi>>)
    mockSend.mockResolvedValue({ sent: [], failed: [] })
  })

  afterAll(() => {
    if (originalSmtp === undefined) delete process.env.SMTP_HOST
    else process.env.SMTP_HOST = originalSmtp
  })

  it('returns 403 for non-payroll-admin', async () => {
    mockAuth.mockResolvedValue({
      profile: { ...adminProfile, role: 'sales_rep' },
    } as Awaited<ReturnType<typeof requireAuthApi>>)

    const res = await postSendStatements()
    expect(res.status).toBe(403)
  })

  it('returns 409 when period is open', async () => {
    mockLoadPeriod.mockResolvedValue({
      id: 'period-1',
      status: 'open',
      period_label: 'Week 1',
    } as Awaited<ReturnType<typeof loadPayrollPeriodForOrg>>)
    mockAllowsSend.mockReturnValue(false)

    const res = await postSendStatements()
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/lock/i)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not 409 from period guard when locked', async () => {
    mockLoadPeriod.mockResolvedValue({
      id: 'period-1',
      status: 'locked',
      period_label: 'Week 1',
    } as Awaited<ReturnType<typeof loadPayrollPeriodForOrg>>)
    mockAllowsSend.mockReturnValue(true)

    const res = await postSendStatements()
    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalled()
  })
})
