/** @jest-environment node */
import { NextRequest } from 'next/server'

let role = 'admin'
let superAdmin = true
let active: boolean | null = true
let storedSettings: Record<string, unknown> = {}
let rpcMissing = false
let storedAddress: string | null = 'a'
const updates: Array<Record<string, unknown>> = []
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (rpcMissing) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } }
      rpcs.push({ fn, args })
      return { data: null, error: null }
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        single: async () =>
          table === 'users'
            ? { data: { org_id: 'org-1', role, is_super_admin: superAdmin, active }, error: null }
            : { data: { settings: storedSettings }, error: null },
        maybeSingle: async () => ({ data: { address: storedAddress }, error: null }),
        update: (row: Record<string, unknown>) => {
          updates.push(row)
          return { eq: async () => ({ error: null }) }
        },
      }
      return q
    },
  }),
}))

import { GET, PATCH } from '@/app/api/admin/settings/route'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
const cookie = `sb-ref-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 't' }))}`
const patch = (body: unknown) =>
  PATCH(
    new NextRequest('https://crm.example/api/admin/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })
  )

const general = {
  type: 'general',
  company_name: 'ARX Roofing & Exteriors',
  company_phone: '(704) 313-8834',
  company_email: 'e',
  company_address: 'a',
  timezone: 'tz',
  date_format: 'MM/DD/YYYY',
  currency: 'USD',
}

beforeEach(() => {
  role = 'admin'
  superAdmin = true
  active = true
  rpcMissing = false
  storedAddress = 'a'
  updates.length = 0
  rpcs.length = 0
  storedSettings = { pricing: { p: 1 }, logo_url: 'org/x/logo.png', brand: { futureKey: 'keep', website: 'old.test', serviceArea: 'Old, NC' } }
})

it('super admin: columns saved without settings; brand goes through the atomic merge with only the sent keys', async () => {
  const res = await patch({ ...general, brand_short_name: 'ZZ', brand_service_area: '', brand_website: 'w'.repeat(200) })
  expect(res.status).toBe(200)
  expect(updates).toHaveLength(1)
  expect('settings' in updates[0]).toBe(false)
  expect(updates[0].name).toBe('ARX Roofing & Exteriors')
  expect(rpcs).toEqual([
    { fn: 'merge_org_settings', args: { p_org_id: 'org-1', p_path: ['brand'], p_set: { shortName: 'ZZ', website: 'w'.repeat(120) }, p_remove: ['serviceArea', 'serviceRegion'] } },
  ])
})

it('before the migration: falls back to read-merge-write and keeps the logo and every other key', async () => {
  rpcMissing = true
  const res = await patch({ ...general, brand_website: 'new.test' })
  expect(res.status).toBe(200)
  expect(updates).toHaveLength(2)
  expect(updates[1]).toEqual({
    settings: { pricing: { p: 1 }, logo_url: 'org/x/logo.png', brand: { futureKey: 'keep', website: 'new.test', serviceArea: 'Old, NC' } },
  })
})

it('a changed address clears its stored contract spelling, whoever saves (a manager too)', async () => {
  role = 'sales_manager'
  superAdmin = false
  storedAddress = '4101 Woodbury Ter NW'
  expect((await patch({ ...general, brand_website: 'ignored' })).status).toBe(200)
  expect(rpcs).toEqual([{ fn: 'merge_org_settings', args: { p_org_id: 'org-1', p_path: ['brand'], p_set: {}, p_remove: ['documentAddress'] } }])
})

it('a new legal name (super admin) clears the stored contract legal name in the same merge', async () => {
  expect((await patch({ ...general, brand_legal_name: 'New Co, LLC' })).status).toBe(200)
  expect(rpcs).toEqual([
    { fn: 'merge_org_settings', args: { p_org_id: 'org-1', p_path: ['brand'], p_set: { legalName: 'New Co, LLC' }, p_remove: ['documentLegalName'] } },
  ])
})

it('general save with no brand fields does not touch settings', async () => {
  await patch(general)
  expect(updates).toHaveLength(1)
  expect('settings' in updates[0]).toBe(false)
  expect(rpcs).toHaveLength(0)
})

it.each([
  ['admin, not super admin', 'admin', false, true],
  ['regional_manager', 'regional_manager', false, true],
  ['sales_manager', 'sales_manager', false, true],
  ['deactivated super admin', 'admin', true, false],
])('%s: brand keys ignored, rest of the save still succeeds', async (_label, r, sa, act) => {
  role = r
  superAdmin = sa
  active = act
  const res = await patch({ ...general, brand_website: 'evil.test', brand_short_name: 'X' })
  expect(res.status).toBe(200)
  expect(updates).toHaveLength(1)
  expect(updates[0].name).toBe('ARX Roofing & Exteriors')
  expect('settings' in updates[0]).toBe(false)
  expect(rpcs).toHaveLength(0)
})

it('the generic settings save can never write settings.brand', async () => {
  superAdmin = false
  await patch({ type: 'settings', brand: { website: 'evil.test' }, other: 1 })
  expect(updates).toHaveLength(1)
  expect(updates[0].settings).toEqual({ ...storedSettings, other: 1 })
})

it.each(['sales_rep', 'setter', 'operations', 'closer'])('%s still cannot save (403)', async (r) => {
  role = r
  expect((await patch({ ...general, brand_website: 'x' })).status).toBe(403)
  expect(updates).toHaveLength(0)
})

it.each(['admin', 'regional_manager', 'sales_manager'])('%s can still save', async (r) => {
  role = r
  expect((await patch({ ...general, brand_website: 'x' })).status).toBe(200)
})

it('GET tells the page whether brand fields are editable', async () => {
  const get = () => GET(new NextRequest('https://crm.example/api/admin/settings', { headers: { cookie } }))
  expect((await (await get()).json()).canEditBrand).toBe(true)
  superAdmin = false
  expect((await (await get()).json()).canEditBrand).toBe(false)
})

describe('job catch-up settings (type: job_catch_up) — admins / owners only, per-key merge', () => {
  it('admin saves the switch + working days through merge_org_settings at the top level', async () => {
    superAdmin = false
    const res = await patch({ type: 'job_catch_up', enabled: true, stuckDays: 10 })
    expect(res.status).toBe(200)
    expect(rpcs).toEqual([{ fn: 'merge_org_settings', args: { p_org_id: 'org-1', p_path: [], p_set: { job_catch_up_enabled: true, job_catch_up_stuck_days: 10 }, p_remove: [] } }])
    expect(updates).toHaveLength(0)
  })

  it('an owner (super admin) whose role is not on the managers list can save it', async () => {
    role = 'operations'
    superAdmin = true
    expect((await patch({ type: 'job_catch_up', enabled: false })).status).toBe(200)
  })

  it.each(['regional_manager', 'sales_manager', 'operations', 'setter', 'closer'])('%s cannot (403), nothing written', async (r) => {
    role = r
    superAdmin = false
    expect((await patch({ type: 'job_catch_up', enabled: true })).status).toBe(403)
    expect(rpcs).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('a deactivated admin cannot', async () => {
    active = false
    expect((await patch({ type: 'job_catch_up', enabled: true })).status).toBe(403)
  })

  it.each([[{}], [{ enabled: 'yes' }], [{ stuckDays: 0 }], [{ stuckDays: 61 }], [{ stuckDays: 2.5 }]])('bad input %j → 400, nothing written', async (body) => {
    expect((await patch({ type: 'job_catch_up', ...body })).status).toBe(400)
    expect(rpcs).toHaveLength(0)
  })

  it('before the migration: falls back to read-merge-write of only these keys', async () => {
    rpcMissing = true
    expect((await patch({ type: 'job_catch_up', enabled: true })).status).toBe(200)
    expect(updates).toEqual([{ settings: { ...storedSettings, job_catch_up_enabled: true } }])
  })

  it('the generic settings save (managers can reach it) can never write the catch-up keys — or brand', async () => {
    role = 'sales_manager'
    superAdmin = false
    storedSettings = { ...storedSettings, job_catch_up_enabled: false, job_catch_up_stuck_days: 7 }
    await patch({ type: 'settings', job_catch_up_enabled: true, job_catch_up_stuck_days: 1, brand: { website: 'evil' }, other: 2 })
    expect(updates).toHaveLength(1)
    expect(updates[0].settings).toEqual({ ...storedSettings, other: 2 })
  })
})
