/** @jest-environment node */
/** Truck sheet routes: a crew's phone link reaches only its own crew's sheet; the office routes need job-board / jobs:edit and a valid day. */
const mockCrew = jest.fn()
const mockBuild = jest.fn()
const mockAuth = jest.fn()
const mockSaveNote = jest.fn()
const mockLoadNote = jest.fn()
const mockSaveVisit = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/service-plans-access', () => ({ activeCrewDay: (...a: unknown[]) => mockCrew(...a), servicePlanRouteAuth: (...a: unknown[]) => mockAuth(...a) }))
jest.mock('@/lib/crew-day-sheet', () => ({ buildCrewDaySheet: (...a: unknown[]) => mockBuild(...a) }))
jest.mock('@/lib/pdf/crew-day-sheet', () => ({ generateCrewDaySheetPDF: () => Buffer.from('%PDF') }))
jest.mock('@/lib/truck-sheet-db', () => ({
  loadCrewDayNote: (...a: unknown[]) => mockLoadNote(...a),
  saveCrewDayNote: (...a: unknown[]) => mockSaveNote(...a),
  saveVisitEquipment: (...a: unknown[]) => mockSaveVisit(...a),
  loadVisitEquipmentView: async () => null,
}))
jest.mock('@/lib/time-tracking-db', () => ({ loadEquipmentChoices: async () => [] }))
jest.mock('@/lib/supabase/org-db', () => ({ orgDb: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' } }) }) }) }) }) }))

import { GET as crewSheet } from '@/app/api/crew/day/[token]/sheet/route'
import { GET as noteGet, POST as notePost } from '@/app/api/ops/visits/crew-note/route'
import { POST as equipmentPost } from '@/app/api/ops/visits/[id]/equipment/route'

const json = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
const forbidden = () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })

beforeEach(() => {
  jest.resetAllMocks()
  mockCrew.mockImplementation(async (_a: unknown, t: string) => (t === 'tok-s1' ? { orgId: 'o1', subId: 's1', crewName: 'Crew One' } : t === 'tok-s2' ? { orgId: 'o1', subId: 's2', crewName: 'Crew Two' } : null))
  mockBuild.mockResolvedValue({})
  mockAuth.mockResolvedValue({ admin: {}, orgId: 'o1', userId: 'u1' })
})

describe('crew phone link sheet', () => {
  it('a dead token is 404 and builds nothing', async () => {
    const r = await crewSheet(new Request('http://x'), { params: { token: 'nope' } })
    expect(r.status).toBe(404)
    expect(mockBuild).not.toHaveBeenCalled()
  })
  it('each token builds only its own crew’s sheet (the crew id comes from the token, never the request)', async () => {
    await crewSheet(new Request('http://x?crew=s2&day=2026-01-01'), { params: { token: 'tok-s1' } })
    expect(mockBuild).toHaveBeenCalledTimes(1)
    expect(mockBuild).toHaveBeenLastCalledWith({}, 'o1', expect.objectContaining({ subId: 's1', crewName: 'Crew One' }))
    await crewSheet(new Request('http://x'), { params: { token: 'tok-s2' } })
    expect(mockBuild).toHaveBeenLastCalledWith({}, 'o1', expect.objectContaining({ subId: 's2' }))
  })
})

describe('office note route', () => {
  it('writing needs jobs:edit (a refusal from the guard passes through, nothing saved)', async () => {
    mockAuth.mockResolvedValueOnce(forbidden())
    const r = await notePost(json({ crew: 's1', day: '2026-11-10', note: 'hi' }))
    expect(r.status).toBe(403)
    expect(mockAuth).toHaveBeenCalledWith('edit')
    expect(mockSaveNote).not.toHaveBeenCalled()
  })
  it('a bad day or missing crew is 400; a good save goes to the one writer with the signed-in person and company', async () => {
    expect((await notePost(json({ crew: 's1', day: 'tomorrow', note: 'hi' }))).status).toBe(400)
    expect((await notePost(json({ day: '2026-11-10', note: 'hi' }))).status).toBe(400)
    mockSaveNote.mockResolvedValue({ ok: true, note: 'hi' })
    const r = await notePost(json({ crew: 's1', day: '2026-11-10', note: 'hi' }))
    expect(r.status).toBe(200)
    expect(mockSaveNote).toHaveBeenCalledWith({}, 'o1', 'u1', 's1', '2026-11-10', 'hi')
  })
  it('a refusal from the writer (a crew of another company) keeps its status', async () => {
    mockSaveNote.mockResolvedValue({ ok: false, status: 404, error: 'Crew not found' })
    expect((await notePost(json({ crew: 'sx', day: '2026-11-10', note: 'hi' }))).status).toBe(404)
  })
  it('reading needs only view access and returns just the text', async () => {
    mockLoadNote.mockResolvedValue({ note: 'Bring the hose', updatedAt: 'x' })
    const r = await noteGet(new Request('http://x?crew=s1&day=2026-11-10'))
    expect(mockAuth).toHaveBeenCalledWith('view')
    expect(await r.json()).toEqual({ note: 'Bring the hose' })
    expect((await noteGet(new Request('http://x?crew=s1'))).status).toBe(400)
  })
})

describe('visit machines route', () => {
  it('needs jobs:edit and names the machines; a missing list is 400', async () => {
    mockAuth.mockResolvedValueOnce(forbidden())
    expect((await equipmentPost(json({ equipment_item_ids: [] }), { params: { id: 'v1' } })).status).toBe(403)
    expect(mockSaveVisit).not.toHaveBeenCalled()
    expect((await equipmentPost(json({}), { params: { id: 'v1' } })).status).toBe(400)
    mockSaveVisit.mockResolvedValue({ ok: true, ids: null })
    expect((await equipmentPost(json({ equipment_item_ids: null }), { params: { id: 'v1' } })).status).toBe(200)
    expect(mockSaveVisit).toHaveBeenCalledWith({}, 'o1', 'v1', null)
  })
})
