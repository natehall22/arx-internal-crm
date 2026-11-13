/** @jest-environment jsdom */
import { readFileSync } from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')

const redirectMock = jest.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`)
})
let role = 'owner'

jest.mock('next/navigation', () => ({
  redirect: (to: string) => redirectMock(to),
  usePathname: () => '/admin/setter-ramp',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ profile: { id: 'u1', org_id: 'org-1', role } }) }))
jest.mock('@/components/Nav', () => ({ __esModule: true, default: () => <nav data-testid="nav" /> }))
jest.mock('@/app/admin/bonuses/BonusApprovalClient', () => ({
  __esModule: true,
  default: ({ isFullAdmin }: { isFullAdmin: boolean }) => <div data-testid="bonus-client">{String(isFullAdmin)}</div>,
}))

import BonusesPage from '@/app/admin/bonuses/page'
import OldBonusApprovalPage from '@/app/admin/sisu/bonus-approval/page'
import SisuHubNav from '@/app/admin/sisu/SisuHubNav'
import { visibleNav, type NavContext } from '@/lib/nav-config'
import { PAYROLL_ADMIN_ROLES } from '@/lib/payroll-admin-access'

beforeEach(() => redirectMock.mockClear())

describe('old bonus-approval URL', () => {
  it('redirects to /admin/bonuses', () => {
    expect(() => OldBonusApprovalPage()).toThrow('NEXT_REDIRECT:/admin/bonuses')
  })
})

describe('/admin/bonuses (Money → Bonuses): same access as the old Sisu tab', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['operations', true],
    ['regional_manager', false],
    ['regional_setter_manager', false],
  ])('%s gets the page (full admin: %s)', async (r, full) => {
    role = r
    render(await BonusesPage())
    expect(screen.getByTestId('bonus-client').textContent).toBe(String(full))
    expect(redirectMock).not.toHaveBeenCalled()
  })
  it.each(['setter', 'canvasser', 'sales_rep', 'sales_manager', 'manager'])('%s is sent away', async (r) => {
    role = r
    await expect(BonusesPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard')
  })
  it('works with incentives OFF: the page never reads the incentives switch and is not under the Sisu layout', () => {
    const src = read('app/admin/bonuses/page.tsx').replace(/\/\*[\s\S]*?\*\//g, '') // code only, not the explaining comment
    expect(src).not.toMatch(/incentives|isOrgFeatureOn|requireOrgFeaturePage|getOrgFeatures/)
    expect(src).not.toMatch(/admin\/sisu/)
    expect(read('app/admin/bonuses/BonusApprovalClient.tsx')).not.toMatch(/orgFeatures|useOrgFeatures/)
  })
  it('is reachable from the menu (Money → Bonuses) with incentives off', () => {
    const flags = { isOpsOnly: false, canSeeOpsDashboard: false, canSeeJobBoard: false, canSeeInsideSales: false, projectsBarred: false, salesDocBarred: false, customerRecords: false, reports: false, isPayrollAdmin: true, earnsPay: false, payWeek: true }
    const c: NavContext = { permsReady: true, role: 'owner', fullAccess: true, permissionNames: new Set(), flags, features: { incentives: false } }
    const n = visibleNav(c)
    expect(n.sections.find((s) => s.id === 'money')!.children).toContainEqual({ href: '/admin/bonuses', label: 'Bonuses' })
    expect(n.sections.map((s) => s.id)).not.toContain('sisu')
  })
  it('does not widen payroll: the payroll layout and PAYROLL_ADMIN_ROLES are unchanged', () => {
    expect(PAYROLL_ADMIN_ROLES).toEqual(['admin', 'owner', 'operations'])
  })
})

describe('Sisu program hub', () => {
  it('no longer has a Bonus Approval tab; Setter Ramp (pay) stays when incentives are off', () => {
    const { container, rerender } = render(<SisuHubNav showIncentives />)
    const hrefs = () => Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs()).toEqual(['/admin/sisu/incentives', '/admin/sisu/incentives?tab=badges', '/admin/sisu/setter-ramp', '/admin/sisu/accountability'])
    rerender(<SisuHubNav showIncentives={false} />)
    expect(hrefs()).toEqual(['/admin/sisu/setter-ramp'])
    expect(container.textContent).not.toMatch(/bonus/i)
  })
  it('nothing links to the old URL except its redirect', () => {
    for (const f of ['app/admin/payroll/LegacyPayrollPage.tsx', 'app/admin/sisu/SisuHubNav.tsx', 'app/admin/sisu/layout.tsx', 'lib/nav-config.ts', 'lib/settings-registry.ts']) {
      expect(read(f)).not.toContain('bonus-approval')
    }
  })
})
