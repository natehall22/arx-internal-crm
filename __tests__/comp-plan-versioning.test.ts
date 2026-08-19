/**
 * @jest-environment node
 *
 * Phase 3 — effective-dated comp plan bodies.
 *
 * The point of the whole feature: amending a plan must change what it pays GOING
 * FORWARD and leave every earlier job paying what it was sold under. Before this,
 * `comp_plans` was mutable with no history, so the API had to 409 every assigned plan —
 * which meant no plan in the system could be edited at all.
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(),
}))

jest.mock('@/lib/eastern-datetime', () => ({
  getEasternTodayIso: jest.fn(() => '2026-08-19'),
}))

import {
  applyCompPlanVersion,
  compPlanBodyChanged,
  compPlanAsOf,
  normalizeCompPlanBody,
  resolveCompPlanVersionForSaleDate,
  type CompPlanVersionRow,
} from '@/lib/comp-plan-version'
import { loadActiveCompPlanForUser } from '@/lib/payroll-export'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { PATCH as adminDataPATCH } from '@/app/api/admin/data/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>

const PLAN = 'plan-closer'

const versions: CompPlanVersionRow[] = [
  { comp_plan_id: PLAN, effective_from: '2000-01-01', base_percentage: 6, plan_type: 'percentage' },
  { comp_plan_id: PLAN, effective_from: '2026-08-04', base_percentage: 7, plan_type: 'percentage' },
]

describe('resolveCompPlanVersionForSaleDate', () => {
  it('pays the terms in force on the sale date, not today’s', () => {
    expect(resolveCompPlanVersionForSaleDate(versions, PLAN, '2026-07-30')?.base_percentage).toBe(6)
    expect(resolveCompPlanVersionForSaleDate(versions, PLAN, '2026-08-04')?.base_percentage).toBe(7)
    expect(resolveCompPlanVersionForSaleDate(versions, PLAN, '2026-08-19')?.base_percentage).toBe(7)
  })

  it('returns null rather than a wrong version for another plan or an unparseable date', () => {
    expect(resolveCompPlanVersionForSaleDate(versions, 'other-plan', '2026-08-19')).toBeNull()
    expect(resolveCompPlanVersionForSaleDate(versions, PLAN, null)).toBeNull()
    expect(resolveCompPlanVersionForSaleDate(versions, PLAN, 'not-a-date')).toBeNull()
  })
})

describe('applyCompPlanVersion', () => {
  const plan = { id: PLAN, name: 'Closer', base_percentage: 7, plan_type: 'percentage', readme: 'ladder notes' }

  it('overlays the versioned terms and leaves identity alone', () => {
    const asOf = compPlanAsOf(plan, versions, '2026-07-30')
    expect(asOf.base_percentage).toBe(6)
    expect(asOf.name).toBe('Closer')
    expect(asOf.readme).toBe('ladder notes')
  })

  it('falls back to the plan row when no version covers the date — never to nothing', () => {
    // A missing version must not zero somebody's commission.
    expect(applyCompPlanVersion(plan, null).base_percentage).toBe(7)
    expect(compPlanAsOf(plan, [], '2026-07-30').base_percentage).toBe(7)
  })

  it('copies a null flag as null instead of normalizing it', () => {
    const merged = applyCompPlanVersion(
      { id: PLAN, personal_sales_enabled: true },
      { comp_plan_id: PLAN, effective_from: '2000-01-01', personal_sales_enabled: null }
    )
    expect(merged.personal_sales_enabled).toBeNull()
  })
})

describe('compPlanBodyChanged', () => {
  const stored = {
    plan_type: 'percentage',
    base_percentage: '7.00', // numerics come back from Postgres as strings
    tiers: null,
    volume_bonuses: null,
    is_manager_plan: false,
    personal_sales_enabled: true,
    team_override_enabled: false,
  }

  it('does not treat a string/number or []/null difference as a change', () => {
    expect(compPlanBodyChanged(stored, { ...stored, base_percentage: 7, tiers: [] })).toBe(false)
  })

  it('detects a real rate change', () => {
    expect(compPlanBodyChanged(stored, { ...stored, base_percentage: 7.5 })).toBe(true)
  })

  it('detects a manager-flag change, which gates who earns derived lines', () => {
    expect(compPlanBodyChanged(stored, { ...stored, is_manager_plan: true })).toBe(true)
  })

  it('ignores identity-only edits', () => {
    expect(normalizeCompPlanBody({ ...stored, name: 'Renamed', readme: 'new text' })).toEqual(
      normalizeCompPlanBody(stored)
    )
  })
})

describe('loadActiveCompPlanForUser', () => {
  function clientWith(assignment: unknown, versionRows: unknown[]) {
    const from = jest.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'lte', 'or', 'order', 'limit']) {
        chain[method] = jest.fn(() => chain)
      }
      chain.maybeSingle = jest.fn(async () => ({ data: assignment, error: null }))
      // comp_plan_versions is awaited directly, with no terminal call.
      chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: table === 'comp_plan_versions' ? versionRows : assignment, error: null })
      return chain
    })
    return { from } as never
  }

  const assignment = {
    user_id: 'closer-1',
    effective_from: '2026-01-01',
    effective_to: null,
    override_percentage: null,
    hourly_rate_override: null,
    comp_plans: { id: PLAN, name: 'Closer', base_percentage: 7, plan_type: 'percentage' },
  }

  it('pays a July job at the rate that was in force in July, not the amended one', async () => {
    const result = await loadActiveCompPlanForUser(
      clientWith(assignment, versions),
      'closer-1',
      'org-1',
      '2026-07-30'
    )
    expect((result?.comp_plans as { base_percentage?: number })?.base_percentage).toBe(6)
  })

  it('pays a job after the amendment at the new rate', async () => {
    const result = await loadActiveCompPlanForUser(
      clientWith(assignment, versions),
      'closer-1',
      'org-1',
      '2026-08-10'
    )
    expect((result?.comp_plans as { base_percentage?: number })?.base_percentage).toBe(7)
  })

  it('keeps the plan row when the org has no versions at all', async () => {
    const result = await loadActiveCompPlanForUser(clientWith(assignment, []), 'closer-1', 'org-1', '2026-07-30')
    expect((result?.comp_plans as { base_percentage?: number })?.base_percentage).toBe(7)
  })
})

const payrollAdminAuth = {
  authUser: { id: 'admin-1', email: 'admin@example.com' },
  profile: { id: 'admin-1', org_id: 'org-1', role: 'admin' },
} as never

const currentPlan = {
  id: PLAN,
  org_id: 'org-1',
  name: 'Closer',
  plan_type: 'percentage',
  base_percentage: '7.00',
  flat_amount: null,
  hourly_rate: null,
  unit_rate: null,
  unit_type: null,
  hybrid_components: null,
  tiers: null,
  volume_bonuses: null,
  team_overrides: null,
  is_manager_plan: false,
  personal_sales_enabled: true,
  team_override_enabled: false,
}

/** Body the admin form posts back. `base_percentage` is what the test varies. */
function planPayload(overrides: Record<string, unknown> = {}) {
  return {
    resource: 'comp_plan',
    id: PLAN,
    name: 'Closer',
    plan_type: 'percentage',
    base_percentage: 7,
    personal_sales_enabled: true,
    is_active: true,
    applicable_roles: ['sales_rep'],
    ...overrides,
  }
}

function mockAdminClient(options: {
  settledLines?: unknown[]
  planAssignments?: unknown[]
  rpcError?: { message: string } | null
}) {
  const rpc = jest.fn().mockResolvedValue({ data: 'version-1', error: options.rpcError ?? null })
  const updates: Array<Record<string, unknown>> = []
  const from = jest.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'gte', 'neq', 'order', 'limit']) {
      chain[method] = jest.fn(() => chain)
    }
    chain.update = jest.fn((payload: Record<string, unknown>) => {
      updates.push({ table, ...payload })
      return chain
    })
    chain.maybeSingle = jest.fn(async () => ({
      data: table === 'comp_plans' ? currentPlan : null,
      error: null,
    }))
    const rows =
      table === 'payroll_payout_lines'
        ? options.settledLines ?? []
        : table === 'user_comp_plans'
          ? options.planAssignments ?? []
          : []
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: rows, error: null })
    return chain
  })
  return { client: { from, rpc } as never, rpc, updates }
}

function request(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof adminDataPATCH>[0]
}

describe('PATCH /api/admin/data (comp_plan)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
  })

  it('lets identity-only edits through with no effective date, reason, or version', async () => {
    const { client, rpc } = mockAdminClient({})
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(request(planPayload({ name: 'Closer (2026)' })))
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires an effective date before changing pay terms', async () => {
    const { client, rpc } = mockAdminClient({})
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(request(planPayload({ base_percentage: 8, change_reason: 'raise' })))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('effective_from_required')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires a reason before changing pay terms', async () => {
    const { client, rpc } = mockAdminClient({})
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(
      request(planPayload({ base_percentage: 8, effective_from: '2026-09-01', change_reason: '  ' }))
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('change_reason_required')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('amends forward with an effective date and reason', async () => {
    const { client, rpc } = mockAdminClient({})
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(
      request(
        planPayload({
          base_percentage: 8,
          effective_from: '2026-09-01',
          change_reason: 'Closer base moves to 8%',
        })
      )
    )
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      'amend_comp_plan_version',
      expect.objectContaining({
        p_comp_plan_id: PLAN,
        p_effective_from: '2026-09-01',
        p_change_reason: 'Closer base moves to 8%',
        p_body: expect.objectContaining({ base_percentage: 8 }),
      })
    )
  })

  it('refuses to restate a job already paid on this plan in a settled period', async () => {
    const { client, rpc } = mockAdminClient({
      settledLines: [
        { user_id: 'closer-1', job: { id: 'job-1', job_number: '26-0031', sale_date: '2026-07-05' } },
      ],
      planAssignments: [{ user_id: 'closer-1', effective_from: '2026-01-01', effective_to: null }],
    })
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(
      request(
        planPayload({
          base_percentage: 8,
          effective_from: '2026-07-01',
          change_reason: 'retro raise',
          confirm_backdate: true,
        })
      )
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('settled_pay_conflict')
    expect(body.error).toMatch(/26-0031/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ignores a settled job that was paid on a DIFFERENT plan', async () => {
    const { client, rpc } = mockAdminClient({
      settledLines: [
        { user_id: 'someone-else', job: { id: 'job-9', job_number: '26-0009', sale_date: '2026-07-05' } },
      ],
      planAssignments: [{ user_id: 'closer-1', effective_from: '2026-01-01', effective_to: null }],
    })
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(
      request(
        planPayload({
          base_percentage: 8,
          effective_from: '2026-07-01',
          change_reason: 'retro raise',
          confirm_backdate: true,
        })
      )
    )
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalled()
  })

  it('makes backdating deliberate', async () => {
    const { client, rpc } = mockAdminClient({})
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(
      request(planPayload({ base_percentage: 8, effective_from: '2026-08-04', change_reason: 'ladder go-live' }))
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('confirm_backdate_required')
    expect(rpc).not.toHaveBeenCalled()

    const confirmed = await adminDataPATCH(
      request(
        planPayload({
          base_percentage: 8,
          effective_from: '2026-08-04',
          change_reason: 'ladder go-live',
          confirm_backdate: true,
        })
      )
    )
    expect(confirmed.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('returns 403 for a non-payroll-admin role', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'rep-1' },
      profile: { id: 'rep-1', org_id: 'org-1', role: 'sales_rep' },
    } as never)
    const { client, rpc } = mockAdminClient({})
    mockCreateServiceClient.mockReturnValue(client)

    const res = await adminDataPATCH(request(planPayload({ base_percentage: 8 })))
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})
