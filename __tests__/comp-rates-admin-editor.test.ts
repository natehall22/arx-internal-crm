/**
 * @jest-environment node
 *
 * Phase 1 of docs/prompts/comp-plan-admin-editing.md —
 * POST/GET /api/admin/comp-rates and the pure resolver it depends on.
 */
import { resolveDerivedCommissionRatesForSaleDate } from '@/lib/job-derived-commission-lines'

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(),
}))

jest.mock('@/lib/eastern-datetime', () => ({
  getEasternTodayIso: jest.fn(() => '2026-08-07'),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { POST as compRatesPOST } from '@/app/api/admin/comp-rates/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>

function makeBuilder(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'gt', 'order', 'limit']) {
    builder[method] = jest.fn(() => builder)
  }
  builder.maybeSingle = jest.fn(() =>
    Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error })
  )
  // Makes `await builder` resolve like a Postgrest response.
  builder.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data, error })
  return builder
}

type TableResponses = {
  orgs?: { data: unknown; error?: unknown }
  payroll_periods?: { data: unknown; error?: unknown }
  org_derived_commission_rates?: { data: unknown; error?: unknown }
}

function mockSupabase(tables: TableResponses, rpcResult: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  return {
    from: jest.fn((table: string) => {
      const t = tables[table as keyof TableResponses]
      if (!t) throw new Error(`unexpected table ${table}`)
      return makeBuilder(t.data, t.error ?? null)
    }),
    rpc: jest.fn().mockResolvedValue(rpcResult),
  }
}

function makeRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof compRatesPOST>[0]
}

const payrollAdminAuth = {
  authUser: { id: 'admin-1', email: 'admin@example.com' },
  profile: { id: 'admin-1', org_id: 'org-1', role: 'admin' },
} as never

const validBody = {
  inspection_rate: 1.5,
  manager_override_rate: 1,
  self_gen_rate: 6,
  effective_from: '2026-08-10', // future relative to mocked "today" 2026-08-07
  change_reason: 'Enable the published ladder lines',
}

const zeroCurrentOrgRow = {
  inspection_commission_rate: 1.5,
  manager_override_commission_rate: 0,
  self_gen_commission_rate: 0,
}

describe('resolveDerivedCommissionRatesForSaleDate', () => {
  it('resolves a historical sale date once a backdated row exists', () => {
    const history = [
      {
        inspectionRatePercent: 1.5,
        managerOverrideRatePercent: 0,
        selfGenRatePercent: 0,
        effectiveFrom: '2026-08-07',
      },
    ]
    // Before backdating: an August sale before 08-07 gets nothing.
    expect(resolveDerivedCommissionRatesForSaleDate(history, '2026-08-05')).toBeNull()

    // After an admin backdates a row to 2026-07-01 with self-gen enabled:
    const backdated = [
      ...history,
      {
        inspectionRatePercent: 1.5,
        managerOverrideRatePercent: 1,
        selfGenRatePercent: 6,
        effectiveFrom: '2026-07-01',
      },
    ]
    const resolved = resolveDerivedCommissionRatesForSaleDate(backdated, '2026-08-05')
    expect(resolved).toEqual({
      inspectionRatePercent: 1.5,
      managerOverrideRatePercent: 1,
      selfGenRatePercent: 6,
      effectiveFrom: '2026-07-01',
    })
  })

  it('a later scheduled row shadows an earlier one for any sale date on/after it', () => {
    // Simulates opting OUT of the later-rows cascade: D=2026-08-04 gets new rates,
    // D+3=2026-08-07 keeps its old (zero) rates and wins for any sale on/after it.
    const history = [
      { inspectionRatePercent: 1.5, managerOverrideRatePercent: 1, selfGenRatePercent: 6, effectiveFrom: '2026-08-04' },
      { inspectionRatePercent: 1.5, managerOverrideRatePercent: 0, selfGenRatePercent: 0, effectiveFrom: '2026-08-07' },
    ]
    expect(resolveDerivedCommissionRatesForSaleDate(history, '2026-08-05')?.selfGenRatePercent).toBe(6)
    expect(resolveDerivedCommissionRatesForSaleDate(history, '2026-08-09')?.selfGenRatePercent).toBe(0)
  })

  it('opting INTO the later-rows cascade makes a sale after both dates resolve to the new rates', () => {
    // Same D and D+3, but the cascade updated D+3 to match D's new rates.
    const history = [
      { inspectionRatePercent: 1.5, managerOverrideRatePercent: 1, selfGenRatePercent: 6, effectiveFrom: '2026-08-04' },
      { inspectionRatePercent: 1.5, managerOverrideRatePercent: 1, selfGenRatePercent: 6, effectiveFrom: '2026-08-07' },
    ]
    const resolved = resolveDerivedCommissionRatesForSaleDate(history, '2026-08-09')
    expect(resolved).toEqual({
      inspectionRatePercent: 1.5,
      managerOverrideRatePercent: 1,
      selfGenRatePercent: 6,
      effectiveFrom: '2026-08-07',
    })
  })
})

describe('POST /api/admin/comp-rates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await compRatesPOST(makeRequest(validBody))
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-payroll-admin role', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'closer-1' },
      profile: { id: 'closer-1', org_id: 'org-1', role: 'closer' },
    } as never)
    const res = await compRatesPOST(makeRequest(validBody))
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('rejects a rate going from >0 to 0 without confirm_disable', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    mockCreateServiceClient.mockReturnValue(
      mockSupabase({
        orgs: { data: zeroCurrentOrgRow }, // inspection currently 1.5
      }) as never
    )

    const res = await compRatesPOST(
      makeRequest({ ...validBody, inspection_rate: 0 }) // 1.5 -> 0
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('confirm_disable_required')
  })

  it('rejects a backdated effective date without confirm_backdate', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    mockCreateServiceClient.mockReturnValue(
      mockSupabase({
        orgs: { data: zeroCurrentOrgRow },
      }) as never
    )

    const res = await compRatesPOST(
      makeRequest({ ...validBody, effective_from: '2026-08-01' }) // before mocked today 2026-08-07
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('confirm_backdate_required')
  })

  it('rejects a backdate reaching into an already-settled (paid/locked) period', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    mockCreateServiceClient.mockReturnValue(
      mockSupabase({
        orgs: { data: zeroCurrentOrgRow },
        payroll_periods: {
          data: [{ id: 'period-1', period_label: '2026-W29', cutoff_at: '2026-07-12T15:09:00.000Z', status: 'paid' }],
        },
      }) as never
    )

    const res = await compRatesPOST(
      makeRequest({
        ...validBody,
        effective_from: '2026-07-10', // on/before the paid period's cutoff date
        confirm_backdate: true,
      })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('locked_period')
    expect(body.period.label).toBe('2026-W29')
  })

  it('permits a backdate that lands after the newest settled period (go-live scenario)', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    mockCreateServiceClient.mockReturnValue(
      mockSupabase({
        orgs: { data: zeroCurrentOrgRow },
        payroll_periods: {
          // newest settled (paid) period cuts off 2026-07-12; open periods never block.
          data: [{ id: 'period-1', period_label: '2026-W29', cutoff_at: '2026-07-12T15:09:00.000Z', status: 'paid' }],
        },
        org_derived_commission_rates: { data: [] }, // no later rows scheduled
      }) as never
    )

    const res = await compRatesPOST(
      makeRequest({
        ...validBody,
        effective_from: '2026-08-04', // go-live date, after the 07-12 paid cutoff
        confirm_backdate: true,
      })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('warns about later scheduled rows instead of silently shadowing them', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    mockCreateServiceClient.mockReturnValue(
      mockSupabase({
        orgs: { data: zeroCurrentOrgRow },
        payroll_periods: { data: [] },
        org_derived_commission_rates: {
          data: [
            {
              effective_from: '2026-08-07',
              inspection_commission_rate: 1.5,
              manager_override_commission_rate: 0,
              self_gen_commission_rate: 0,
            },
          ],
        },
      }) as never
    )

    const res = await compRatesPOST(
      makeRequest({ ...validBody, effective_from: '2026-08-04', confirm_backdate: true })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('later_rows_shadow_warning')
    expect(body.laterRows).toEqual([
      { effectiveFrom: '2026-08-07', inspectionRate: 1.5, managerOverrideRate: 0, selfGenRate: 0 },
    ])
  })

  it('cascades to later rows when apply_to_later_rows is true, calling the RPC with the flag set', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const supabase = mockSupabase({
      orgs: { data: zeroCurrentOrgRow },
      payroll_periods: { data: [] },
      org_derived_commission_rates: {
        data: [
          {
            effective_from: '2026-08-07',
            inspection_commission_rate: 1.5,
            manager_override_commission_rate: 0,
            self_gen_commission_rate: 0,
          },
        ],
      },
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await compRatesPOST(
      makeRequest({
        ...validBody,
        effective_from: '2026-08-04',
        confirm_backdate: true,
        apply_to_later_rows: true,
      })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith(
      'upsert_org_derived_commission_rates',
      expect.objectContaining({ p_apply_to_later_rows: true, p_effective_from: '2026-08-04' })
    )
  })
})
