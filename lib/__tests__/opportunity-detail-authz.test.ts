/**
 * @jest-environment node
 *
 * Regression coverage for a BOLA/IDOR gap in the single-opportunity API routes:
 * GET/PATCH /api/opportunities/[id] previously scoped only on org_id, with no
 * ownership check — any authenticated rep could fetch or edit another rep's
 * opportunity (full PII: name, phone, email, inspection notes, financials) by
 * guessing/obtaining its id, even though the list endpoint
 * (app/api/opportunities/route.ts) correctly hides it from them.
 *
 * The fix mirrors the list endpoint's existing `isRep` + owner/setter/lead-closer
 * scoping and returns the same 404 "Opportunity not found" used for org
 * mismatches, so the endpoint doesn't leak whether the record exists.
 */

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/payroll-attribution-sync', () => ({
  syncCloserAttributionDownstream: jest.fn(),
}))

type MockResponse = { data: unknown; error: unknown }

/**
 * Minimal chainable Supabase query-builder stand-in. `.from(table)` selects which
 * queued response list subsequent `.single()`/`.maybeSingle()` calls pop from — every
 * other chain method (`select`, `eq`, `order`, `in`, `update`) just returns the same
 * builder so arbitrary chains resolve.
 */
function createMockSupabase(responses: Record<string, MockResponse[]>) {
  const cursors: Record<string, number> = {}
  let currentTable = ''

  const resolveNext = () => {
    const idx = cursors[currentTable] ?? 0
    cursors[currentTable] = idx + 1
    const queued = responses[currentTable] || []
    const next = queued[idx] ?? { data: null, error: null }
    return Promise.resolve(next)
  }

  const builder: Record<string, jest.Mock> = {}
  builder.select = jest.fn(() => builder)
  builder.eq = jest.fn(() => builder)
  builder.order = jest.fn(() => builder)
  builder.in = jest.fn(() => builder)
  builder.update = jest.fn(() => builder)
  builder.insert = jest.fn(() => builder)
  builder.single = jest.fn(() => resolveNext())
  builder.maybeSingle = jest.fn(() => resolveNext())

  return {
    from: jest.fn((table: string) => {
      currentTable = table
      return builder
    }),
  }
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))

import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'
import { GET, PATCH } from '@/app/api/opportunities/[id]/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>

const ORG_ID = 'org-1'
const OPP_ID = 'opp-1'
const OWNING_REP_ID = 'user-owner'
const OTHER_REP_ID = 'user-other-rep'
const MANAGER_ID = 'user-manager'

function authAs(role: string, userId: string) {
  mockRequireAuthApi.mockResolvedValue({
    authUser: { id: userId, email: `${userId}@example.com` },
    profile: { id: userId, org_id: ORG_ID, role, full_name: userId } as never,
  } as never)
}

function baseOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: OPP_ID,
    org_id: ORG_ID,
    owner_user_id: OWNING_REP_ID,
    setter_user_id: null,
    lead_id: 'lead-1',
    address_text: '123 Main St',
    ...overrides,
  }
}

function fakeParams() {
  return { params: { id: OPP_ID } }
}

function fakeRequest(body?: unknown) {
  return {
    json: async () => body ?? {},
  } as never
}

describe('GET /api/opportunities/[id] — rep ownership scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    mockCreateClient.mockReturnValue(createMockSupabase({}) as never)

    const res = await GET(fakeRequest(), fakeParams())
    const body = await (res as unknown as { json: () => Promise<{ error: string }> }).json()

    expect((res as unknown as { status: number }).status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 (not 403) for a rep who does not own/set/close the opportunity', async () => {
    authAs('rep', OTHER_REP_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [{ data: baseOpportunity(), error: null }],
        leads: [{ data: { closer_user_id: 'someone-else' }, error: null }],
      }) as never
    )

    const res = await GET(fakeRequest(), fakeParams())
    const body = await (res as unknown as { json: () => Promise<{ error: string }> }).json()

    expect((res as unknown as { status: number }).status).toBe(404)
    expect(body).toEqual({ error: 'Opportunity not found' })
  })

  it('returns 200 for the owning rep', async () => {
    authAs('rep', OWNING_REP_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [{ data: baseOpportunity(), error: null }],
      }) as never
    )

    const res = await GET(fakeRequest(), fakeParams())
    const body = await (res as unknown as { json: () => Promise<{ opportunity: { id: string } }> }).json()

    expect((res as unknown as { status: number }).status).toBe(200)
    expect(body.opportunity.id).toBe(OPP_ID)
  })

  it('returns 200 for a rep who is the setter (not owner)', async () => {
    authAs('sales_rep', 'user-setter')
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [
          { data: baseOpportunity({ owner_user_id: OWNING_REP_ID, setter_user_id: 'user-setter' }), error: null },
        ],
      }) as never
    )

    const res = await GET(fakeRequest(), fakeParams())
    expect((res as unknown as { status: number }).status).toBe(200)
  })

  it('returns 200 for a rep who is the lead closer (via lead_id lookup)', async () => {
    authAs('closer', 'user-lead-closer')
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [{ data: baseOpportunity(), error: null }],
        leads: [{ data: { closer_user_id: 'user-lead-closer' }, error: null }],
      }) as never
    )

    const res = await GET(fakeRequest(), fakeParams())
    expect((res as unknown as { status: number }).status).toBe(200)
  })

  it('returns 200 for a manager/admin regardless of ownership', async () => {
    authAs('admin', MANAGER_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [{ data: baseOpportunity(), error: null }],
      }) as never
    )

    const res = await GET(fakeRequest(), fakeParams())
    const body = await (res as unknown as { json: () => Promise<{ opportunity: { id: string } }> }).json()

    expect((res as unknown as { status: number }).status).toBe(200)
    expect(body.opportunity.id).toBe(OPP_ID)
  })

  it('still 404s when the opportunity does not exist / is in another org', async () => {
    authAs('admin', MANAGER_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [{ data: null, error: { message: 'no rows' } }],
      }) as never
    )

    const res = await GET(fakeRequest(), fakeParams())
    expect((res as unknown as { status: number }).status).toBe(404)
  })
})

describe('PATCH /api/opportunities/[id] — rep ownership scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 404 for a non-owning rep attempting to patch', async () => {
    authAs('rep', OTHER_REP_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [{ data: baseOpportunity(), error: null }],
        leads: [{ data: { closer_user_id: 'someone-else' }, error: null }],
      }) as never
    )

    const res = await PATCH(fakeRequest({ notes: 'trying to edit' }), fakeParams())
    const body = await (res as unknown as { json: () => Promise<{ error: string }> }).json()

    expect((res as unknown as { status: number }).status).toBe(404)
    expect(body).toEqual({ error: 'Opportunity not found' })
  })

  it('allows the owning rep to patch', async () => {
    authAs('rep', OWNING_REP_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [
          { data: baseOpportunity(), error: null }, // existingOpp lookup
          { data: baseOpportunity({ notes: 'updated' }), error: null }, // post-update select
        ],
      }) as never
    )

    const res = await PATCH(fakeRequest({ notes: 'updated' }), fakeParams())
    expect((res as unknown as { status: number }).status).toBe(200)
  })

  it('allows a manager/admin to patch any opportunity in the org', async () => {
    authAs('admin', MANAGER_ID)
    mockCreateClient.mockReturnValue(
      createMockSupabase({
        opportunities: [
          { data: baseOpportunity(), error: null }, // existingOpp lookup
          { data: baseOpportunity({ notes: 'updated by manager' }), error: null }, // post-update select
        ],
      }) as never
    )

    const res = await PATCH(fakeRequest({ notes: 'updated by manager' }), fakeParams())
    expect((res as unknown as { status: number }).status).toBe(200)
  })
})
