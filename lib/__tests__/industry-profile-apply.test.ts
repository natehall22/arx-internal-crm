/** @jest-environment node */
import { DEFAULT_ORG_TRADES } from '@/lib/org-trades'

const calls: string[] = []
let storedSettings: { features: unknown; profile?: unknown } = { features: {} }
let trades: unknown = [...DEFAULT_ORG_TRADES]
let failProfileWrite = false

jest.mock('@/lib/org-features', () => {
  const actual = jest.requireActual('@/lib/org-features')
  return { ...actual, readOrgFeatureSettings: async () => storedSettings }
})
jest.mock('@/lib/org-trades-admin', () => {
  const actual = jest.requireActual('@/lib/org-trades-admin')
  return {
    ...actual,
    readOrgTradesForSeed: async () => trades,
    applyOrgTradesSeed: async (_c: unknown, _o: string, _u: string, plan: { insert: unknown[]; update: unknown[]; deactivate: unknown[] }) => {
      calls.push(`trades +${plan.insert.length} on${plan.update.length} off${plan.deactivate.length}`)
    },
  }
})
jest.mock('@/lib/org-settings', () => ({
  mergeOrgSettings: async (_c: unknown, _o: string, set: Record<string, unknown>, opts: { path?: string[]; remove?: string[] }) => {
    calls.push(`merge ${JSON.stringify(opts.path)} set=${JSON.stringify(set)} remove=${(opts.remove ?? []).length}`)
    if (failProfileWrite && opts.path?.[0] === 'profile') return { error: 'boom' }
    return { error: null }
  },
}))

let authProfile: Record<string, unknown> | null = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!authProfile) throw new Error('Unauthorized')
    return { profile: authProfile }
  },
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

import { applyIndustryProfile } from '@/lib/org-profile-server'
import { GET, POST } from '@/app/api/admin/industry-profile/route'

beforeEach(() => {
  calls.length = 0
  storedSettings = { features: {} }
  trades = [...DEFAULT_ORG_TRADES]
  failProfileWrite = false
  authProfile = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
})

describe('applyIndustryProfile', () => {
  it('trades (add-only) first, then the profile key last; feature switches untouched by default', async () => {
    const { plan } = await applyIndustryProfile({} as never, 'org-1', 'u1', 'lawn_landscape')
    expect(calls).toEqual(['trades +5 on0 off0', 'merge ["profile"] set={"id":"lawn_landscape","version":2} remove=0'])
    expect(plan.to.id).toBe('lawn_landscape')
  })

  it('resetFeatures removes only the saved switch keys, before the profile key', async () => {
    storedSettings = { features: { canvassing: true } }
    await applyIndustryProfile({} as never, 'org-1', 'u1', 'lawn_landscape', { resetFeatures: true })
    expect(calls.slice(1)).toEqual(['merge ["features"] set={} remove=8', 'merge ["profile"] set={"id":"lawn_landscape","version":2} remove=0'])
  })

  it('trades table missing: trades skipped, profile still recorded', async () => {
    trades = null
    await applyIndustryProfile({} as never, 'org-1', 'u1', 'exterior_cleaning')
    expect(calls).toEqual(['merge ["profile"] set={"id":"exterior_cleaning","version":2} remove=0'])
  })

  it('a failed profile write throws (the old profile keeps showing; re-run is safe)', async () => {
    failProfileWrite = true
    await expect(applyIndustryProfile({} as never, 'org-1', 'u1', 'lawn_landscape')).rejects.toThrow('profile: boom')
  })
})

describe('/api/admin/industry-profile', () => {
  const post = (body: unknown) => POST(new Request('https://crm.example/api/admin/industry-profile', { method: 'POST', body: JSON.stringify(body) }))
  const get = (q = '') => GET(new Request(`https://crm.example/api/admin/industry-profile${q}`))

  it('owners only: an admin who is not the owner, a disabled owner and a signed-out caller get 403 and nothing is written', async () => {
    for (const p of [{ id: 'u2', org_id: 'org-1', role: 'admin', is_super_admin: false, active: true }, { id: 'u3', org_id: 'org-1', role: 'admin', is_super_admin: true, active: false }, null]) {
      authProfile = p
      expect((await post({ profile: 'lawn_landscape' })).status).toBe(403)
      expect((await get('?to=lawn_landscape')).status).toBe(403)
    }
    expect(calls).toEqual([])
  })

  it('GET previews without writing; an unknown profile is refused', async () => {
    const res = await get('?to=lawn_landscape')
    const body = await res.json()
    expect(body.current.id).toBe('roofing')
    expect(body.profiles.map((p: { id: string }) => p.id)).toEqual(['roofing', 'lawn_landscape', 'exterior_cleaning', 'home_builder'])
    expect(body.plan.to.id).toBe('lawn_landscape')
    expect(calls).toEqual([])
    expect((await get('?to=nope')).status).toBe(400)
  })

  it('POST applies for the caller’s own company; bad input is refused', async () => {
    expect((await post({ profile: 'nope' })).status).toBe(400)
    expect((await post({ profile: 'lawn_landscape', resetFeatures: 'yes' })).status).toBe(400)
    expect(calls).toEqual([])
    const res = await post({ profile: 'lawn_landscape' })
    expect(res.status).toBe(200)
    expect(calls.at(-1)).toBe('merge ["profile"] set={"id":"lawn_landscape","version":2} remove=0')
  })
})
