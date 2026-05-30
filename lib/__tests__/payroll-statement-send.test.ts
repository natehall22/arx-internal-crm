import {
  periodAllowsStatementEmailSend,
  sendPayrollStatementsForPeriod,
  type StatementMailer,
} from '@/lib/payroll-statement-send'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

jest.mock('@/lib/payroll-statement', () => ({
  buildPayrollStatement: jest.fn(),
}))

import { buildPayrollStatement } from '@/lib/payroll-statement'

const mockBuild = buildPayrollStatement as jest.MockedFunction<typeof buildPayrollStatement>

const samplePayload: PayrollStatementPayload = {
  mode: 'final',
  statementCalculatedAt: '2026-01-10T12:00:00Z',
  periodStatus: 'locked',
  dataFreshnessNote: 'Official',
  projectedBreakdown: [],
  period: {
    id: 'p1',
    label: 'Week 1',
    cutoffAt: '2026-01-07',
    payDate: '2026-01-10',
    status: 'locked',
  },
  rep: { id: 'u1', name: 'Jane' },
  deals: [],
  hourly: null,
  totals: {
    grossCommission: 100,
    hourlyEarnings: 0,
    chargebacksApplied: 0,
    netPayout: 100,
    hasDeficit: false,
    grossCommissionDefinition: 'pre_chargeback',
  },
  chargebacks: [],
}

function makeSupabaseMock(userEmail: string | null = 'jane@example.com') {
  const deliveryInserts: Record<string, unknown>[] = []
  const authEmail = userEmail

  const supabase = {
    auth: {
      admin: {
        getUserById: jest.fn(async () => ({
          data: authEmail ? { user: { email: authEmail } } : { user: { email: null } },
          error: null,
        })),
      },
    },
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: [{ id: 'u1', full_name: 'Jane', email: userEmail, active: true }],
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'payroll_payout_lines') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [{ user_id: 'u1' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'payroll_rep_hours') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === 'payroll_statement_deliveries') {
        return {
          insert: (row: Record<string, unknown>) => {
            deliveryInserts.push(row)
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: `del-${deliveryInserts.length}` }, error: null }),
              }),
            }
          },
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }
    },
    deliveryInserts,
  }

  return supabase
}

describe('periodAllowsStatementEmailSend', () => {
  it('allows locked and paid only', () => {
    expect(periodAllowsStatementEmailSend('locked')).toBe(true)
    expect(periodAllowsStatementEmailSend('paid')).toBe(true)
    expect(periodAllowsStatementEmailSend('open')).toBe(false)
    expect(periodAllowsStatementEmailSend('cancelled')).toBe(false)
    expect(periodAllowsStatementEmailSend('')).toBe(false)
  })
})

describe('sendPayrollStatementsForPeriod', () => {
  beforeEach(() => {
    mockBuild.mockReset()
    mockBuild.mockResolvedValue(samplePayload)
  })

  it('writes a sent delivery row on success', async () => {
    const mailer: StatementMailer = {
      send: jest.fn().mockResolvedValue(undefined),
    }
    const mock = makeSupabaseMock()
    const supabase = mock as unknown as Parameters<typeof sendPayrollStatementsForPeriod>[0]['supabase']

    const result = await sendPayrollStatementsForPeriod({
      supabase,
      orgId: 'org-1',
      periodId: 'p1',
      actorUserId: 'admin-1',
      appUrl: 'https://app.example.com',
      periodStatus: 'locked',
      userIds: ['u1'],
      mailer,
    })

    expect(result.sent).toHaveLength(1)
    expect(result.sent[0].email).toBe('jane@example.com')
    expect(mailer.send).toHaveBeenCalledTimes(1)
    const inserts = mock.deliveryInserts
    expect(inserts).toHaveLength(1)
    expect(inserts[0].status).toBe('sent')
    expect(inserts[0].statement_hash).toBeTruthy()
  })

  it('records failed delivery when email missing', async () => {
    const mock = makeSupabaseMock(null)
    const supabase = mock as unknown as Parameters<typeof sendPayrollStatementsForPeriod>[0]['supabase']

    const result = await sendPayrollStatementsForPeriod({
      supabase,
      orgId: 'org-1',
      periodId: 'p1',
      actorUserId: 'admin-1',
      appUrl: 'https://app.example.com',
      periodStatus: 'locked',
      userIds: ['u1'],
      mailer: { send: jest.fn() },
    })

    expect(result.sent).toHaveLength(0)
    expect(result.failed[0].reason).toMatch(/No email/)
    expect(mock.deliveryInserts[0].status).toBe('failed')
  })

  it('rejects open period', async () => {
    await expect(
      sendPayrollStatementsForPeriod({
        supabase: makeSupabaseMock() as unknown as Parameters<
          typeof sendPayrollStatementsForPeriod
        >[0]['supabase'],
        orgId: 'org-1',
        periodId: 'p1',
        actorUserId: 'admin-1',
        appUrl: 'https://app.example.com',
        periodStatus: 'open',
        userIds: ['u1'],
        mailer: { send: jest.fn() },
      })
    ).rejects.toThrow('PERIOD_NOT_SENDABLE')
  })
})

describe('POST /api/admin/payroll/periods/[periodId]/send-statements', () => {
  const originalSmtpHost = process.env.SMTP_HOST

  beforeEach(() => {
    jest.resetModules()
    process.env.SMTP_HOST = 'smtp.example.com'
    if (!global.Response) {
      global.Response = class {
        body: string
        status: number
        headers: { getSetCookie: () => string[]; set: jest.Mock; get: jest.Mock }

        constructor(body?: string, init?: { status?: number }) {
          this.body = body ?? ''
          this.status = init?.status ?? 200
          this.headers = {
            getSetCookie: () => [],
            set: jest.fn(),
            get: jest.fn().mockReturnValue(null),
          }
        }

        static json(body: unknown, init?: { status?: number }) {
          return new Response(JSON.stringify(body), init)
        }

        async json() {
          return JSON.parse(this.body)
        }
      } as unknown as typeof Response
    }
  })

  afterEach(() => {
    process.env.SMTP_HOST = originalSmtpHost
    jest.dontMock('@/lib/auth')
    jest.dontMock('@/lib/supabase/service')
    jest.dontMock('@/lib/payroll-period-guards')
    jest.dontMock('@/lib/payroll-statement-send')
    jest.dontMock('next/server')
  })

  async function loadRouteWithMocks({
    role = 'admin',
    periodStatus = 'locked',
  }: {
    role?: string
    periodStatus?: string
  } = {}) {
    const requireAuthApi = jest.fn().mockResolvedValue({
      profile: { id: 'admin-1', role, org_id: 'org-1' },
    })
    const createServiceClient = jest.fn(() => ({ from: jest.fn() }))
    const loadPayrollPeriodForOrg = jest.fn().mockResolvedValue({
      id: 'p1',
      org_id: 'org-1',
      status: periodStatus,
    })
    const sendPayrollStatementsForPeriod = jest.fn().mockResolvedValue({ sent: [], failed: [] })

    jest.doMock('@/lib/auth', () => ({ requireAuthApi }))
    jest.doMock('@/lib/supabase/service', () => ({ createServiceClient }))
    jest.doMock('@/lib/payroll-period-guards', () => ({ loadPayrollPeriodForOrg }))
    jest.doMock('@/lib/payroll-statement-send', () => ({
      ...jest.requireActual('@/lib/payroll-statement-send'),
      sendPayrollStatementsForPeriod,
    }))
    jest.doMock('next/server', () => ({
      NextResponse: {
        json: (body: unknown, init?: { status?: number }) => ({
          status: init?.status ?? 200,
          json: async () => body,
        }),
      },
    }))

    const route = await import('@/app/api/admin/payroll/periods/[periodId]/send-statements/route')

    return {
      POST: route.POST,
      createServiceClient,
      loadPayrollPeriodForOrg,
      sendPayrollStatementsForPeriod,
    }
  }

  function makeRequest(body: Record<string, unknown> = {}) {
    return {
      url: 'https://app.example.com/api/admin/payroll/periods/p1/send-statements',
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Parameters<Awaited<ReturnType<typeof loadRouteWithMocks>>['POST']>[0]
  }

  it('returns 409 for open periods and tells admins to lock first', async () => {
    const { POST, sendPayrollStatementsForPeriod } = await loadRouteWithMocks({
      periodStatus: 'open',
    })

    const res = await POST(makeRequest(), { params: { periodId: 'p1' } })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/Lock the period first/i)
    expect(sendPayrollStatementsForPeriod).not.toHaveBeenCalled()
  })

  it('allows locked periods through to the sender', async () => {
    const { POST, sendPayrollStatementsForPeriod } = await loadRouteWithMocks({
      periodStatus: 'locked',
    })

    const res = await POST(makeRequest(), { params: { periodId: 'p1' } })
    const body = await res.json()

    expect(res.status).not.toBe(409)
    expect(res.status).toBe(200)
    expect(body.sentCount).toBe(0)
    expect(body.failedCount).toBe(0)
    expect(sendPayrollStatementsForPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        periodId: 'p1',
        actorUserId: 'admin-1',
        periodStatus: 'locked',
      })
    )
  })

  it('returns 403 for non-payroll-admin roles', async () => {
    const { POST, createServiceClient, loadPayrollPeriodForOrg, sendPayrollStatementsForPeriod } =
      await loadRouteWithMocks({ role: 'sales_rep' })

    const res = await POST(makeRequest(), { params: { periodId: 'p1' } })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(createServiceClient).not.toHaveBeenCalled()
    expect(loadPayrollPeriodForOrg).not.toHaveBeenCalled()
    expect(sendPayrollStatementsForPeriod).not.toHaveBeenCalled()
  })
})
