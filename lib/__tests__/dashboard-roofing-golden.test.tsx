/** @jest-environment node */
/**
 * Golden: the roofing dashboard (an org with no industry profile, or the roofing one) renders byte-for-byte what it
 * rendered before the dashboard became an ordered list of cards. The snapshots in __snapshots__/ were recorded from
 * origin/main ebad31a (before cards) and must not change: a change here is a change to ARX's screen.
 */
import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  notFound: jest.fn(),
  redirect: jest.fn(),
}))

import DashboardClient from '@/app/dashboard/DashboardClient'
import { HARNESS_DASHBOARD } from '@/e2e/fixtures'

beforeAll(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-11-06T15:00:00Z'))
})
afterAll(() => jest.useRealTimers())

const member = (id: string, name: string, role: string) => ({
  id, name, role, doorsKnocked: 120, contacts: 30, inspectionsSet: 4, inspectionsReceived: 3, sits: 3, sales: 1, closeRate: '33', efficiency: '20',
})
const setters = [member('s1', 'Sam Setter', 'setter')]
const closers = [member('c1', 'Cal Closer', 'sales_rep')]

function renderRoofing(role: string, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <DashboardClient
      profile={{ ...HARNESS_DASHBOARD.profile, role }}
      stats={HARNESS_DASHBOARD.stats}
      progress={HARNESS_DASHBOARD.progress}
      pendingPrompts={[]}
      settings={{}}
      {...extra}
    />
  )
}

describe('roofing dashboard golden', () => {
  it.each(['admin', 'sales_rep', 'setter', 'canvasser'])('%s sees the same dashboard as before cards', (role) => {
    expect(renderRoofing(role)).toMatchSnapshot()
  })
  it('the team scoreboard (closer stats, setter stats) is unchanged', () => {
    const html = renderRoofing('admin', { canViewTeamLeaderboard: true, setterTeamStats: setters, closerTeamStats: closers, teamMemberStats: [...setters, ...closers] })
    expect(html).toContain('Team scoreboard')
    expect(html).toMatchSnapshot()
  })
})
