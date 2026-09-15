import {
  MAX_SCHEDULE_WINDOW_DAYS,
  daysBetweenDateOnly,
  isValidDateString,
  parseScheduleWindow,
} from '@/lib/schedule-window'

const win = (start?: string, end?: string) => {
  const p = new URLSearchParams()
  if (start !== undefined) p.set('start', start)
  if (end !== undefined) p.set('end', end)
  return parseScheduleWindow(p)
}

describe('parseScheduleWindow', () => {
  it('accepts a normal week', () => {
    const r = win('2026-09-06', '2026-09-12')
    expect(r).toEqual({ ok: true, window: { start: '2026-09-06', end: '2026-09-12' } })
  })

  it('accepts a single day', () => {
    expect(win('2026-09-06', '2026-09-06').ok).toBe(true)
  })

  it('rejects missing or malformed dates', () => {
    for (const [s, e] of [
      [undefined, '2026-09-12'],
      ['2026-09-06', undefined],
      ['09/06/2026', '2026-09-12'],
      ['2026-9-6', '2026-09-12'],
      ['nope', 'nope'],
    ] as [string | undefined, string | undefined][]) {
      const r = win(s, e)
      expect(r.ok).toBe(false)
    }
  })

  it('rejects an end before the start', () => {
    const r = win('2026-09-12', '2026-09-06')
    expect(r).toEqual({ ok: false, error: 'end must not be before start' })
  })

  it('bounds the window so the board cannot ask for a year of jobs', () => {
    expect(win('2026-01-01', '2026-04-01').ok).toBe(true) // 90 days exactly
    const tooBig = win('2026-01-01', '2026-04-02') // 91
    expect(tooBig.ok).toBe(false)
    expect(tooBig).toHaveProperty('error', `Window too large — max ${MAX_SCHEDULE_WINDOW_DAYS} days`)
  })
})

describe('daysBetweenDateOnly', () => {
  it('counts plain calendar days', () => {
    expect(daysBetweenDateOnly('2026-09-06', '2026-09-12')).toBe(6)
    expect(daysBetweenDateOnly('2026-09-06', '2026-09-06')).toBe(0)
  })

  it('does not drift across a DST boundary or a leap day', () => {
    // Both are pure date arithmetic; a local-time implementation would be off
    // by one across the US spring-forward.
    expect(daysBetweenDateOnly('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetweenDateOnly('2024-02-28', '2024-03-01')).toBe(2)
    expect(daysBetweenDateOnly('2026-12-31', '2027-01-01')).toBe(1)
  })
})

describe('isValidDateString', () => {
  it('only accepts bare YYYY-MM-DD', () => {
    expect(isValidDateString('2026-09-06')).toBe(true)
    expect(isValidDateString('2026-09-06T00:00:00Z')).toBe(false)
    expect(isValidDateString(20260906)).toBe(false)
    expect(isValidDateString(null)).toBe(false)
  })
})
