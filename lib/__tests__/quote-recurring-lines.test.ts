/** @jest-environment node */
const features = jest.fn()
jest.mock('@/lib/org-features', () => ({ loadOrgFeatures: (...a: unknown[]) => features(...a) }))
const loadTemplate = jest.fn()
const loadTemplates = jest.fn()
jest.mock('@/lib/service-plans-db', () => ({ loadTemplate: (...a: unknown[]) => loadTemplate(...a), loadTemplates: (...a: unknown[]) => loadTemplates(...a) }))

import { approvalOneTimeCents, approvalRecurringEstimateCents, isRecurringLine, recurringFacts, recurringKey, recurringTermsLine, templateOfferedOnQuote } from '@/lib/quotes/recurring'
import { propertyAddressKey } from '@/lib/service-plans'
import { priceQuote, quoteFingerprint, type QuoteLine } from '@/lib/quotes/pricing'
import { builderPlanTemplates, cleanRecurringLines } from '@/lib/quotes/recurring-lines'

const seasons = [{ from: '04-01', to: '10-31', frequency: 'every_2_weeks' as const }]
const tpl = { id: 't1', version: 3, name: 'Bi-weekly mowing', billing_basis: 'per_visit' as const, seasons, allowCustom: true, active: true }
const legacy = { kind: 'legacy', percent: 7 } as const
const line = (id: string, total: number, extra: Partial<QuoteLine> = {}): QuoteLine => ({ id, line_total: total, unit_price: total, unit: 'each', price_type: null, taxable: null, ...extra })

describe('recurringFacts (existing plan maths)', () => {
  it('per visit: first-season visits x price, with the customer wording', () => {
    const f = recurringFacts(tpl, { unit_price: 45, plan_start_date: '2027-04-01', plan_weekday: null })
    // Thursdays every 2 weeks from Apr 1 to Oct 31: Apr 1 + 14k, k = 0..15
    expect(f.visits).toBe(16)
    expect(f.firstSeasonCents).toBe(16 * 4500)
    expect(f.detail).toBe('$45 per visit · Apr 1–Oct 31 · about 16 visits')
    expect(f.termsLine).toBe('Billed after each visit. Cancel anytime.')
    expect(f.firstVisit).toBe('2027-04-01')
  })
  it('per month: months with a visit x monthly price; per year: one price', () => {
    const m = recurringFacts({ ...tpl, billing_basis: 'per_month' }, { unit_price: 120, plan_start_date: '2027-04-01', plan_weekday: null })
    expect(m.months).toBe(7)
    expect(m.firstSeasonCents).toBe(7 * 12000)
    expect(m.detail).toContain('per month')
    expect(recurringFacts({ ...tpl, billing_basis: 'per_year' }, { unit_price: 900, plan_start_date: '2027-04-01', plan_weekday: null }).firstSeasonCents).toBe(90000)
  })
  it('a start in the off-season begins at the next season; a wrapped season ends next year', () => {
    const f = recurringFacts(tpl, { unit_price: 45, plan_start_date: '2027-11-10', plan_weekday: null })
    expect(f.firstVisit!.startsWith('2028-04')).toBe(true)
    const w = recurringFacts({ ...tpl, seasons: [{ from: '11-01', to: '03-31', frequency: 'monthly' }] }, { unit_price: 50, plan_start_date: '2027-11-10', plan_weekday: null })
    expect(w.firstSeasonEnd).toBe('2028-03-31')
    expect(w.visits).toBeGreaterThan(3)
  })
  it('no start date or no visits = no value', () => {
    expect(recurringFacts(tpl, { unit_price: 45, plan_start_date: null, plan_weekday: null }).firstSeasonCents).toBe(0)
    expect(recurringFacts({ ...tpl, seasons: [{ from: '01-01', to: '12-31', frequency: 'none' }] }, { unit_price: 45, plan_start_date: '2027-04-01', plan_weekday: null }).firstSeasonCents).toBe(0)
  })
  it('terms line follows the billing basis', () => {
    expect(recurringTermsLine('per_month')).toBe('Billed monthly. Cancel anytime.')
    expect(recurringTermsLine('per_year')).toBe('Billed yearly. Cancel anytime.')
  })
  it('hourly or price-tier-only templates are not offered on quotes', () => {
    expect(templateOfferedOnQuote(tpl)).toBe(true)
    expect(templateOfferedOnQuote({ ...tpl, billing_basis: 'per_hour' })).toBe(false)
    expect(templateOfferedOnQuote({ ...tpl, allowCustom: false })).toBe(false)
    expect(templateOfferedOnQuote({ ...tpl, active: false })).toBe(false)
  })
})

describe('pricing leaves recurring lines out of the one-time price', () => {
  const rec = line('r1', 0, { unit_price: 45, service_plan_template_id: 't1', recurring_key: 't1:3:2027-04-01:' })
  it('one-time total is unchanged by a recurring line, optional or not', () => {
    const base = [line('a', 1000)]
    const plain = priceQuote({ lines: base, selectedOptionalIds: [], tax: legacy })
    expect(priceQuote({ lines: [...base, rec], selectedOptionalIds: [], tax: legacy }).totalCents).toBe(plain.totalCents)
    expect(priceQuote({ lines: [...base, { ...rec, is_optional: true }], selectedOptionalIds: ['r1'], tax: legacy }).totalCents).toBe(plain.totalCents)
  })
  it('a recurring-only quote has a $0 one-time total', () => {
    expect(priceQuote({ lines: [rec], selectedOptionalIds: [], tax: legacy }).totalCents).toBe(0)
  })
  it('fingerprint: a recurring change moves it; a quote with no recurring line keeps its old shape', () => {
    const base = [line('a', 1000)]
    const fp = (l: QuoteLine[]) => quoteFingerprint({ lines: l, tax: legacy })
    expect(fp([...base, rec])).not.toBe(fp([...base, { ...rec, recurring_key: 't1:4:2027-04-01:' }]))
    expect(fp(base)).toBe(fp(base.map((l) => ({ ...l, service_plan_template_id: null, recurring_key: null }))))
  })
  it('recurringKey carries template version, start and weekday', () => {
    expect(recurringKey({ id: 't1', version: 3 }, { unit_price: 1, plan_start_date: '2027-04-01', plan_weekday: 2 })).toBe('t1:3:2027-04-01:2')
    expect(isRecurringLine(rec)).toBe(true)
    expect(isRecurringLine(line('a', 1))).toBe(false)
  })
})

describe('recurring estimate is separate from the one-time money', () => {
  it('recurring estimate = first-season value of each chosen line only', () => {
    const a = { total_cents: 50000, snapshot: { recurring: [{ chosen: true, firstSeasonCents: 72000 }, { chosen: true, firstSeasonCents: 10000 }, { chosen: false, firstSeasonCents: 99999 }] } }
    expect(approvalRecurringEstimateCents(a as never)).toBe(82000)
  })
  it('one-time money is total_cents as before, and 0 for a plan-only approval', () => {
    expect(approvalOneTimeCents({ total_cents: 50000, snapshot: {} })).toBe(50000)
    expect(approvalOneTimeCents({ total_cents: 72000, snapshot: { planOnly: true } })).toBe(0)
  })
  it('visits count from max(line start, today): a past start never counts visits that cannot happen', () => {
    const t = { billing_basis: 'per_visit' as const, seasons }
    const line = { unit_price: 45, plan_start_date: '2027-04-01', plan_weekday: null }
    const early = recurringFacts(t as never, line, '2027-01-10')
    const late = recurringFacts(t as never, line, '2027-07-01')
    expect(late.firstSeasonCents).toBeLessThan(early.firstSeasonCents)
    expect(recurringFacts(t as never, line, '2026-01-01').firstSeasonCents).toBe(early.firstSeasonCents)
  })
})

describe('property address matching', () => {
  it('ignores street suffix, direction and punctuation spellings', () => {
    expect(propertyAddressKey('12 North Oak Street, Apt. 4')).toBe(propertyAddressKey('12 N Oak St Apt 4'))
    expect(propertyAddressKey('9 Maple Avenue')).toBe(propertyAddressKey('9 maple ave.'))
    expect(propertyAddressKey('9 Maple Avenue')).not.toBe(propertyAddressKey('9 Maple Court'))
  })
})

describe('builder gating (servicePlans + quoteApproval)', () => {
  const t = (over: object = {}) => ({ id: 't1', name: 'Mowing', active: true, billing_basis: 'per_visit', seasons, pricing: { allowCustom: true, tiers: [{ price: 40 }] }, ...over })
  beforeEach(() => {
    jest.clearAllMocks()
    loadTemplates.mockResolvedValue({ ready: true, templates: [t(), t({ id: 't2', billing_basis: 'per_hour' }), t({ id: 't3', pricing: { allowCustom: false, tiers: [] } })] })
    loadTemplate.mockImplementation(async (_a: unknown, _o: unknown, id: string) => (id === 't1' ? t() : id === 't2' ? t({ id: 't2', billing_basis: 'per_hour' }) : null))
  })
  it('offers templates only when both switches are on', async () => {
    features.mockResolvedValue({ servicePlans: true, quoteApproval: true })
    const on = await builderPlanTemplates({} as never, 'o1')
    expect(on.map((x) => x.id)).toEqual(['t1'])
    expect(on[0]).toMatchObject({ basisLabel: 'per visit', defaultPrice: 40 })
    features.mockResolvedValue({ servicePlans: true, quoteApproval: false })
    expect(await builderPlanTemplates({} as never, 'o1')).toEqual([])
    features.mockResolvedValue({ servicePlans: false, quoteApproval: true })
    expect(await builderPlanTemplates({} as never, 'o1')).toEqual([])
  })
  it('a roofing save (no recurring line) passes through untouched without even reading features', async () => {
    const lines = [{ name: 'Shingles', unit_price: 5, line_total: 5 }]
    const r = await cleanRecurringLines({} as never, 'o1', lines)
    expect(r).toEqual({ ok: true, lines })
    expect(features).not.toHaveBeenCalled()
  })
  it('a recurring line is refused when the switches are off, or the template is hourly / unknown', async () => {
    const rl = { name: 'x', unit_price: 45, plan_start_date: '2027-04-01', service_plan_template_id: 't1' }
    features.mockResolvedValue({ servicePlans: false, quoteApproval: true })
    expect((await cleanRecurringLines({} as never, 'o1', [rl])).ok).toBe(false)
    features.mockResolvedValue({ servicePlans: true, quoteApproval: true })
    expect((await cleanRecurringLines({} as never, 'o1', [{ ...rl, service_plan_template_id: 't2' }])).ok).toBe(false)
    expect((await cleanRecurringLines({} as never, 'o1', [{ ...rl, service_plan_template_id: 'nope' }])).ok).toBe(false)
  })
  it('needs a price and a start date; saves with no one-time amount and the plan price as unit price', async () => {
    features.mockResolvedValue({ servicePlans: true, quoteApproval: true })
    const rl = { name: '', unit_price: 45.456, plan_start_date: '2027-04-01', plan_weekday: '3', service_plan_template_id: 't1', line_total: 999, quantity: 7 }
    expect((await cleanRecurringLines({} as never, 'o1', [{ ...rl, unit_price: 0 }])).ok).toBe(false)
    expect((await cleanRecurringLines({} as never, 'o1', [{ ...rl, plan_start_date: 'soon' }])).ok).toBe(false)
    expect((await cleanRecurringLines({} as never, 'o1', [{ ...rl, plan_weekday: 9 }])).ok).toBe(false)
    const ok = await cleanRecurringLines({} as never, 'o1', [rl])
    expect(ok.ok && ok.lines[0]).toMatchObject({ name: 'Mowing', unit: 'visit', quantity: 1, line_total: 0, unit_price: 45.46, plan_weekday: 3, taxable: null, is_adder: false })
  })
})
