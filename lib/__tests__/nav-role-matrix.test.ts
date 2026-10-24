import { visibleNav, CANVASS_ITEM, ADMIN_ITEM, type NavContext } from '@/lib/nav-config'
import {
  canAccessCustomerRecords, canAccessCustomerRecordsFromPermissionNames, canAccessJobBoardFromPermissionNames,
  canAccessOpsDashboardFromPermissionNames, canAccessReports, canAccessReportsFromPermissionNames,
  isBarredFromProjectsUi, isBarredFromSalesDocAccess, isOrgSuperuserRoleSlug, getPermissions, isFieldRoleLike,
} from '@/lib/permissions'
import { canViewInsideSalesFollowUp } from '@/lib/inside-sales-follow-up'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { COMMISSION_ROLES } from '@/lib/comp-plan-defaults'

// Same resolution as lib/effective-permissions.ts for legacy (no custom role) users, then the same context Nav.tsx builds.
const FIELD_ROLE_DENIED_PERMISSION_PREFIXES = ['jobs:', 'ops:'] // lib/effective-permissions.ts
const MATRIX_ALIAS: Record<string, string> = { manager: 'sales_manager', closer: 'sales_rep' }

function navFor(role: string, payWeek: boolean) {
  const full = isOrgSuperuserRoleSlug(role)
  const names = new Set<string>(full ? [] : getPermissions((MATRIX_ALIAS[role] ?? role) as never))
  if (!full && isFieldRoleLike({ role })) {
    Array.from(names).forEach((n) => { if (n === 'admin:full' || FIELD_ROLE_DENIED_PERMISSION_PREFIXES.some((p) => n.startsWith(p))) names.delete(n) })
  }
  if (!full) names.add('referral_partners:view')
  const input = { fullAccess: full, permissionNames: names }
  const ctx: NavContext = {
    permsReady: true, role, fullAccess: full, permissionNames: names,
    flags: {
      isOpsOnly: role === 'operations',
      canSeeOpsDashboard: canAccessOpsDashboardFromPermissionNames(input),
      canSeeJobBoard: canAccessJobBoardFromPermissionNames(input),
      canSeeInsideSales: canViewInsideSalesFollowUp({ role, permissionNames: names } as never),
      projectsBarred: isBarredFromProjectsUi(role),
      salesDocBarred: isBarredFromSalesDocAccess({ role, permissionNames: names } as never),
      customerRecords: canAccessCustomerRecordsFromPermissionNames(input) || canAccessCustomerRecords(role),
      reports: canAccessReportsFromPermissionNames(input) || canAccessReports(role),
      isPayrollAdmin: isPayrollAdminRole(role),
      earnsPay: COMMISSION_ROLES.has(role),
      payWeek,
    },
  }
  const n = visibleNav(ctx)
  const pages = n.sections.flatMap((s) => (s.children.length ? s.children.map((c) => c.href) : [s.href]))
  if (n.canvass) pages.push(CANVASS_ITEM.href)
  if (n.admin) pages.push(ADMIN_ITEM.href)
  return pages
}

const ROLES = ['owner', 'operations', 'closer', 'setter', 'canvasser']

describe('nav per role (what each role is shown)', () => {
  it('prints the matrix', () => {
    const rows = ROLES.map((r) => `${r.padEnd(11)} ${navFor(r, true).join(' ')}`)
    // eslint-disable-next-line no-console
    console.log('\nNAV MATRIX (pay screens ON)\n' + rows.join('\n'))
  })

  it.each(['setter', 'canvasser'])('%s sees no pay admin, profit, pricebook, customers list or reports builder', (r) => {
    const pages = navFor(r, true)
    for (const bad of ['/admin/payroll', '/admin/job-profit-tracker', '/pricebook', '/admin', '/ops', '/ops/dashboard', '/ops/schedule', '/projects', '/opportunities']) {
      expect(pages).not.toContain(bad)
    }
  })

  it.each(['closer', 'setter', 'canvasser'])('%s never sees payroll admin or job profit', (r) => {
    const pages = navFor(r, true)
    expect(pages).not.toContain('/admin/payroll')
    expect(pages).not.toContain('/admin/job-profit-tracker')
  })
})
