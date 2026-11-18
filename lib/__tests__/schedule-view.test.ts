import { scheduleViewFor } from '@/lib/schedule-view'

describe('scheduleViewFor', () => {
  it('opens on Visits when service plans are on, Board when not (ARX unchanged)', () => {
    expect(scheduleViewFor(true, undefined)).toBe('visits')
    expect(scheduleViewFor(true, 'visits')).toBe('visits')
    expect(scheduleViewFor(false, undefined)).toBe('board')
    expect(scheduleViewFor(false, 'visits')).toBe('board')
  })
  it('Board and Calendar stay reachable', () => {
    expect(scheduleViewFor(true, 'board')).toBe('board')
    expect(scheduleViewFor(true, 'calendar')).toBe('calendar')
    expect(scheduleViewFor(false, 'calendar')).toBe('calendar')
  })
})
