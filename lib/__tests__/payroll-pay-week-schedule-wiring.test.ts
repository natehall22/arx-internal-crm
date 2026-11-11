/**
 * The new payroll path runs on the company's saved pay week (lib/payroll-week-schedule.ts). ARX's agreements: Monday–Sunday,
 * cutoff Sunday 11:59 PM, paid Friday, financed money in by Wednesday 11:59 PM still pays. DST: Mar 8 2026 and Nov 1 2026.
 */
jest.mock('@/lib/payroll-statement-email', () => ({ sendPayrollStatementEmail: jest.fn() }))
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { approvePayWeek } from '@/lib/payroll-approve'
import { ensureNextOpenPeriod } from '@/lib/payroll-periods'
import { findCurrentPayWeekPeriod, loadPayWeek, resolvePayWeekPeriod } from '@/lib/payroll-pay-week'
import { checkPayWeekChange, savePayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { mergeOrgSettings, mergeSettingsAt } from '@/lib/org-settings'
import { fakePayrollRpcs } from '@/lib/test-helpers/fake-payroll-rpc'

const mergeRpc = {
  rpc: {
    merge_org_settings: (a: Record<string, unknown>, tables: Record<string, Array<Record<string, unknown>>>) => {
      const o = tables.orgs.find((x) => x.id === a.p_org_id)!
      o.settings = mergeSettingsAt(o.settings, a.p_path as string[], a.p_set as Record<string, unknown>, a.p_remove as string[])
    },
  },
}

const ORG = 'org1'
const ARX_WEEK = { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 3, time: '23:59' } }
const org = (payWeek?: unknown) => ({ id: ORG, timezone: 'America/New_York', settings: payWeek ? { payWeek } : {} })

describe('a company on Monday–Sunday', () => {
  it('"the week that just ended" on a Wednesday is Mon–Sun, paid Friday, created once', async () => {
    const db = createFakeDb({ orgs: [org(ARX_WEEK)], payroll_periods: [] })
    const p = await resolvePayWeekPeriod(db.client, ORG, new Date('2026-11-11T15:00:00Z'))
    expect(p.cutoffAt).toBe('2026-11-09T04:59:59.999Z')
    expect(p.weekStart).toBe('2026-11-02')
    expect(p.weekEnding).toBe('2026-11-08')
    expect(p.payDate).toBe('2026-11-13')
    expect(p.lateFundingUntil).toBe('2026-11-12T04:59:59.999Z')
    expect(db.tables.payroll_periods).toHaveLength(1)
    expect(db.tables.payroll_periods[0].period_label).toBe('Week ending 2026-11-08')
    await resolvePayWeekPeriod(db.client, ORG, new Date('2026-11-12T15:00:00Z'))
    expect(db.tables.payroll_periods).toHaveLength(1)
  })

  it('the spring-forward and fall-back Sundays close at 11:59 PM local; next week is created on the right Sunday', async () => {
    for (const [now, cutoff, next] of [
      ['2026-03-09T15:00:00Z', '2026-03-09T03:59:59.999Z', '2026-03-16T03:59:59.999Z'],
      ['2026-11-02T15:00:00Z', '2026-11-02T04:59:59.999Z', '2026-11-09T04:59:59.999Z'],
      ['2026-10-26T15:00:00Z', '2026-10-26T03:59:59.999Z', '2026-11-02T04:59:59.999Z'],
    ]) {
      const db = createFakeDb({ orgs: [org(ARX_WEEK)], payroll_periods: [] })
      const p = await resolvePayWeekPeriod(db.client, ORG, new Date(now))
      expect(p.cutoffAt).toBe(cutoff)
      await ensureNextOpenPeriod(db.client, ORG, p.cutoffAt)
      expect(db.tables.payroll_periods.map((r) => new Date(r.cutoff_at as string).toISOString())).toContain(next)
    }
  })

  it('a rep opening My pay never creates a week', async () => {
    const db = createFakeDb({ orgs: [org(ARX_WEEK)], payroll_periods: [] })
    expect(await findCurrentPayWeekPeriod(db.client, ORG, new Date('2026-11-11T15:00:00Z'))).toBeNull()
    expect(db.tables.payroll_periods).toHaveLength(0)
  })

  it('a week whose neighbour is 4 days back is a 4-day in-between week (unit pay window starts at the neighbour)', async () => {
    const db = createFakeDb({
      orgs: [org(ARX_WEEK)],
      payroll_periods: [
        { id: 'old', org_id: ORG, status: 'locked', cutoff_at: '2026-11-12T04:59:59.999Z', scheduled_pay_date: '2026-11-13', period_label: 'Week ending 2026-11-11', created_at: '2026-11-01T00:00:00Z' },
        { id: 'new', org_id: ORG, status: 'open', cutoff_at: '2026-11-16T04:59:59.999Z', scheduled_pay_date: '2026-11-20', period_label: 'Week ending 2026-11-15', created_at: '2026-11-02T00:00:00Z' },
        { id: 'gone', org_id: ORG, status: 'cancelled', cutoff_at: '2026-11-14T04:59:59.999Z', scheduled_pay_date: '2026-11-13', period_label: 'x', created_at: '2026-11-02T00:00:00Z' },
      ],
    })
    const p = await resolvePayWeekPeriod(db.client, ORG, new Date(), 'new')
    expect(p.weekStart).toBe('2026-11-12')
    expect(p.windowStartIso).toBe('2026-11-12T04:59:59.999Z')
  })

  it('approving before Sunday night is refused with the company\'s own cutoff day', async () => {
    const db = createFakeDb({ orgs: [org(ARX_WEEK)], payroll_periods: [{ id: 'w', org_id: ORG, status: 'open', cutoff_at: '2026-11-16T04:59:59.999Z', scheduled_pay_date: '2026-11-20', period_label: 'Week ending 2026-11-15' }], users: [{ id: 'u', org_id: ORG, role: 'admin', active: true, is_super_admin: true }] })
    const r = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'u', periodId: 'w', expectedTotal: 0, now: new Date('2026-11-15T15:00:00Z') })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.body.error).toBe("This week hasn't ended yet. Approve it after Sunday night.")
  })

  it('the screen says the pay week in words and warns while late money can still land', async () => {
    const db = createFakeDb({ orgs: [org(ARX_WEEK)], payroll_periods: [], users: [] })
    const week = await loadPayWeek(db.client, ORG, new Date('2026-11-10T15:00:00Z'))
    expect(week.schedule.words).toBe('Monday–Sunday · closes Sunday 11:59 PM · paid Friday · money in by Wednesday 11:59 PM still pays that week')
    expect(week.warnings.map((w) => w.code)).toContain('late_money_open')
    const after = await loadPayWeek(db.client, ORG, new Date('2026-11-12T15:00:00Z'))
    expect(after.warnings.map((w) => w.code)).not.toContain('late_money_open')
  })
})

describe('changing the pay week', () => {
  const legacyOpen = (id: string, cutoff: string) => ({ id, org_id: ORG, status: 'open', cutoff_at: cutoff, scheduled_pay_date: '2026-11-13', period_label: id, created_at: '2026-11-01T00:00:00Z' })

  it('preview: last Wednesday week exists → Thursday–Sunday in-between week, dates shown before saving', async () => {
    const db = createFakeDb({ orgs: [org()], payroll_periods: [{ ...legacyOpen('wed', '2026-11-12T04:59:59.999Z'), status: 'locked' }] })
    const r = await checkPayWeekChange(db.client, ORG, ARX_WEEK, new Date('2026-11-12T15:00:00Z'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current.words).toBe('Thursday–Wednesday · closes Wednesday 11:59 PM · paid Friday')
    expect(r.value.preview.firstWeek).toEqual({ start: '2026-11-12', end: '2026-11-15', payDate: '2026-11-20', days: 4 })
    expect(r.value.blockers).toEqual([])
    expect(r.value.oldWeeks).toEqual([])
  })

  it('Wed -> Sun: old open weeks close cleanly — their hours/fixes move to the new Sunday week covering them; next week is a Sunday', async () => {
    const db = createFakeDb({
      orgs: [org()],
      users: [{ id: 'u', org_id: ORG, full_name: 'U', role: 'canvasser', active: true }],
      payroll_periods: [legacyOpen('full', '2026-11-05T04:59:59.999Z'), legacyOpen('empty', '2026-11-12T04:59:59.999Z')],
      payroll_rep_hours: [{ id: 'h', org_id: ORG, payroll_period_id: 'full', user_id: 'u', hourly_earnings: 10 }],
      payroll_adjustments: [{ id: 'f', org_id: ORG, payroll_period_id: 'full', user_id: 'u', amount: 25, reason: 'x', kind: 'fix', status: 'pending' }],
    }, { rpc: { ...mergeRpc.rpc, ...fakePayrollRpcs } as never })
    const pre = await checkPayWeekChange(db.client, ORG, ARX_WEEK, new Date('2026-11-12T15:00:00Z'))
    expect(pre.ok && pre.value.oldWeeks.map((w) => [w.weekEnding, w.movesTo, w.what])).toEqual([['2026-11-04', '2026-11-08', 'hours, fixes'], ['2026-11-11', '2026-11-15', 'nothing']])
    const saved = await savePayWeekSchedule(db.client, ORG, ARX_WEEK, new Date('2026-11-12T15:00:00Z'))
    expect(saved.ok).toBe(true)
    expect(db.tables.payroll_periods.filter((p) => p.status === 'cancelled').map((p) => p.id).sort()).toEqual(['empty', 'full'])
    const sun = db.tables.payroll_periods.find((p) => p.period_label === 'Week ending 2026-11-08')!
    expect(db.tables.payroll_rep_hours[0].payroll_period_id).toBe(sun.id)
    expect(db.tables.payroll_adjustments[0].payroll_period_id).toBe(sun.id)
    // A fix for an OLD Wednesday week now lands on the next SUNDAY week, never another Wednesday.
    const next = await ensureNextOpenPeriod(db.client, ORG, '2026-11-05T04:59:59.999Z')
    expect(db.tables.payroll_periods.find((p) => p.id === next.id)!.period_label).toBe('Week ending 2026-11-08')
  })

  it('a week with pay lines on it blocks the change', async () => {
    const db = createFakeDb({ orgs: [org()], payroll_periods: [legacyOpen('busy', '2026-11-05T04:59:59.999Z')], payroll_payout_lines: [{ id: 'l', org_id: ORG, payroll_period_id: 'busy', user_id: 'u', net_amount: 1 }] }, mergeRpc)
    const r = await savePayWeekSchedule(db.client, ORG, ARX_WEEK, new Date('2026-11-12T15:00:00Z'))
    expect(r.ok).toBe(false)
    expect(db.tables.orgs[0].settings).toEqual({})
  })

  it('a one-day shift (Wed -> Thu cutoff) takes effect: the Thursday week is its own week, never the old Wednesday one', async () => {
    const thu = { weekStartDay: 5, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: null }
    const db = createFakeDb({ orgs: [org(thu)], payroll_periods: [{ ...legacyOpen('wed', '2026-11-12T04:59:59.999Z'), status: 'locked' }] })
    const p = await resolvePayWeekPeriod(db.client, ORG, new Date('2026-11-13T15:00:00Z'))
    expect(p.id).not.toBe('wed')
    expect(p.weekEnding).toBe('2026-11-12')
    expect(p.weekStart).toBe('2026-11-12') // 1-day in-between week after the old Wednesday
  })

  it('junk is refused; the generic settings writer cannot write payWeek', async () => {
    const db = createFakeDb({ orgs: [org()], payroll_periods: [] })
    const r = await savePayWeekSchedule(db.client, ORG, { weekStartDay: 1, cutoffTime: '25:00', paydayWeekday: 5 }, new Date())
    expect(r.ok).toBe(false)
    expect((await mergeOrgSettings(db.client, ORG, { payWeek: ARX_WEEK })).error).toMatch(/savePayWeekSchedule/)
  })
})

describe('Approve is owners only (super admins); the office prepares', () => {
  const week = { id: 'w', org_id: ORG, status: 'open', cutoff_at: '2026-11-09T04:59:59.999Z', scheduled_pay_date: '2026-11-13', period_label: 'Week ending 2026-11-08' }
  it.each([
    ['an office (operations) user', { id: 'u', org_id: ORG, role: 'operations', active: true }],
    ['an admin who is not an owner', { id: 'u', org_id: ORG, role: 'admin', active: true, is_super_admin: false }],
    ['a deactivated owner', { id: 'u', org_id: ORG, role: 'admin', active: false, is_super_admin: true }],
    ['an owner of another company', { id: 'u', org_id: 'other', role: 'admin', active: true, is_super_admin: true }],
  ])('%s is refused before anything is computed or claimed', async (_label, user) => {
    const db = createFakeDb({ orgs: [org(ARX_WEEK)], payroll_periods: [{ ...week }], users: [user] })
    const r = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'u', periodId: 'w', expectedTotal: 0, now: new Date('2026-11-12T15:00:00Z') })
    expect(r).toMatchObject({ ok: false, status: 403, body: { code: 'owner_only' } })
    expect(db.tables.payroll_periods[0]).not.toHaveProperty('lock_claim_token')
    expect(db.tables.payroll_periods[0].status).toBe('open')
  })
})
