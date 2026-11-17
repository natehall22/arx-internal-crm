/** @jest-environment node */
import fs from 'fs'
import path from 'path'

let profile: Record<string, unknown> = { id: 'u1', org_id: 'o1', role: 'admin', is_super_admin: false, active: true }
let authFails = false
let storedSettings: Record<string, unknown> = {}
let profileId = 'roofing'
let startCards: string[] | null = null
const saveDashboardCards = jest.fn(async (..._a: unknown[]) => ({ ok: true as const, cards: [] }))

jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => { if (authFails) throw new Error('no'); return { profile } } }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { settings: storedSettings } }) }) }) }) }),
}))
jest.mock('@/lib/org-profile', () => ({
  loadOrgProfile: async () => ({ id: profileId, features: null, dashboard: { cards: startCards } }),
}))
jest.mock('@/lib/dashboard-cards-server', () => ({ saveDashboardCards: (...a: unknown[]) => saveDashboardCards(...a) }))

import { DELETE, GET, PUT } from '@/app/api/admin/dashboard-cards/route'

const req = (url = 'http://x/api/admin/dashboard-cards', init?: RequestInit) => new Request(url, init)
const as = (over: Record<string, unknown>) => { profile = { id: 'u1', org_id: 'o1', role: 'admin', is_super_admin: false, active: true, ...over } }

beforeEach(() => {
  jest.clearAllMocks()
  authFails = false
  storedSettings = {}
  profileId = 'roofing'
  startCards = null
  as({})
})

describe('GET /api/admin/dashboard-cards', () => {
  it('401 without a session; 403 for anyone outside Dashboard settings (a salesperson, a crew lead)', async () => {
    authFails = true
    expect((await GET(req())).status).toBe(401)
    authFails = false
    for (const role of ['sales_rep', 'closer', 'crew_lead', 'setter']) {
      as({ role })
      expect((await GET(req())).status).toBe(403)
    }
  })
  it('regional and sales managers read it (the same people as Dashboard settings), but only the owner edits the classic sections', async () => {
    for (const role of ['regional_manager', 'sales_manager', 'admin']) {
      as({ role })
      const body = await (await GET(req())).json()
      expect(body.canEdit).toBe(false)
    }
    as({ role: 'admin', is_super_admin: true })
    expect((await (await GET(req())).json()).canEdit).toBe(true)
  })
  it('"Build a card dashboard instead" is never offered for a roofing company, even to its owner, and ?mode=cards does not open it', async () => {
    as({ is_super_admin: true })
    const body = await (await GET(req('http://x/api/admin/dashboard-cards?mode=cards'))).json()
    expect([body.canBuildCards, body.editingMode, body.mode]).toEqual([false, 'classic', 'classic'])
  })
  it('it is offered to the owner of another classic company, and to nobody else', async () => {
    profileId = 'home_builder'
    as({ is_super_admin: true })
    expect((await (await GET(req())).json()).canBuildCards).toBe(true)
    expect((await (await GET(req('http://x/a?mode=cards'))).json()).editingMode).toBe('cards')
    as({ is_super_admin: false })
    const body = await (await GET(req('http://x/a?mode=cards'))).json()
    expect([body.canBuildCards, body.editingMode]).toEqual([false, 'classic'])
  })
  it('an admin edits an existing card dashboard', async () => {
    profileId = 'lawn_landscape'
    startCards = ['win-rate']
    expect((await (await GET(req())).json()).canEdit).toBe(true)
  })
})

describe('PUT / DELETE hand the rules to the one writer with who is asking', () => {
  it('PUT passes owner, profile and the current dashboard type', async () => {
    as({ is_super_admin: true })
    await PUT(req('http://x', { method: 'PUT', body: JSON.stringify({ cards: [] }) }))
    expect(saveDashboardCards.mock.calls[0][4]).toEqual({ owner: true, profileId: 'roofing', currentMode: 'classic', startMode: 'classic' })
    as({ is_super_admin: false })
    await PUT(req('http://x', { method: 'PUT', body: '{}' }))
    expect((saveDashboardCards.mock.calls[1][4] as { owner: boolean }).owner).toBe(false)
  })
  it('a writer refusal comes back as its status', async () => {
    saveDashboardCards.mockResolvedValueOnce({ ok: false, error: 'Only the owner', status: 403 } as never)
    const res = await PUT(req('http://x', { method: 'PUT', body: '{}' }))
    expect(res.status).toBe(403)
  })
  it('a salesperson cannot write at all', async () => {
    as({ role: 'sales_rep' })
    expect((await PUT(req('http://x', { method: 'PUT', body: '{}' }))).status).toBe(403)
    expect((await DELETE()).status).toBe(403)
    expect(saveDashboardCards).not.toHaveBeenCalled()
  })
})

describe('opening the dashboard writes nothing', () => {
  it('the card loader never touches the clock-closing loaders', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/dashboard-cards-server.ts'), 'utf8')
    expect(src).not.toMatch(/autoCloseForgotten|loadTimeWeek/)
    const db = fs.readFileSync(path.join(process.cwd(), 'lib/time-tracking-db.ts'), 'utf8')
    const body = db.slice(db.indexOf('export async function loadWorkSecondsByStop'), db.indexOf('/** Roles the company actually uses'))
    expect(body.length).toBeGreaterThan(100)
    expect(body).not.toMatch(/autoCloseForgotten|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
  })
})
