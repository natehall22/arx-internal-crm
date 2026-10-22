/** @jest-environment node */
const profileRef: { current: Record<string, unknown> } = { current: { id: 'owner-1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true } }
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: profileRef.current, authUser: { id: 'owner-1' } }) }))

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
let rpcResult: { data?: unknown; error?: { message: string } | null } = { data: { id: 'v1', updated_at: 't', changes: [], unchanged: false }, error: null }

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return rpcResult
    },
  }),
}))

import { POST } from '@/app/api/admin/suppliers/route'

const post = (body: unknown) => new Request('https://crm.test/api/admin/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never

beforeEach(() => {
  rpcCalls.length = 0
  rpcResult = { data: { id: 'v1', updated_at: 't', changes: [{ field: 'order_email', label: 'Order email', old: null, new: 'o@abc.com' }], unchanged: false }, error: null }
  profileRef.current = { id: 'owner-1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
})

describe('POST /api/admin/suppliers', () => {
  it('403 for anyone who is not an owner, and never reaches the database', async () => {
    profileRef.current = { id: 'u', org_id: 'org-1', role: 'admin', is_super_admin: false, active: true }
    const res = await POST(post({ name: 'ABC' }))
    expect(res?.status).toBe(403)
    expect(rpcCalls).toEqual([])
  })

  it('400 on a bad email and never reaches the database', async () => {
    const res = await POST(post({ name: 'ABC', order_email: 'not-an-email' }))
    expect(res?.status).toBe(400)
    expect(rpcCalls).toEqual([])
  })

  it('saves through the ONE atomic database function, with the actor, org and stale-form token', async () => {
    const res = await POST(post({ id: '11111111-1111-4111-8111-111111111111', updated_at: '2026-10-22T10:00:00Z', name: 'ABC Supply', order_email: 'o@abc.com', default_for_trades: ['roofing', 'gutters'] }))
    expect(res?.status).toBe(200)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('save_supplier')
    expect(rpcCalls[0].args).toMatchObject({ p_org: 'org-1', p_actor: 'owner-1', p_id: '11111111-1111-4111-8111-111111111111', p_expected_updated_at: '2026-10-22T10:00:00Z' })
    expect((rpcCalls[0].args.p_input as Record<string, unknown>).default_for_trades).toEqual(['roofing', 'gutters'])
    const json = await res!.json()
    expect(json.changes).toEqual(['Order email: (empty) → o@abc.com'])
  })

  it('an update without the version token is refused before the database', async () => {
    const res = await POST(post({ id: '11111111-1111-4111-8111-111111111111', name: 'ABC Supply' }))
    expect(res?.status).toBe(400)
    expect(rpcCalls).toEqual([])
  })

  it('a non-uuid id is a 404, not a 500', async () => {
    const res = await POST(post({ id: 'not-a-uuid', updated_at: 't', name: 'ABC Supply' }))
    expect(res?.status).toBe(404)
    expect(rpcCalls).toEqual([])
  })

  it.each([
    ['supplier_name_taken', 409, /already exists/],
    ['supplier_default_clash:QXO', 409, /QXO is already the default/],
    ['supplier_stale', 409, /changed by someone else/],
    ['supplier_not_found', 404, /not found/],
  ])('maps database error %s to plain English', async (message, status, text) => {
    rpcResult = { data: null, error: { message } }
    const res = await POST(post({ name: 'ABC Supply' }))
    expect(res?.status).toBe(status)
    expect((await res!.json()).error).toMatch(text)
  })

  it('an unexpected database error is a 500, not a leak', async () => {
    rpcResult = { data: null, error: { message: 'connection reset by peer 10.0.0.5' } }
    const res = await POST(post({ name: 'ABC Supply' }))
    expect(res?.status).toBe(500)
    expect(JSON.stringify(await res!.json())).not.toContain('10.0.0.5')
  })
})
