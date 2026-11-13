import { activeSectionId, visibleNav, type NavContext } from '@/lib/nav-config'

const flags = { isOpsOnly: false, canSeeOpsDashboard: false, canSeeJobBoard: false, canSeeInsideSales: false, projectsBarred: false, salesDocBarred: false, customerRecords: false, reports: false, isPayrollAdmin: false, earnsPay: false, payWeek: true }
const ctx = (o: Partial<Omit<NavContext, 'flags'>> & { flags?: Partial<NavContext['flags']> } = {}): NavContext => ({
  permsReady: true, role: 'sales_rep', fullAccess: false, permissionNames: new Set(), ...o, flags: { ...flags, ...o.flags },
})
const ids = (c: NavContext) => visibleNav(c).sections.map((s) => s.id)
const leaves = (c: NavContext) => visibleNav(c).sections.flatMap((s) => s.children.map((l) => l.href))
/** Every page the menu links to: a section's pages, or the section's own link for single-page items. */
const pages = (c: NavContext) => visibleNav(c).sections.flatMap((s) => (s.children.length ? s.children.map((l) => l.href) : [s.href]))

describe('nav config', () => {
  it('full access sees every section and Admin/Canvass', () => {
    const c = ctx({ role: 'owner', fullAccess: true, flags: { canSeeOpsDashboard: true, canSeeJobBoard: true, canSeeInsideSales: true, isPayrollAdmin: true } })
    expect(ids(c)).toEqual(['today', 'dashboard', 'pipeline', 'jobs', 'customers', 'money', 'reports', 'sisu'])
    const n = visibleNav(c)
    expect(n.admin && n.canvass).toBe(true)
  })
  it('fails closed while permissions are loading: only ungated pages show', () => {
    const c = ctx({ permsReady: false, permissionNames: new Set(['leads:view', 'jobs:view']) })
    expect(leaves(c)).toEqual([])
    expect(ids(c)).toEqual(['today', 'dashboard'])
    expect(visibleNav(c).canvass).toBe(false)
  })
  it('a setter sees Today, Dashboard, Pipeline→Leads (never Opportunities), Sisu, Canvass — nothing about money or jobs', () => {
    const c = ctx({ role: 'setter', permissionNames: new Set(['leads:view', 'leads:create', 'canvass:view', 'opportunities:view']) })
    expect(pages(c)).toEqual(['/today', '/dashboard', '/leads', '/sisu'])
    expect(ids(c)).toEqual(['today', 'dashboard', 'pipeline', 'sisu'])
    expect(visibleNav(c).canvass).toBe(true)
  })
  it('an ops-only user lands on the job pages and has no sales dashboard', () => {
    const c = ctx({ role: 'operations', permissionNames: new Set(['jobs:view', 'jobs:edit', 'ops:dashboard:view']), flags: { isOpsOnly: true, canSeeOpsDashboard: true, canSeeJobBoard: true } })
    expect(leaves(c)).toEqual(['/ops', '/ops/schedule', '/ops/checkups', '/ops/dashboard'])
    expect(ids(c)).not.toContain('dashboard')
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

  describe('Sisu, Dashboard, Reports are top-level; Insights is gone', () => {
    const lead = { permissionNames: new Set(['leads:view']) }
    it('Sisu: shown with today\'s rule (incentives on + leads:view), as its own top-level item under the name "Sisu"', () => {
      const n = visibleNav(ctx({ role: 'sales_rep', ...lead }))
      const sisu = n.sections.find((s) => s.id === 'sisu')
      expect(sisu).toMatchObject({ label: 'Sisu', href: '/sisu', children: [] })
      for (const s of n.sections) expect(s.children.map((l) => l.href)).not.toContain('/sisu')
      expect(ids(ctx({ role: 'setter', ...lead }))).toContain('sisu')
      expect(ids(ctx({ role: 'owner', fullAccess: true }))).toContain('sisu')
    })
    it('Sisu is hidden without leads:view, while permissions load, and when the company turns incentives off', () => {
      expect(ids(ctx({ permissionNames: new Set(['opportunities:view']) }))).not.toContain('sisu')
      expect(ids(ctx({ permsReady: false, permissionNames: new Set(['leads:view']) }))).not.toContain('sisu')
      expect(ids(ctx({ ...lead, features: { incentives: false } }))).not.toContain('sisu')
      expect(ids(ctx({ ...lead, features: { incentives: true } }))).toContain('sisu')
      expect(ids(ctx({ ...lead, features: { canvassing: false } }))).toContain('sisu')
    })
    it('nothing is called Insights or Incentives any more', () => {
      const n = visibleNav(ctx({ role: 'owner', fullAccess: true, flags: { canSeeOpsDashboard: true, canSeeJobBoard: true, isPayrollAdmin: true, reports: true } }))
      const labels = n.sections.flatMap((s) => [s.label, ...s.children.map((l) => l.label)])
      expect(labels).not.toContain('Insights')
      expect(labels).not.toContain('Incentives')
      expect(n.sections.map((s) => s.id)).not.toContain('insights' as never)
    })
    it('top-level order: Today, Dashboard, Pipeline, Jobs, Customers, Money, Reports, Sisu (then Canvass)', () => {
      const n = visibleNav(ctx({ role: 'owner', fullAccess: true, flags: { canSeeOpsDashboard: true, canSeeJobBoard: true, canSeeInsideSales: true, isPayrollAdmin: true } }))
      expect(n.sections.map((s) => s.label)).toEqual(['Today', 'Dashboard', 'Pipeline', 'Jobs', 'Customers', 'Money', 'Reports', 'Sisu'])
      expect(n.canvass).toBe(true)
    })
    it('Dashboard keeps its rule (not for ops-only); Reports keeps its rule (report permission or role helper)', () => {
      expect(ids(ctx())).toContain('dashboard')
      expect(ids(ctx({ flags: { isOpsOnly: true } }))).not.toContain('dashboard')
      expect(ids(ctx())).not.toContain('reports')
      expect(ids(ctx({ permissionNames: new Set(['reports:view_own']) }))).toContain('reports')
      expect(ids(ctx({ flags: { reports: true } }))).toContain('reports')
      expect(ids(ctx({ permsReady: false, flags: { reports: true } }))).not.toContain('reports')
    })
    it('phone: Dashboard, Reports and Sisu never take a bottom tab (they are More-only)', () => {
      const n = visibleNav(ctx({ role: 'owner', fullAccess: true, flags: { canSeeOpsDashboard: true, canSeeJobBoard: true, isPayrollAdmin: true } }))
      const moreOnly = n.sections.filter((s) => s.moreOnly).map((s) => s.id)
      expect(moreOnly).toEqual(['dashboard', 'reports', 'sisu'])
      expect(n.sections.filter((s) => !s.moreOnly).slice(0, 4).map((s) => s.id)).toEqual(['today', 'pipeline', 'jobs', 'customers'])
    })
    it('Money → Bonuses: payroll admins and regional bonus approvers; nobody else; independent of the incentives switch', () => {
      expect(leaves(ctx({ role: 'owner', flags: { isPayrollAdmin: true } }))).toContain('/admin/bonuses')
      expect(leaves(ctx({ role: 'regional_manager' }))).toEqual(['/admin/bonuses'])
      expect(leaves(ctx({ role: 'regional_setter_manager' }))).toContain('/admin/bonuses')
      expect(leaves(ctx({ role: 'sales_manager' }))).not.toContain('/admin/bonuses')
      expect(leaves(ctx({ role: 'setter' }))).not.toContain('/admin/bonuses')
      expect(leaves(ctx({ role: 'regional_manager', permsReady: false }))).not.toContain('/admin/bonuses')
      expect(leaves(ctx({ role: 'owner', flags: { isPayrollAdmin: true }, features: { incentives: false } }))).toContain('/admin/bonuses')
    })
    it('the active highlight follows the new items', () => {
      const n = visibleNav(ctx({ role: 'owner', fullAccess: true, flags: { isPayrollAdmin: true, reports: true } }))
      expect(activeSectionId('/dashboard', n)).toBe('dashboard')
      expect(activeSectionId('/reports/explore', n)).toBe('reports')
      expect(activeSectionId('/sisu', n)).toBe('sisu')
      expect(activeSectionId('/admin/bonuses', n)).toBe('money')
    })
  })
})
