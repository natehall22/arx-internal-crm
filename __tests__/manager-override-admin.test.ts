/**
 * @jest-environment node
 *
 * The manager override control surface: the pure read model behind the admin card, and
 * the assignment write path that now carries an explicit rate.
 *
 * The behaviour under test exists because payroll stopped reading
 * `orgs.manager_override_commission_rate` when management overlays shipped — an override
 * line comes from an effective-dated assignment plus a plan version, so the admin UI has
 * to describe and edit those, not the org column.
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

import {
  eligibleOverrideManagerIds,
  resolveOverlayRatePercent,
  summarizeManagerOverrides,
  type ManagerAssignmentInput,
  type OverlayAssignmentInput,
  type OverlayVersionInput,
} from '@/lib/management-override-admin'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { POST as overlayPOST } from '@/app/api/admin/comp-plan-overlays/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>

const TODAY = '2026-08-19'
const PLAN = 'plan-overlay'

const users = [
  { id: 'evan', full_name: 'Evan' },
  { id: 'nathan', full_name: 'Nathan Hall' },
  { id: 'archer', full_name: 'Archer' },
]
const userNamesById = new Map(users.map((u) => [u.id, u.full_name]))
const activeUserIds = new Set(users.map((u) => u.id))

const managerAssignments: ManagerAssignmentInput[] = [
  { user_id: 'archer', manager_user_id: 'evan', effective_from: '2026-01-01', effective_to: null },
  { user_id: 'evan', manager_user_id: 'nathan', effective_from: '2026-01-01', effective_to: null },
]

function assignment(overrides: Partial<OverlayAssignmentInput> = {}): OverlayAssignmentInput {
  return {
    id: 'assign-1',
    user_id: 'evan',
    comp_plan_id: PLAN,
    lane: 'setter',
    effective_from: '2026-08-01',
    effective_to: null,
    ended_at: null,
    comp_plans: { name: 'Manager override' },
    ...overrides,
  }
}

const versions: OverlayVersionInput[] = [
  { comp_plan_id: PLAN, lane: 'setter', override_percent: 1, effective_from: '2026-08-01' },
]

describe('resolveOverlayRatePercent', () => {
  it('uses the latest version at or before the date, not the newest overall', () => {
    const history: OverlayVersionInput[] = [
      ...versions,
      { comp_plan_id: PLAN, lane: 'setter', override_percent: 1.5, effective_from: '2026-09-01' },
    ]
    expect(resolveOverlayRatePercent(history, PLAN, 'setter', '2026-08-15')).toBe(1)
    expect(resolveOverlayRatePercent(history, PLAN, 'setter', '2026-09-01')).toBe(1.5)
  })

  it('returns null — not 0 — when the lane has no version yet', () => {
    expect(resolveOverlayRatePercent(versions, PLAN, 'closer', TODAY)).toBeNull()
  })
})

describe('summarizeManagerOverrides', () => {
  it('reports the live override with its rate and the reports that roll up', () => {
    const rows = summarizeManagerOverrides({
      assignments: [assignment()],
      versions,
      managerAssignments,
      userNamesById,
      activeUserIds,
      today: TODAY,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      lane: 'setter',
      managerName: 'Evan',
      ratePercent: 1,
      status: 'current',
      reportCount: 1,
    })
  })

  it('prices a scheduled change at its own start date, not today', () => {
    const rows = summarizeManagerOverrides({
      assignments: [assignment({ id: 'future', effective_from: '2026-09-01' })],
      versions: [
        ...versions,
        { comp_plan_id: PLAN, lane: 'setter', override_percent: 1.5, effective_from: '2026-09-01' },
      ],
      managerAssignments,
      userNamesById,
      activeUserIds,
      today: TODAY,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'scheduled', ratePercent: 1.5 })
  })

  it('shows both the current override and a scheduled replacement', () => {
    const rows = summarizeManagerOverrides({
      assignments: [
        assignment({ id: 'now', effective_to: '2026-08-31' }),
        assignment({ id: 'next', effective_from: '2026-09-01' }),
      ],
      versions,
      managerAssignments,
      userNamesById,
      activeUserIds,
      today: TODAY,
    })
    expect(rows.map((r) => r.status)).toEqual(['current', 'scheduled'])
  })

  it('flags an assignment whose plan has no rate version, which silently pays nothing', () => {
    const rows = summarizeManagerOverrides({
      assignments: [assignment({ lane: 'closer', user_id: 'nathan' })],
      versions,
      managerAssignments,
      userNamesById,
      activeUserIds,
      today: TODAY,
    })
    expect(rows[0]).toMatchObject({ lane: 'closer', ratePercent: null })
  })

  it('does not count a deactivated report toward the roll-up', () => {
    const rows = summarizeManagerOverrides({
      assignments: [assignment()],
      versions,
      managerAssignments,
      userNamesById,
      activeUserIds: new Set(['evan', 'nathan']), // archer deactivated
      today: TODAY,
    })
    expect(rows[0].reportCount).toBe(0)
  })
})

describe('eligibleOverrideManagerIds', () => {
  it('offers only managers with an active report effective that day', () => {
    expect(
      Array.from(
        eligibleOverrideManagerIds({ managerAssignments, activeUserIds, onDate: '2026-09-01' })
      ).sort()
    ).toEqual(['evan', 'nathan'])
  })

  it('drops a manager whose only report ended before the date', () => {
    const ended: ManagerAssignmentInput[] = [
      { user_id: 'archer', manager_user_id: 'evan', effective_from: '2026-01-01', effective_to: '2026-07-31' },
    ]
    expect(
      eligibleOverrideManagerIds({ managerAssignments: ended, activeUserIds, onDate: TODAY }).size
    ).toBe(0)
  })

  it('drops a manager who is no longer an active user', () => {
    expect(
      eligibleOverrideManagerIds({
        managerAssignments,
        activeUserIds: new Set(['archer']),
        onDate: TODAY,
      }).size
    ).toBe(0)
  })
})

const payrollAdminAuth = {
  authUser: { id: 'admin-1', email: 'admin@example.com' },
  profile: { id: 'admin-1', org_id: 'org-1', role: 'admin' },
} as never

/**
 * `basePercentage` is the overlay plan's frozen starting rate; `liveVersionPercent` is
 * the rate currently in force for that plan + lane (null when the plan has no version
 * yet). They differ whenever the rate has been changed since the plan was created,
 * which is exactly when the fallback has to pick the right one.
 */
function mockSupabaseWithPlan(basePercentage: number | null, liveVersionPercent: number | null = null) {
  const rpc = jest.fn().mockResolvedValue({ data: 'assignment-id', error: null })
  const responses: Record<string, { data: unknown; error: unknown }> = {
    comp_plans: { data: { base_percentage: basePercentage }, error: null },
    management_comp_overlay_plan_versions: {
      data: liveVersionPercent === null ? null : { override_percent: liveVersionPercent },
      error: null,
    },
  }
  const from = jest.fn((table: string) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'lte', 'order', 'limit']) {
      builder[method] = jest.fn(() => builder)
    }
    builder.maybeSingle = jest.fn(() =>
      Promise.resolve(responses[table] ?? { data: null, error: null })
    )
    return builder
  })
  return { client: { from, rpc }, rpc }
}

function overlayRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof overlayPOST>[0]
}

const validOverlayBody = {
  user_id: 'evan',
  comp_plan_id: PLAN,
  lane: 'setter',
  effective_from: '2026-09-01',
  change_reason: 'Enable the 1% setter manager override',
}

describe('POST /api/admin/comp-plan-overlays', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
  })

  it('passes an explicit rate through to the RPC, which versions it', async () => {
    const { client, rpc } = mockSupabaseWithPlan(1)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest({ ...validOverlayBody, override_percent: 1.5 }))
    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith(
      'assign_management_comp_overlay',
      expect.objectContaining({ p_override_percent: 1.5 })
    )
  })

  it("falls back to the plan's own rate on the plan's first assignment", async () => {
    const { client, rpc } = mockSupabaseWithPlan(1, null)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest(validOverlayBody))
    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith(
      'assign_management_comp_overlay',
      expect.objectContaining({ p_override_percent: 1 })
    )
  })

  it('falls back to the rate IN FORCE, not the plan\'s frozen base rate', async () => {
    // The plan was created at 1.00% and later raised to 1.50% via a new version. The
    // plan row can never be updated (PUT comp_plan 409s once assigned), so trusting
    // base_percentage here would cut everyone on this overlay back to 1.00% the next
    // time an admin assigns it and leaves the rate box blank.
    const { client, rpc } = mockSupabaseWithPlan(1, 1.5)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest(validOverlayBody))
    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith(
      'assign_management_comp_overlay',
      expect.objectContaining({ p_override_percent: 1.5 })
    )
  })

  it('rejects a rate above the typo guard', async () => {
    const { client, rpc } = mockSupabaseWithPlan(1)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest({ ...validOverlayBody, override_percent: 100 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot exceed 25%/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects more than two decimal places', async () => {
    const { client, rpc } = mockSupabaseWithPlan(1)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest({ ...validOverlayBody, override_percent: 1.005 }))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts a deliberate 0 instead of treating it as "unset"', async () => {
    const { client, rpc } = mockSupabaseWithPlan(1)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest({ ...validOverlayBody, override_percent: 0 }))
    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith(
      'assign_management_comp_overlay',
      expect.objectContaining({ p_override_percent: 0 })
    )
  })

  it('refuses when neither an explicit rate nor any existing rate exists', async () => {
    const { client, rpc } = mockSupabaseWithPlan(null, null)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest(validOverlayBody))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('still requires a change reason', async () => {
    const { client, rpc } = mockSupabaseWithPlan(1)
    mockCreateServiceClient.mockReturnValue(client as never)

    const res = await overlayPOST(overlayRequest({ ...validOverlayBody, change_reason: '   ' }))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-payroll-admin role', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'u-2' },
      profile: { id: 'u-2', org_id: 'org-1', role: 'sales_rep' },
    } as never)

    const res = await overlayPOST(overlayRequest(validOverlayBody))
    expect(res.status).toBe(403)
  })
})
