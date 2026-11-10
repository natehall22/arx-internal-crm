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

/**
 * Per-company time zone (orgs.timezone). The cron fires :30 past 9–13 UTC; every continental US company must get
 * exactly one fire at 5:30am local on both sides of BOTH DST transitions (2026: Mar 8 and Nov 1), and Eastern must
 * behave exactly as before (the 13 UTC fire is either outside its window or a retry the daily claim absorbs).
 */
describe('isMorningUpdateSendWindow per company time zone (DST both ways)', () => {
  const FIRES = [9, 10, 11, 12, 13]
  const firstInWindow = (date: string, tz: string) => FIRES.find((h) => isMorningUpdateSendWindow(cronFire(date, h), tz))
  const zones: Array<[string, Record<string, number>]> = [
    // tz → first in-window UTC fire on: [winter before Mar 8, summer after Mar 8, summer before Nov 1, winter after Nov 1]
    ['America/New_York', { '2026-03-06': 10, '2026-03-10': 9, '2026-10-30': 9, '2026-11-03': 10 }],
    ['America/Chicago', { '2026-03-06': 11, '2026-03-10': 10, '2026-10-30': 10, '2026-11-03': 11 }],
    ['America/Denver', { '2026-03-06': 12, '2026-03-10': 11, '2026-10-30': 11, '2026-11-03': 12 }],
    ['America/Los_Angeles', { '2026-03-06': 13, '2026-03-10': 12, '2026-10-30': 12, '2026-11-03': 13 }],
  ]
  it.each(zones)('%s gets its 5:30am local fire on both sides of each transition', (tz, expected) => {
    for (const [date, hour] of Object.entries(expected)) {
      expect([date, firstInWindow(date, tz)]).toEqual([date, hour])
      // that first fire is 5:30 local
      const local = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: false }).format(cronFire(date, hour))
      expect(local).toBe('05:30')
    }
  })

  it('the default zone is unchanged (no tz argument = Eastern)', () => {
    for (const d of ['2026-03-06', '2026-03-10', '2026-10-30', '2026-11-03']) {
      for (const h of FIRES) {
        expect(isMorningUpdateSendWindow(cronFire(d, h))).toBe(isMorningUpdateSendWindow(cronFire(d, h), 'America/New_York'))
      }
    }
  })

  it('Sunday is local Sunday: a Pacific Saturday 13:30 UTC fire still sends, a Pacific Sunday never does', () => {
    expect(isMorningUpdateSendWindow(cronFire('2026-11-07', 13), 'America/Los_Angeles')).toBe(true) // Sat 5:30 PST
    expect(isMorningUpdateSendWindow(cronFire('2026-11-08', 13), 'America/Los_Angeles')).toBe(false) // Sun
  })

  it('send date is the company\'s own calendar date', () => {
    // 04:00 UTC Nov 3 = Nov 2 11pm Eastern = Nov 2 8pm Pacific; 06:30 UTC = Nov 3 1:30am Eastern, Nov 2 10:30pm Pacific
    expect(getBlastSendDate(new Date('2026-11-03T06:30:00Z'), 'America/New_York')).toBe('2026-11-03')
    expect(getBlastSendDate(new Date('2026-11-03T06:30:00Z'), 'America/Los_Angeles')).toBe('2026-11-02')
    // inside the window every zone agrees on the date
    expect(getBlastSendDate(cronFire('2026-11-03', 13), 'America/Los_Angeles')).toBe('2026-11-03')
  })
})
