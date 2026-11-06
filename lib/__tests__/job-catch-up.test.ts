import {
  buildJobCatchUp,
  catchUpAgeDays,
  catchUpAgeLabel,
  deriveNextStep,
  jobEvents,
  tradeEvents,
  type CatchUpFacts,
  type CatchUpNote,
  type CatchUpTrade,
} from '@/lib/job-catch-up'
import {
  DEFAULT_STUCK_DAYS,
  canEditJobCatchUpSettings,
  parseStuckDays,
  readJobCatchUpSettings,
} from '@/lib/job-catch-up-settings'
import { deriveMaterialsState } from '@/lib/job-materials-state'
import type { HealthProblem } from '@/lib/data-health'

// 2026-11-06 15:00 UTC = 10:00 Eastern, Friday.
const NOW = new Date('2026-11-06T15:00:00Z')
const TODAY = '2026-11-06'

const materials = (stored: string) => deriveMaterialsState({ stored })
const trade = (over: Partial<CatchUpTrade> = {}): CatchUpTrade => ({ trade: 'roofing', status: 'scheduled', scheduled_date: '2026-11-12', install_days: 1, sub_name: 'Ridgeline Roofing LLC', ...over })
const note = (over: Partial<CatchUpNote> = {}): CatchUpNote => ({ id: 'n1', at: '2026-11-04T14:00:00Z', who: 'Steve Potts', type: 'note', text: 'Called the county, permit should clear Monday.', human: true, ...over })
const problem = (code: HealthProblem['code'], message: string): HealthProblem => ({ code, area: 'ops', message, fixLabel: 'Open job', fixHref: '/ops/jobs/j1', blocksPay: false })

function facts(over: Partial<CatchUpFacts> = {}): CatchUpFacts {
  return {
    job: { id: 'j1', status: 'materials', scheduled_date: null, permit_required: false, permit_status: 'not_needed', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' },
    trades: [],
    materials: materials('ordered'),
    payment: null,
    problems: [],
    events: [],
    notes: [],
    stuckDays: 7,
    now: NOW,
    ...over,
  }
}
const step = (over: Partial<CatchUpFacts>) => deriveNextStep(facts(over), TODAY)

describe('job catch-up settings', () => {
  it('is OFF unless explicitly true, and defaults to 7 days', () => {
    expect(readJobCatchUpSettings(null)).toEqual({ enabled: false, stuckDays: DEFAULT_STUCK_DAYS })
    expect(readJobCatchUpSettings({ job_catch_up_enabled: 'true' })).toEqual({ enabled: false, stuckDays: 7 })
    expect(readJobCatchUpSettings({ job_catch_up_enabled: true, job_catch_up_stuck_days: 10 })).toEqual({ enabled: true, stuckDays: 10 })
    expect(readJobCatchUpSettings({ job_catch_up_enabled: true, job_catch_up_stuck_days: 0 }).stuckDays).toBe(7)
    expect(readJobCatchUpSettings([]).enabled).toBe(false)
  })
  it('accepts whole days 1–60 only', () => {
    expect(parseStuckDays('5')).toBe(5)
    expect(parseStuckDays(60)).toBe(60)
    for (const bad of [0, 61, 2.5, '', 'x', null, undefined, -3]) expect(parseStuckDays(bad)).toBeNull()
  })
  it('only admins and owners change it', () => {
    expect(canEditJobCatchUpSettings({ role: 'admin' })).toBe(true)
    expect(canEditJobCatchUpSettings({ role: 'owner' })).toBe(true)
    expect(canEditJobCatchUpSettings({ role: 'operations', is_super_admin: true })).toBe(true)
    for (const role of ['operations', 'sales_manager', 'manager', 'setter', 'closer']) expect(canEditJobCatchUpSettings({ role })).toBe(false)
    expect(canEditJobCatchUpSettings({ role: 'admin', active: false })).toBe(false)
    expect(canEditJobCatchUpSettings(null)).toBe(false)
  })
})

describe('next step (first match wins)', () => {
  it('terminal and paused jobs', () => {
    expect(step({ job: { id: 'j', status: 'cancelled' } })).toEqual({ text: 'Cancelled', owner: 'none' })
    expect(step({ job: { id: 'j', status: 'collected' } })).toEqual({ text: 'Done — closed out', owner: 'none' })
    expect(step({ job: { id: 'j', status: 'on_hold' } }).text).toBe('On hold — resume when ready')
  })
  it('a completed job: collection words only when the viewer sees them', () => {
    const done = { id: 'j', status: 'complete' }
    expect(step({ job: done, payment: 'Paid in full' }).text).toBe('Mark collected')
    expect(step({ job: done, payment: 'Closed with balance' }).text).toBe('Mark collected')
    expect(step({ job: done, payment: 'Partially paid' }).text).toBe('Waiting on payment')
    expect(step({ job: done, payment: 'Unpaid' }).text).toBe('Waiting on payment')
    expect(step({ job: done, payment: null }).text).toBe('Close out the job')
  })
  it('every crew done → mark the job complete', () => {
    expect(step({ job: { id: 'j', status: 'in_progress' }, trades: [trade({ status: 'completed' }), trade({ trade: 'gutters', status: 'cancelled', scheduled_date: null })] }).text).toBe('Mark job complete')
  })
  it('a crew past its last day → mark it done, owned by the crew', () => {
    expect(step({ job: { id: 'j', status: 'scheduled' }, trades: [trade({ scheduled_date: '2026-11-04', install_days: 2 })] })).toEqual({ text: 'Mark roofing crew done', owner: 'crew', crew: 'Ridgeline Roofing LLC' })
    // A 2-day crew that started yesterday is still on site today.
    expect(step({ job: { id: 'j', status: 'scheduled' }, trades: [trade({ scheduled_date: '2026-11-05', install_days: 2 })] }).text).toBe('Roofing crew on site')
  })
  it('crew on site today', () => {
    expect(step({ job: { id: 'j', status: 'scheduled' }, trades: [trade({ scheduled_date: TODAY })] }).text).toBe('Roofing crew on site')
  })
  it('crew marked done without photos', () => {
    expect(step({ job: { id: 'j', status: 'in_progress' }, trades: [trade({ status: 'completed' }), trade({ trade: 'gutters', scheduled_date: '2026-11-20' })], problems: [problem('trade_done_no_photos', 'x')] }).text).toBe('Get crew photos')
  })
  it('permit before materials before scheduling (pre-install only)', () => {
    const job = { id: 'j', status: 'sold', permit_required: true, permit_status: 'pending' }
    expect(step({ job, materials: materials('not_ordered') }).text).toBe('Waiting on permit')
    expect(step({ job: { ...job, permit_status: 'denied' } }).text).toBe('Permit denied — fix permit')
    expect(step({ job: { ...job, permit_status: 'approved' }, materials: materials('not_ordered') }).text).toBe('Order materials')
    expect(step({ job: { id: 'j', status: 'sold' }, materials: materials('ordered') }).text).toBe('Schedule crew')
  })
  it('partly ordered materials name what is missing when suppliers say so', () => {
    const partial = deriveMaterialsState({ stored: 'not_ordered', suppliers: { rollup: { covered: 2, total: 3, allCovered: false }, sentOrders: [{ receivedAt: null }] } })
    expect(step({ materials: partial }).text).toBe('Finish ordering materials (2 of 3 ordered)')
    expect(step({ materials: materials('partial') }).text).toBe('Finish ordering materials')
  })
  it('unscheduled crews, then the next crew date', () => {
    expect(step({ trades: [trade(), trade({ trade: 'gutters', scheduled_date: null, sub_name: null })] }).text).toBe('Schedule gutters crew')
    expect(step({ trades: [trade({ scheduled_date: null }), trade({ trade: 'gutters', scheduled_date: null })] }).text).toBe('Schedule roofing + gutters crew')
    expect(step({ job: { id: 'j', status: 'scheduled' }, trades: [trade({ trade: 'gutters', scheduled_date: '2026-11-20' }), trade()] })).toEqual({ text: 'Roofing crew Nov 12', owner: 'crew', crew: 'Ridgeline Roofing LLC' })
  })
  it('nothing else to say → the stage', () => {
    expect(step({ job: { id: 'j', status: 'scheduled', scheduled_date: '2026-11-12' }, trades: [] }).text).toBe('Scheduled')
  })
})

describe('buildJobCatchUp', () => {
  it('example: waiting on permit, Steve wrote last, 2 days ago', () => {
    const c = buildJobCatchUp(facts({ job: { id: 'j1', status: 'sold', permit_required: true, permit_status: 'pending', created_at: '2026-10-28T12:00:00Z' }, notes: [note()] }))
    expect(c.line).toBe('Steve · Waiting on permit · 2d')
    expect(c.ownerKind).toBe('person')
    expect(c.stage).toBe('Sold')
    expect(c.stuck).toBe(false)
    expect(c.lastUpdate).toMatchObject({ who: 'Steve Potts', kind: 'note' })
  })
  it('crew steps belong to the crew company; no writer → Office', () => {
    expect(buildJobCatchUp(facts({ job: { id: 'j', status: 'scheduled', created_at: '2026-11-05T12:00:00Z' }, trades: [trade()] })).owner).toBe('Ridgeline Roofing LLC')
    expect(buildJobCatchUp(facts({ job: { id: 'j', status: 'sold', created_at: '2026-11-05T12:00:00Z' }, materials: materials('not_ordered') })).owner).toBe('Office')
    // A system row is not a person.
    expect(buildJobCatchUp(facts({ notes: [note({ who: null, human: false })] })).owner).toBe('Office')
  })
  it('stuck when nothing moved for N days (inclusive), amber reason says how long', () => {
    const idle = buildJobCatchUp(facts({ job: { id: 'j', status: 'materials', created_at: '2026-10-30T16:00:00Z' } }))
    expect(idle.ageDays).toBe(7)
    expect(idle.stuck).toBe(true)
    expect(idle.reasons).toEqual(['Nothing has moved in 7 days.'])
    const fresh = buildJobCatchUp(facts({ job: { id: 'j', status: 'materials', created_at: '2026-10-31T16:00:00Z' } }))
    expect(fresh.stuck).toBe(false)
    expect(buildJobCatchUp(facts({ stuckDays: 30 })).stuck).toBe(false)
  })
  it('stuck when Needs-you has an ops problem, even if it moved today', () => {
    const c = buildJobCatchUp(facts({ notes: [note({ at: '2026-11-06T13:00:00Z' })], problems: [problem('crew_past_due', 'Roofing crew was due 2026-11-04 and isn’t marked done.')] }))
    expect(c.ageLabel).toBe('today')
    expect(c.stuck).toBe(true)
    expect(c.reasons).toEqual(['Roofing crew was due 2026-11-04 and isn’t marked done.'])
  })
  it('collected and cancelled jobs are never stuck', () => {
    for (const status of ['collected', 'cancelled']) {
      const c = buildJobCatchUp(facts({ job: { id: 'j', status, created_at: '2025-01-01T12:00:00Z' }, problems: [problem('completed_no_costs', 'x')] }))
      expect(c.stuck).toBe(false)
      expect(c.reasons).toEqual([])
      expect(c.done).toBe(true)
    }
  })
  it('last customer contact = latest call/text/email/visit; otherwise the latest note, said so', () => {
    const withCall = buildJobCatchUp(facts({ notes: [note({ id: 'a', at: '2026-11-05T12:00:00Z' }), note({ id: 'b', type: 'call', who: 'Andrew Waltz', text: 'Confirmed Tuesday install', at: '2026-11-03T12:00:00Z' })] }))
    expect(withCall.lastContact).toMatchObject({ who: 'Andrew Waltz', kind: 'contact', what: 'Call: Confirmed Tuesday install' })
    expect(withCall.contactIsNote).toBe(false)
    const noCall = buildJobCatchUp(facts({ notes: [note()] }))
    expect(noCall.contactIsNote).toBe(true)
    expect(noCall.lastContact?.kind).toBe('note')
    expect(buildJobCatchUp(facts()).lastContact).toBeNull()
  })
  it('never quotes a note that looks like pricing (no dollar amounts)', () => {
    const c = buildJobCatchUp(facts({ notes: [note({ text: null })] }))
    expect(c.recent[0].what).toBe('mentions pricing — open the thread')
    expect(JSON.stringify(c)).not.toMatch(/\$/)
  })
  it('long notes are trimmed; the last 3 updates mix notes and events, newest first', () => {
    const c = buildJobCatchUp(facts({
      notes: [note({ text: 'x'.repeat(400), at: '2026-11-05T10:00:00Z' })],
      events: [{ at: '2026-11-04T10:00:00Z', what: 'Supplier order sent' }, { at: '2026-11-06T09:00:00Z', what: 'Payment recorded' }, { at: '2026-10-01T10:00:00Z', what: 'Old' }],
    }))
    expect(c.recent.map((u) => u.what.slice(0, 16))).toEqual(['Payment recorded', 'x'.repeat(16), 'Supplier order s'])
    expect(c.recent[1].what.length).toBe(140)
  })
})

describe('events the CRM already knows', () => {
  it('job timestamps; "Job updated" only when nothing else explains it', () => {
    expect(jobEvents({ id: 'j', status: 'materials', created_at: '2026-10-01T10:00:00Z', materials_ordered_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:02:00Z' }).map((e) => e.what)).toEqual(['Job created', 'Materials marked ordered'])
    expect(jobEvents({ id: 'j', status: 'on_hold', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-09T10:00:00Z' }).map((e) => e.what)).toEqual(['Job created', 'Job updated'])
    expect(jobEvents({ id: 'j', status: 'sold', sale_date: '2026-10-01' })).toEqual([{ at: '2026-10-01', what: 'Job created' }])
  })
  it('crew rows: done, scheduled, removed; an untouched auto-created crew is not movement', () => {
    const ev = tradeEvents([
      trade({ status: 'completed', completed_at: '2026-11-02T20:00:00Z', updated_at: '2026-11-02T20:01:00Z' }),
      trade({ trade: 'gutters', created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-04T10:00:00Z', scheduled_date: '2026-11-20' }),
      trade({ trade: 'siding', status: 'pending', scheduled_date: null, created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' }),
      trade({ trade: 'windows', status: 'cancelled', updated_at: '2026-11-05T11:00:00Z' }),
    ])
    expect(ev.map((e) => e.what)).toEqual(['Roofing crew marked done', 'Gutters crew scheduled for Nov 20', 'Windows crew removed'])
  })
})

describe('age is counted in business-calendar days (DST-safe)', () => {
  it('late-evening Eastern events belong to that Eastern day, not the UTC day', () => {
    // 11:30pm Eastern on Nov 5 = 04:30 UTC Nov 6. Still "1d" at 10am on Nov 6.
    expect(catchUpAgeDays('2026-11-06T04:30:00Z', NOW)).toBe(1)
    expect(catchUpAgeDays('2026-11-06T05:30:00Z', NOW)).toBe(0)
  })
  it('across the November fall-back (Nov 1, 2026)', () => {
    expect(catchUpAgeDays('2026-10-31T23:30:00-04:00', new Date('2026-11-01T23:30:00-05:00'))).toBe(1)
    expect(catchUpAgeDays('2026-10-31T00:30:00-04:00', new Date('2026-11-07T23:59:00-05:00'))).toBe(7)
  })
  it('across the March spring-forward (Mar 8, 2026)', () => {
    expect(catchUpAgeDays('2026-03-07T23:30:00-05:00', new Date('2026-03-08T00:30:00-05:00'))).toBe(1)
    expect(catchUpAgeDays('2026-03-07T00:10:00-05:00', new Date('2026-03-14T23:50:00-04:00'))).toBe(7)
  })
  it('bare dates are calendar days; labels', () => {
    expect(catchUpAgeDays('2026-11-04', NOW)).toBe(2)
    expect(catchUpAgeDays('2026-12-01T00:00:00Z', NOW)).toBe(0)
    expect([catchUpAgeLabel(null), catchUpAgeLabel(0), catchUpAgeLabel(9), catchUpAgeLabel(90), catchUpAgeLabel(91)]).toEqual(['—', 'today', '9d', '90d', '90d+'])
  })
})
