/** @jest-environment node */
/**
 * Field Tech (role slug field_tech): a crew member doing the visits in the field.
 *   - which role presets / role choices a company is offered (per industry profile; the original roofing company unchanged);
 *   - the server-side denies: no money, pipeline, settings or other people's data, even with grants;
 *   - what is still allowed: the crew time clock as a crew member (tests in time-tracking-db.test.ts), nothing needing a permission.
 */
import fs from 'fs'
import path from 'path'

import { defaultTab, tabsFor } from '@/lib/customer-file/access'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { hasFinancials, hasMoneyRecord } from '@/lib/financials-access'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { resolveOrgFeatures } from '@/lib/org-features'
import { resolveOpsAccess } from '@/lib/ops-access'
import {
  canAccessJobBoardFromPermissionNames, getPermissions, isBarredFromProjectsUi, isBarredFromRoofMeasureAccess, isBarredFromSalesDocAccess,
  isCrewFieldRole, isFieldRoleLike, getRoleDisplayName,
} from '@/lib/permissions'
import { todayKindFor } from '@/lib/today'
import { FIELD_TECH_ROLE, offeredPresets, orgHasFieldCrews, presetDescription, roleOffered, type PresetLike } from '@/lib/role-presets'
import { canReadMessage, canSeeProduction, writableAudiences, type ThreadViewer } from '@/lib/threads/visibility'
import { DB_USER_ROLES } from '@/lib/types/database'

const SYSTEM: PresetLike[] = [
  { name: 'Setter / Canvasser', base_role: 'canvasser', description: 'Door-to-door canvassing, lead creation, basic scheduling', is_system: true },
  { name: 'Sales Representative', base_role: 'sales_rep', description: 'Full sales cycle', is_system: true },
  { name: 'Sales Manager', base_role: 'sales_manager', description: 'Team management', is_system: true },
  { name: 'Operations', base_role: 'operations', description: 'Project management', is_system: true },
  { name: 'Administrator', base_role: 'admin', description: 'Full system access', is_system: true },
  { name: 'Field Tech', base_role: 'field_tech', description: 'stored text', is_system: true },
  { name: 'Crew Lead', base_role: 'field_tech', description: 'stored text', is_system: true },
  { name: 'Office', base_role: 'custom', description: 'Schedules visits', is_system: true },
  { name: 'Bookkeeper', base_role: 'custom', description: 'Invoices', is_system: true },
]
const names = (ps: PresetLike[]) => ps.map((p) => p.name)
const featuresOf = (profile: string | null) => resolveOrgFeatures(profile ? { features: {}, profile: { id: profile } } : {})

describe('role presets follow the company', () => {
  it('the original roofing company (no profile) sees exactly the old list: Setter / Canvasser in, Field Tech not offered', () => {
    expect(names(offeredPresets(SYSTEM, featuresOf(null)))).toEqual(['Setter / Canvasser', 'Sales Representative', 'Sales Manager', 'Operations', 'Administrator'])
    expect(names(offeredPresets(SYSTEM, featuresOf('roofing')))).toEqual(names(offeredPresets(SYSTEM, featuresOf(null))))
  })

  it('a lawn company (canvassing off, service plans + time clock on): Setter / Canvasser hidden, Field Tech shown', () => {
    const f = featuresOf('lawn_landscape')
    expect(f.canvassing).toBe(false)
    expect(names(offeredPresets(SYSTEM, f))).toEqual(['Sales Representative', 'Sales Manager', 'Operations', 'Administrator', 'Field Tech', 'Crew Lead', 'Office', 'Bookkeeper'])
  })

  it.each(INDUSTRY_PROFILE_IDS)('profile %s: Setter / Canvasser appears iff door knocking is on; Field Tech iff service plans or the time clock is', (id) => {
    const f = featuresOf(id)
    const shown = names(offeredPresets(SYSTEM, f))
    expect(shown.includes('Setter / Canvasser')).toBe(f.canvassing)
    for (const n of ['Field Tech', 'Crew Lead', 'Office', 'Bookkeeper']) expect(shown.includes(n)).toBe(f.servicePlans || f.timeTracking)
    // every other preset is always offered
    for (const n of ['Sales Representative', 'Sales Manager', 'Operations', 'Administrator']) expect(shown).toContain(n)
  })

  it('a company that switches the time clock on gets Field Tech even on the roofing profile', () => {
    const f = resolveOrgFeatures({ features: { timeTracking: true } })
    expect(names(offeredPresets(SYSTEM, f))).toContain('Field Tech')
  })

  it('a preset the owner made themselves is never hidden, even on a canvasser base role', () => {
    const own: PresetLike = { name: 'Mowing helper', base_role: 'canvasser', is_system: false }
    expect(offeredPresets([own], featuresOf('lawn_landscape'))).toEqual([own])
  })

  it('role dropdown: setter / canvasser hidden without door knocking, field_tech offered with crews; a person’s current role stays', () => {
    const lawn = featuresOf('lawn_landscape')
    expect(roleOffered('setter', lawn)).toBe(false)
    expect(roleOffered('canvasser', lawn)).toBe(false)
    for (const r of ['call_center', 'regional_setter_manager', 'setter_manager']) { expect(roleOffered(r, lawn)).toBe(false); expect(roleOffered(r, featuresOf(null))).toBe(true) }
    expect(roleOffered('canvasser', lawn, 'canvasser')).toBe(true)
    expect(roleOffered('field_tech', lawn)).toBe(true)
    expect(roleOffered('operations', lawn)).toBe(true)
    const roofing = featuresOf(null)
    expect(roleOffered('setter', roofing)).toBe(true)
    expect(roleOffered('field_tech', roofing)).toBe(false)
  })

  it('the Field Tech card is written in the company’s own word for a job', () => {
    const ft = SYSTEM[5]
    expect(presetDescription(ft, { jobs: INDUSTRY_PROFILES.lawn_landscape.terms.jobs ?? 'Jobs' })).toContain('their own work')
    expect(presetDescription(ft, { jobs: 'Projects' })).toContain('their own projects')
    expect(presetDescription(ft, { jobs: 'Jobs' })).toContain('their own jobs')
    // other presets keep their stored text
    expect(presetDescription(SYSTEM[1], { jobs: 'Work' })).toBe('Full sales cycle')
  })

  it('no canvass wording on a non-canvassing company’s cards', () => {
    const f = featuresOf('lawn_landscape')
    const text = offeredPresets(SYSTEM, f).map((p) => `${p.name} ${presetDescription(p, { jobs: 'Work' })}`).join(' ').toLowerCase()
    expect(text).not.toMatch(/canvass|door-to-door|setter/)
  })
})

describe('role identity', () => {
  it('field_tech is a real role: database list, display name, crew-role helper', () => {
    expect(DB_USER_ROLES).toContain('field_tech')
    expect(getRoleDisplayName('field_tech')).toBe('Field Tech')
    expect(FIELD_TECH_ROLE).toBe('field_tech')
    expect(isCrewFieldRole('field_tech')).toBe(true)
    expect(isCrewFieldRole('setter')).toBe(false)
  })
  it('is in the field-role group, by slug and by a custom role NAMED Field Tech (not a "Field Tech Manager")', () => {
    expect(isFieldRoleLike({ role: 'field_tech' })).toBe(true)
    expect(isFieldRoleLike({ role: 'custom', customRoleName: 'Field Tech' })).toBe(true)
    expect(isFieldRoleLike({ role: 'custom', customRoleName: 'field_technician' })).toBe(true)
    expect(isFieldRoleLike({ role: 'custom', customRoleName: 'Field Tech Manager' })).toBe(false)
    expect(isFieldRoleLike({ role: 'operations' })).toBe(false)
  })
  it('SQL twin: the migration names the same slug and name words', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611300020_field_tech_preset_and_field_role.sql'), 'utf8')
    expect(sql).toMatch(/'field_tech'\)/)
    expect(sql).toContain('field[ _-]?tech(nician)?')
    expect(fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611300010_user_role_field_tech.sql'), 'utf8')).toMatch(/ADD VALUE IF NOT EXISTS 'field_tech'/)
    expect(sql + fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611300010_user_role_field_tech.sql'), 'utf8')).not.toMatch(/\b(drop|delete)\b/i)
  })
})

/** A tiny stand-in for the admin client: role_permissions / user_permissions / custom_roles rows. */
function adminWith(opts: { roleGrants?: string[]; userGrants?: string[]; customRole?: { name: string; display_name: string } | null }) {
  const rows = (n: string[] = []) => n.map((name) => ({ permission: { name } }))
  const builder = (data: unknown) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = () => Promise.resolve({ data, error: null })
    b.then = (resolve: (v: unknown) => void) => resolve({ data, error: null })
    return b
  }
  return { from: (t: string) => builder(t === 'role_permissions' ? rows(opts.roleGrants) : t === 'user_permissions' ? rows(opts.userGrants) : t === 'custom_roles' ? opts.customRole ?? null : null) } as never
}

const EVERYTHING = [
  'admin:full', 'admin:settings', 'admin:access', 'jobs:view', 'jobs:edit', 'jobs:financials:view', 'ops:dashboard:view', 'money:record',
  'reports:financials', 'reports:view_all', 'reports:export', 'pricebook:view', 'pricebook:edit', 'leads:view', 'opportunities:view', 'proposals:view',
  'contracts:view', 'customers:view', 'users:view', 'users:edit', 'scheduling:view', 'canvass:view', 'referral_partners:view',
]

describe('Field Tech: server-side denies (resolver)', () => {
  it('holds no permission at all, even with every grant on the person (money, pipeline, settings, reports, referral partners)', async () => {
    const r = await resolveEffectivePermissionNames(adminWith({ userGrants: EVERYTHING }), 'ft', { role: 'field_tech' })
    expect(r.fullAccess).toBe(false)
    expect(Array.from(r.permissionNames)).toEqual([])
    expect(hasFinancials(r)).toBe(false)
    expect(hasMoneyRecord(r)).toBe(false)
    expect(canAccessJobBoardFromPermissionNames(r)).toBe(false)
  })
  it('the role matrix gives them nothing either, and a custom role cannot add to it', async () => {
    expect(getPermissions('field_tech')).toEqual([])
    const r = await resolveEffectivePermissionNames(adminWith({ roleGrants: EVERYTHING }), 'ft', { role: 'field_tech', custom_role_id: 'cr' })
    expect(Array.from(r.permissionNames)).toEqual([])
  })
  it('resolveOpsAccess: no job board, no editing jobs, no job financials, no ops dashboard', async () => {
    const a = await resolveOpsAccess(adminWith({ userGrants: EVERYTHING }), 'ft', { role: 'field_tech' })
    expect(a).toMatchObject({ canJobBoard: false, canEditJobs: false, canViewJobFinancials: false, canOpsDashboard: false })
  })
  it('a custom role NAMED Field Tech (role custom) loses job / ops / money grants like any field role', async () => {
    const r = await resolveEffectivePermissionNames(adminWith({ roleGrants: EVERYTHING, customRole: { name: 'Field Tech', display_name: 'Field Tech' } }), 'ft2', { role: 'custom', custom_role_id: 'cr' })
    expect(Array.from(r.permissionNames).filter((n) => /^(jobs|ops|money):/.test(n) || n === 'admin:full')).toEqual([])
    expect(r.fullAccess).toBe(false)
  })
  it('an operations person and an admin are unaffected', async () => {
    expect((await resolveOpsAccess(adminWith({}), 'a', { role: 'admin' })).canJobBoard).toBe(true)
    expect((await resolveOpsAccess(adminWith({}), 'o', { role: 'operations' })).canJobBoard).toBe(true)
  })
})

describe('Field Tech: sales documents, projects, threads, customer file', () => {
  const GRANTS: Pick<ThreadViewer, 'jobBoard' | 'jobEdit' | 'jobFinancials'> = { jobBoard: true, jobEdit: true, jobFinancials: true }
  // What resolveThreadViewer builds for role field_tech: pricingBarred comes from isBarredFromSalesDocAccess.
  const viewer: ThreadViewer = { userId: 'ft', orgId: 'o', ownerLike: false, managerLike: false, closerLike: false, setterLike: false, ...GRANTS, pricingBarred: isBarredFromSalesDocAccess({ role: 'field_tech' }) }
  const deal = { owner_user_id: 'closer', setter_user_id: 'setter' }

  it('barred from pricing, proposals, contracts, roof measure and Projects', () => {
    expect(isBarredFromSalesDocAccess({ role: 'field_tech' })).toBe(true)
    expect(isBarredFromRoofMeasureAccess('field_tech')).toBe(true)
    expect(isBarredFromProjectsUi('field_tech')).toBe(true)
  })
  it('even with every job grant: no Production / Crew threads, no pricing-flagged messages, no Job / Money / Files tab', () => {
    expect(canSeeProduction(viewer, deal)).toBe(false)
    for (const audience of ['production', 'crew'] as const) expect(canReadMessage(viewer, deal, { audience })).toBe(false)
    expect(canReadMessage(viewer, deal, { audience: 'team', restricted_pricing: true })).toBe(false)
    expect(writableAudiences(viewer, deal)).not.toContain('production')
    expect(writableAudiences(viewer, deal)).not.toContain('crew')
    expect(tabsFor(viewer, { hasJob: true })).toEqual(['overview', 'sales', 'notes'])
    expect(defaultTab(viewer, { hasJob: true }, 'money')).not.toBe('money')
  })
  it('a person with no recognized sales / ops role reads no deal conversation at all (fail closed)', () => {
    expect(canReadMessage({ ...viewer, jobBoard: false, jobEdit: false, jobFinancials: false }, deal, { audience: 'team' })).toBe(false)
  })
})

describe('custom role named Field Technician (role custom)', () => {
  it('gets the full lockdown: no permission at all, even with reports:financials', async () => {
    const r = await resolveEffectivePermissionNames(adminWith({ roleGrants: ['reports:financials', 'leads:view'], userGrants: ['reports:financials'], customRole: { name: 'Field Technician', display_name: 'Field Technician' } }), 'ft3', { role: 'custom', custom_role_id: 'cr' })
    expect(Array.from(r.permissionNames)).toEqual([])
    expect(hasFinancials(r)).toBe(false)
  })
  it('isCrewFieldRole takes the same input as isFieldRoleLike; a manager role is neither', () => {
    expect(isCrewFieldRole({ role: 'custom', customRoleName: 'Field Technician' })).toBe(true)
    expect(isCrewFieldRole({ role: 'custom', customRoleName: 'Field Tech Manager' })).toBe(false)
    expect(isCrewFieldRole({ role: 'custom', customRoleName: 'Setter' })).toBe(false)
  })
  it('the Today screen routes a Field Tech (slug or custom name) to no sales queues', () => {
    const base = { isSuperuser: false, canJobBoard: false }
    expect(todayKindFor({ ...base, role: 'field_tech' })).toBe('crew')
    expect(todayKindFor({ ...base, role: 'custom', customRoleName: 'Field Technician' })).toBe('crew')
    expect(todayKindFor({ ...base, role: 'sales_rep' })).toBe('closer')
    expect(todayKindFor({ ...base, role: 'setter' })).toBe('setter')
  })
})

describe('shared "has crews" predicate', () => {
  it('seed and UI agree: profile + saved switches + plan', () => {
    expect(orgHasFieldCrews({ features: {}, profile: { id: 'lawn_landscape' } })).toBe(true)
    expect(orgHasFieldCrews({ features: {}, profile: { id: 'roofing' } })).toBe(false)
    expect(orgHasFieldCrews({ features: { timeTracking: true } })).toBe(true)
    expect(orgHasFieldCrews({ features: { servicePlans: false, timeTracking: false }, profile: { id: 'lawn_landscape' } })).toBe(false)
    // not entitled by the plan = off, whatever the company saved
    expect(orgHasFieldCrews({ features: { timeTracking: true } }, { timeTracking: false, servicePlans: false })).toBe(false)
  })
  it('the work_orders policy migration adds the job-board term and removes nothing', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611300030_work_orders_write_policies_job_board.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(sql.match(/can_view_job_board\(auth\.uid\(\)\)/g)?.length).toBe(4)
    expect(sql.replace(/"[^"]*"/g, '')).not.toMatch(/\b(drop|delete)\b/i) // (the existing policy's own name says delete)
  })
})

describe('service role presets (SQL)', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611300020_field_tech_preset_and_field_role.sql'), 'utf8')
  const block = (name: string) => sql.slice(sql.indexOf(`('${name}'`), sql.indexOf(`('${name}'`) + 900).split(/\) AS t|\n      \(/)[0]
  it('Office and Bookkeeper never carry payroll, settings or admin; only Bookkeeper has reports:financials; neither uses the operations role', () => {
    const office = block('Office'), book = block('Bookkeeper')
    for (const b of [office, book]) {
      expect(b.slice(b.indexOf('ARRAY['))).not.toMatch(/admin:|payroll|operations/)
    }
    expect(office).not.toContain('reports:financials')
    expect(book).toContain('reports:financials')
    expect(book).not.toMatch(/(leads|opportunities|proposals|contracts):(create|edit|send)/)
    expect(office).toContain("'custom'")
    expect(book).toContain("'custom'")
  })
  it('Field Tech and Crew Lead are the same lockdown role with no permissions', () => {
    expect(block('Field Tech')).toMatch(/'field_tech', 'teal', 7, ARRAY\[\]::text\[\]/)
    expect(block('Crew Lead')).toMatch(/'field_tech', 'green', 8, ARRAY\[\]::text\[\]/)
  })
  it('every permission name it grants exists in the app permission list', () => {
    const names = Array.from(sql.matchAll(/'([a-z_]+:[a-z_:]+)'/g)).map((m) => m[1]).filter((n) => !n.startsWith('arx'))
    const allNames = fs.readFileSync(path.resolve(__dirname, '../permissions.ts'), 'utf8')
    for (const n of Array.from(new Set(names))) if (n !== 'field_tech') expect(allNames).toContain(`'${n}'`)
  })
})
