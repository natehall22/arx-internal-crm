import {
  DEFAULT_LAWN_SEASONS,
  addDaysYmd,
  cleanPlanInput,
  cleanSeasons,
  cleanStandardTier,
  crewAfterEdit,
  daysBetweenYmd,
  followUpVisitFields,
  parseBulkShift,
  parsePlanStatusChange,
  parseVisitAction,
  planAnchor,
  planVisitDates,
  readStandardTier,
  redactPlanPrices,
  regenerationPlan,
  resolvePlanPricing,
  seasonContains,
  standardTierCheck,
  visitHorizon,
  visitPatch,
  visitPrice,
  weekdayOfYmd,
  ymdInZone,
  type Season,
  type ServicePlanSchedule,
} from '@/lib/service-plans'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const plan = (over: Partial<ServicePlanSchedule> = {}): ServicePlanSchedule => ({
  status: 'active',
  start_date: '2026-03-02', // a Monday
  end_date: null,
  paused_until: null,
  seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
  preferred_weekday: null,
  ...over,
})

describe('calendar days', () => {
  it('weekday / add / between are pure date math', () => {
    expect(weekdayOfYmd('2026-03-02')).toBe(1)
    expect(addDaysYmd('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetweenYmd('2026-12-25', '2027-01-08')).toBe(14)
  })
  it('today is the company zone’s calendar day, on both sides of the DST changes', () => {
    // Spring forward 2026-03-08 07:00 UTC; fall back 2026-11-01 06:00 UTC (US).
    expect(ymdInZone(new Date('2026-03-08T04:30:00Z'), DEFAULT_TIMEZONE)).toBe('2026-03-07')
    expect(ymdInZone(new Date('2026-03-08T05:30:00Z'), DEFAULT_TIMEZONE)).toBe('2026-03-08')
    expect(ymdInZone(new Date('2026-11-01T03:30:00Z'), DEFAULT_TIMEZONE)).toBe('2026-10-31')
    expect(ymdInZone(new Date('2026-11-01T04:30:00Z'), DEFAULT_TIMEZONE)).toBe('2026-11-01')
    expect(ymdInZone(new Date('2026-11-02T04:30:00Z'), DEFAULT_TIMEZONE)).toBe('2026-11-01') // EST now: 23:30 on the 1st
  })
  it('weekly visits stay exactly 7 days apart across both DST weekends', () => {
    for (const [from, to] of [['2026-02-20', '2026-03-31'], ['2026-10-15', '2026-11-30']]) {
      const d = planVisitDates(plan(), from, to)
      for (let i = 1; i < d.length; i++) expect(daysBetweenYmd(d[i - 1], d[i])).toBe(7)
      expect(d.every((x) => weekdayOfYmd(x) === 1)).toBe(true)
    }
  })
})

describe('seasons', () => {
  it('a season may wrap the new year; 02-29 matches leap days only', () => {
    const winter = { from: '12-01', to: '02-29' }
    expect(seasonContains(winter, '2026-12-15')).toBe(true)
    expect(seasonContains(winter, '2027-02-28')).toBe(true)
    expect(seasonContains(winter, '2028-02-29')).toBe(true)
    expect(seasonContains(winter, '2027-03-01')).toBe(false)
  })
  it('the default lawn seasons are valid and cover every day once', () => {
    const r = cleanSeasons(DEFAULT_LAWN_SEASONS)
    expect(r.ok).toBe(true)
  })
  it('refuses overlaps, bad days and unknown frequencies', () => {
    expect(cleanSeasons([{ from: '04-01', to: '10-31', frequency: 'weekly' }, { from: '10-31', to: '11-30', frequency: 'monthly' }])).toEqual({ ok: false, error: expect.stringContaining('Oct 31') })
    expect(cleanSeasons([{ from: '02-30', to: '03-01', frequency: 'weekly' }]).ok).toBe(false)
    expect(cleanSeasons([{ from: '01-01', to: '03-01', frequency: 'daily' }]).ok).toBe(false)
    expect(cleanSeasons([]).ok).toBe(false)
  })
})

describe('planVisitDates (season boundaries)', () => {
  const lawn = plan({ start_date: '2026-03-03', preferred_weekday: 2, seasons: [...DEFAULT_LAWN_SEASONS] as Season[] }) // Tuesdays
  it('weekly in season, every 2 weeks in the shoulders, first Tuesday in winter', () => {
    expect(planVisitDates(lawn, '2026-03-01', '2026-04-14')).toEqual(['2026-03-03', '2026-03-17', '2026-03-31', '2026-04-07', '2026-04-14'])
    expect(planVisitDates(lawn, '2026-10-20', '2026-12-31')).toEqual(['2026-10-20', '2026-10-27', '2026-11-10', '2026-11-24', '2026-12-01'])
    expect(planVisitDates(lawn, '2027-01-01', '2027-02-28')).toEqual(['2027-01-05', '2027-02-02'])
  })
  it('every-2-weeks keeps the same rhythm whatever window it is asked for (idempotent generation)', () => {
    const p = plan({ seasons: [{ from: '01-01', to: '12-31', frequency: 'every_2_weeks' }] })
    const whole = planVisitDates(p, '2026-03-01', '2026-06-30')
    const later = planVisitDates(p, '2026-04-08', '2026-06-30')
    expect(later).toEqual(whole.filter((d) => d >= '2026-04-08'))
    expect(daysBetweenYmd(planAnchor(p), later[0]) % 14).toBe(0)
  })
  it('every 4 weeks from the anchor; none = nothing', () => {
    const p = plan({ seasons: [{ from: '01-01', to: '12-31', frequency: 'every_4_weeks' }] })
    expect(planVisitDates(p, '2026-03-01', '2026-05-31')).toEqual(['2026-03-02', '2026-03-30', '2026-04-27', '2026-05-25'])
    expect(planVisitDates(plan({ seasons: [{ from: '01-01', to: '12-31', frequency: 'none' }] }), '2026-03-01', '2026-12-31')).toEqual([])
  })
  it('respects start, end, the preferred weekday, pause with and without a resume date, and ended', () => {
    expect(planVisitDates(plan({ start_date: '2026-03-04' }), '2026-03-01', '2026-03-20')).toEqual(['2026-03-04', '2026-03-11', '2026-03-18']) // weekday from the start date
    expect(planVisitDates(plan({ preferred_weekday: 5 }), '2026-03-01', '2026-03-14')).toEqual(['2026-03-06', '2026-03-13'])
    expect(planVisitDates(plan({ end_date: '2026-03-10' }), '2026-03-01', '2026-03-31')).toEqual(['2026-03-02', '2026-03-09'])
    expect(planVisitDates(plan({ status: 'paused', paused_until: '2026-03-20' }), '2026-03-01', '2026-03-31')).toEqual(['2026-03-23', '2026-03-30'])
    expect(planVisitDates(plan({ status: 'paused' }), '2026-03-01', '2026-03-31')).toEqual([])
    expect(planVisitDates(plan({ status: 'ended' }), '2026-03-01', '2026-03-31')).toEqual([])
  })
  it('the horizon is today plus 41 days', () => {
    expect(visitHorizon('2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-12-21' })
  })
})

describe('plan input', () => {
  const base = { property_id: 'p1', trade: 'lawn', name: 'Weekly mowing', price: '$45.00', billing_basis: 'per_visit', start_date: '2026-03-02', seasons: DEFAULT_LAWN_SEASONS }
  it('cleans a full create', () => {
    const r = cleanPlanInput(base)
    expect(r.ok && r.value.price).toBe(45)
    expect(r.ok && r.value.seasons?.length).toBe(4)
  })
  it('refuses end before start, bad weekday, bad price, unknown follow-up', () => {
    expect(cleanPlanInput({ ...base, end_date: '2026-01-01' }).ok).toBe(false)
    expect(cleanPlanInput({ ...base, preferred_weekday: 7 }).ok).toBe(false)
    expect(cleanPlanInput({ ...base, price: 'abc' }).ok).toBe(false)
    expect(cleanPlanInput({ ...base, follow_up: 'pizza' }).ok).toBe(false)
  })
  it('partial edit returns only what was sent', () => {
    const r = cleanPlanInput({ name: ' New name ' }, true)
    expect(r).toEqual({ ok: true, value: { name: 'New name' } })
  })
  it('status changes: pause needs a future resume date', () => {
    expect(parsePlanStatusChange({ action: 'pause', until: '2026-11-10' }, '2026-11-10')).toEqual({ error: expect.any(String) })
    expect(parsePlanStatusChange({ action: 'pause', until: '2026-12-01' }, '2026-11-10')).toEqual({ action: 'pause', until: '2026-12-01' })
    expect(parsePlanStatusChange({ name: 'x' }, '2026-11-10')).toBeNull()
  })
  it('visit price snapshot: per-visit plans only; prices can be hidden', () => {
    expect(visitPrice({ price: 45, billing_basis: 'per_visit' })).toBe(45)
    expect(visitPrice({ price: 120, billing_basis: 'per_month' })).toBeNull()
    expect(redactPlanPrices({ price: 45 }, false)).toEqual({ price: null, priceHidden: true })
  })
})

describe('standard price tier (ARX Care: ≤ 3 stories, pitch ≤ 10/12)', () => {
  const rule = readStandardTier({ servicePlans: { standardTier: { price: 39, billingBasis: 'per_month', maxStories: 3, maxPitchRise: 10 } } })
  it('reads the rule from settings; nothing stored = no standard tier', () => {
    expect(rule).toEqual({ price: 39, billingBasis: 'per_month', maxStories: 3, maxPitchRise: 10 })
    expect(readStandardTier({})).toBeNull()
  })
  it('qualifies only homes inside the rule, with stories and pitch known', () => {
    expect(standardTierCheck(rule, { stories: 2, pitch_rise: 8 })).toEqual({ ok: true })
    expect(standardTierCheck(rule, { stories: 4, pitch_rise: 8 }).ok).toBe(false)
    expect(standardTierCheck(rule, { stories: 2, pitch_rise: 12 }).ok).toBe(false)
    expect(standardTierCheck(rule, { stories: null, pitch_rise: 8 }).ok).toBe(false)
    expect(standardTierCheck(null, { stories: 1, pitch_rise: 4 }).ok).toBe(false)
  })
  it('standard = the company price and basis (typed price ignored); custom = the override', () => {
    expect(resolvePlanPricing({ price_tier: 'standard', price: 5, billing_basis: 'per_visit', stories: 2, pitch_rise: 6 }, rule)).toEqual({ ok: true, price: 39, billing_basis: 'per_month' })
    expect(resolvePlanPricing({ price_tier: 'custom', price: 79, billing_basis: 'per_year', stories: 4, pitch_rise: 12 }, rule)).toEqual({ ok: true, price: 79, billing_basis: 'per_year' })
    expect(resolvePlanPricing({ price_tier: 'standard', price: null, billing_basis: 'per_month', stories: 4, pitch_rise: 6 }, rule).ok).toBe(false)
  })
  it('settings save validates, null removes', () => {
    expect(cleanStandardTier({ standardTier: null })).toEqual({ ok: true, value: null })
    expect(cleanStandardTier({ standardTier: { price: 'x' } }).ok).toBe(false)
    expect(cleanStandardTier({ standardTier: { price: 39, maxStories: 0 } }).ok).toBe(false)
  })
})

describe('visit actions', () => {
  const now = new Date('2026-11-10T15:00:00Z')
  const office = { userId: 'u1', subId: null }
  const crew = { userId: null, subId: 's1' }
  it('done / skip only from scheduled; skip needs a reason (other needs words)', () => {
    expect(visitPatch({ status: 'scheduled', scheduled_date: '2026-11-10' }, { action: 'done' }, crew, now)).toMatchObject({ status: 'completed', completed_by: null, completed_by_sub_id: 's1' })
    expect(visitPatch({ status: 'completed', scheduled_date: '2026-11-10' }, { action: 'done' }, office, now)).toEqual({ error: expect.any(String) })
    expect(parseVisitAction({ action: 'skip' })).toEqual({ error: expect.any(String) })
    expect(parseVisitAction({ action: 'skip', reason: 'other' })).toEqual({ error: expect.any(String) })
    expect(visitPatch({ status: 'scheduled', scheduled_date: '2026-11-10' }, { action: 'skip', reason: 'rain' }, office, now)).toMatchObject({ status: 'skipped', skip_reason: 'rain', completed_by: 'u1' })
  })
  it('an inspection is done only with green / yellow / red; a service visit never carries one', () => {
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x', visit_step: 'inspection' }, { action: 'done' }, office, now)).toEqual({ error: expect.any(String) })
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x', visit_step: 'inspection' }, { action: 'done', result: 'yellow' }, office, now)).toMatchObject({ health_result: 'yellow' })
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x', visit_step: 'service' }, { action: 'done', result: 'red' }, office, now)).toMatchObject({ health_result: null })
    expect(parseVisitAction({ action: 'done', result: 'blue' })).toEqual({ error: expect.any(String) })
  })
  it('reopen clears the close; move / assign only while scheduled', () => {
    expect(visitPatch({ status: 'skipped', scheduled_date: 'x' }, { action: 'reopen' }, office, now)).toMatchObject({ status: 'scheduled', skip_reason: null, health_result: null })
    expect(visitPatch({ status: 'completed', scheduled_date: 'x' }, { action: 'move', date: '2026-11-12' }, office, now)).toEqual({ error: expect.any(String) })
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x' }, { action: 'assign', subId: null }, office, now)).toEqual({ assigned_sub_id: null })
  })
  it('the follow-on inspection: N days after the visit was done, on the parent’s slot, to the plan’s person', () => {
    const f = followUpVisitFields({ follow_up: 'inspection', follow_up_days: 2, follow_up_user_id: 'insp' }, { id: 'v1', service_planned_date: '2026-11-09', visit_step: 'service' }, '2026-11-10')
    expect(f).toEqual({ visit_step: 'inspection', parent_visit_id: 'v1', service_planned_date: '2026-11-09', scheduled_date: '2026-11-12', assigned_user_id: 'insp' })
    expect(followUpVisitFields({ follow_up: null, follow_up_days: null, follow_up_user_id: null }, { id: 'v1', service_planned_date: 'x', visit_step: 'service' }, '2026-11-10')).toBeNull()
    expect(followUpVisitFields({ follow_up: 'inspection', follow_up_days: 0, follow_up_user_id: null }, { id: 'v2', service_planned_date: 'x', visit_step: 'inspection' }, '2026-11-10')).toBeNull()
  })
})

describe('bulk shift', () => {
  it('one day or a range, 1 to 30 days either way, all crews / one / unassigned', () => {
    expect(parseBulkShift({ from: '2026-11-10', days: 1 })).toEqual({ from: '2026-11-10', to: '2026-11-10', days: 1, subId: 'all' })
    expect(parseBulkShift({ from: '2026-11-10', to: '2026-11-12', days: -2, subId: 'none' })).toEqual({ from: '2026-11-10', to: '2026-11-12', days: -2, subId: null })
    expect(parseBulkShift({ from: '2026-11-10', days: 0 })).toEqual({ error: expect.any(String) })
    expect(parseBulkShift({ from: '2026-11-12', to: '2026-11-10', days: 1 })).toEqual({ error: expect.any(String) })
    expect(parseBulkShift({ from: '2026-11-01', to: '2026-12-15', days: 1 })).toEqual({ error: expect.any(String) })
  })
})

describe('regeneration after an edit', () => {
  const v = (id: string, planned: string, over: Record<string, unknown> = {}) => ({ id, status: 'scheduled', service_planned_date: planned, scheduled_date: planned, assigned_sub_id: 'crewA', completed_at: null, ...over })
  it('touches only unstarted service visits after today; history and today stay', () => {
    const visits = [
      v('past', '2026-11-03', { status: 'completed', completed_at: 'x' }),
      v('today', '2026-11-10'),
      v('skipped', '2026-11-17', { status: 'skipped' }),
      v('keep', '2026-11-24'),
      v('drop', '2026-12-01'),
      v('inspection', '2026-11-24', { visit_step: 'inspection' }),
      v('movedToToday', '2026-11-11', { scheduled_date: '2026-11-10' }),
    ]
    const r = regenerationPlan(visits, new Set(['2026-11-24']), '2026-11-10')
    expect(r.remove).toEqual(['drop'])
    expect(r.keep.map((x) => x.id)).toEqual(['keep'])
  })
  it('a crew picked by hand stays; the old default follows the new default', () => {
    expect(crewAfterEdit('crewA', 'crewA', 'crewB')).toBe('crewB')
    expect(crewAfterEdit('crewC', 'crewA', 'crewB')).toBe('crewC')
    expect(crewAfterEdit(null, null, 'crewB')).toBe('crewB')
  })
})
