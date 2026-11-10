/** @jest-environment node */
import { NextRequest } from 'next/server'

let superAdmin = true
let role = 'admin'
const updates: Array<Record<string, unknown>> = []
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args })
      return { data: null, error: null }
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        single: async () =>
          table === 'users'
            ? { data: { org_id: 'org-1', role, is_super_admin: superAdmin, active: true }, error: null }
            : { data: { settings: { features: { canvassing: false }, other: 1 } }, error: null },
        update: (row: Record<string, unknown>) => {
          updates.push(row)
          return { eq: async () => ({ error: null }) }
        },
      }
      return q
    },
  }),
}))

import { PATCH } from '@/app/api/admin/settings/route'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
const cookie = `sb-ref-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 't' }))}`
const patch = (body: unknown) =>
  PATCH(new NextRequest('https://crm.example/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }))

beforeEach(() => {
  superAdmin = true
  role = 'admin'
  updates.length = 0
  rpcs.length = 0
})

it('owner: writes only the sent switch, per key at path [features]', async () => {
  const res = await patch({ type: 'features', features: { insurance: false } })
  expect(res.status).toBe(200)
  expect(rpcs).toEqual([{ fn: 'merge_org_settings', args: { p_org_id: 'org-1', p_path: ['features'], p_set: { insurance: false }, p_remove: [] } }])
  expect(updates).toEqual([])
})

it('anyone who is not a super admin (even role admin) is refused', async () => {
  superAdmin = false
  const res = await patch({ type: 'features', features: { insurance: false } })
  expect(res.status).toBe(403)
  expect(rpcs).toEqual([])
})

it('bad input is refused', async () => {
  expect((await patch({ type: 'features', features: { nope: false } })).status).toBe(400)
  expect((await patch({ type: 'features', features: { canvassing: 'no' } })).status).toBe(400)
})

it('the generic managers settings save cannot write features (stored switches are kept)', async () => {
  superAdmin = false
  role = 'sales_manager'
  const res = await patch({ type: 'settings', features: { canvassing: true }, foo: 2 })
  expect(res.status).toBe(200)
  expect(updates).toEqual([{ settings: { features: { canvassing: false }, other: 1, foo: 2 } }])
})
