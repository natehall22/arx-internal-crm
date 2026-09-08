/**
 * @jest-environment node
 *
 * GET/POST/PATCH/DELETE /api/admin/subs.
 *
 * This route was migrated off a hand-rolled session-cookie parse +
 * `supabase.auth.getUser()` onto `requireAuthApi()` (CLAUDE.md's standing
 * auth rule), and PATCH gained an explicit field whitelist to close a
 * mass-assignment hole (`const { id, ...updates } = body` spread straight
 * into `.update()`). These tests cover both:
 *
 *  1. requireAuthApi() throwing -> 401 (it throws, never returns null).
 *  2. Role gates on each handler are unchanged (admin/regional_manager/
 *     operations/manager/sales_manager/owner for GET/POST/PATCH; admin-only
 *     for DELETE).
 *  3. PATCH only ever writes whitelisted fields — org_id, user_id,
 *     portal_access_token, id, and active-flip-adjacent audit columns
 *     smuggled into the body are silently dropped, not written.
 *  4. PATCH's update stays scoped to the caller's own org.
 */

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { GET, POST, PATCH, DELETE } from '@/app/api/admin/subs/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>

type Resp = { data: unknown; error?: unknown }

/** Chainable builder resolving to `response` however it's terminated. */
function makeBuilder(response: Resp) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'limit']) {
    builder[method] = jest.fn(() => builder)
  }
  builder.single = jest.fn(() => Promise.resolve(response))
  builder.then = (resolve: (v: Resp) => void) => resolve(response)
  return builder
}

function mockSupabaseQueues(queues: Record<string, Resp[]>) {
  const callCounts: Record<string, number> = {}
  const builders: Record<string, ReturnType<typeof makeBuilder>[]> = {}
  const from = jest.fn((table: string) => {
    const idx = callCounts[table] || 0
    callCounts[table] = idx + 1
    const list = queues[table] || []
    const response = list[idx] ?? list[list.length - 1] ?? { data: null, error: null }
    const builder = makeBuilder(response)
    builders[table] = builders[table] || []
    builders[table].push(builder)
    return builder
  })
  return { from, _builders: builders }
}

function makeJsonRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

function makeDeleteRequest(id: string | null) {
  const url = id
    ? `https://example.com/api/admin/subs?id=${encodeURIComponent(id)}`
    : 'https://example.com/api/admin/subs'
  return { url } as unknown as Parameters<typeof DELETE>[0]
}

const adminAuth = {
  authUser: { id: 'admin-1', email: 'admin@example.com' },
  profile: { id: 'admin-1', org_id: 'org-1', role: 'admin' },
} as never

const closerAuth = {
  authUser: { id: 'closer-1', email: 'closer@example.com' },
  profile: { id: 'closer-1', org_id: 'org-1', role: 'closer' },
} as never

const regionalManagerAuth = {
  authUser: { id: 'rm-1', email: 'rm@example.com' },
  profile: { id: 'rm-1', org_id: 'org-1', role: 'regional_manager' },
} as never

describe('GET /api/admin/subs', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when requireAuthApi throws (deactivated user / bad token)', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await GET()
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin role', async () => {
    mockRequireAuthApi.mockResolvedValue(closerAuth)
    const res = await GET()
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('scopes the subs query to the caller org', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({
      sub_contractors: [{ data: [{ id: 'sub-1', company_name: 'Acme Roofing' }] }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.orgId).toBe('org-1')
    const builder = supabase._builders.sub_contractors[0]
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })
})

describe('POST /api/admin/subs', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await POST(makeJsonRequest({ company_name: 'Acme' }))
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin-ish role', async () => {
    mockRequireAuthApi.mockResolvedValue(closerAuth)
    const res = await POST(makeJsonRequest({ company_name: 'Acme' }))
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('rejects an invalid scheduling_email', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({})
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await POST(makeJsonRequest({ company_name: 'Acme', scheduling_email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('inserts with org_id taken from the caller profile, not the request body', async () => {
    mockRequireAuthApi.mockResolvedValue(regionalManagerAuth)
    const insertedSub = { id: 'sub-1', org_id: 'org-1', company_name: 'Acme Roofing' }
    const supabase = mockSupabaseQueues({
      sub_contractors: [{ data: insertedSub }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await POST(
      makeJsonRequest({
        company_name: 'Acme Roofing',
        scheduling_email: 'ops@acme.com',
        org_id: 'org-attacker', // must be ignored — POST builds its own insert object
      })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sub).toEqual(insertedSub)
    const builder = supabase._builders.sub_contractors[0]
    const insertArg = (builder.insert as jest.Mock).mock.calls[0][0]
    expect(insertArg.org_id).toBe('org-1')
    expect(insertArg.scheduling_email).toBe('ops@acme.com')
  })
})

describe('PATCH /api/admin/subs', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Account disabled'))
    const res = await PATCH(makeJsonRequest({ id: 'sub-1', company_name: 'New Name' }))
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin-ish role', async () => {
    mockRequireAuthApi.mockResolvedValue(closerAuth)
    const res = await PATCH(makeJsonRequest({ id: 'sub-1', company_name: 'New Name' }))
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('requires an id', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({})
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await PATCH(makeJsonRequest({ company_name: 'New Name' }))
    expect(res.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('strips org_id, user_id, portal_access_token, active and id-in-updates from a mass-assignment attempt', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const updatedSub = { id: 'sub-1', org_id: 'org-1', company_name: 'Renamed Co' }
    const supabase = mockSupabaseQueues({
      sub_contractors: [{ data: updatedSub }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await PATCH(
      makeJsonRequest({
        id: 'sub-1',
        company_name: 'Renamed Co',
        org_id: 'org-attacker', // move the sub to another tenant — must be dropped
        user_id: 'user-attacker', // link to an arbitrary user account — must be dropped
        portal_access_token: 'stolen-token', // forge portal access — must be dropped
        created_at: '2020-01-01', // audit column — must be dropped
      })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sub).toEqual(updatedSub)

    const builder = supabase._builders.sub_contractors[0]
    const updateArg = (builder.update as jest.Mock).mock.calls[0][0]
    expect(updateArg).toEqual({ company_name: 'Renamed Co' })
    expect(updateArg.org_id).toBeUndefined()
    expect(updateArg.user_id).toBeUndefined()
    expect(updateArg.portal_access_token).toBeUndefined()
    expect(updateArg.created_at).toBeUndefined()
    expect(updateArg.id).toBeUndefined()
  })

  it('allows the whitelisted active toggle used by the deactivate/activate button', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const updatedSub = { id: 'sub-1', org_id: 'org-1', active: false }
    const supabase = mockSupabaseQueues({
      sub_contractors: [{ data: updatedSub }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await PATCH(makeJsonRequest({ id: 'sub-1', active: false }))
    expect(res.status).toBe(200)
    const builder = supabase._builders.sub_contractors[0]
    const updateArg = (builder.update as jest.Mock).mock.calls[0][0]
    expect(updateArg).toEqual({ active: false })
  })

  it('scopes the update to the caller org', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const updatedSub = { id: 'sub-1', org_id: 'org-1', company_name: 'Renamed Co' }
    const supabase = mockSupabaseQueues({
      sub_contractors: [{ data: updatedSub }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    await PATCH(makeJsonRequest({ id: 'sub-1', company_name: 'Renamed Co' }))
    const builder = supabase._builders.sub_contractors[0]
    expect(builder.eq).toHaveBeenCalledWith('id', 'sub-1')
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('rejects an invalid scheduling_email in updates', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({})
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await PATCH(makeJsonRequest({ id: 'sub-1', scheduling_email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('400s when the body has only disallowed fields', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({})
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await PATCH(makeJsonRequest({ id: 'sub-1', org_id: 'org-attacker' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/no valid fields/i)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/subs', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await DELETE(makeDeleteRequest('sub-1'))
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin role (regional_manager can edit but not delete)', async () => {
    mockRequireAuthApi.mockResolvedValue(regionalManagerAuth)
    const res = await DELETE(makeDeleteRequest('sub-1'))
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('requires an id', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({})
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await DELETE(makeDeleteRequest(null))
    expect(res.status).toBe(400)
  })

  it('scopes the delete to the caller org', async () => {
    mockRequireAuthApi.mockResolvedValue(adminAuth)
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: [] }],
      work_orders: [{ data: [] }],
      sub_contractors: [{ data: null, error: null }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await DELETE(makeDeleteRequest('sub-1'))
    expect(res.status).toBe(200)
    const builder = supabase._builders.sub_contractors[0]
    expect(builder.eq).toHaveBeenCalledWith('id', 'sub-1')
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })
})
