jest.mock('@/lib/push-apns', () => ({ sendPushToUser: jest.fn() }))
import { stateFromAddress, parseStateCode } from '@/lib/us-state'
import { buildMultiStateWarnings } from '@/lib/payroll-state-warnings'
import { amountsFor, buildProviderExport, readAdpSettings, type ExportPerson } from '@/lib/payroll-provider-export'
import { comparePlanRuns } from '@/lib/payroll-plan-preview'
import { hashToken, isCleanWeek } from '@/lib/payroll-approve-link'
import type { PayWeek, PayWeekPerson } from '@/lib/payroll-pay-week'

describe('state from address (same rule as property_address_key)', () => {
  it('reads the trailing state, with or without ZIP / country', () => {
    expect(stateFromAddress('1484 Dale Earnhardt Blvd, Kannapolis, NC 28083')).toBe('NC')
    expect(stateFromAddress('511 Allison St NW, Concord, SC 29001, USA')).toBe('SC')
    expect(stateFromAddress('12 Oak Ct')).toBeNull()
    expect(stateFromAddress('12 Elm St')).toBeNull()
    expect(stateFromAddress(null)).toBeNull()
    expect(parseStateCode(' nc ')).toBe('NC')
    expect(parseStateCode('XX')).toBeNull()
  })
})

describe('multi-state warning (text only)', () => {
  const jobs = new Map([['j1', { jobNumber: '26-0031', address: '5 Pine Rd, Rock Hill, SC 29730' }], ['j2', { jobNumber: '26-0032', address: '9 Oak Ln, Concord, NC 28027' }]])
  it('warns for a job outside the home state; unknown = silent', () => {
    const people = [{ userId: 'u1', name: 'Jordan', jobIds: ['j1', 'j2'] }, { userId: 'u2', name: 'Riley', jobIds: ['j2'] }]
    const w = buildMultiStateWarnings({ people, jobs, home: new Map(), companyState: 'NC' })
    expect(w).toHaveLength(1)
    expect(w[0].text).toContain('Jordan is paid in NC')
    expect(w[0].text).toContain('26-0031 in SC')
    // Jordan lives in SC: the NC job is now the odd one out.
    expect(buildMultiStateWarnings({ people, jobs, home: new Map([['u1', 'SC']]), companyState: 'NC' })[0].text).toContain('26-0032 in NC')
    expect(buildMultiStateWarnings({ people, jobs, home: new Map(), companyState: null })).toEqual([])
  })
})

const person = (o: Partial<PayWeekPerson> & { lines: PayWeekPerson['lines'] }): PayWeekPerson => ({ userId: 'u1', name: 'Jordan Vale', roleLabel: 'Closer', total: 0, raw: 0, hoursMissing: false, ...o })
const week = (people: PayWeekPerson[], state: 'draft' | 'approved' = 'approved'): PayWeek => ({ period: { weekStart: '2026-11-02', weekEnding: '2026-11-08', payDate: '2026-11-13', cutoffAt: '2026-11-09T04:59:59Z' }, state, totals: { amount: people.reduce((s, p) => s + p.total, 0), people: people.length }, canApprove: true, blockedBy: null, needs: [], warnings: [], people } as unknown as PayWeek)

describe('provider export', () => {
  const p = person({ total: 1100, lines: [
    { kind: 'Commission', what: 'x', math: '', amount: 1400 },
    { kind: 'Hourly', what: 'h', math: '', amount: 0 },
    { kind: 'Bonus', what: 'b', math: '', amount: 50 },
    { kind: 'Adjustment', what: 'Fix', math: '', amount: -50, adjustmentKind: 'fix' },
    { kind: 'Adjustment', what: 'Advance repaid', math: '', amount: -300, adjustmentKind: 'advance_recovery' },
  ], hours: { regular: 0, overtime: 0 } })
  const people = new Map<string, ExportPerson>([['u1', { userId: 'u1', firstName: '=Jordan', lastName: 'Vale', email: 'j@x.co', employeeId: '77' }]])
  it('splits by kind and ties to the check', () => {
    const a = amountsFor(p)
    expect(a).toMatchObject({ commission: 1400, bonus: 50, other: -50, advance: 300, total: 1100 })
    expect(a.commission + a.bonus + a.other - a.advance).toBe(a.total)
  })
  it('Gusto: plain headers, formula-safe names', () => {
    const out = buildProviderExport({ provider: 'gusto', week: week([p]), people })
    const [head, line] = out.csv.trim().split('\n')
    expect(head).toBe('First name,Last name,Email,Regular hours,Overtime hours,Commission,Bonus,"Other pay (fixes, balances)",Advance repaid (deduct),Total pay')
    expect(line).toBe("'=Jordan,Vale,j@x.co,0,0,1400.00,50.00,-50.00,300.00,1100.00")
    expect(out.filename).toBe('gusto-pay-week-ending-2026-11-08.csv')
  })
  it('ADP: documented columns, batch id = week end MMDDYY, missing file numbers and company code are listed', () => {
    const noId = new Map(people)
    noId.set('u1', { ...people.get('u1')!, employeeId: null })
    const out = buildProviderExport({ provider: 'adp', week: week([p]), people: noId, adp: readAdpSettings({ payrollExport: { coCode: 'AB1', codes: { commission: 'COM' } } }) })
    expect(out.csv.split('\n')[0].startsWith('Co Code,Batch ID,File #,Employee Name,Reg Hours,O/T Hours,Earnings 3 Code,Earnings 3 Amount')).toBe(true)
    expect(out.csv.split('\n')[1].startsWith('AB1,110826,,')).toBe(true)
    expect(out.missing).toEqual([{ userId: 'u1', name: 'Jordan Vale', why: 'No ADP file number' }])
    expect(out.csv).toContain('ADV,300.00')
    expect(buildProviderExport({ provider: 'adp', week: week([p]), people }).missing[0].why).toBe('ADP company code is not set')
  })
  it('only approved weeks', () => {
    expect(() => buildProviderExport({ provider: 'gusto', week: week([p], 'draft'), people })).toThrow()
  })
})

describe('plan preview comparison', () => {
  it('keeps only people whose pay changes, biggest first', () => {
    const m = (...e: Array<[string, number]>) => new Map(e.map(([id, total]) => [id, { name: id, total }]))
    const out = comparePlanRuns(['w1', 'w2'], [m(['a', 100], ['b', 50]), m(['a', 100], ['b', 50])], [m(['a', 100], ['b', 80]), m(['a', 150], ['b', 50])])
    expect(out.map((x) => [x.userId, x.difference])).toEqual([['b', 30], ['a', 50]].sort((x, y) => (y[1] as number) - (x[1] as number)))
    expect(comparePlanRuns(['w'], [m(['a', 1])], [m(['a', 1])])).toEqual([])
  })
})

describe('one-tap approve', () => {
  const clean = week([person({ total: 100, lines: [] })], 'draft')
  const now = new Date('2026-11-10T12:00:00Z')
  it('clean = ended, nothing needs anyone, no warning beyond another-state', () => {
    expect(isCleanWeek(clean, now)).toBe(true)
    expect(isCleanWeek({ ...clean, warnings: [{ code: 'multi_state', text: '' }] }, now)).toBe(true)
    expect(isCleanWeek({ ...clean, warnings: [{ code: 'big_line', text: '' }] }, now)).toBe(false)
    expect(isCleanWeek({ ...clean, needs: [{ kind: 'hours' } as never] }, now)).toBe(false)
    expect(isCleanWeek({ ...clean, blockedBy: { code: 'minimum_unanswered', text: '', count: 1 } }, now)).toBe(false)
    expect(isCleanWeek(clean, new Date('2026-11-08T12:00:00Z'))).toBe(false)
    expect(isCleanWeek({ ...clean, state: 'approved' }, now)).toBe(false)
  })
  it('stores only a hash', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('abc')).not.toContain('abc')
  })
})
