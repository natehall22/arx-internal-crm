/** @jest-environment node */
/**
 * The time clock doors: the crew phone link only works when the company uses the clock (and a sub crew gets nothing),
 * the signed-in clock and the office list are behind the company switch, the office list is payroll admins only,
 * and settings are owners only. The writer itself is covered in time-tracking-db.test.ts.
 */
let featureOn = true
let crew: { orgId: string; subId: string } | null = { orgId: 'org1', subId: 's1' }
let profile: Record<string, unknown> | null = { id: 'u1', org_id: 'org1', role: 'admin', is_super_admin: false, active: true }
const applied: unknown[] = []

jest.mock('@/lib/service-plans-access', () => ({ activeCrewDay: async () => crew }))
jest.mock('@/lib/org-features-server', () => ({
  isOrgFeatureOn: async () => featureOn,
  orgFeatureOffResponse: async () => {
    const { NextResponse } = await import('next/server')
    return featureOn ? null : NextResponse.json({ error: 'off', code: 'feature_off' }, { status: 403 })
  },
}))
jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!profile) throw new Error('no session')
    return { profile, authUser: { id: profile.id } }
  },
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/time-tracking-db', () => ({
  loadClockState: async (_a: unknown, actor: unknown) => ({ ready: true, people: [], actor }),
  applyClockTap: async (_a: unknown, actor: unknown, tap: unknown) => {
    applied.push({ actor, tap })
    return { ok: true, done: 1 }
  },
  loadTimeWeek: async () => ({ ready: true, people: [] }),
  addTimeEntry: async () => ({ ok: true, id: 'e1' }),
  loadClockConfig: async () => ({ settings: { autoCloseHours: 12 }, timeZone: 'UTC' }),
  loadSelfClockRoleChoices: async () => ['operations'],
}))
jest.mock('@/lib/org-settings', () => ({ mergeOrgSettings: async () => ({ error: null }) }))

import * as crewClock from '@/app/api/crew/day/[token]/clock/route'
import * as myClock from '@/app/api/time/clock/route'
import * as office from '@/app/api/admin/time/route'
import * as settings from '@/app/api/admin/time/settings/route'

const tapBody = { tapId: 'tap-00000001', action: 'clock_out', userIds: ['aaaaaaaa-0000-4000-8000-000000000001'], at: '2026-06-10T15:00:00.000Z', deviceNow: '2026-06-10T15:00:00.000Z' }
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  featureOn = true
  crew = { orgId: 'org1', subId: 's1' }
  profile = { id: 'u1', org_id: 'org1', role: 'admin', is_super_admin: false, active: true }
  applied.length = 0
})

describe('crew phone link clock', () => {
  it('works for a live link when the company uses the clock; the link decides the crew, never the body', async () => {
    const res = await crewClock.POST(post({ ...tapBody, subId: 'someone-else' }), { params: { token: 't' } })
    expect(res.status).toBe(200)
    expect(applied[0]).toMatchObject({ actor: { via: 'crew_link', orgId: 'org1', subId: 's1' } })
  })
  it('a dead link or a company without the clock gets 404, marked permanent so the phone stops retrying', async () => {
    crew = null
    const r1 = await crewClock.POST(post(tapBody), { params: { token: 't' } })
    expect(r1.status).toBe(404)
    expect(await r1.json()).toMatchObject({ permanent: true })
    crew = { orgId: 'org1', subId: 's1' }
    featureOn = false
    expect((await crewClock.GET(new Request('http://x'), { params: { token: 't' } })).status).toBe(404)
    expect(applied).toHaveLength(0)
  })
  it('a malformed tap is a permanent 400', async () => {
    const res = await crewClock.POST(post({ action: 'clock_in' }), { params: { token: 't' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ permanent: true })
  })
})

describe('signed-in clock', () => {
  it('acts as the signed-in person; 401 signed out; 403 with the switch off', async () => {
    expect((await myClock.POST(post(tapBody))).status).toBe(200)
    expect(applied[0]).toMatchObject({ actor: { via: 'signed_in', orgId: 'org1', userId: 'u1' } })
    profile = null
    expect((await myClock.GET()).status).toBe(401)
    profile = { id: 'u1', org_id: 'org1', role: 'setter' }
    featureOn = false
    expect((await myClock.GET()).status).toBe(403)
  })
})

describe('office + settings', () => {
  it('the time list is payroll admins only', async () => {
    expect((await office.GET(new Request('http://x/api/admin/time'))).status).toBe(200)
    profile = { id: 'u2', org_id: 'org1', role: 'sales_manager' }
    expect((await office.GET(new Request('http://x/api/admin/time'))).status).toBe(403)
    expect((await office.POST(post({ reason: 'x' }))).status).toBe(403)
  })
  it('settings are owners only', async () => {
    expect((await settings.GET()).status).toBe(403)
    profile = { id: 'u1', org_id: 'org1', role: 'admin', is_super_admin: true, active: true }
    expect((await settings.GET()).status).toBe(200)
    const bad = await settings.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ timeTracking: { autoCloseHours: 100 } }) }))
    expect(bad.status).toBe(400)
  })
})
