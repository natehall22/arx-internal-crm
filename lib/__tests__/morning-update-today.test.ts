import { morningUpdateFocusFor, normalizeOrgEmailBlastSettings } from '../admin-email-blasts'
import { buildTodayHtml, loadMorningTodayQueues } from '../morning-update-email'
import { jobQueue, loadStormHitsQueue, proposalQueue, type Queue } from '../today'

describe('morning update focus setting', () => {
  it("stores only 'crews' choices and drops junk", () => {
    const s = normalizeOrgEmailBlastSettings({
      morning_update: { enabled: true, role_targets: [], user_targets: ['u1', 'u2'], user_focus: { u1: 'crews', u2: 'all', u3: 'admin', '': 'crews' } },
    })
    expect(s.morning_update.user_focus).toEqual({ u1: 'crews' })
  })

  it("defaults to 'all' (old settings with no user_focus keep today's email)", () => {
    const s = normalizeOrgEmailBlastSettings({ morning_update: { enabled: true, role_targets: [], user_targets: ['u1'] } })
    expect(morningUpdateFocusFor(s.morning_update, 'u1')).toBe('all')
    expect(morningUpdateFocusFor(s.morning_update, null)).toBe('all')
    expect(morningUpdateFocusFor({ ...s.morning_update, user_focus: { u1: 'crews' } }, 'u1')).toBe('crews')
  })

  it('other blasts never carry a focus map', () => {
    const s = normalizeOrgEmailBlastSettings({ sale: { enabled: true, role_targets: [], user_targets: [], user_focus: { u1: 'crews' } } })
    expect(s.sale.user_focus).toBeUndefined()
  })
})

describe('Today block in the morning email', () => {
  const proposals = proposalQueue(
    [{ id: 'p1', customer_name: 'Ashley Gaines', proposal_number: 'P-00118', total: 18430.5, sent_at: '2026-10-21T15:00:00Z' }],
    1,
    true
  )
  const jobs = jobQueue('jobs-to-schedule', 'Jobs to schedule', [{ id: 'j1', job_number: '26-0040', address_text: '12 Elm Street, Concord NC', scheduled_date: null }], 12, 'Every sold job has an install date.')

  it('lists job and proposal numbers with links, never customer names, addresses or money', () => {
    const html = buildTodayHtml([proposals, jobs], 'https://crm.example.com')
    expect(html).toContain('Proposal #P-00118')
    expect(html).toContain('waiting since Oct 21')
    expect(html).toContain('href="https://crm.example.com/proposals/p1"')
    expect(html).toContain('Job 26-0040')
    expect(html).not.toContain('Ashley')
    expect(html).not.toContain('Elm Street')
    expect(html).not.toContain('$')
  })

  it('points to the Today screen when a queue has more than it lists', () => {
    const html = buildTodayHtml([jobs], 'https://crm.example.com')
    expect(html).toContain('Jobs to schedule (12)')
    expect(html).toContain('and 11 more')
    expect(html).toContain('https://crm.example.com/today')
  })

  it('says so when nothing is waiting, and shows a queue’s empty line', () => {
    expect(buildTodayHtml([])).toContain('Nothing is waiting on you.')
    expect(buildTodayHtml(null)).toContain("couldn&apos;t load")
    const empty: Queue = { id: 'crews-this-week', title: 'Crews this week', count: 0, empty: 'No crews on the calendar this week.', items: [] }
    expect(buildTodayHtml([empty])).toContain('No crews on the calendar this week.')
  })

  it('escapes queue text', () => {
    const q: Queue = { id: 'x', title: '<b>t</b>', count: 1, empty: '', items: [{ id: '1', title: '', detail: '', href: '/x', ref: '<i>', note: '"n"' }] }
    const html = buildTodayHtml([q])
    expect(html).not.toContain('<b>t</b>')
    expect(html).not.toContain('<i>')
  })
})

describe('Storm hits call list', () => {
  /** Minimal chainable Supabase stand-in: each table returns its rows, filters are ignored except the opportunity ids. */
  function fakeAdmin(tables: Record<string, unknown[]>) {
    return {
      from(table: string) {
        let rows = tables[table] ?? []
        const q: any = {
          select: () => q,
          eq: () => q,
          gte: () => q,
          order: () => q,
          limit: () => q,
          in: (col: string, vals: string[]) => {
            if (col === 'id') rows = rows.filter((r: any) => vals.includes(r.id))
            return q
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
        }
        return q
      },
    } as any
  }

  const admin = fakeAdmin({
    storm_opportunity_alerts: [
      { opportunity_id: 'o1', event_date: '2026-11-05', layer: 'wind', magnitude: 60, damage: false, distance_miles: 1.2, match_source: 'report', routed: true, created_at: '2026-11-06T10:00:00Z' },
      { opportunity_id: 'o1', event_date: '2026-11-05', layer: 'hail', magnitude: 1.25, damage: false, distance_miles: 0, match_source: 'swath', created_at: '2026-11-06T10:00:00Z' },
      { opportunity_id: 'o2', event_date: '2026-11-04', layer: 'hail', magnitude: 1, damage: false, distance_miles: 0.4, match_source: 'report', routed: false, created_at: '2026-11-05T10:00:00Z' },
      { opportunity_id: 'o3', event_date: '2026-11-05', layer: 'hail', magnitude: 2, damage: false, distance_miles: 0.1, match_source: 'report', created_at: '2026-11-06T10:00:00Z' },
      { opportunity_id: 'o4', event_date: '2026-11-05', layer: 'hail', magnitude: 1.5, damage: false, distance_miles: 0.2, match_source: 'report', created_at: '2026-11-06T10:00:00Z' },
    ],
    opportunities: [
      { id: 'o1', status: 'open', leads: { homeowner_name: 'Pat Doe', phone: '704-555-0142' } },
      { id: 'o2', status: 'in_progress', leads: [{ homeowner_name: 'Sam Roe', phone: 'n/a' }] },
      { id: 'o3', status: 'won', leads: { homeowner_name: 'Won Deal', phone: '7045550000' } },
      { id: 'o4', status: 'lost', leads: { homeowner_name: 'Lost Deal', phone: '7045551111' } },
    ],
  })

  it('lists each deal once with its biggest hit, newest storm first; customers included, lost drop off', async () => {
    const q = await loadStormHitsQueue(admin, 'org', new Date('2026-11-06T11:00:00Z'))
    expect(q.count).toBe(3)
    expect(q.items.map((i) => i.ref)).toEqual(['Won Deal', 'Pat Doe', 'Sam Roe'])
    expect(q.items[0].note).toContain('customer')
    expect(q.items[0].note).not.toContain('already working')
    expect(q.items[1].note).toContain('1.25 in hail')
    expect(q.items[1].note).toContain('inside the storm area')
    expect(q.items[1].phone).toBe('704-555-0142')
    expect(q.items[2].phone).toBe('n/a') // kept as typed; only dialable numbers get tap-to-call
    expect(q.items[2].note).toContain('a rep is already working this deal')
    expect(q.items[1].note).not.toContain('already working')
    expect(q.items[1].href).toBe('/opportunities/o1')
  })

  it('renders name, facts and a tap-to-call number in the email', async () => {
    const q = await loadStormHitsQueue(admin, 'org', new Date('2026-11-06T11:00:00Z'))
    const html = buildTodayHtml([q], 'https://crm.example.com')
    expect(html).toContain('Storm hits on open deals and customers (3)')
    expect(html).toContain('Pat Doe')
    expect(html).toContain('href="tel:+17045550142"')
    expect(html).toContain('(704) 555-0142')
    expect(html).toContain('Won Deal')
    expect(html).not.toContain('Lost Deal')
    expect(html).not.toContain('tel:n/a')
  })

  it('a failed storm lookup shows a "couldn’t load" line and keeps the rest of Today', async () => {
    const broken = {
      from(table: string) {
        const q: any = {
          select: () => q, eq: () => q, gte: () => q, lt: () => q, is: () => q, order: () => q, limit: () => q, in: () => q, not: () => q, lte: () => q, neq: () => q,
          then: (resolve: (v: unknown) => void) =>
            resolve(
              table === 'storm_opportunity_alerts'
                ? { data: null, error: { message: 'boom' } }
                : table === 'production_jobs'
                  ? { data: [{ id: 'j1', job_number: '26-0038', address_text: null, scheduled_date: null }], count: 1, error: null }
                  : { data: [], count: 0, error: null }
            ),
        }
        return q
      },
    } as any
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const queues = await loadMorningTodayQueues(broken, 'org', 'all', new Date('2026-11-06T11:00:00Z'))
    spy.mockRestore()
    expect(queues[0].id).toBe('storm-hits')
    expect(buildTodayHtml(queues)).toContain('Storm hits couldn’t load today.')
    expect(queues.some((q) => q.id === 'unscheduled-jobs')).toBe(true)
  })

  it('the crews version never loads storm hits', async () => {
    const tables: string[] = []
    const spyAdmin = {
      from(table: string) {
        tables.push(table)
        const q: any = {
          select: () => q, eq: () => q, gte: () => q, lt: () => q, is: () => q, order: () => q, limit: () => q, in: () => q, not: () => q, lte: () => q, neq: () => q,
          then: (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null }),
        }
        return q
      },
    } as any
    await loadMorningTodayQueues(spyAdmin, 'org', 'crews', new Date('2026-11-06T11:00:00Z'))
    expect(tables).not.toContain('storm_opportunity_alerts')
  })
})
