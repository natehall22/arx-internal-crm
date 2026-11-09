import { anchorJobs, checkupPatch, parseCheckupAction, plannedCheckups } from '@/lib/checkups'
import {
  addMonthsYmd,
  checkupLabel,
  checkupOffsets,
  monthsBetweenYmd,
  parseCheckupPatch,
  readCheckupSettings,
} from '@/lib/checkups-settings'
import { contactBody, parseContact } from '@/lib/customer-contact'

const DEFAULTS = { inspectionMonths: [6, 12], touchEveryMonths: 12 }

describe('checkup schedule', () => {
  it('defaults: off, inspections at 6 and 12, then a call every 12 months, nobody assigned', () => {
    expect(readCheckupSettings({})).toEqual({ enabled: false, inspectionMonths: [6, 12], touchEveryMonths: 12, assigneeUserId: null })
    expect(readCheckupSettings({ checkups_enabled: 'yes' }).enabled).toBe(false)
  })

  it('6 and 12 are inspections, then yearly calls', () => {
    expect(checkupOffsets(DEFAULTS, 48)).toEqual([
      { month: 6, kind: 'inspection' },
      { month: 12, kind: 'inspection' },
      { month: 24, kind: 'touch' },
      { month: 36, kind: 'touch' },
      { month: 48, kind: 'touch' },
    ])
    expect(checkupOffsets({ inspectionMonths: [6, 12], touchEveryMonths: 0 }, 48)).toHaveLength(2)
  })

  it('month math clamps to the end of short months and handles year wrap', () => {
    expect(addMonthsYmd('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonthsYmd('2027-08-31', 6)).toBe('2028-02-29')
    expect(addMonthsYmd('2026-03-09', 12)).toBe('2027-03-09')
    expect(monthsBetweenYmd('2026-03-09', '2026-09-08')).toBe(5)
    expect(monthsBetweenYmd('2026-03-09', '2026-09-09')).toBe(6)
  })

  it('labels read like people say them', () => {
    expect(checkupLabel({ kind: 'inspection', month_offset: 6 })).toBe('6-month inspection')
    expect(checkupLabel({ kind: 'inspection', month_offset: 12 })).toBe('1-year inspection')
    expect(checkupLabel({ kind: 'touch', month_offset: 24 })).toBe('2-year check-in call')
  })

  it('creates a checkup 30 days before it is due', () => {
    expect(plannedCheckups('2026-06-15', '2026-11-14', DEFAULTS)).toEqual([])
    expect(plannedCheckups('2026-06-15', '2026-11-15', DEFAULTS).map((p) => p.month)).toEqual([6])
  })

  it('a job brought in late gets only its newest missed checkup, not a pile', () => {
    const p = plannedCheckups('2022-01-10', '2026-11-09', DEFAULTS)
    expect(p.map((x) => [x.month, x.kind])).toEqual([[48, 'touch']])
  })

  it('a second job at the same home within 180 days does not start its own schedule; a later re-roof does', () => {
    const jobs = [
      { id: 'roof', customer_id: 'c1', project_id: null, address_text: '1 Main St', completed_at: '2026-03-09T15:00:00Z' },
      { id: 'gutters', customer_id: 'c1', project_id: null, address_text: '1 Main St', completed_at: '2026-04-20T15:00:00Z' },
      { id: 'other', customer_id: 'c2', project_id: null, address_text: '2 Main St', completed_at: '2026-04-20T15:00:00Z' },
      { id: 'later', customer_id: 'c1', project_id: null, address_text: '1 Main St', completed_at: '2027-06-01T15:00:00Z' },
      { id: 'no-cust', customer_id: null, project_id: null, address_text: '9  Elm  St', completed_at: '2026-05-01T15:00:00Z' },
      { id: 'no-cust-2', customer_id: null, project_id: null, address_text: '9 elm st', completed_at: '2026-05-02T15:00:00Z' },
    ]
    expect(anchorJobs(jobs).map((j) => j.id).sort()).toEqual(['later', 'no-cust', 'other', 'roof'])
  })
})

describe('checkup actions', () => {
  const now = new Date('2026-11-09T17:00:00Z')
  const insp = { kind: 'inspection' as const, status: 'due' as const, attempts: 0 }
  const touch = { kind: 'touch' as const, status: 'due' as const, attempts: 1 }

  it('an inspection needs green / yellow / red to be done; a touch never carries one', () => {
    expect(checkupPatch(insp, { action: 'done' }, 'u', now)).toEqual({ error: expect.any(String) })
    expect(checkupPatch(insp, { action: 'done', result: 'yellow', notes: 'loose boot' }, 'u', now)).toMatchObject({ status: 'done', result: 'yellow', notes: 'loose boot', done_by: 'u' })
    expect(checkupPatch(touch, { action: 'done', result: 'red' }, 'u', now)).toMatchObject({ status: 'done', result: null })
  })

  it('only inspections are booked, and closed ones cannot be changed until reopened', () => {
    expect(checkupPatch(touch, { action: 'book', date: '2026-11-20' }, 'u', now)).toEqual({ error: expect.any(String) })
    expect(checkupPatch(insp, { action: 'book', date: '2026-11-20' }, 'u', now)).toMatchObject({ status: 'booked', booked_for: '2026-11-20' })
    const closed = { ...insp, status: 'declined' as const }
    expect(checkupPatch(closed, { action: 'book', date: '2026-11-20' }, 'u', now)).toEqual({ error: expect.any(String) })
    expect(checkupPatch(closed, { action: 'reopen' }, 'u', now)).toMatchObject({ status: 'due', result: null, done_at: null })
  })

  it('a check-in call is done once they pick up; a voicemail only counts as a try', () => {
    expect(checkupPatch(touch, { action: 'contact', outcome: 'voicemail', activityId: 'a1' }, 'u', now)).toMatchObject({ attempts: 2, last_activity_id: 'a1' })
    expect(checkupPatch(touch, { action: 'contact', outcome: 'voicemail', activityId: 'a1' }, 'u', now)).not.toHaveProperty('status')
    expect(checkupPatch(touch, { action: 'contact', outcome: 'reached', activityId: 'a1' }, 'u', now)).toMatchObject({ status: 'done', attempts: 2 })
    // Reaching them about an inspection does not record the inspection.
    expect(checkupPatch(insp, { action: 'contact', outcome: 'reached', activityId: null }, 'u', now)).not.toHaveProperty('status')
  })

  it('rejects junk input', () => {
    expect(parseCheckupAction({ action: 'book', date: 'tomorrow' })).toEqual({ error: expect.any(String) })
    expect(parseCheckupAction({ action: 'done', result: 'blue' })).toEqual({ error: expect.any(String) })
    expect(parseCheckupAction({ action: 'delete' })).toEqual({ error: expect.any(String) })
    expect(parseCheckupAction({ action: 'contact', outcome: 'reached', activityId: 'x' })).toEqual({ action: 'contact', outcome: 'reached', activityId: 'x' })
  })

  it('settings saves are validated', () => {
    expect(parseCheckupPatch({ inspectionMonths: [12, 6, 6] })).toEqual({ set: { checkups_inspection_months: [6, 12] } })
    expect(parseCheckupPatch({ inspectionMonths: [] })).toEqual({ error: expect.any(String) })
    expect(parseCheckupPatch({ touchEveryMonths: 61 })).toEqual({ error: expect.any(String) })
    expect(parseCheckupPatch({ assigneeUserId: 'Nathan' })).toEqual({ error: expect.any(String) })
    expect(parseCheckupPatch({})).toEqual({ error: 'Nothing to save' })
  })
})

describe('contact logging', () => {
  it('only outcomes that fit the kind are accepted', () => {
    expect(parseContact({ kind: 'call', outcome: 'voicemail' })).toEqual({ kind: 'call', outcome: 'voicemail' })
    expect(parseContact({ kind: 'text', outcome: 'voicemail' })).toBeNull()
    expect(parseContact({ kind: 'fax', outcome: 'sent' })).toBeNull()
    expect(parseContact(null)).toBeNull()
  })

  it('reads as a plain line in the thread', () => {
    expect(contactBody({ kind: 'call', outcome: 'no_answer' })).toBe('Call — No answer')
    expect(contactBody({ kind: 'text', outcome: 'sent' }, '  Asked about the 6-month visit ')).toBe('Text — Sent: Asked about the 6-month visit')
  })
})
