/**
 * Hourly billing rules (lib/hourly-billing.ts): rounding, minimums, drive time, person-hours vs crew-hours, machines
 * (own time vs the operator's), open clocks, midnight / clock-change days, office edits and the invoice lines.
 */
import {
  DEFAULT_HOURLY_BILLING_SETTINGS,
  billableLines,
  clockedDays,
  dayBillableHours,
  dayClockedSeconds,
  invoiceLinesForDay,
  jobTarget,
  lineDescription,
  linesFromEdit,
  linesFromSnapshot,
  approvalLineSnapshot,
  parseDayEdit,
  parseHourlyBillingPatch,
  readHourlyBillingSettings,
  roundBillableHours,
  sameLines,
  visitTarget,
  type BillContext,
  type HourlyBillingSettings,
  type Rate,
} from '@/lib/hourly-billing'
import { hasAtMost2Decimals, invoiceItemLineFields } from '@/lib/invoice-lines'
import { localTimeToInstant, paidTime, type TimeEntry } from '@/lib/time-tracking'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const TZ = DEFAULT_TIMEZONE
const D = '2026-06-10'
const at = (hm: string, ymd = D) => localTimeToInstant(ymd, hm, TZ)!.toISOString()
const JOB = 'job-1'
const OTHER_JOB = 'job-2'
const VISIT = 'visit-1'
const TRACTOR = '33333333-3333-4333-8333-000000000001'
const MOWER = '33333333-3333-4333-8333-000000000002'
const TRIP = '33333333-3333-4333-8333-000000000009'

let n = 0
function e(p: Partial<TimeEntry> & Pick<TimeEntry, 'kind' | 'startedAt'>): TimeEntry {
  return {
    id: `e${++n}`,
    userId: null,
    subId: null,
    workOrderId: null,
    jobId: null,
    endedAt: null,
    source: 'lead_tap',
    endSource: 'lead_tap',
    closedForTravel: false,
    needsReview: false,
    reviewNote: null,
    pricebookItemId: null,
    tappedBy: null,
    endedBy: null,
    ...p,
  }
}
const work = (userId: string, from: string, to: string | null, where: { jobId?: string; workOrderId?: string } = { jobId: JOB }, x: Partial<TimeEntry> = {}) =>
  e({ kind: 'work', userId, startedAt: at(from), endedAt: to ? at(to) : null, jobId: where.jobId ?? null, workOrderId: where.workOrderId ?? null, ...x })
const brk = (userId: string, from: string, to: string) => e({ kind: 'break', userId, startedAt: at(from), endedAt: at(to) })
const machine = (item: string, by: string | null, from: string, to: string | null, where: { jobId?: string; workOrderId?: string } = { jobId: JOB }) =>
  e({ kind: 'equipment', pricebookItemId: item, tappedBy: by, startedAt: at(from), endedAt: to ? at(to) : null, jobId: where.jobId ?? null, workOrderId: where.workOrderId ?? null })

const billedJobs = new Set([JOB])
const billedVisits = new Set([VISIT])
const targetOf = (x: TimeEntry) => (x.workOrderId && billedVisits.has(x.workOrderId) ? visitTarget(x.workOrderId) : x.jobId && billedJobs.has(x.jobId) ? jobTarget(x.jobId) : null)
const days = (entries: TimeEntry[], now = Date.parse(at('23:00'))) => clockedDays(entries, { timeZone: TZ, targetOf, now })
const dayOf = (entries: TimeEntry[], target = jobTarget(JOB), date = D) => days(entries).get(target)?.get(date)

const LABOR: Rate = { itemId: 'labor-item', name: 'Grading labor', rateCents: 6500, taxable: false }
const RATES = new Map<string, Rate>([
  [TRACTOR, { itemId: TRACTOR, name: 'Tractor', rateCents: 9500, taxable: true }],
  [MOWER, { itemId: MOWER, name: 'Mower', rateCents: 4000, taxable: false }],
])
const TRIP_RATE: Rate = { itemId: TRIP, name: 'Trip charge', rateCents: 3500, taxable: false }
const ctx = (s: Partial<HourlyBillingSettings> = {}, labor: Rate | null = LABOR): BillContext => ({
  settings: { ...DEFAULT_HOURLY_BILLING_SETTINGS, ...s },
  labor,
  equipment: RATES,
  trip: TRIP_RATE,
})
const lines = (entries: TimeEntry[], s: Partial<HourlyBillingSettings> = {}) => billableLines(dayOf(entries)!, ctx(s))
const kind = (ls: ReturnType<typeof lines>, k: string) => ls.filter((l) => l.kind === k)

describe('rounding', () => {
  it('exact = hundredths of an hour; up / nearest quarter hour', () => {
    expect(roundBillableHours(0, 'up15')).toBe(0)
    expect(roundBillableHours(3600, 'none')).toBe(1)
    expect(roundBillableHours(6 * 3600 + 7 * 60, 'none')).toBe(6.12)
    expect(roundBillableHours(6 * 3600 + 7 * 60, 'up15')).toBe(6.25)
    expect(roundBillableHours(6 * 3600 + 7 * 60, 'nearest15')).toBe(6)
    expect(roundBillableHours(6 * 3600 + 8 * 60, 'nearest15')).toBe(6.25)
    expect(roundBillableHours(6 * 3600 + 7.5 * 60, 'nearest15')).toBe(6.25) // half rounds up
    expect(roundBillableHours(15 * 60, 'up15')).toBe(0.25) // exactly on a quarter stays
    expect(roundBillableHours(15 * 60 + 1, 'up15')).toBe(0.5)
    expect(roundBillableHours(60, 'up15')).toBe(0.25)
    expect(roundBillableHours(60, 'nearest15')).toBe(0)
  })
})

describe('company rules (settings)', () => {
  it('defaults, and anything bad is the default', () => {
    expect(readHourlyBillingSettings({})).toEqual(DEFAULT_HOURLY_BILLING_SETTINGS)
    expect(readHourlyBillingSettings({ hourlyBilling: { rounding: 'weird', minimumHours: -1, basis: 'x', travel: 'nope' } })).toEqual(DEFAULT_HOURLY_BILLING_SETTINGS)
    expect(readHourlyBillingSettings({ hourlyBilling: { rounding: 'up15', minimumHours: 2, basis: 'crew', travel: 'yes', equipmentFromOperator: false } })).toEqual({
      rounding: 'up15', minimumHours: 2, basis: 'crew', travel: 'yes', tripChargeItemId: null, equipmentFromOperator: false,
    })
  })
  it('a trip charge with no item reads as "no drive time" (never promises a charge it cannot make)', () => {
    expect(readHourlyBillingSettings({ hourlyBilling: { travel: 'trip_charge' } }).travel).toBe('no')
    expect(readHourlyBillingSettings({ hourlyBilling: { travel: 'trip_charge', tripChargeItemId: TRIP } }).travel).toBe('trip_charge')
  })
  it('owner saves are validated', () => {
    expect(parseHourlyBillingPatch({ hourlyBilling: { rounding: 'up15', minimumHours: '2.5' } })).toEqual({ set: { rounding: 'up15', minimumHours: 2.5 } })
    expect(parseHourlyBillingPatch({ hourlyBilling: { minimumHours: 30 } })).toHaveProperty('error')
    expect(parseHourlyBillingPatch({ hourlyBilling: { minimumHours: 1.255 } })).toHaveProperty('error')
    expect(parseHourlyBillingPatch({ hourlyBilling: { tripChargeItemId: 'not-a-uuid' } })).toHaveProperty('error')
    expect(parseHourlyBillingPatch({ hourlyBilling: { color: 'red' } })).toHaveProperty('error')
    expect(parseHourlyBillingPatch({ hourlyBilling: {} })).toHaveProperty('error')
  })
})

describe('labor: person-hours vs crew-hours', () => {
  // Two people at the job 8:00–14:07; Ana takes a 30-min lunch, Bo does not.
  const entries = () => [work('ana', '08:00', '14:07'), brk('ana', '12:00', '12:30'), work('bo', '08:00', '14:07')]

  it('person basis: each person net of their own breaks, summed', () => {
    const l = kind(lines(entries()), 'labor')
    expect(l).toHaveLength(1)
    // 5:37 + 6:07 = 11:44 exact → 5.62 + 6.12
    expect(l[0].hours).toBe(11.74)
    expect(l[0].people).toBe(2)
    expect(l[0].rateCents).toBe(6500)
  })
  it('person basis with rounding up: each person rounded on their own', () => {
    const l = kind(lines(entries(), { rounding: 'up15' }), 'labor')
    expect(l[0].hours).toBe(5.75 + 6.25)
    expect(l[0].reasons.join(' ')).toMatch(/each person rounded up/)
  })
  it('crew basis: time anyone was working there, billed once', () => {
    const l = kind(lines(entries(), { basis: 'crew', rounding: 'up15' }), 'labor')
    expect(l[0].hours).toBe(6.25) // 8:00–14:07 (Bo covered Ana's lunch)
    expect(l[0].people).toBe(2)
    expect(l[0].reasons[0]).toMatch(/Crew of 2/)
  })
  it('crew basis: the whole crew at lunch is not billed', () => {
    const l = kind(lines([...entries(), brk('bo', '12:00', '12:30')], { basis: 'crew' }), 'labor')
    expect(l[0].hours).toBe(5.62)
  })
  it('clocked seconds kept for the audit trail are exact (no rounding)', () => {
    expect(dayClockedSeconds(dayOf(entries())!)).toBe((5 * 60 + 37 + 6 * 60 + 7) * 60)
  })
  it('time on a job not billed by the hour is not billed, but its lunch still comes off', () => {
    const d = dayOf([work('ana', '07:00', '08:00', { jobId: OTHER_JOB }), work('ana', '08:00', '10:00'), brk('ana', '09:00', '09:15')])!
    expect(Array.from(d.people.get('ana')!.work).length).toBe(2)
    expect(billableLines(d, ctx())[0].hours).toBe(1.75)
    expect(days([work('ana', '07:00', '08:00', { jobId: OTHER_JOB })]).size).toBe(0)
  })
})

describe('minimum hours per visit', () => {
  it('raises labor (and each machine) up to the minimum, with the reason', () => {
    const ls = lines([work('ana', '09:00', '09:45'), machine(MOWER, 'ana', '09:00', '09:30')], { minimumHours: 2, equipmentFromOperator: false })
    expect(kind(ls, 'labor')[0].hours).toBe(2)
    expect(kind(ls, 'labor')[0].reasons.join(' ')).toMatch(/2 h minimum/)
    expect(kind(ls, 'equipment')[0].hours).toBe(2)
  })
  it('person basis: the minimum is for the visit, not per person', () => {
    const ls = lines([work('ana', '09:00', '09:45'), work('bo', '09:00', '09:45')], { minimumHours: 2 })
    expect(kind(ls, 'labor')[0].hours).toBe(2)
  })
  it('over the minimum: untouched', () => {
    expect(kind(lines([work('ana', '09:00', '12:00')], { minimumHours: 2 }), 'labor')[0].hours).toBe(3)
  })
  it('never invents labor on a day with no one working', () => {
    expect(kind(lines([machine(TRACTOR, null, '09:00', '09:30')], { minimumHours: 2 }), 'labor')).toHaveLength(0)
  })
})

describe('drive time', () => {
  // Ana: another (fixed-price) stop 07:00–09:30, closed "going to the next stop", arrives at the job 10:00.
  const entries = () => [work('ana', '07:00', '09:30', { jobId: OTHER_JOB }, { closedForTravel: true }), work('ana', '10:00', '12:00')]

  it("'no': not billed", () => {
    expect(kind(lines(entries()), 'travel')).toHaveLength(0)
  })
  it("'yes': the drive to this stop is its own line at the labor rate", () => {
    const t = kind(lines(entries(), { travel: 'yes' }), 'travel')
    expect(t).toHaveLength(1)
    expect(t[0].hours).toBe(0.5)
    expect(t[0].rateCents).toBe(6500)
    expect(t[0].name).toBe('Travel time')
  })
  it("'yes': drive time FROM this stop belongs to the next stop, not here", () => {
    const d = dayOf([work('ana', '08:00', '10:00', { jobId: JOB }, { closedForTravel: true }), work('ana', '10:30', '12:00', { jobId: OTHER_JOB })])!
    expect(billableLines(d, ctx({ travel: 'yes' })).map((l) => l.kind)).toEqual(['labor'])
  })
  it("'yes': a lunch on the way is not billed as drive time", () => {
    const t = kind(lines([...entries(), brk('ana', '09:40', '09:50')], { travel: 'yes' }), 'travel')
    expect(t[0].hours).toBe(0.33)
  })
  it("'trip_charge': one flat line per visit with anything billed", () => {
    const ls = lines(entries(), { travel: 'trip_charge', tripChargeItemId: TRIP })
    expect(kind(ls, 'travel')).toHaveLength(0)
    expect(kind(ls, 'trip')).toEqual([expect.objectContaining({ hours: 1, rateCents: 3500, name: 'Trip charge' })])
  })
  it('drive time is never pay-changed here: payroll paidTime still sees the same travel', () => {
    const p = paidTime(entries(), { timeZone: TZ })
    expect(p.travel.reduce((s, i) => s + i.end - i.start, 0)).toBe(30 * 60_000)
  })
})

describe('machines', () => {
  it("own on/off time, or the operator's hours at that stop", () => {
    const entries = [work('ana', '09:00', '12:00'), machine(TRACTOR, 'ana', '09:00', '15:00')]
    expect(kind(lines(entries, { equipmentFromOperator: false }), 'equipment')[0].hours).toBe(6)
    const op = kind(lines(entries, { equipmentFromOperator: true }), 'equipment')[0]
    expect(op.hours).toBe(3)
    expect(op.reasons[0]).toMatch(/Operator's time 3 h \(machine ran 6 h\)/)
    expect(op.rateCents).toBe(9500)
    expect(op.taxable).toBe(true)
  })
  it('two operators taking turns on one tractor bill it once (union of their time, not the sum)', () => {
    const entries = [work('ana', '08:00', '12:00'), work('bo', '10:00', '14:00'), machine(TRACTOR, 'ana', '08:00', '11:00'), machine(TRACTOR, 'bo', '11:00', '14:00')]
    expect(kind(lines(entries), 'equipment')[0].hours).toBe(6) // 08:00–14:00, not 4 + 4
    expect(kind(lines(entries, { equipmentFromOperator: false }), 'equipment')[0].hours).toBe(6)
  })
  it('one machine tapped twice over the same stretch counts once', () => {
    expect(kind(lines([machine(TRACTOR, null, '09:00', '11:00'), machine(TRACTOR, null, '10:00', '12:00')], { equipmentFromOperator: false }), 'equipment')[0].hours).toBe(3)
  })
  it('no operator time at that stop → the machine’s own time', () => {
    expect(kind(lines([machine(TRACTOR, 'zed', '09:00', '10:30')]), 'equipment')[0].hours).toBe(1.5)
  })
  it('two machines: two lines, rounded each', () => {
    const ls = lines([machine(TRACTOR, null, '09:00', '10:05'), machine(MOWER, null, '09:00', '09:20')], { rounding: 'up15', equipmentFromOperator: false })
    expect(kind(ls, 'equipment').map((l) => [l.name, l.hours])).toEqual([['Mower', 0.5], ['Tractor', 1.25]])
  })
  it('a machine still running = the day is not finished', () => {
    expect(dayOf([work('ana', '09:00', '10:00'), machine(TRACTOR, 'ana', '09:00', null)])!.open).toBe(true)
  })
})

describe('days', () => {
  it('a person still clocked in marks the day open and bills nothing for that stretch', () => {
    const d = dayOf([work('ana', '09:00', null)])!
    expect(d.open).toBe(true)
    expect(billableLines(d, ctx())).toEqual([])
  })
  it('a shift past midnight is ONE billing day (its start day): rounding and the minimum apply once', () => {
    const overnight = e({ kind: 'work', userId: 'ana', jobId: JOB, startedAt: at('22:00'), endedAt: at('02:00', '2026-06-11') })
    const split = days([overnight]).get(jobTarget(JOB))!
    expect(Array.from(split.keys())).toEqual([D])
    expect(split.get(D)!.people.get('ana')!.workSeconds).toBe(4 * 3600)
    expect(billableLines(split.get(D)!, ctx({ minimumHours: 2, rounding: 'up15' }))[0].hours).toBe(4)
  })
  it('a visit past midnight keeps all its time on its first day (billed once, nothing stranded)', () => {
    const late = e({ kind: 'work', userId: 'ana', workOrderId: VISIT, startedAt: at('22:00'), endedAt: at('01:30', '2026-06-11') })
    const m = days([late]).get(visitTarget(VISIT))!
    expect(Array.from(m.keys())).toEqual([D])
    expect(m.get(D)!.people.get('ana')!.workSeconds).toBe(3.5 * 3600)
  })
  it('clock change (fall back, Nov 1): a 00:00–04:00 shift is 5 real hours on one day', () => {
    const x = e({ kind: 'work', userId: 'ana', jobId: JOB, startedAt: at('00:00', '2026-11-01'), endedAt: at('04:00', '2026-11-01') })
    expect(days([x]).get(jobTarget(JOB))!.get('2026-11-01')!.people.get('ana')!.workSeconds).toBe(5 * 3600)
  })
  it('clock change (spring forward, Mar 8): a 00:00–04:00 shift is 3 real hours', () => {
    const x = e({ kind: 'work', userId: 'ana', jobId: JOB, startedAt: at('00:00', '2026-03-08'), endedAt: at('04:00', '2026-03-08') })
    expect(days([x]).get(jobTarget(JOB))!.get('2026-03-08')!.people.get('ana')!.workSeconds).toBe(3 * 3600)
  })
  it('a visit is keyed by its own work order; an auto-closed clock asks for a look', () => {
    const d = days([work('ana', '09:00', '11:00', { workOrderId: VISIT }, { endSource: 'auto_closed', needsReview: true })]).get(visitTarget(VISIT))!.get(D)!
    expect(d.needsReview).toBe(true)
    expect(billableLines(d, ctx())[0].hours).toBe(2)
  })
  it('no labor rate yet: the line has no rate (the day cannot be approved)', () => {
    expect(billableLines(dayOf([work('ana', '09:00', '10:00')])!, ctx({}, null))[0].rateCents).toBeNull()
  })
})

describe('office edits / typed hours', () => {
  it('parses kinds / machines / people / hours, never prices', () => {
    const p = parseDayEdit({ lines: [{ kind: 'labor', people: 3, hours: '19.5', rateCents: 1 }, { kind: 'equipment', itemId: TRACTOR, hours: 6 }, { kind: 'trip' }], reason: ' clock left on ' })
    expect(p).toEqual({ edit: { lines: [{ kind: 'labor', people: 3, hours: 19.5 }, { kind: 'equipment', itemId: TRACTOR, hours: 6 }, { kind: 'trip', hours: 1 }], reason: 'clock left on' } })
  })
  it('refuses bad input', () => {
    expect(parseDayEdit({ lines: [] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'labor', hours: 0 }] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'labor', hours: 1.255 }] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'labor', hours: 800 }] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'labor', hours: 1 }, { kind: 'labor', hours: 2 }] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'equipment', itemId: 'x', hours: 1 }] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'labor', people: 0, hours: 1 }] })).toHaveProperty('error')
    expect(parseDayEdit({ lines: [{ kind: 'bonus', hours: 1 }] })).toHaveProperty('error')
  })
  it('rates come from the price book / plan, not the edit; unknown machine refused', () => {
    const built = linesFromEdit({ lines: [{ kind: 'labor', people: 2, hours: 13 }, { kind: 'equipment', itemId: TRACTOR, hours: 6.5 }], reason: '' }, ctx())
    expect(built).toEqual({ lines: [expect.objectContaining({ kind: 'labor', rateCents: 6500, hours: 13, people: 2 }), expect.objectContaining({ kind: 'equipment', rateCents: 9500, hours: 6.5 })] })
    expect(linesFromEdit({ lines: [{ kind: 'equipment', itemId: '33333333-3333-4333-8333-0000000000aa', hours: 1 }], reason: '' }, ctx())).toHaveProperty('error')
    expect(linesFromEdit({ lines: [{ kind: 'labor', hours: 1 }], reason: '' }, ctx({}, null))).toHaveProperty('error')
  })
  it('an edit that changes nothing is the clock’s own lines', () => {
    const computed = lines([work('ana', '08:00', '14:00'), work('bo', '08:00', '14:00')])
    const same = linesFromEdit({ lines: [{ kind: 'labor', people: 2, hours: 12 }], reason: '' }, ctx())
    expect('lines' in same && sameLines(same.lines, computed)).toBe(true)
    const diff = linesFromEdit({ lines: [{ kind: 'labor', people: 2, hours: 11 }], reason: '' }, ctx())
    expect('lines' in diff && sameLines(diff.lines, computed)).toBe(false)
  })
})

describe('invoice lines', () => {
  it('date column, hours × rate, plain words; a trip charge is "each"', () => {
    const ls = [
      ...lines([work('ana', '08:00', '14:00'), work('bo', '08:00', '14:00'), work('cy', '08:00', '14:00'), machine(TRACTOR, 'ana', '08:00', '14:00')], { travel: 'trip_charge', tripChargeItemId: TRIP }),
    ]
    const inv = invoiceLinesForDay(D, ls)
    expect(inv).toEqual([
      { description: 'Grading labor — 3 people × 6 hrs', qty: 18, unit_price_cents: 6500, taxable: false, unit: 'hour', service_date: D },
      { description: 'Tractor', qty: 6, unit_price_cents: 9500, taxable: true, unit: 'hour', service_date: D },
      { description: 'Trip charge', qty: 1, unit_price_cents: 3500, taxable: false, service_date: D },
    ])
    expect(dayBillableHours(ls)).toBe(24)
    // Every line passes the invoice system's own line check (hours, 2 decimals, a real day).
    for (const l of inv) expect(invoiceItemLineFields(l)).not.toHaveProperty('error')
  })
  it('people with different hours: "2 people", total hours', () => {
    expect(lineDescription({ kind: 'labor', itemId: null, name: 'Labor', people: 2, hours: 11.75, rateCents: 1, taxable: false, reasons: [] })).toBe('Labor — 2 people')
  })
  it('approval snapshot round-trips', () => {
    const ls = lines([work('ana', '08:00', '09:00')])
    expect(linesFromSnapshot(JSON.parse(JSON.stringify(approvalLineSnapshot(ls))))).toEqual(ls)
    expect(linesFromSnapshot([{ kind: 'nope', hours: 1 }, null])).toEqual([])
  })
  it('hours like 1.1 and 2.3 are 2-decimal numbers (floating point)', () => {
    expect([1.1, 2.3, 0.29, 6.25].every(hasAtMost2Decimals)).toBe(true)
    expect(hasAtMost2Decimals(1.255)).toBe(false)
    expect(invoiceItemLineFields({ unit: 'hour', qty: 1.1 })).toEqual({ value: { unit: 'hour' } })
  })
})
