import { formatCents, formatDate, formatDateTime, formatMoney, formatPercent, formatPhone, formatTime } from '@/lib/format'
import { JOB_STATUSES } from '@/lib/job-status'
import { statusMeta } from '@/lib/status'

describe('lib/format', () => {
  it('formats money with $ and commas, empties as a dash', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50')
    expect(formatMoney('16325')).toBe('$16,325.00')
    expect(formatMoney(-12.3)).toBe('-$12.30')
    expect(formatMoney(18430.5, { whole: true })).toBe('$18,431')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney('abc')).toBe('—')
    expect(formatCents(1632500)).toBe('$16,325.00')
    expect(formatPercent(7)).toBe('7%')
  })
  it('renders calendar days as written, whatever the viewer zone', () => {
    expect(formatDate('2026-10-22')).toBe('Oct 22, 2026')
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })
  it('renders instants in the org timezone (Eastern)', () => {
    // 2026-10-22T02:30Z is still Oct 21 at 10:30 PM Eastern (EDT)
    expect(formatDateTime('2026-10-22T02:30:00Z')).toBe('Oct 21, 10:30 PM')
    expect(formatTime('2026-10-22T19:05:00Z')).toBe('3:05 PM')
  })
  it('formats US phones', () => {
    expect(formatPhone('7045550142')).toBe('(704) 555-0142')
    expect(formatPhone('+1 704-555-0142')).toBe('(704) 555-0142')
    expect(formatPhone('555')).toBe('555')
  })
})

describe('lib/status', () => {
  it('every job status resolves to the job module label and a real tone', () => {
    for (const s of JOB_STATUSES) {
      const m = statusMeta('job', s)
      expect(m.label).toBeTruthy()
      expect(['neutral', 'info', 'success', 'warning', 'danger', 'accent']).toContain(m.tone)
    }
    expect(statusMeta('job', 'materials').label).toBe('Material Ordering')
  })
  it('known and unknown statuses never throw or mislabel', () => {
    expect(statusMeta('proposal', 'accepted')).toEqual({ label: 'Accepted', tone: 'success' })
    expect(statusMeta('opportunity', 'in_progress').label).toBe('In progress')
    expect(statusMeta('appointment', 'weird_new_state')).toEqual({ label: 'Weird new state', tone: 'neutral' })
    expect(statusMeta('lead', null).label).toBe('Unknown')
  })
})
