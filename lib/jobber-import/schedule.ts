/**
 * Move from Jobber — a recurring job's schedule as a service plan's seasons. Pure and client-safe.
 *
 * Jobber's Recurring jobs report has NO frequency column (help.getjobber.com "Recurring jobs report": start/end date,
 * visits assigned, completed visits — no repeat rule), so the schedule is worked out:
 *   1. from the Visits report, when it was uploaded: the gaps between the job's visit dates, month by month (weekly in
 *      summer and every 2 weeks in the shoulder months become two seasons), the usual weekday, the months with visits;
 *   2. else from words in the job title / line items ("weekly", "bi-weekly", "monthly");
 *   3. else weekly, all year — and the plan says so ("check how often").
 * Every imported plan arrives PAUSED ("needs review"), so a wrong guess never puts a visit on anyone's calendar.
 */
import type { Season, ServiceFrequency } from '@/lib/service-plans'

export type InferredSchedule = {
  seasons: Season[]
  weekday: number | null
  source: 'visits' | 'words' | 'default'
  /** Plain sentences for the "needs review" list. */
  notes: string[]
}

const DAY = 86_400_000
const toMs = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
const pad = (n: number) => String(n).padStart(2, '0')
const LAST_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function gapFrequency(days: number): ServiceFrequency {
  if (days <= 10) return 'weekly'
  if (days <= 20) return 'every_2_weeks'
  if (days <= 27) return 'every_4_weeks'
  if (days <= 35) return days === 28 ? 'every_4_weeks' : 'monthly'
  return 'monthly'
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export function frequencyFromWords(text: string): ServiceFrequency | null {
  const t = text.toLowerCase()
  if (/\b(bi-?weekly|every (other|2nd|second|two|2) weeks?|fortnight)/.test(t)) return 'every_2_weeks'
  if (/\bevery (4|four) weeks?/.test(t)) return 'every_4_weeks'
  if (/\bmonthly|every month|once a month/.test(t)) return 'monthly'
  if (/\bweekly|every week|once a week/.test(t)) return 'weekly'
  return null
}

/**
 * Seasons from visit dates ("YYYY-MM-DD", any order, duplicates ok). Months are calendar months; a month with visits but
 * no gap of its own takes the next month's frequency (or the previous one's). Consecutive months with the same frequency
 * become one season ("Apr 1 – Oct 31 weekly"); a year with visits every month is one all-year season.
 */
export function seasonsFromVisits(dates: string[]): { seasons: Season[]; weekday: number | null } | null {
  const days = Array.from(new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort()
  if (days.length < 2) return null
  const gapsByMonth = new Map<number, number[]>()
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((toMs(days[i]) - toMs(days[i - 1])) / DAY)
    if (gap > 45) continue // the off season, not a frequency
    const m = +days[i - 1].slice(5, 7)
    gapsByMonth.set(m, [...(gapsByMonth.get(m) ?? []), gap])
  }
  const active = new Set(days.map((d) => +d.slice(5, 7)))
  const freq = new Map<number, ServiceFrequency>()
  for (const m of Array.from(active)) {
    const g = gapsByMonth.get(m)
    if (g?.length) freq.set(m, gapFrequency(median(g)))
  }
  if (freq.size === 0) return null
  // Months with visits but no gap of their own: nearest month that has one (forward, then backward, wrapping).
  for (const m of Array.from(active)) {
    if (freq.has(m)) continue
    for (let step = 1; step <= 12; step++) {
      const fwd = ((m - 1 + step) % 12) + 1
      const back = ((m - 1 - step + 24) % 12) + 1
      const f = freq.get(fwd) ?? freq.get(back)
      if (f) {
        freq.set(m, f)
        break
      }
    }
  }
  // Walk the year starting after a month with no visits (so a Nov–Feb winter run stays one season).
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const startAfter = months.find((m) => !active.has(m))
  const order = startAfter ? months.map((_, i) => ((startAfter + i) % 12) + 1) : months
  const runs: Array<{ from: number; to: number; frequency: ServiceFrequency }> = []
  for (const m of order) {
    const f = freq.get(m)
    if (!f) continue
    const last = runs[runs.length - 1]
    const prevMonth = ((m + 10) % 12) + 1
    if (last && last.to === prevMonth && last.frequency === f) last.to = m
    else runs.push({ from: m, to: m, frequency: f })
  }
  const seasons: Season[] =
    runs.length === 1 && active.size === 12
      ? [{ from: '01-01', to: '12-31', frequency: runs[0].frequency }]
      : runs.map((r) => ({ from: `${pad(r.from)}-01`, to: `${pad(r.to)}-${LAST_DAY[r.to - 1] === 29 ? 28 : LAST_DAY[r.to - 1]}`, frequency: r.frequency }))
  // Usual weekday = the most common one.
  const counts = new Array(7).fill(0)
  for (const d of days) counts[new Date(toMs(d)).getUTCDay()] += 1
  const top = Math.max(...counts)
  return { seasons, weekday: counts.indexOf(top) }
}

/** The plan schedule for one recurring job. `startDate` (YYYY-MM-DD) gives the weekday when visits don't. */
export function inferSchedule(input: { visitDates: string[]; words: string; startDate: string | null }): InferredSchedule {
  const fromVisits = seasonsFromVisits(input.visitDates)
  const startWeekday = input.startDate ? new Date(toMs(input.startDate)).getUTCDay() : null
  if (fromVisits) {
    return {
      seasons: fromVisits.seasons,
      weekday: fromVisits.weekday ?? startWeekday,
      source: 'visits',
      notes: [`How often was worked out from ${new Set(input.visitDates).size} visits in Jobber — check it.`],
    }
  }
  const word = frequencyFromWords(input.words)
  if (word) {
    return {
      seasons: [{ from: '01-01', to: '12-31', frequency: word }],
      weekday: startWeekday,
      source: 'words',
      notes: ['How often was read from the job’s name. Jobber’s export has no season — set the months if it isn’t all year.'],
    }
  }
  return {
    seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
    weekday: startWeekday,
    source: 'default',
    notes: ['Jobber’s export doesn’t say how often — set to weekly, all year. Change it before turning the plan on.'],
  }
}
