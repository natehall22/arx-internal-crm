/**
 * Every company gets exactly ONE morning update per local Mon–Sat, zero on Sunday, across the full cron schedule
 * (vercel.json: :30 past 9–13 UTC) for the two weeks right after each DST change. "One" = at least one fire lands in
 * the company's window, and every in-window fire maps to the same send date (the daily claim turns them into one send).
 */
import fs from 'node:fs'
import path from 'node:path'
import { orgTimeZone } from '@/lib/cron-orgs'
import { getBlastSendDate } from '@/lib/email-blast-ledger'
import { isMorningUpdateSendWindow } from '@/lib/morning-update-schedule'

const cron = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')).crons.find(
  (c: { path: string }) => c.path === '/api/cron/morning-update'
).schedule as string
const [minute, hours, , , dows] = cron.split(' ')
const FIRE_HOURS = hours.split(',').map(Number)
const [dowFrom, dowTo] = dows.split('-').map(Number)

/** Every UTC instant the cron fires between two dates (inclusive). */
function fires(fromYmd: string, toYmd: string): Date[] {
  const out: Date[] = []
  for (let d = new Date(`${fromYmd}T00:00:00Z`); d <= new Date(`${toYmd}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() < dowFrom || d.getUTCDay() > dowTo) continue
    for (const h of FIRE_HOURS) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, Number(minute))))
  }
  return out
}

const ZONES: Array<[string, string | null]> = [
  ['Eastern (ARX)', 'America/New_York'],
  ['Central', 'America/Chicago'],
  ['Mountain', 'America/Denver'],
  ['Arizona (no DST)', 'America/Phoenix'],
  ['Pacific', 'America/Los_Angeles'],
  ['blank time zone', null],
  ['invalid time zone', 'Mars/Olympus'],
]

const PERIODS = [
  ['spring forward (Mar 8 2026)', '2026-03-08', '2026-03-21'],
  ['fall back (Nov 1 2026)', '2026-11-01', '2026-11-14'],
] as const

test('the schedule includes the 13:00 UTC fire (Pacific winter 5:30am)', () => {
  expect(FIRE_HOURS).toEqual([9, 10, 11, 12, 13])
})

describe.each(PERIODS)('%s: two weeks after', (_label, from, to) => {
  it.each(ZONES)('%s: exactly one send per local Mon–Sat, none on Sunday', (_name, raw) => {
    const tz = orgTimeZone(raw)
    const claimsByDate = new Map<string, number>()
    for (const fire of fires(from, to)) {
      if (!isMorningUpdateSendWindow(fire, tz)) continue
      const date = getBlastSendDate(fire, tz)
      claimsByDate.set(date, (claimsByDate.get(date) ?? 0) + 1)
    }
    // every local Mon–Sat in the period has ≥1 in-window fire (→ exactly one send via the claim); no Sunday has any
    for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d = new Date(d.getTime() + 86400000)) {
      const ymd = d.toISOString().slice(0, 10)
      const isSunday = d.getUTCDay() === 0
      expect([ymd, claimsByDate.has(ymd)]).toEqual([ymd, !isSunday])
    }
    // the first in-window fire each day is 5:30am local
    for (const [ymd] of Array.from(claimsByDate)) {
      const first = fires(ymd, ymd).find((f) => isMorningUpdateSendWindow(f, tz))!
      const local = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(first)
      expect([ymd, local]).toEqual([ymd, '05:30'])
    }
  })
})

test('ARX (Eastern): every in-window fire of a day claims the same date, so retries can never make a second send', () => {
  for (const [, from, to] of PERIODS) {
    const byUtcDay = new Map<string, Set<string>>()
    for (const fire of fires(from, to)) {
      if (!isMorningUpdateSendWindow(fire, 'America/New_York')) continue
      const key = fire.toISOString().slice(0, 10)
      byUtcDay.set(key, (byUtcDay.get(key) ?? new Set()).add(getBlastSendDate(fire, 'America/New_York')))
    }
    for (const dates of Array.from(byUtcDay.values())) expect(dates.size).toBe(1)
  }
})
