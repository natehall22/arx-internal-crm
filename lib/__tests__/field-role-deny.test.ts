import { defaultTab, tabsFor } from '@/lib/customer-file/access'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { resolveOpsAccess } from '@/lib/ops-access'
import { canReadMessage, canSeeProduction, writableAudiences, type ThreadViewer } from '@/lib/threads/visibility'

/**
 * Field roles — setters, canvassers, inside sales — never see Production/Crew threads, the Job tab, pricing, profit or
 * financials, even when a custom role or a per-user grant hands them jobs:view / jobs:edit / jobs:financials:view.
 */
const GRANTS: Pick<ThreadViewer, 'jobBoard' | 'jobEdit' | 'jobFinancials'> = { jobBoard: true, jobEdit: true, jobFinancials: true }
const base: ThreadViewer = { userId: 'u', orgId: 'o', ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: false, pricingBarred: false }
const setterGranted: ThreadViewer = { ...base, ...GRANTS, userId: 'setter', setterLike: true, pricingBarred: true }
const insideGranted: ThreadViewer = { ...base, ...GRANTS, userId: 'inside', insideSales: true, pricingBarred: true }
const deal = { owner_user_id: 'closer', setter_user_id: 'setter' }

describe('thread visibility: the deny comes before the grant', () => {
  it.each([['setter', setterGranted], ['inside sales', insideGranted]])('%s with the job board granted still cannot read or write Production/Crew', (_n, v) => {
    expect(canSeeProduction(v, deal)).toBe(false)
    for (const audience of ['production', 'crew'] as const) expect(canReadMessage(v, deal, { audience })).toBe(false)
    expect(writableAudiences(v, deal)).not.toContain('production')
    expect(writableAudiences(v, deal)).not.toContain('crew')
    // pricing-flagged messages stay hidden whatever the audience
    expect(canReadMessage(v, deal, { audience: 'team', restricted_pricing: true })).toBe(false)
  })

  it('an owner and real ops are unaffected', () => {
    const owner = { ...base, ...GRANTS, ownerLike: true }
    const ops = { ...base, ...GRANTS }
    expect(canReadMessage(owner, deal, { audience: 'crew' })).toBe(true)
    expect(canReadMessage(ops, deal, { audience: 'production' })).toBe(true)
    expect(writableAudiences(ops, deal)).toEqual(['team', 'sales', 'production', 'crew'])
  })
})

describe('Customer File tabs', () => {
  it.each([['setter', setterGranted, ['overview', 'notes']], ['inside sales', insideGranted, ['overview', 'sales', 'notes']]] as const)('%s with every job grant: no Job, Money or Files tab', (_n, v, tabs) => {
    expect(tabsFor(v, { hasJob: true })).toEqual(tabs)
    expect(defaultTab(v, { hasJob: true }, 'job')).not.toBe('job')
    expect(defaultTab(v, { hasJob: true }, 'money')).not.toBe('money')
  })
})

/** A tiny stand-in for the admin client: role_permissions / user_permissions / custom_roles rows. */
function adminWith(opts: { roleGrants?: string[]; userGrants?: string[]; customRole?: { name: string; display_name: string } | null }) {
  const rows = (names: string[] = []) => names.map((name) => ({ permission: { name } }))
  const builder = (data: unknown) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = () => Promise.resolve({ data, error: null })
    b.then = (resolve: (v: unknown) => void) => resolve({ data, error: null })
    return b
  }
  return {
    from: (t: string) => builder(t === 'role_permissions' ? rows(opts.roleGrants) : t === 'user_permissions' ? rows(opts.userGrants) : t === 'custom_roles' ? opts.customRole ?? null : null),
  } as never
}

describe('the permission resolver strips job/ops grants from field roles', () => {
  const GRANTED = ['jobs:view', 'jobs:edit', 'jobs:financials:view', 'ops:dashboard:view', 'leads:view', 'scheduling:view']

  it('a setter with per-user grants keeps their own permissions but loses every jobs:* / ops:*', async () => {
    const r = await resolveEffectivePermissionNames(adminWith({ userGrants: GRANTED }), 'u1', { role: 'setter' })
    expect(Array.from(r.permissionNames).filter((n) => /^(jobs|ops):/.test(n))).toEqual([])
    expect(r.permissionNames.has('leads:view')).toBe(true)
    expect(r.fullAccess).toBe(false)
  })

  it('a custom role named Inside Sales with job grants loses them too', async () => {
    const r = await resolveEffectivePermissionNames(adminWith({ roleGrants: GRANTED, customRole: { name: 'inside_sales_plus', display_name: 'Inside Sales Plus' } }), 'u2', { role: 'custom', custom_role_id: 'cr1' })
    expect(Array.from(r.permissionNames).filter((n) => /^(jobs|ops):/.test(n))).toEqual([])
  })

  it('an ops-style custom role with the same grants keeps them (the deny is by role, never inferred)', async () => {
    const r = await resolveEffectivePermissionNames(adminWith({ roleGrants: GRANTED, customRole: { name: 'ops_lead', display_name: 'Ops Lead' } }), 'u3', { role: 'custom', custom_role_id: 'cr2' })
    expect(r.permissionNames.has('jobs:view')).toBe(true)
    expect(r.permissionNames.has('jobs:financials:view')).toBe(true)
  })

  it('resolveOpsAccess therefore gives a granted setter no job board, edit or financials', async () => {
    const access = await resolveOpsAccess(adminWith({ userGrants: GRANTED }), 'u1', { role: 'setter' })
    expect(access).toMatchObject({ canJobBoard: false, canEditJobs: false, canViewJobFinancials: false, canOpsDashboard: false })
  })

  it('an admin is unaffected', async () => {
    const access = await resolveOpsAccess(adminWith({}), 'a1', { role: 'admin' })
    expect(access).toMatchObject({ canJobBoard: true, canEditJobs: true, canViewJobFinancials: true })
  })
})
