/** @jest-environment node */
const profileRef: { current: Record<string, unknown> } = { current: { id: 'owner-1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true } }
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: profileRef.current, authUser: { id: 'owner-1' } }) }))

type Call = { table: string; op: string; payload?: unknown }
const calls: Call[] = []
let existing: Record<string, unknown>[] = []
let auditFails = false

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const state: { op: string; payload?: unknown } = { op: 'select' }
      const q: Record<string, any> = {}
      for (const m of ['select', 'eq', 'is', 'neq', 'order', 'limit']) q[m] = () => q
      q.insert = (payload: unknown) => { state.op = 'insert'; state.payload = payload; calls.push({ table, op: 'insert', payload }); return q }
      q.update = (payload: unknown) => { state.op = 'update'; state.payload = payload; calls.push({ table, op: 'update', payload }); return q }
      q.delete = () => { state.op = 'delete'; calls.push({ table, op: 'delete' }); return q }
      q.maybeSingle = async () => {
        if (state.op === 'insert' || state.op === 'update') return { data: { id: 'v-new', ...(state.payload as object) }, error: null }
        return { data: existing[0] ?? null, error: null }
      }
      q.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'supplier_audit_log' && state.op === 'insert') return resolve({ error: auditFails ? { message: 'x' } : null })
        if (table === 'vendors' && state.op === 'select') return resolve({ data: existing, error: null })
        if (state.op === 'update' || state.op === 'delete') return resolve({ error: null })
        return resolve({ data: [], error: null })
      }
      return q
    },
  }),
}))

import { POST } from '@/app/api/admin/suppliers/route'

const post = (body: unknown) => new Request('https://crm.test/api/admin/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never

beforeEach(() => {
  calls.length = 0
  existing = []
  auditFails = false
  profileRef.current = { id: 'owner-1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
})

describe('POST /api/admin/suppliers', () => {
  it('403 for anyone who is not an owner', async () => {
    profileRef.current = { id: 'u', org_id: 'org-1', role: 'admin', is_super_admin: false, active: true }
    const res = await POST(post({ name: 'ABC' }))
    expect(res?.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('400 on a bad email and writes nothing', async () => {
    const res = await POST(post({ name: 'ABC', order_email: 'not-an-email' }))
    expect(res?.status).toBe(400)
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  it('creates the supplier and logs who/what', async () => {
    const res = await POST(post({ name: 'ABC Supply', order_email: 'o@abc.com', default_for_trades: ['roofing'] }))
    expect(res?.status).toBe(200)
    const log = calls.find((c) => c.table === 'supplier_audit_log')
    expect(log?.payload).toMatchObject({ org_id: 'org-1', vendor_id: 'v-new', action: 'created', changed_by: 'owner-1' })
    expect(JSON.stringify((log?.payload as any).changes)).toContain('o@abc.com')
  })

  it('refuses a duplicate name', async () => {
    existing = [{ id: 'other', name: 'abc supply', active: true, default_for_trades: [] }]
    const res = await POST(post({ name: 'ABC Supply' }))
    expect(res?.status).toBe(409)
  })

  it('refuses two active defaults for one trade', async () => {
    existing = [{ id: 'other', name: 'QXO', active: true, default_for_trades: ['roofing'] }]
    const res = await POST(post({ name: 'ABC Supply', default_for_trades: ['roofing'] }))
    expect(res?.status).toBe(409)
  })

  it('does not keep a change it could not log', async () => {
    auditFails = true
    const res = await POST(post({ name: 'ABC Supply' }))
    expect(res?.status).toBe(500)
    expect(calls.some((c) => c.table === 'vendors' && c.op === 'delete')).toBe(true)
  })
})
