/** @jest-environment node */
/**
 * AI connector phase 2 — the human click. The ONLY door that saves an AI change is the signed-in person's own browser
 * request: an AI app (bearer key, no session, no browser origin) can never reach it, and injected text cannot click.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const mockAuth = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: () => mockAuth() }))
const mockApprove = jest.fn(async (..._a: unknown[]) => ({ data: { status: 'saved', summary: 'done', records: [] } }))
const mockDecline = jest.fn(async (..._a: unknown[]) => ({ data: { status: 'declined' } }))
jest.mock('@/lib/ai-connector/changes-review', () => ({
  approveAiChange: (...a: unknown[]) => mockApprove(...a),
  declineAiChange: (...a: unknown[]) => mockDecline(...a),
  personContext: async (b: object) => ({ ...b, writesAllowed: true }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

import { POST } from '@/app/api/ai-changes/[id]/route'
import { loadAiChangesQueue } from '@/lib/today'

const ID = '11111111-1111-1111-1111-111111111111'
const req = (headers: Record<string, string>, body: unknown = { decision: 'approve' }) =>
  new Request(`https://acme.crm.test/api/ai-changes/${ID}`, { method: 'POST', headers: { host: 'acme.crm.test', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const call = (r: Request) => POST(r, { params: { id: ID } })

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue({ profile: { id: 'u1', org_id: 'org-a' } })
  mockApprove.mockClear()
  mockDecline.mockClear()
})

describe('POST /api/ai-changes/[id]', () => {
  it('an AI app (bearer key, no browser origin) can never approve', async () => {
    mockAuth.mockRejectedValue(new Error('Unauthorized'))
    const res = await call(req({ authorization: 'Bearer aat_whatever' }))
    expect([401, 403]).toContain(res.status)
    expect(mockApprove).not.toHaveBeenCalled()
  })
  it('no Origin header → refused even with a session; another site → refused', async () => {
    expect((await call(req({}))).status).toBe(403)
    expect((await call(req({ origin: 'https://evil.test' }))).status).toBe(403)
    expect(mockApprove).not.toHaveBeenCalled()
  })
  it('no session → 401, nothing approved', async () => {
    mockAuth.mockRejectedValue(new Error('Unauthorized'))
    expect((await call(req({ origin: 'https://acme.crm.test' }))).status).toBe(401)
    expect(mockApprove).not.toHaveBeenCalled()
  })
  it('only approve or decline are accepted', async () => {
    expect((await call(req({ origin: 'https://acme.crm.test' }, { decision: 'yes' }))).status).toBe(400)
    expect((await call(req({ origin: 'https://acme.crm.test' }, {}))).status).toBe(400)
    expect(mockApprove).not.toHaveBeenCalled()
  })
  it('the person in their own browser: approve and decline reach the engine as THEM (id from the session, never the body)', async () => {
    const ok = await call(req({ origin: 'https://acme.crm.test' }, { decision: 'approve', userId: 'someone-else' }))
    expect(ok.status).toBe(200)
    expect(mockApprove.mock.calls[0][0]).toMatchObject({ userId: 'u1', orgId: 'org-a' })
    expect(mockApprove.mock.calls[0][1]).toBe(ID)
    await call(req({ origin: 'https://acme.crm.test' }, { decision: 'decline' }))
    expect(mockDecline).toHaveBeenCalledTimes(1)
  })
})

describe('Today: AI changes waiting for approval', () => {
  it('lists only MY pending, unexpired changes (titles only), linking to the review page', async () => {
    const future = '2099-01-01T00:00:00Z'
    const db = createFakeDb({
      ai_changes: [
        { id: 'a', org_id: 'org-a', user_id: 'u1', status: 'pending', expires_at: future, preview: { title: 'Add a note' }, created_at: '2026-11-15T12:00:00Z' },
        { id: 'b', org_id: 'org-a', user_id: 'u2', status: 'pending', expires_at: future, preview: { title: 'Not mine' }, created_at: '2026-11-15T12:00:00Z' },
        { id: 'c', org_id: 'org-a', user_id: 'u1', status: 'applied', expires_at: future, preview: { title: 'Done' }, created_at: '2026-11-15T12:00:00Z' },
        { id: 'd', org_id: 'org-a', user_id: 'u1', status: 'pending', expires_at: '2020-01-01T00:00:00Z', preview: { title: 'Old' }, created_at: '2026-11-15T12:00:00Z' },
        { id: 'e', org_id: 'org-b', user_id: 'u1', status: 'pending', expires_at: future, preview: { title: 'Other company' }, created_at: '2026-11-15T12:00:00Z' },
      ],
    })
    const q = await loadAiChangesQueue(db.client as never, 'org-a', 'u1', new Date('2026-11-15T13:00:00Z'))
    expect(q.items.map((i) => i.id)).toEqual(['a'])
    expect(q.items[0].href).toBe('/ai-changes/a')
    expect(q.count).toBe(1)
  })
})
