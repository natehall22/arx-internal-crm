/**
 * Sisu leaderboard — dashboard-parity date filtering.
 *
 * Covers the two halves of the feature:
 *  - UI: the picker renders, the default period costs no extra fetch, changing the
 *    period refetches with the same query params the dashboard uses, and a custom
 *    range only queries once both ends are picked.
 *  - Server scope: who a viewer is allowed to see (lib/dashboard-member-scope.ts),
 *    which is the only thing standing between a rep and other people's numbers.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LeaderboardSection } from '@/app/sisu/IncentivesClient'
import { resolveDashboardMemberScope } from '@/lib/dashboard-member-scope'
import { isCalendarDateString, isTimeFrame } from '@/lib/time-frames'

type Entry = {
  user_id: string
  full_name: string
  role: string
  primary_metric: number
  doors_knocked: number
  rank: number
  badge_count: number
}

function entry(overrides: Partial<Entry> & { user_id: string; rank: number }): Entry {
  return {
    full_name: `Rep ${overrides.user_id}`,
    role: 'canvasser',
    primary_metric: 10,
    doors_knocked: 100,
    badge_count: 0,
    ...overrides,
  }
}

const weekBoard = {
  setters: [
    entry({ user_id: 'u1', full_name: 'Week Winner', rank: 1, primary_metric: 9 }),
    entry({ user_id: 'u2', full_name: 'Week Runner', rank: 2, primary_metric: 4 }),
  ],
  closers: [],
  asOf: '2026-08-25T12:00:00.000Z',
}

const monthBoard = {
  setters: [entry({ user_id: 'u3', full_name: 'Month Winner', rank: 1, primary_metric: 40 })],
  closers: [],
  asOf: '2026-08-25T12:05:00.000Z',
}

function renderSection() {
  return render(
    <LeaderboardSection
      leaderboard={weekBoard}
      loading={false}
      error={false}
      activeRoleTab="setters"
      setActiveRoleTab={() => {}}
      currentUserId="u2"
      leaderboardAsOf={new Date(weekBoard.asOf)}
    />,
  )
}

describe('Sisu leaderboard date filter', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => monthBoard,
    }))
    global.fetch = fetchMock
  })

  it('offers the same timeframe options as the dashboard and defaults to this week', () => {
    renderSection()
    const select = screen.getByLabelText('Leaderboard time period') as HTMLSelectElement
    expect(select.value).toBe('week')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'today',
      'yesterday',
      'week',
      'last_week',
      'month',
      'last_month',
      'quarter',
      'year',
      'all',
      'custom',
    ])
  })

  it('renders the default week rankings without an extra request', () => {
    renderSection()
    expect(screen.getByText('Week W.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refetches with ?timeframe= and swaps in the new rankings', async () => {
    renderSection()

    fireEvent.change(screen.getByLabelText('Leaderboard time period'), {
      target: { value: 'last_month' },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/sisu/leaderboard?timeframe=last_month')
    expect(init.method).toBe('POST')

    expect(await screen.findByText('Month W.')).toBeInTheDocument()
    expect(screen.queryByText('Week W.')).not.toBeInTheDocument()
  })

  it('waits for both ends of a custom range before querying', async () => {
    renderSection()

    fireEvent.change(screen.getByLabelText('Leaderboard time period'), {
      target: { value: 'custom' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Pick a start and end date/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Custom range start date'), {
      target: { value: '2026-07-01' },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Custom range end date'), {
      target: { value: '2026-07-31' },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/sisu/leaderboard?timeframe=custom&startDate=2026-07-01&endDate=2026-07-31',
    )
  })

  it('keeps rank-movement history separate per period', async () => {
    renderSection()
    fireEvent.change(screen.getByLabelText('Leaderboard time period'), {
      target: { value: 'last_month' },
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await screen.findByText('Month W.')

    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('sisu_lb_ranks_'))
    expect(keys).toContain('sisu_lb_ranks_u2_setters_week')
    expect(keys).toContain('sisu_lb_ranks_u2_setters_last_month')
  })

  it('surfaces a failed filtered load instead of showing stale rankings', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    renderSection()

    fireEvent.change(screen.getByLabelText('Leaderboard time period'), {
      target: { value: 'year' },
    })

    expect(await screen.findByText('Leaderboard unavailable')).toBeInTheDocument()
  })
})

describe('timeframe / date param guards', () => {
  it('accepts only the shared timeframe list', () => {
    expect(isTimeFrame('week')).toBe(true)
    expect(isTimeFrame('custom')).toBe(true)
    expect(isTimeFrame('all_time')).toBe(false)
    expect(isTimeFrame("week'; drop table users;--")).toBe(false)
    expect(isTimeFrame(null)).toBe(false)
  })

  it('rejects calendar dates that do not exist or are malformed', () => {
    expect(isCalendarDateString('2026-07-31')).toBe(true)
    expect(isCalendarDateString('2026-02-30')).toBe(false)
    expect(isCalendarDateString('2026-13-01')).toBe(false)
    expect(isCalendarDateString('07/31/2026')).toBe(false)
    expect(isCalendarDateString('')).toBe(false)
    expect(isCalendarDateString(undefined)).toBe(false)
  })
})

describe('resolveDashboardMemberScope', () => {
  function stubClient(rows: { users?: { id: string }[]; teams?: { id: string }[] } = {}) {
    const calls: { table: string; filters: Record<string, unknown> }[] = []
    const client = {
      from(table: string) {
        const filters: Record<string, unknown> = {}
        calls.push({ table, filters })
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return builder
          },
          in: (col: string, val: unknown) => {
            filters[col] = val
            return Promise.resolve({
              data: table === 'users' ? rows.users ?? [] : rows.teams ?? [],
            })
          },
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: table === 'teams' ? rows.teams ?? [] : rows.users ?? [] }),
        }
        return builder
      },
    }
    return { client, calls }
  }

  it('gives admins the whole org', async () => {
    const { client } = stubClient()
    const scope = await resolveDashboardMemberScope(client as any, {
      id: 'admin-1',
      org_id: 'org-1',
      role: 'admin',
      team_id: null,
      region_id: null,
    })
    expect(scope).toEqual({ orgWide: true, memberIds: [] })
  })

  it('scopes a rep with a team to that team, org-filtered', async () => {
    const { client, calls } = stubClient({ users: [{ id: 'a' }, { id: 'b' }] })
    const scope = await resolveDashboardMemberScope(client as any, {
      id: 'rep-1',
      org_id: 'org-1',
      role: 'canvasser',
      team_id: 'team-1',
      region_id: null,
    })
    expect(scope.orgWide).toBe(false)
    expect(new Set(scope.memberIds)).toEqual(new Set(['rep-1', 'a', 'b']))
    expect(calls[0].filters.org_id).toBe('org-1')
    expect(calls[0].filters.team_id).toEqual(['team-1'])
  })

  it('scopes a rep with no team to themselves', async () => {
    const { client } = stubClient()
    const scope = await resolveDashboardMemberScope(client as any, {
      id: 'rep-2',
      org_id: 'org-1',
      role: 'canvasser',
      team_id: null,
      region_id: null,
    })
    expect(scope).toEqual({ orgWide: false, memberIds: ['rep-2'] })
  })

  it('fails closed for a regional_manager with no region instead of widening to the org', async () => {
    const { client } = stubClient({ users: [{ id: 'other' }] })
    const scope = await resolveDashboardMemberScope(client as any, {
      id: 'rm-1',
      org_id: 'org-1',
      role: 'regional_manager',
      // A stale team_id used to fall through to ORG-WIDE in the dashboard's inline version.
      team_id: 'team-1',
      region_id: null,
    })
    expect(scope).toEqual({ orgWide: false, memberIds: ['rm-1'] })
  })
})
