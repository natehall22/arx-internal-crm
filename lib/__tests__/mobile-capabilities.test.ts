/**
 * @jest-environment node
 */
import { weatherOverlayFeatureEnabled } from '@/lib/weather-footprint'

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

jest.mock('@/lib/effective-permissions', () => ({
  resolveEffectivePermissionNames: jest.fn(),
  effectiveHasPermission: (
    result: { fullAccess: boolean; permissionNames: Set<string> },
    name: string
  ) => result.fullAccess || result.permissionNames.has(name),
}))

import { requireAuthApi } from '@/lib/auth'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { GET as territoriesGET } from '@/app/api/mobile/territories/route'
import { GET as capabilitiesGET } from '@/app/api/mobile/capabilities/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockResolveEffectivePermissionNames = resolveEffectivePermissionNames as jest.MockedFunction<
  typeof resolveEffectivePermissionNames
>

describe('mobile capabilities weather flag', () => {
  const original = process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY
    } else {
      process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY = original
    }
  })

  it('returns false when env flag unset', () => {
    delete process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY
    expect(weatherOverlayFeatureEnabled()).toBe(false)
  })

  it('returns true when env flag is true', () => {
    process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY = 'true'
    expect(weatherOverlayFeatureEnabled()).toBe(true)
  })
})

describe('mobile territories route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))

    const res = await territoriesGET()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRequireAuthApi).toHaveBeenCalledTimes(1)
  })
})

describe('mobile capabilities route — inside-sales app lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'user-1', email: 'rep@example.com' },
      profile: { id: 'user-1', org_id: 'org-1', role: 'closer', custom_role_id: null } as never,
    } as never)
  })

  it('denies app_access for inside-sales queue workers (opportunities:view + leads:claim_inbound)', async () => {
    mockResolveEffectivePermissionNames.mockResolvedValue({
      fullAccess: false,
      permissionNames: new Set(['opportunities:view', 'opportunities:edit', 'leads:claim_inbound', 'leads:view_inbound']),
    })

    const res = await capabilitiesGET()
    const body = await res.json()

    expect(body.app_access).toBe(false)
    expect(body.opportunities_tab).toBe(false)
    expect(body.measure_tab).toBe(false)
  })

  it('grants app_access for a closer with opportunities:view but no inbound-claim permission', async () => {
    mockResolveEffectivePermissionNames.mockResolvedValue({
      fullAccess: false,
      permissionNames: new Set(['opportunities:view', 'opportunities:edit']),
    })

    const res = await capabilitiesGET()
    const body = await res.json()

    expect(body.app_access).toBe(true)
    expect(body.opportunities_tab).toBe(true)
    expect(body.measure_tab).toBe(true)
  })

  it('grants app_access for a setter with neither permission', async () => {
    mockResolveEffectivePermissionNames.mockResolvedValue({
      fullAccess: false,
      permissionNames: new Set(),
    })

    const res = await capabilitiesGET()
    const body = await res.json()

    expect(body.app_access).toBe(true)
    expect(body.opportunities_tab).toBe(false)
    expect(body.measure_tab).toBe(false)
  })

  it('grants app_access for full-access roles (admin/owner) regardless of permission set', async () => {
    mockResolveEffectivePermissionNames.mockResolvedValue({
      fullAccess: true,
      permissionNames: new Set(),
    })

    const res = await capabilitiesGET()
    const body = await res.json()

    expect(body.app_access).toBe(true)
  })
})
