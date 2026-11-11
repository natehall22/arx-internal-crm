import { describeChange, diffFields } from '@/lib/change-log'
import { STARTER_TEMPLATES, starterTemplate } from '@/lib/service-plan-starters'
import {
  DEFAULT_STEP_RESULTS,
  addDaysYmd,
  cleanPlanInput,
  cleanPricing,
  cleanSeasons,
  cleanSteps,
  cleanTemplateInput,
  crewAfterEdit,
  describeVisitEffect,
  eligibleTiers,
  nextStep,
  previewVisitEffect,
  stepResultKeys,
  daysBetweenYmd,
  followUpVisitFields,
  parseBulkShift,
  parsePlanStatusChange,
  parseVisitAction,
  planAnchor,
  planVisitDates,
  redactPlanPrices,
  regenerationPlan,
  resolvePlanPricing,
  seasonContains,
  tierCheck,
  visitHorizon,
  visitPatch,
  visitPrice,
  weekdayOfYmd,
  ymdInZone,
  type Season,
  type ServicePlanSchedule,
} from '@/lib/service-plans'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const DEFAULT_LAWN_SEASONS = starterTemplate('lawn_weekly')!.seasons

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
    expect(cleanPlanInput({ ...base, steps: [{ key: 'service', label: 'x' }] }).ok).toBe(false)
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

describe('price rules (generic; e.g. a roof & gutter plan: ≤ 3 stories, pitch ≤ 10/12)', () => {
  const rules = cleanPricing({
    fields: [{ key: 'stories', label: 'Stories' }, { key: 'pitch', label: 'Roof pitch (/12)' }],
    tiers: [{ key: 'standard', label: 'Standard home', price: '39', billingBasis: 'per_month', conditions: [{ field: 'stories', op: 'lte', value: 3 }, { field: 'pitch', op: 'lte', value: '10' }] }],
    allowCustom: true,
  })
  const pricing = rules.ok ? rules.value : (null as never)
  it('cleans rules: prices and rule values become numbers; unknown questions / blank prices refused', () => {
    expect(rules.ok).toBe(true)
    expect(pricing.tiers[0]).toMatchObject({ price: 39, conditions: [{ field: 'stories', op: 'lte', value: 3 }, { field: 'pitch', op: 'lte', value: 10 }] })
    expect(cleanPricing({ fields: [], tiers: [{ key: 't', label: 'T', price: 1, conditions: [{ field: 'nope', op: 'lte', value: 1 }] }] }).ok).toBe(false)
    expect(cleanPricing({ tiers: [{ key: 't', label: 'T', price: '' }] }).ok).toBe(false)
    expect(cleanPricing({ tiers: [], allowCustom: false }).ok).toBe(false)
  })
  it('a home qualifies only inside every rule; unanswered = not yet', () => {
    const t = pricing.tiers[0]
    expect(tierCheck(pricing, t, { stories: 2, pitch: 8 })).toEqual({ ok: true })
    expect(tierCheck(pricing, t, { stories: 4, pitch: 8 })).toEqual({ ok: false, reason: 'Stories must be at most 3' })
    expect(tierCheck(pricing, t, { stories: 2, pitch: 12 }).ok).toBe(false)
    expect(tierCheck(pricing, t, { stories: 2 })).toEqual({ ok: false, reason: 'Answer “Roof pitch (/12)”' })
    expect(eligibleTiers(pricing, { stories: 1, pitch: 4 }).map((x) => x.key)).toEqual(['standard'])
  })
  it('a tier sets price and basis (typed price ignored); custom is the override, only when allowed', () => {
    expect(resolvePlanPricing({ tier_key: 'standard', price: 5, billing_basis: 'per_visit', pricing_inputs: { stories: 2, pitch: 6 } }, pricing)).toEqual({ ok: true, price: 39, billing_basis: 'per_month', tier_key: 'standard' })
    expect(resolvePlanPricing({ tier_key: null, price: 79, billing_basis: 'per_year', pricing_inputs: { stories: 4, pitch: 12 } }, pricing)).toEqual({ ok: true, price: 79, billing_basis: 'per_year', tier_key: null })
    expect(resolvePlanPricing({ tier_key: 'standard', price: null, billing_basis: 'per_month', pricing_inputs: { stories: 4, pitch: 6 } }, pricing).ok).toBe(false)
    expect(resolvePlanPricing({ tier_key: 'gone', price: null, billing_basis: 'per_month', pricing_inputs: {} }, pricing).ok).toBe(false)
    expect(resolvePlanPricing({ tier_key: null, price: 1, billing_basis: 'per_month', pricing_inputs: {} }, { ...pricing, allowCustom: false }).ok).toBe(false)
  })
})

describe('follow-on steps and their results', () => {
  const steps = cleanSteps([
    { key: 'cleaning_check', label: 'Clean-up check', daysAfter: 0, assignTo: 'crew', subId: 's1', results: [] },
    { key: 'inspection', label: 'Roof inspection', daysAfter: 2, assignTo: 'person', userId: 'insp', results: DEFAULT_STEP_RESULTS },
  ])
  const list = steps.ok ? steps.value : []
  it('cleans steps; green / yellow / red is only the default, options are editable', () => {
    expect(steps.ok).toBe(true)
    expect(list[1].results.map((r) => r.key)).toEqual(['green', 'yellow', 'red'])
    expect(cleanSteps([{ key: 'service', label: 'X' }]).ok).toBe(false)
    expect(cleanSteps([{ key: 'a', label: 'A', results: [{ key: 'pass', label: 'Pass', tone: 'good' }, { key: 'fail', label: 'Fail', tone: 'bad' }] }]).ok).toBe(true)
    expect(stepResultKeys(list, 'inspection')).toEqual(['green', 'yellow', 'red'])
    expect(stepResultKeys(list, 'service')).toEqual([])
  })
  it('steps chain in order: service → first step → next → none', () => {
    expect(nextStep(list, 'service')?.key).toBe('cleaning_check')
    expect(nextStep(list, 'cleaning_check')?.key).toBe('inspection')
    expect(nextStep(list, 'inspection')).toBeNull()
    expect(nextStep(list, 'unknown')).toBeNull()
  })
  it('starter templates are valid data (nothing about a plan is in code)', () => {
    for (const t of STARTER_TEMPLATES) {
      const r = cleanTemplateInput({ ...t, pricing: { ...t.pricing, tiers: t.pricing.tiers.map((x) => ({ ...x, price: 10 })) } })
      expect(r.ok).toBe(true)
      // Prices are left for each company to set.
      expect(cleanTemplateInput(t).ok).toBe(t.pricing.tiers.length === 0)
    }
  })
})

describe('history and preview', () => {
  it('diffFields lists only what changed, in the shared change-log shape', () => {
    const c = diffFields({ price: 45, name: 'A', seasons: [1] }, { price: 50, name: 'A', seasons: [1] }, { price: 'Price', name: 'Name', seasons: 'Seasons' })
    expect(c).toEqual([{ field: 'price', label: 'Price', old: 45, new: 50 }])
    expect(describeChange(c[0])).toBe('Price: 45 → 50')
  })
  const base = { status: 'active' as const, start_date: '2026-11-03', end_date: null, paused_until: null, seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' as const }], preferred_weekday: 2, name: 'Mow', price: 45, billing_basis: 'per_visit' as const, taxable: false, default_sub_id: 's1', property_id: 'p1' }
  const v = (d: string, over: Record<string, unknown> = {}) => ({ id: d, visit_step: 'service', status: 'scheduled', service_planned_date: d, scheduled_date: d, assigned_sub_id: 's1', completed_at: null, title: 'Mow', service_price: 45, service_taxable: false, property_id: 'p1', ...over })
  const visits = ['2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15'].map((d) => v(d))
  it('a weekday change: future visits move (removed + added), today stays', () => {
    const e = previewVisitEffect(visits, base, { ...base, preferred_weekday: 4 }, '2026-11-10')
    expect(e.removed).toBe(5)
    // Thursdays 11-12 … 12-17 inside the 6-week horizon.
    expect(e.added).toBe(6)
    expect(e.updated).toBe(0)
    expect(describeVisitEffect(e)).toBe('5 upcoming visits removed, 6 added. Done, skipped and today’s visits don’t change.')
  })
  it('a price change updates future visits only; nothing at all says so', () => {
    expect(previewVisitEffect(visits, base, { ...base, price: 50 }, '2026-11-10')).toEqual({ removed: 0, added: 0, updated: 5 })
    expect(previewVisitEffect(visits, base, { ...base }, '2026-11-10')).toEqual({ removed: 0, added: 0, updated: 0 })
    expect(describeVisitEffect({ removed: 0, added: 0, updated: 0 })).toBe('No visits on the calendar change.')
  })
  it('a hand-picked crew is not "updated" when the default crew changes', () => {
    const mixed = [v('2026-11-17', { assigned_sub_id: 's9' }), v('2026-11-24')]
    expect(previewVisitEffect(mixed, base, { ...base, default_sub_id: 's2' }, '2026-11-10').updated).toBe(1)
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
  it('a follow-on step with results is done only with one of them; the plan’s own visit never carries one', () => {
    const row = { status: 'scheduled', scheduled_date: 'x', visit_step: 'inspection', results: ['green', 'yellow', 'red'] }
    expect(visitPatch(row, { action: 'done' }, office, now)).toEqual({ error: expect.any(String) })
    expect(visitPatch(row, { action: 'done', result: 'blue' }, office, now)).toEqual({ error: expect.any(String) })
    expect(visitPatch(row, { action: 'done', result: 'yellow' }, office, now)).toMatchObject({ step_result: 'yellow' })
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x', visit_step: 'check', results: [] }, { action: 'done' }, office, now)).toMatchObject({ status: 'completed', step_result: null })
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x', visit_step: 'service' }, { action: 'done', result: 'red' }, office, now)).toMatchObject({ step_result: null })
    expect(parseVisitAction({ action: 'done', result: 'Not A Key' })).toEqual({ error: expect.any(String) })
  })
  it('reopen clears the close; move / assign only while scheduled', () => {
    expect(visitPatch({ status: 'skipped', scheduled_date: 'x' }, { action: 'reopen' }, office, now)).toMatchObject({ status: 'scheduled', skip_reason: null, step_result: null })
    expect(visitPatch({ status: 'completed', scheduled_date: 'x' }, { action: 'move', date: '2026-11-12' }, office, now)).toEqual({ error: expect.any(String) })
    expect(visitPatch({ status: 'scheduled', scheduled_date: 'x' }, { action: 'assign', subId: null }, office, now)).toEqual({ assigned_sub_id: null })
  })
  it('the next step: N days after the visit was done, on the parent’s slot, to the step’s person or crew', () => {
    const steps = [{ key: 'inspection', label: 'Roof inspection', daysAfter: 2, assignTo: 'person' as const, userId: 'insp', subId: null, results: [] }]
    expect(followUpVisitFields(steps, { id: 'v1', service_planned_date: '2026-11-09', visit_step: 'service' }, '2026-11-10')).toEqual({
      visit_step: 'inspection', parent_visit_id: 'v1', service_planned_date: '2026-11-09', scheduled_date: '2026-11-12', assigned_user_id: 'insp', assigned_sub_id: null, title_suffix: 'Roof inspection',
    })
    expect(followUpVisitFields([], { id: 'v1', service_planned_date: 'x', visit_step: 'service' }, '2026-11-10')).toBeNull()
    expect(followUpVisitFields(steps, { id: 'v2', service_planned_date: 'x', visit_step: 'inspection' }, '2026-11-10')).toBeNull()
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
