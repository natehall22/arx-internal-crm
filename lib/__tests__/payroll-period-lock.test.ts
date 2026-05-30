jest.mock('@/lib/payroll-period-export-engine', () => ({
  computePayrollExportRowsForDateRange: jest.fn(),
}))

jest.mock('@/lib/payroll-export', () => ({
  ...jest.requireActual('@/lib/payroll-export'),
  loadAdditiveDealCommissionParticipants: jest.fn(),
}))

import {
  participantRoleToDealCommissionRole,
  runPayrollPeriodLockBackfill,
} from '@/lib/payroll-period-lock'
import { computePayrollExportRowsForDateRange } from '@/lib/payroll-period-export-engine'
import {
  loadAdditiveDealCommissionParticipants,
  type PayrollExportRow,
} from '@/lib/payroll-export'
import {
  lockPayoutGrossAmount,
  resolveParticipantLineAmount,
} from '@/lib/payroll-statement'

const mockComputeExportRows =
  computePayrollExportRowsForDateRange as jest.MockedFunction<
    typeof computePayrollExportRowsForDateRange
  >
const mockLoadAdditiveParticipants =
  loadAdditiveDealCommissionParticipants as jest.MockedFunction<
    typeof loadAdditiveDealCommissionParticipants
  >

function exportRow(overrides: Partial<PayrollExportRow> = {}): PayrollExportRow {
  return {
    job_id: 'j1',
    job_number: '1001',
    customer_name: 'Customer',
    sale_date: '2026-01-05',
    address_text: '1 Main St',
    sale_amount: 1000,
    commission_comp_base: 1000,
    pool_cap: null,
    user_id: 'u1',
    user_name: 'User One',
    participant_role: 'sales_rep',
    comp_plan_id: 'cp1',
    comp_plan_name: 'Sales Rep',
    plan_type: 'standard',
    base_rate_pct: 12,
    period_volume: 1000,
    volume_bonus_rate_pct: 0,
    volume_bonus_flat: 0,
    effective_rate_pct: 12,
    raw_commission: 120,
    scaled_commission: 120,
    pool_cap_enforced: false,
    unsupported_plan: false,
    note: null,
    ...overrides,
  }
}

function makeBackfillSupabaseMock(opts: {
  existingLineCount?: number
  dealRoleRows?: Record<string, unknown>[]
} = {}) {
  const payoutLineInserts: Record<string, unknown>[] = []
  const dealRoleInserts: Record<string, unknown>[] = []
  const existingLineCount = opts.existingLineCount ?? 0
  const dealRoleRows = opts.dealRoleRows ?? []

  function makeQuery(table: string, selectColumns?: string): any {
    const query: any = {
      select: jest.fn((columns?: string) => makeQuery(table, columns)),
      eq: jest.fn(() => query),
      lt: jest.fn(() => query),
      neq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      in: jest.fn(() => query),
      maybeSingle: jest.fn(async () => {
        if (table === 'payroll_periods') return { data: null, error: null }
        if (table === 'deal_commission_roles' && selectColumns === 'id') {
          return { data: null, error: null }
        }
        return { data: null, error: null }
      }),
      single: jest.fn(async () => {
        if (table === 'payroll_period_snapshots') return { data: { id: 'period-snap-1' }, error: null }
        if (table === 'payroll_job_snapshots') return { data: { id: 'job-snap-1' }, error: null }
        return { data: null, error: null }
      }),
      upsert: jest.fn(() => query),
      insert: jest.fn((payload: Record<string, unknown>) => {
        if (table === 'payroll_payout_lines') payoutLineInserts.push(payload)
        if (table === 'deal_commission_roles') dealRoleInserts.push(payload)
        return { error: null }
      }),
      then: (resolve: (value: unknown) => void) => {
        if (table === 'payroll_payout_lines' && selectColumns === 'id') {
          return Promise.resolve({ count: existingLineCount, error: null }).then(resolve)
        }
        if (table === 'production_jobs') {
          return Promise.resolve({
            data: [
              {
                id: 'j1',
                sale_amount: 1000,
                commission_pre_tax_subtotal: 1000,
                commission_comp_base: 1000,
                dealer_fee_amount: 0,
                salesperson_id: 'u1',
                project_id: null,
              },
            ],
            error: null,
          }).then(resolve)
        }
        if (table === 'projects') return Promise.resolve({ data: [], error: null }).then(resolve)
        if (table === 'opportunities') return Promise.resolve({ data: [], error: null }).then(resolve)
        if (
          table === 'deal_commission_roles' &&
          selectColumns ===
            'job_id, user_id, role, override_amount, override_percent, premier_pricing_amount'
        ) {
          return Promise.resolve({ data: dealRoleRows, error: null }).then(resolve)
        }
        return Promise.resolve({ data: [], error: null }).then(resolve)
      },
    }
    return query
  }

  return {
    from: jest.fn((table: string) => makeQuery(table)),
    payoutLineInserts,
    dealRoleInserts,
  }
}

describe('participantRoleToDealCommissionRole', () => {
  it('maps setter to setter', () => {
    expect(participantRoleToDealCommissionRole('setter')).toBe('setter')
  })

  it('maps owner and sales_rep to closer', () => {
    expect(participantRoleToDealCommissionRole('owner')).toBe('closer')
    expect(participantRoleToDealCommissionRole('sales_rep')).toBe('closer')
  })
})

describe('lock payout amount parity with preview', () => {
  it('matches resolveParticipantLineAmount for closer override fixture', () => {
    const engine = 120
    const compBase = 1000
    const explicit = { override_amount: 250, premier_pricing_amount: 0 }
    const preview = resolveParticipantLineAmount(engine, compBase, explicit).grossAmount
    const lock = lockPayoutGrossAmount(engine, compBase, explicit)
    expect(lock).toBe(250)
    expect(preview).toBe(lock)
  })

  it('matches preview within $0.01 for override percent + premier', () => {
    const engine = 80
    const compBase = 2000
    const explicit = { override_percent: 12.5, premier_pricing_amount: 15 }
    const preview = resolveParticipantLineAmount(engine, compBase, explicit).grossAmount
    const lock = lockPayoutGrossAmount(engine, compBase, explicit)
    expect(Math.abs(preview - lock)).toBeLessThanOrEqual(0.01)
    expect(lock).toBe(265)
  })

  it('uses engine + premier when no override on lock path', () => {
    const engine = 100
    const lock = lockPayoutGrossAmount(engine, 1000, { premier_pricing_amount: 25 })
    expect(lock).toBe(125)
  })
})

describe('runPayrollPeriodLockBackfill', () => {
  beforeEach(() => {
    mockComputeExportRows.mockReset()
    mockLoadAdditiveParticipants.mockReset()
    mockLoadAdditiveParticipants.mockResolvedValue([])
  })

  it('skips existing payout lines without recomputing export rows', async () => {
    const mock = makeBackfillSupabaseMock({ existingLineCount: 1 })

    const result = await runPayrollPeriodLockBackfill(mock as never, {
      orgId: 'org-1',
      periodId: 'period-1',
      cutoffAt: '2026-01-10',
      lockedBy: 'admin-1',
      lockedAt: '2026-01-10T12:00:00Z',
    })

    expect(result.skippedExisting).toBe(true)
    expect(result.linesCreated).toBe(0)
    expect(mockComputeExportRows).not.toHaveBeenCalled()
    expect(mock.payoutLineInserts).toHaveLength(0)
  })

  it('uses deal role override amount for an existing pool line', async () => {
    mockComputeExportRows.mockResolvedValue([exportRow()])
    const mock = makeBackfillSupabaseMock({
      dealRoleRows: [
        {
          job_id: 'j1',
          user_id: 'u1',
          role: 'closer',
          override_amount: 500,
          override_percent: null,
          premier_pricing_amount: null,
        },
      ],
    })

    const result = await runPayrollPeriodLockBackfill(mock as never, {
      orgId: 'org-1',
      periodId: 'period-1',
      cutoffAt: '2026-01-10',
      lockedBy: 'admin-1',
      lockedAt: '2026-01-10T12:00:00Z',
    })

    expect(result.linesCreated).toBe(1)
    expect(mock.payoutLineInserts).toHaveLength(1)
    expect(mock.payoutLineInserts[0].gross_amount).toBe(500)
    expect(
      (mock.payoutLineInserts[0].comp_plan_snapshot as Record<string, unknown>)
        .scaled_commission
    ).toBe(500)
  })

  it('creates additive payout lines after pool-scaled export rows', async () => {
    mockComputeExportRows.mockResolvedValue([exportRow({ commission_comp_base: 1000 })])
    mockLoadAdditiveParticipants.mockResolvedValue([
      {
        userId: 'fm1',
        role: 'field_manager',
        overrideAmount: 75,
        overridePercent: null,
        premierPricingAmount: null,
      },
    ])
    const mock = makeBackfillSupabaseMock()

    const result = await runPayrollPeriodLockBackfill(mock as never, {
      orgId: 'org-1',
      periodId: 'period-1',
      cutoffAt: '2026-01-10',
      lockedBy: 'admin-1',
      lockedAt: '2026-01-10T12:00:00Z',
    })

    expect(result.linesCreated).toBe(2)
    expect(mock.payoutLineInserts).toHaveLength(2)
    expect(mock.payoutLineInserts[1]).toEqual(
      expect.objectContaining({
        participant_role: 'field_manager',
        user_id: 'fm1',
        gross_amount: 75,
      })
    )
  })
})
