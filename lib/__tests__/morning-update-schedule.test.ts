import { getBlastSendDate } from '../email-blast-ledger'
import { isMorningUpdateSendWindow } from '../morning-update-schedule'

/** The four UTC instants the Vercel cron fires at (:30 past 9, 10, 11, 12 UTC). */
function cronFire(dateUtc: string, utcHour: number): Date {
  return new Date(`${dateUtc}T${String(utcHour).padStart(2, '0')}:30:02.000Z`)
}

describe('isMorningUpdateSendWindow', () => {
  describe('EDT (summer, UTC-4)', () => {
    // Friday 2026-08-14 — the day the 5:30am send was lost to a Supabase 503.
    it('accepts the 5:30am first fire', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-08-14', 9))).toBe(true)
    })

    it('accepts the 6:30, 7:30 and 8:30am retry fires', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-08-14', 10))).toBe(true)
      expect(isMorningUpdateSendWindow(cronFire('2026-08-14', 11))).toBe(true)
      expect(isMorningUpdateSendWindow(cronFire('2026-08-14', 12))).toBe(true)
    })

    it('rejects 4:30am, before the window opens', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-08-14', 8))).toBe(false)
    })

    it('rejects 9:30am, after the window closes', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-08-14', 13))).toBe(false)
    })
  })

  describe('EST (winter, UTC-5)', () => {
    // Friday 2026-01-16. The 9 UTC fire is 4:30am ET and must not send.
    it('rejects the 9 UTC fire (4:30am EST)', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-01-16', 9))).toBe(false)
    })

    it('accepts the 10 UTC fire as the 5:30am EST send', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-01-16', 10))).toBe(true)
    })

    it('accepts the 11 and 12 UTC retry fires', () => {
      expect(isMorningUpdateSendWindow(cronFire('2026-01-16', 11))).toBe(true)
      expect(isMorningUpdateSendWindow(cronFire('2026-01-16', 12))).toBe(true)
    })
  })

  it('never sends on Sunday', () => {
    // Sunday 2026-08-16, 5:30am EDT.
    expect(isMorningUpdateSendWindow(cronFire('2026-08-16', 9))).toBe(false)
  })

  it('sends on Saturday', () => {
    expect(isMorningUpdateSendWindow(cronFire('2026-08-15', 9))).toBe(true)
  })
})

describe('getBlastSendDate', () => {
  it('uses the Eastern calendar date, not the UTC one', () => {
    // 01:30 UTC on Aug 15 is still Aug 14 in Eastern time.
    expect(getBlastSendDate(new Date('2026-08-15T01:30:00.000Z'))).toBe('2026-08-14')
  })

  it('is stable across every fire of the same morning', () => {
    const dates = [9, 10, 11, 12].map((hour) => getBlastSendDate(cronFire('2026-08-14', hour)))
    expect(new Set(dates).size).toBe(1)
    expect(dates[0]).toBe('2026-08-14')
  })
})
