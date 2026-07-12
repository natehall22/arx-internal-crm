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

import { requireAuthApi } from '@/lib/auth'
import { POST as leaderboardPOST } from '@/app/api/sisu/leaderboard/route'
import { GET as badgesGET } from '@/app/api/sisu/badges/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>

function fakeRequest(url: string, body?: unknown) {
  return {
    nextUrl: new URL(url),
    json: async () => body ?? {},
  } as unknown as Parameters<typeof leaderboardPOST>[0]
}

describe('Sisu routes accept bearer auth (iOS) and reject unauthenticated', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('leaderboard: returns 401 when requireAuthApi throws (no cookie or bearer session)', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))

    const res = await leaderboardPOST(fakeRequest('https://x.test/api/sisu/leaderboard'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRequireAuthApi).toHaveBeenCalledTimes(1)
  })

  it('badges: returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))

    const res = await badgesGET(
      fakeRequest('https://x.test/api/sisu/badges?userId=11111111-1111-1111-1111-111111111111')
    )
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRequireAuthApi).toHaveBeenCalledTimes(1)
  })

  it('badges: rejects a non-UUID userId with 400 (checked before any DB call)', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-1', email: 'rep@example.com' },
      profile: { id: 'user-1', org_id: 'org-1' } as never,
    } as never)

    const res = await badgesGET(fakeRequest('https://x.test/api/sisu/badges?userId=not-a-uuid'))
    expect(res.status).toBe(400)
  })
})
