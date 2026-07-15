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
import { POST as pushTokenPOST, DELETE as pushTokenDELETE } from '@/app/api/mobile/push-token/route'
import { NextRequest } from 'next/server'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>

function makeRequest(method: string, body: unknown): NextRequest {
  return {
    json: async () => body,
    method,
  } as unknown as NextRequest
}

describe('POST/DELETE /api/mobile/push-token', () => {
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

  it('POST returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await pushTokenPOST(
      makeRequest('POST', { device_token: 'a'.repeat(64), environment: 'sandbox' })
    )
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('DELETE returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await pushTokenDELETE(makeRequest('DELETE', { device_token: 'a'.repeat(64) }))
    expect(res.status).toBe(401)
  })

  it('POST upserts token idempotently on (user_id, device_token)', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-1', email: 'rep@example.com' },
      profile: { id: 'user-1', org_id: 'org-1', role: 'canvasser' } as never,
    } as never)

    const upsert = jest.fn().mockResolvedValue({ error: null })
    const from = jest.fn().mockReturnValue({ upsert })
    mockCreateClient.mockReturnValue({ from } as never)

    const token = 'b'.repeat(64)
    const req = makeRequest('POST', {
      device_token: token,
      platform: 'ios',
      environment: 'sandbox',
    })

    const res1 = await pushTokenPOST(req)
    const res2 = await pushTokenPOST(
      makeRequest('POST', { device_token: token, platform: 'ios', environment: 'sandbox' })
    )

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        org_id: 'org-1',
        device_token: token,
        platform: 'ios',
        environment: 'sandbox',
      }),
      { onConflict: 'user_id,device_token' }
    )
    expect(from).toHaveBeenCalledWith('mobile_device_tokens')
  })
})
