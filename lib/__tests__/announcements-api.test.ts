/** @jest-environment node */
const profileRef: { current: Record<string, unknown> } = { current: { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true } }
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: profileRef.current, authUser: { id: 'u1' } }) }))

type Op = { table: string; op: string; payload?: unknown }
const ops: Op[] = []
let announcements: Record<string, unknown>[] = []
let dismissals: Record<string, unknown>[] = []

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const st: { op: string; payload?: unknown } = { op: 'select' }
      const q: Record<string, any> = {}
      for (const m of ['select', 'eq', 'lte', 'gt', 'order', 'limit']) q[m] = () => q
      q.upsert = (payload: unknown) => { st.op = 'upsert'; ops.push({ table, op: 'upsert', payload }); return q }
      q.insert = (payload: unknown) => { st.op = 'insert'; ops.push({ table, op: 'insert', payload }); return q }
      q.update = (payload: unknown) => { st.op = 'update'; ops.push({ table, op: 'update', payload }); return q }
      q.maybeSingle = async () => ({ data: st.op === 'insert' || st.op === 'update' ? { id: 'new' } : announcements[0] ?? null, error: null })
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === 'announcements' ? announcements : table === 'announcement_dismissals' ? dismissals : table === 'users' ? [{ id: 'u1', full_name: 'Nathan', role: 'admin', active: true }, { id: 'u2', full_name: 'Setter Sam', role: 'setter', active: true }] : [], error: null })
      return q
    },
  }),
}))

import { GET as active } from '@/app/api/announcements/active/route'
import { POST as dismiss } from '@/app/api/announcements/[id]/dismiss/route'
import { GET as adminList, POST as adminSave } from '@/app/api/admin/announcements/route'

const ann = { id: '11111111-1111-4111-8111-111111111111', title: "What's new", body: { owner: ['Owner line'], setter: ['Setter line'] }, link_url: '/whats-new', starts_at: '2020-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z', active: true }

beforeEach(() => {
  ops.length = 0
  announcements = [ann]
  dismissals = []
  profileRef.current = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
})

describe('GET /api/announcements/active', () => {
  it('returns this role’s copy', async () => {
    const j = await (await active())!.json()
    expect(j.announcement).toMatchObject({ id: ann.id, lines: ['Owner line'], link: '/whats-new' })
  })
  it('returns nothing once the user has dismissed it', async () => {
    dismissals = [{ announcement_id: ann.id }]
    expect((await (await active())!.json()).announcement).toBeNull()
  })
})

describe('POST /api/announcements/[id]/dismiss', () => {
  it('saves the dismissal per user in the database', async () => {
    const res = await dismiss(new Request('https://x.test') as never, { params: { id: ann.id } })
    expect(res.status).toBe(200)
    expect(ops.find((o) => o.op === 'upsert')?.payload).toMatchObject({ org_id: 'org-1', announcement_id: ann.id, user_id: 'u1' })
  })
  it('404 for a non-uuid', async () => {
    expect((await dismiss(new Request('https://x.test') as never, { params: { id: 'nope' } })).status).toBe(404)
  })
})

describe('owner editor', () => {
  const body = { slug: 'whats-new-2026-10', title: "What's new", starts_at: '2026-10-22T12:00:00Z', ends_at: '2026-11-05T12:00:00Z', body: { owner: ['One'] } }
  const post = (b: unknown) => new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }) as never
  it('is owners only', async () => {
    profileRef.current = { id: 'u', org_id: 'org-1', role: 'admin', is_super_admin: false, active: true }
    expect((await adminList())!.status).toBe(403)
    expect((await adminSave(post(body)))!.status).toBe(403)
    expect(ops).toEqual([])
  })
  it('creates a validated announcement', async () => {
    expect((await adminSave(post(body)))!.status).toBe(200)
    expect(ops.find((o) => o.op === 'insert')?.payload).toMatchObject({ org_id: 'org-1', slug: 'whats-new-2026-10', created_by: 'u1' })
  })
  it('rejects an external link', async () => {
    expect((await adminSave(post({ ...body, link_url: 'https://evil.example' })))!.status).toBe(400)
  })
  it('lists who has and has not dismissed', async () => {
    dismissals = [{ announcement_id: ann.id, user_id: 'u1', dismissed_at: '2026-10-23T00:00:00Z' }]
    const j = await (await adminList())!.json()
    expect(j.announcements[0].dismissed.map((p: { name: string }) => p.name)).toEqual(['Nathan'])
    expect(j.announcements[0].not_dismissed.map((p: { name: string }) => p.name)).toEqual(['Setter Sam'])
  })
})
