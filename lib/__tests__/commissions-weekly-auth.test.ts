/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(),
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
import { GET as weeklyGET } from '@/app/api/commissions/weekly/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>

function mockSupabaseForWeekly(opts: {
  commissions?: { total_amount: number }[]
  hasUserCompPlan?: boolean
  hasDefaultPlan?: boolean
}) {
  const commissions = opts.commissions ?? [{ total_amount: 125.5 }]
  const hasUserCompPlan = opts.hasUserCompPlan ?? true
  const hasDefaultPlan = opts.hasDefaultPlan ?? false

  return {
    from: (table: string) => {
      if (table === 'user_comp_plans') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                lte: () => ({
                  or: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: hasUserCompPlan
                            ? { id: 'ucp-1', comp_plans: { is_active: true } }
                            : null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'comp_plans') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: hasDefaultPlan ? { id: 'plan-default' } : null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'commissions') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: async () => ({ data: commissions }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('GET /api/commissions/weekly', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when requireAuthApi throws (no cookie or bearer session)', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))

    const res = await weeklyGET()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRequireAuthApi).toHaveBeenCalledTimes(1)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns self weekly estimate fields for authenticated closer', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-closer', email: 'closer@example.com' },
      profile: {
        id: 'user-closer',
        org_id: 'org-1',
        role: 'closer',
      } as never,
    } as never)
    mockCreateServiceClient.mockReturnValue(mockSupabaseForWeekly({}) as never)

    const res = await weeklyGET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.isEstimate).toBe(true)
    expect(body.role).toBe('closer')
    expect(body.perspectiveLane).toBe('closer')
    expect(body.weeklyTotal).toBe(125.5)
    expect(body.hasCompPlan).toBe(true)
    expect(typeof body.weekStart).toBe('string')
    expect(typeof body.weekEnd).toBe('string')
    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1)
  })

  it('maps setter-like roles to setter perspectiveLane', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-setter', email: 's@example.com' },
      profile: {
        id: 'user-setter',
        org_id: 'org-1',
        role: 'setter',
      } as never,
    } as never)
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseForWeekly({ commissions: [], hasUserCompPlan: false, hasDefaultPlan: false }) as never
    )

    const res = await weeklyGET()
    const body = await res.json()

    expect(body.perspectiveLane).toBe('setter')
    expect(body.weeklyTotal).toBe(0)
    expect(body.hasCompPlan).toBe(false)
  })
})
