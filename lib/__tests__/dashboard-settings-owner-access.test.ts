/** @jest-environment node */
import { NextRequest } from 'next/server'

let profile: Record<string, unknown> = {}
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) } }) }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'order', 'in']) q[m] = () => q
    q.single = async () => ({ data: profile, error: null })
    q.maybeSingle = async () => ({ data: null, error: null })
    q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null })
    return { from: () => q }
  },
}))

import { GET, POST } from '@/app/api/admin/dashboard-settings/route'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'k'
const cookie = `sb-ref-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 't' }))}`
const get = () => GET(new NextRequest('http://x/api/admin/dashboard-settings', { headers: { cookie } }))
const write = (fn: typeof POST) => fn(new NextRequest('http://x/api/admin/dashboard-settings', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'org', settings: {} }) }))

describe('dashboard settings: who gets in', () => {
  it('an owner whose role is not admin / manager is let in (read and write), like the cards route', async () => {
    for (const p of [{ role: 'owner', is_super_admin: false }, { role: 'sales_rep', is_super_admin: true }]) {
      profile = { id: 'u1', org_id: 'o1', active: true, ...p }
      expect((await get()).status).not.toBe(403)
      for (const fn of [POST]) expect((await write(fn)).status).not.toBe(403)
    }
  })
  it('a deactivated super admin and an ordinary salesperson are still refused', async () => {
    for (const p of [{ role: 'sales_rep', is_super_admin: true, active: false }, { role: 'sales_rep', is_super_admin: false, active: true }]) {
      profile = { id: 'u1', org_id: 'o1', ...p }
      expect((await get()).status).toBe(403)
      for (const fn of [POST]) expect((await write(fn)).status).toBe(403)
    }
  })
})
