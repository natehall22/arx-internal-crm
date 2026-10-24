import { activeSectionId, visibleNav, type NavContext } from '@/lib/nav-config'

const flags = { isOpsOnly: false, canSeeOpsDashboard: false, canSeeJobBoard: false, canSeeInsideSales: false, projectsBarred: false, salesDocBarred: false, customerRecords: false, reports: false, isPayrollAdmin: false, earnsPay: false, payWeek: true }
const ctx = (o: Partial<Omit<NavContext, 'flags'>> & { flags?: Partial<NavContext['flags']> } = {}): NavContext => ({
  permsReady: true, role: 'sales_rep', fullAccess: false, permissionNames: new Set(), ...o, flags: { ...flags, ...o.flags },
})
const ids = (c: NavContext) => visibleNav(c).sections.map((s) => s.id)
const leaves = (c: NavContext) => visibleNav(c).sections.flatMap((s) => s.children.map((l) => l.href))

describe('nav config', () => {
  it('full access sees every section and Admin/Canvass', () => {
    const c = ctx({ role: 'owner', fullAccess: true, flags: { canSeeOpsDashboard: true, canSeeJobBoard: true, canSeeInsideSales: true, isPayrollAdmin: true } })
    expect(ids(c)).toEqual(['today', 'pipeline', 'jobs', 'customers', 'money', 'insights'])
    const n = visibleNav(c)
    expect(n.admin && n.canvass).toBe(true)
  })
  it('fails closed while permissions are loading: only ungated pages show', () => {
    const c = ctx({ permsReady: false, permissionNames: new Set(['leads:view', 'jobs:view']) })
    expect(leaves(c)).toEqual(['/dashboard'])
    expect(visibleNav(c).canvass).toBe(false)
  })
  it('a setter sees Pipeline→Leads (never Opportunities), Canvass, Today, Incentives — nothing about money or jobs', () => {
    const c = ctx({ role: 'setter', permissionNames: new Set(['leads:view', 'leads:create', 'canvass:view', 'opportunities:view']) })
    expect(leaves(c)).toEqual(['/leads', '/dashboard', '/sisu'])
    expect(ids(c)).toEqual(['today', 'pipeline', 'insights'])
    expect(visibleNav(c).canvass).toBe(true)
  })
  it('an ops-only user lands on the job pages and has no sales dashboard', () => {
    const c = ctx({ role: 'operations', permissionNames: new Set(['jobs:view', 'jobs:edit', 'ops:dashboard:view']), flags: { isOpsOnly: true, canSeeOpsDashboard: true, canSeeJobBoard: true } })
    expect(leaves(c)).toEqual(['/ops', '/ops/schedule', '/ops/dashboard'])
  })
  it('a section with no visible page disappears; Money needs a payroll admin or pricebook access', () => {
    expect(ids(ctx())).not.toContain('money')
    expect(ids(ctx({ permissionNames: new Set(['pricebook:view']) }))).toContain('money')
    expect(ids(ctx({ permissionNames: new Set(['pricebook:view']), flags: { salesDocBarred: true } }))).not.toContain('money')
  })
  it('a commission role sees Money → My pay; a payroll admin sees Payroll', () => {
    expect(leaves(ctx({ flags: { earnsPay: true } }))).toContain('/my-pay')
    expect(leaves(ctx({ flags: { earnsPay: true, payWeek: false } }))).not.toContain('/my-pay')
    expect(leaves(ctx({ flags: { isPayrollAdmin: true } }))).not.toContain('/my-pay')
    expect(ids(ctx({ flags: { earnsPay: true } }))).toContain('money')
  })
  it('projects stay hidden for barred roles even with the permission', () => {
    expect(leaves(ctx({ permissionNames: new Set(['projects:view']), flags: { projectsBarred: true } }))).not.toContain('/projects')
  })
  it('customers fall back to the role helper like the old nav', () => {
    expect(leaves(ctx({ flags: { customerRecords: true } }))).toContain('/customers')
  })
  it('highlights the section holding the longest matching page', () => {
    const n = visibleNav(ctx({ role: 'owner', fullAccess: true, flags: { canSeeOpsDashboard: true, canSeeJobBoard: true, isPayrollAdmin: true } }))
    expect(activeSectionId('/ops/jobs/abc', n)).toBe('jobs')
    expect(activeSectionId('/ops/dashboard', n)).toBe('jobs')
    expect(activeSectionId('/admin/payroll/periods', n)).toBe('money')
    expect(activeSectionId('/leads/123', n)).toBe('pipeline')
    expect(activeSectionId('/nowhere', n)).toBeNull()
  })
})
