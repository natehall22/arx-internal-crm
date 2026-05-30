/**
 * @jest-environment node
 */

export {}

const requireAuthApi = jest.fn()
const createServiceClient = jest.fn()
const loadPayrollPeriodForOrg = jest.fn()
const buildPayrollStatement = jest.fn()
const listRepIdsWithPeriodActivity = jest.fn()

jest.mock('@/lib/auth', () => ({ requireAuthApi }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient }))
jest.mock('@/lib/payroll-period-guards', () => ({
  loadPayrollPeriodForOrg,
  isPayrollPeriodEditable: (period: { status: string }) => period.status === 'open',
}))
jest.mock('@/lib/payroll-statement', () => ({
  buildPayrollStatement,
  listRepIdsWithPeriodActivity,
}))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

async function callPreview(periodStatus: string) {
  jest.resetModules()
  requireAuthApi.mockResolvedValue({
    profile: { id: 'admin-1', role: 'admin', org_id: 'org-1' },
  })
  loadPayrollPeriodForOrg.mockResolvedValue({
    id: 'p1',
    org_id: 'org-1',
    status: periodStatus,
    cutoff_at: '2026-01-07T00:00:00Z',
  })
  createServiceClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'rep-1' }, error: null }),
          }),
        }),
      }),
    }),
  })
  buildPayrollStatement.mockResolvedValue({ mode: 'estimated', totals: { netPayout: 0 } })
  listRepIdsWithPeriodActivity.mockResolvedValue(['rep-1'])

  const { POST } = await import('@/app/api/admin/payroll/periods/[periodId]/preview/route')
  const request = {
    json: jest.fn().mockResolvedValue({ user_id: 'rep-1' }),
  } as never

  const response = await POST(request, { params: { periodId: 'p1' } })
  return { response, body: await response.json() }
}

describe('POST payroll period preview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 409 when period is locked', async () => {
    const { response, body } = await callPreview('locked')
    expect(response.status).toBe(409)
    expect(body.error).toMatch(/locked or paid/i)
    expect(buildPayrollStatement).not.toHaveBeenCalled()
  })

  it('returns 200 when period is open', async () => {
    const { response } = await callPreview('open')
    expect(response.status).toBe(200)
    expect(buildPayrollStatement).toHaveBeenCalled()
  })
})
