/** @jest-environment node */
/**
 * Plan entitlements: the platform owner decides which modules a company may use (orgs.plan_entitlements, lib/org-features.ts).
 * NULL = all allowed; not entitled = off whatever the company switch says; the company can't write the plan; only platform staff
 * change it through /api/support/plans; every change is logged by the one SQL function.
 */
import fs from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

import { loadOrgFeatures, ORG_FEATURE_KEYS, resolveOrgEntitlements, resolveOrgFeatures } from '@/lib/org-features'
import { parseCompanySeedInput, seedEntitlements } from '@/lib/company-seed'
import { resolveOrgProfile } from '@/lib/org-profile'

const ROOT = join(__dirname, '..', '..')
const read = (f: string) => fs.readFileSync(join(ROOT, f), 'utf8')

let plan: unknown = null // orgs.plan_entitlements of org-1
let planColumnMissing = false
let storedSwitches: Record<string, boolean> = {}
let isStaff = true
let staffId = 'staff-1'
let superAdmin = true
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
const mergeCalls: Array<Record<string, unknown>> = []

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) } }),
}))
jest.mock('@/lib/support/staff', () => ({
  requirePlatformStaffApi: async () => {
    const { NextResponse } = await import('next/server')
    return isStaff ? { ctx: { authUser: { id: staffId } } } : { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  },
  getPlatformStaffContext: async () => null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args })
      if (fn === 'set_plan_entitlement') {
        const cur = (plan ?? args.p_base) as Record<string, boolean>
        plan = { ...cur, [args.p_feature as string]: args.p_entitled }
        return { data: plan, error: null }
      }
      mergeCalls.push(args)
      return { data: null, error: null }
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: (cols: string) => {
          q._cols = cols
          return q
        },
        eq: () => q,
        single: async () => (table === 'users' ? { data: { org_id: 'org-1', role: 'admin', is_super_admin: superAdmin, active: true }, error: null } : { data: { settings: {} }, error: null }),
        maybeSingle: async () => {
          if (String(q._cols).includes('plan_entitlements') && planColumnMissing) return { data: null, error: { code: '42703', message: 'column orgs.plan_entitlements does not exist' } }
          const row: Record<string, unknown> = { features: storedSwitches, profile: null }
          if (String(q._cols).includes('plan_entitlements')) row.entitlements = plan
          return { data: row, error: null }
        },
        order: async () => ({ data: [{ id: 'org-1', name: 'Acme', plan, profile: null }], error: null }),
      }
      return q
    },
  }),
}))

import { PATCH as settingsPatch } from '@/app/api/admin/settings/route'
import { GET as plansGet, PATCH as plansPatch } from '@/app/api/support/plans/route'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
const cookie = `sb-ref-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 't' }))}`
const companyPatch = (body: unknown) =>
  settingsPatch(new NextRequest('https://crm.example/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }))
const staffPatch = (body: unknown) =>
  plansPatch(new Request('https://crm.example/api/support/plans', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  plan = null
  planColumnMissing = false
  storedSwitches = {}
  isStaff = true
  staffId = 'staff-1'
  superAdmin = true
  rpcs.length = 0
  mergeCalls.length = 0
})

describe('the reader', () => {
  it('NULL / missing plan = every module allowed: the original company is unchanged', () => {
    for (const settings of [{}, { features: { canvassing: false, servicePlans: true } }, { profile: { id: 'lawn_landscape' } }]) {
      expect(resolveOrgFeatures(settings, null)).toEqual(resolveOrgFeatures(settings))
      expect(resolveOrgFeatures(settings, undefined)).toEqual(resolveOrgFeatures(settings))
    }
    expect(Object.values(resolveOrgEntitlements(null)).every(Boolean)).toBe(true)
  })

  it('not entitled = off even when the company switch is on; entitled keeps the company switch', () => {
    const on = resolveOrgFeatures({ features: { servicePlans: true, canvassing: true, insurance: false } }, { servicePlans: false, canvassing: true, insurance: true })
    expect(on.servicePlans).toBe(false)
    expect(on.canvassing).toBe(true)
    expect(on.insurance).toBe(false) // entitled but the company switched it off
  })

  it('a plan map with a key left out means not in the plan (a module added later is not granted by accident)', () => {
    const e = resolveOrgEntitlements({ canvassing: true })
    expect(e.canvassing).toBe(true)
    expect(ORG_FEATURE_KEYS.filter((k) => k !== 'canvassing').every((k) => e[k] === false)).toBe(true)
    expect(resolveOrgEntitlements({ canvassing: 'yes' }).canvassing).toBe(false)
  })

  it('the company can never grant itself: an `entitlements` key inside settings is ignored', () => {
    const f = resolveOrgFeatures({ features: { servicePlans: true }, entitlements: { servicePlans: true }, planEntitlements: { servicePlans: true } }, { servicePlans: false })
    expect(f.servicePlans).toBe(false)
    expect(resolveOrgProfile({ features: { servicePlans: true }, entitlements: {} }, { servicePlans: false }).features.servicePlans).toBe(false)
  })

  it('loadOrgFeatures applies the column; a column that is not there yet (migration pending) = all allowed', async () => {
    storedSwitches = { servicePlans: true }
    plan = { servicePlans: false }
    const { createServiceClient } = jest.requireMock('@/lib/supabase/service') as { createServiceClient: () => never }
    expect((await loadOrgFeatures(createServiceClient(), 'org-1')).servicePlans).toBe(false)
    planColumnMissing = true
    expect((await loadOrgFeatures(createServiceClient(), 'org-1')).servicePlans).toBe(true)
  })
})

describe('company side', () => {
  it('PATCH refuses turning ON a feature that is not in the plan (403), writes nothing', async () => {
    plan = { servicePlans: false, canvassing: true }
    const res = await companyPatch({ type: 'features', features: { servicePlans: true } })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_in_plan')
    expect(mergeCalls).toEqual([])
  })

  it('PATCH still lets an owner turn a not-entitled feature OFF and an entitled one on', async () => {
    plan = { servicePlans: false, canvassing: true }
    expect((await companyPatch({ type: 'features', features: { servicePlans: false } })).status).toBe(200)
    expect((await companyPatch({ type: 'features', features: { canvassing: true } })).status).toBe(200)
  })

  it('PATCH with NULL plan (ARX / existing companies) behaves as before', async () => {
    plan = null
    expect((await companyPatch({ type: 'features', features: { servicePlans: true } })).status).toBe(200)
  })

  it('one not-entitled key in a batch refuses the whole save', async () => {
    plan = { canvassing: true }
    expect((await companyPatch({ type: 'features', features: { canvassing: true, texting: true } })).status).toBe(403)
    expect(mergeCalls).toEqual([])
  })

  it('no company-facing code writes the plan: only the reader, the support plans library and the seed script name the column', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) {
          if (['node_modules', '.next', '__tests__', 'test-helpers'].includes(e.name)) continue
          walk(rel)
        } else if (/\.(ts|tsx)$/.test(e.name) && /plan_entitlements/.test(fs.readFileSync(join(ROOT, rel), 'utf8'))) hits.push(rel)
      }
    }
    for (const d of ['app', 'lib', 'components', 'hooks']) walk(d)
    expect(hits.sort()).toEqual(['lib/company-seed.ts', 'lib/org-features.ts', 'lib/org-profile.ts', 'lib/support/plans.ts'])
    // the only writes: the SQL function (plans.ts) and the operator's seed script
    expect(read('lib/org-features.ts')).not.toMatch(/\.(update|insert|upsert)\(/)
    expect(read('lib/support/plans.ts')).toContain("rpc('set_plan_entitlement'")
    // the generic settings save can't reach the column
    expect(read('app/api/admin/settings/route.ts')).not.toMatch(/plan_entitlements/)
  })
})

describe('platform side', () => {
  it('only platform staff can read or change plans (anyone else gets 404, nothing is written)', async () => {
    isStaff = false
    expect((await plansGet(new Request('https://crm.example/api/support/plans'))).status).toBe(404)
    expect((await staffPatch({ orgId: 'org-1', feature: 'servicePlans', entitled: true })).status).toBe(404)
    expect(rpcs).toEqual([])
  })

  it('a company owner (not staff) cannot use the plans route either', async () => {
    isStaff = false
    superAdmin = true
    expect((await staffPatch({ orgId: 'org-1', feature: 'servicePlans', entitled: true })).status).toBe(404)
    expect(rpcs).toEqual([])
  })

  it('a change goes through the one logging SQL function with the staff member id', async () => {
    const res = await staffPatch({ orgId: 'org-1', feature: 'servicePlans', entitled: false })
    expect(res.status).toBe(200)
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0].fn).toBe('set_plan_entitlement')
    expect(rpcs[0].args).toMatchObject({ p_org: 'org-1', p_staff: 'staff-1', p_feature: 'servicePlans', p_entitled: false })
    // a company with no plan yet starts from "everything allowed" so one toggle does not switch the rest off
    const base = rpcs[0].args.p_base as Record<string, boolean>
    expect(ORG_FEATURE_KEYS.every((k) => base[k] === true)).toBe(true)
    const body = await res.json()
    expect(body.entitlements.servicePlans).toBe(false)
    expect(body.entitlements.canvassing).toBe(true)
  })

  it('unknown module / non-boolean / missing company id are 400 and write nothing', async () => {
    expect((await staffPatch({ orgId: 'org-1', feature: 'nope', entitled: true })).status).toBe(400)
    expect((await staffPatch({ orgId: 'org-1', feature: 'texting', entitled: 'yes' })).status).toBe(400)
    expect((await staffPatch({ feature: 'texting', entitled: true })).status).toBe(400)
    expect(rpcs).toEqual([])
  })

  it('/support Plans does not need a support grant: the plans library never consults grants', () => {
    const src = read('lib/support/plans.ts') + read('app/api/support/plans/route.ts')
    expect(src).not.toMatch(/support_access_grants|liveSupportAccess|checkSupportSession/)
    expect(read('app/support/page.tsx')).toContain('listPlanCompanies')
  })
})

describe('the migration', () => {
  const sql = read('supabase/migrations/202611270010_plan_entitlements.sql')

  it('is additive: no drop / delete / truncate word anywhere, comments included', () => {
    expect(sql).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS plan_entitlements jsonb;')
  })

  it('the trigger refuses a company session (anything but the service role or a direct session) on insert and update', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.orgs')
    expect(sql).toContain("RAISE EXCEPTION 'plan_entitlements can only be changed by the server'")
    expect(sql).toContain("RAISE EXCEPTION 'plan_entitlements can only be set by the server'")
    expect(sql).toContain("v_role NOT IN ('service_role', '')")
  })

  it('the log is append-only and service-role only; the change function is service-role only and logs in the same call', () => {
    expect(sql).toContain('GRANT SELECT, INSERT ON public.plan_entitlement_log TO service_role;')
    expect(sql).toContain('BEFORE UPDATE ON public.plan_entitlement_log')
    expect(sql).toContain("RAISE EXCEPTION 'plan_entitlement_log is append-only'")
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('TO service_role;')
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.set_plan_entitlement'))
    expect(fn.indexOf('UPDATE public.orgs')).toBeGreaterThan(0)
    expect(fn.indexOf('INSERT INTO public.plan_entitlement_log')).toBeGreaterThan(fn.indexOf('UPDATE public.orgs'))
  })
})

describe('seeding', () => {
  const base = { org: { name: 'X', phone: '1', email: 'a@b.co', address: 'a' }, owner: { email: 'o@b.co', fullName: 'O' } }
  const parse = (extra: Record<string, unknown>) => parseCompanySeedInput({ ...base, ...extra })

  it('a new company is entitled to what its profile turns on; roofing / no profile = the original modules only', () => {
    const lawn = seedEntitlements({ profile: 'lawn_landscape', demo: false, entitlements: null })
    expect(lawn).toEqual(resolveOrgFeatures({ features: {}, profile: { id: 'lawn_landscape' } }))
    const roofing = seedEntitlements({ profile: null, demo: false, entitlements: null })
    expect(roofing).toEqual(resolveOrgFeatures({}))
    expect(roofing.servicePlans).toBe(false)
    expect(lawn.servicePlans).toBe(true)
  })

  it('"entitlements" in the seed file overrides the profile key by key; a demo company also gets what its sample data uses', () => {
    const o = seedEntitlements({ profile: 'lawn_landscape', demo: false, entitlements: { servicePlans: false, texting: true } })
    expect(o.servicePlans).toBe(false)
    expect(o.texting).toBe(true)
    const demo = seedEntitlements({ profile: 'lawn_landscape', demo: true, entitlements: null })
    expect(demo.servicePlans && demo.timeTracking && demo.customerPortal).toBe(true)
  })

  it('the seed file parser validates the key', () => {
    const ok = parse({ entitlements: { texting: true } })
    expect(ok.ok && ok.input.entitlements).toEqual({ texting: true })
    const none = parse({})
    expect(none.ok && none.input.entitlements).toBeNull()
    expect(parse({ entitlements: { nope: true } }).ok).toBe(false)
    expect(parse({ entitlements: { texting: 'yes' } }).ok).toBe(false)
    expect(parse({ entitlements: [true] }).ok).toBe(false)
  })
})
