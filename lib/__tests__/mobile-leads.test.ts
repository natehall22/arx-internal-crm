/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'
import { GET as leadsGET } from '@/app/api/mobile/leads/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>

function chainMock(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {}
  const self = () => chain
  for (const method of ['select', 'eq', 'or', 'order', 'limit']) {
    chain[method] = jest.fn(self)
  }
  // Terminal — awaitable thenable
  chain.then = undefined as never
  Object.assign(chain, result)
  // Make the final limit() resolve like a Postgrest builder
  chain.limit = jest.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/mobile/leads', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))

    const res = await leadsGET()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRequireAuthApi).toHaveBeenCalledTimes(1)
  })

  it('returns caller-owned leads with expected shape and hasMore=false', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-1', email: 'rep@example.com' },
      profile: { id: 'user-1', org_id: 'org-1', role: 'canvasser' } as never,
    } as never)

    const row = {
      id: 'lead-1',
      lat: 35.2,
      lng: -80.8,
      address_text: '123 Main St',
      homeowner_name: 'Jane Doe',
      phone: '7045551212',
      canvass_disposition: 'hot_lead',
      canvass_notes: 'knocked',
      status: 'new',
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-10T12:00:00.000Z',
      owner_user_id: 'user-1',
      pin_attributed_user_id: null,
    }

    const from = jest.fn().mockReturnValue(chainMock({ data: [row], error: null }))
    mockCreateClient.mockReturnValue({ from } as never)

    const res = await leadsGET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.hasMore).toBe(false)
    expect(body.leads).toHaveLength(1)
    expect(body.leads[0]).toEqual({
      id: 'lead-1',
      lat: 35.2,
      lng: -80.8,
      address_text: '123 Main St',
      homeowner_name: 'Jane Doe',
      phone: '7045551212',
      canvass_disposition: 'hot_lead',
      canvass_notes: 'knocked',
      status: 'new',
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-10T12:00:00.000Z',
    })
    expect(body.leads[0]).not.toHaveProperty('owner_user_id')
    expect(body.leads[0]).not.toHaveProperty('pin_attributed_user_id')
    expect(from).toHaveBeenCalledWith('leads')
  })

  it('includes leads where caller is owner even if pin attribution differs', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-1', email: 'rep@example.com' },
      profile: { id: 'user-1', org_id: 'org-1', role: 'canvasser' } as never,
    } as never)

    const row = {
      id: 'lead-2',
      lat: 35.3,
      lng: -80.9,
      address_text: '456 Oak Ave',
      homeowner_name: 'Sam',
      phone: null,
      canvass_disposition: 'go_back',
      canvass_notes: null,
      status: 'inspection',
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-11T12:00:00.000Z',
      owner_user_id: 'user-1',
      pin_attributed_user_id: 'other-user',
    }

    const from = jest.fn().mockReturnValue(chainMock({ data: [row], error: null }))
    mockCreateClient.mockReturnValue({ from } as never)

    const res = await leadsGET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.leads).toHaveLength(1)
    expect(body.leads[0].id).toBe('lead-2')
  })
})
