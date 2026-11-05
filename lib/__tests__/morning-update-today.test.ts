import { morningUpdateFocusFor, normalizeOrgEmailBlastSettings } from '../admin-email-blasts'
import { buildTodayHtml } from '../morning-update-email'
import { jobQueue, proposalQueue, type Queue } from '../today'

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
