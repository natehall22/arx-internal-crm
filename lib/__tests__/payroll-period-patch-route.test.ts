/**
 * @jest-environment node
 */

export {}

const requireAuthApi = jest.fn()
const createServiceClient = jest.fn()
const clearPayrollPeriodLockArtifacts = jest.fn()
const runPayrollPeriodLockBackfill = jest.fn()

jest.mock('@/lib/auth', () => ({ requireAuthApi }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient }))
jest.mock('@/lib/payroll-period-lock', () => ({
  clearPayrollPeriodLockArtifacts,
  runPayrollPeriodLockBackfill,
}))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

function makeSupabaseMock(existingStatus: string) {
  const updates: Record<string, unknown>[] = []

  function makeQuery(table: string): any {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      maybeSingle: jest.fn(async () => {
        if (table === 'payroll_periods') {
          return {
            data: { id: 'period-1', status: existingStatus, locked_at: '2026-01-10T12:00:00Z' },
            error: null,
          }
        }
        return { data: null, error: null }
      }),
      single: jest.fn(async () => ({
        data: { id: 'period-1', status: updates.at(-1)?.status ?? existingStatus },
        error: null,
      })),
      update: jest.fn((payload: Record<string, unknown>) => {
        updates.push(payload)
        return query
      }),
    }
    return query
  }

  return {
    from: jest.fn((table: string) => makeQuery(table)),
    updates,
  }
}

async function callPatch(action: string, existingStatus: string) {
  jest.resetModules()

  requireAuthApi.mockResolvedValue({
    profile: { id: 'admin-1', role: 'admin', org_id: 'org-1' },
  })
  clearPayrollPeriodLockArtifacts.mockResolvedValue(undefined)
  runPayrollPeriodLockBackfill.mockResolvedValue({
    jobsSnapshotted: 0,
    linesCreated: 0,
    repsAffected: 0,
    rolesBackfilled: 0,
    skippedExisting: false,
  })

  const supabase = makeSupabaseMock(existingStatus)
  createServiceClient.mockReturnValue(supabase)

  const { PATCH } = await import('@/app/api/admin/payroll/periods/[periodId]/route')
  const request = {
    json: jest.fn().mockResolvedValue({ action }),
  } as never

  const response = await PATCH(request, { params: { periodId: 'period-1' } })
  return { response, body: await response.json(), supabase }
}

describe('PATCH /api/admin/payroll/periods/[periodId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 409 when reopening a paid period', async () => {
    const { response, body, supabase } = await callPatch('reopen', 'paid')

    expect(response.status).toBe(409)
    expect(body.error).toMatch(/Paid periods cannot be reopened/i)
    expect(clearPayrollPeriodLockArtifacts).not.toHaveBeenCalled()
    expect(supabase.updates).toHaveLength(0)
  })

  it('returns 409 when cancelling a paid period', async () => {
    const { response, body, supabase } = await callPatch('cancel', 'paid')

    expect(response.status).toBe(409)
    expect(body.error).toMatch(/Paid periods cannot be cancelled/i)
    expect(clearPayrollPeriodLockArtifacts).not.toHaveBeenCalled()
    expect(supabase.updates).toHaveLength(0)
  })

  it('clears lock artifacts once before reopening a locked period', async () => {
    const { response, supabase } = await callPatch('reopen', 'locked')

    expect(response.status).toBe(200)
    expect(clearPayrollPeriodLockArtifacts).toHaveBeenCalledTimes(1)
    expect(clearPayrollPeriodLockArtifacts).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'period-1'
    )
    expect(supabase.updates[0]).toEqual({ status: 'open', locked_at: null, paid_at: null })
    expect(
      clearPayrollPeriodLockArtifacts.mock.invocationCallOrder[0]
    ).toBeLessThan(supabase.from.mock.results.find((r: any) => r.value.update)?.value.update?.mock?.invocationCallOrder?.[0] ?? Number.MAX_SAFE_INTEGER)
  })
})
