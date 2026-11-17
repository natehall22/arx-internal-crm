/**
 * Recurring lines on a quote (client-safe, pure). A quote line tied to a service plan template (`service_plan_template_id`)
 * is RECURRING: it adds nothing to the one-time total (priceQuote leaves it out) and becomes a service plan when the quote is
 * approved. This file adds no schedule or price maths of its own — visit dates come from `planVisitDates` and prices from
 * the plan's own billing basis (lib/service-plans.ts), exactly what the plan will do once it exists.
 *
 * "First-season value" is the DOCUMENTED sale amount a recurring line adds to the signed contract (so sales reports and
 * commission, which read the contract, count it): the visits the plan would make in the FIRST season (the template season
 * the first visit falls in, through that season's last day) x the visit price; per-month plans: the months that have a
 * visit x the monthly price; per-year plans: one yearly price. Hourly templates have no price to estimate and are not
 * offered on quotes. Sales tax is not part of it (a plan's visits are taxed when they are billed, lib/service-billing*).
 */
import {
  BILLING_BASIS_LABELS,
  addDaysYmd,
  isYmd,
  monthDayLabel,
  planVisitDates,
  seasonFor,
  type BillingBasis,
  type Season,
  type ServicePlanSchedule,
} from '@/lib/service-plans'

export type RecurringTemplateFacts = {
  id: string
  version: number
  name: string
  billing_basis: BillingBasis
  seasons: Season[]
  /** A template that only sells at set price tiers cannot take a typed quote price. */
  allowCustom: boolean
  active: boolean
}

export type RecurringLineInput = {
  unit_price: number | string | null | undefined
  plan_start_date: string | null | undefined
  plan_weekday: number | null | undefined
}

export function isRecurringLine(l: { service_plan_template_id?: string | null }): boolean {
  return typeof l.service_plan_template_id === 'string' && l.service_plan_template_id.length > 0
}

/** Can a quote line use this template? (active, priced per visit / month / year, takes a typed price) */
export function templateOfferedOnQuote(t: Pick<RecurringTemplateFacts, 'active' | 'billing_basis' | 'allowCustom'>): boolean {
  return t.active && t.billing_basis !== 'per_hour' && t.allowCustom
}

/** The one short terms line, by the template's billing basis. */
export function recurringTermsLine(basis: BillingBasis): string {
  switch (basis) {
    case 'per_visit':
      return 'Billed after each visit. Cancel anytime.'
    case 'per_month':
      return 'Billed monthly. Cancel anytime.'
    case 'per_year':
      return 'Billed yearly. Cancel anytime.'
    case 'per_hour':
      return 'Billed by the hour after each visit. Cancel anytime.'
  }
}

export type RecurringFacts = {
  /** Price in cents per billing unit (visit / month / year). */
  priceCents: number
  basis: BillingBasis
  basisLabel: string
  /** "Apr 1–Oct 31" (the first season), or '' when the template makes no visits. */
  seasonLabel: string
  /** Estimated visits in the first season (0 = none). */
  visits: number
  /** Months with a visit in the first season (per-month plans). */
  months: number
  firstVisit: string | null
  firstSeasonEnd: string | null
  /** What this line adds to the sale amount. */
  firstSeasonCents: number
  termsLine: string
  /** "$45 per visit · Apr 1–Oct 31 · about 15 visits" (the line's name is shown by the caller). */
  detail: string
}

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)

function scheduleOf(seasons: Season[], start: string, weekday: number | null, end: string | null): ServicePlanSchedule {
  return { status: 'active', start_date: start, end_date: end, paused_until: null, seasons, preferred_weekday: weekday }
}

export function recurringFacts(t: Pick<RecurringTemplateFacts, 'billing_basis' | 'seasons'>, line: RecurringLineInput): RecurringFacts {
  const priceCents = Math.round((Number(line.unit_price) || 0) * 100)
  const basis = t.billing_basis
  const start = isYmd(line.plan_start_date) ? line.plan_start_date : null
  const weekday = line.plan_weekday != null && Number.isInteger(Number(line.plan_weekday)) && Number(line.plan_weekday) >= 0 && Number(line.plan_weekday) <= 6 ? Number(line.plan_weekday) : null
  const base = { priceCents, basis, basisLabel: BILLING_BASIS_LABELS[basis], termsLine: recurringTermsLine(basis) }
  const empty = (): RecurringFacts => ({ ...base, seasonLabel: '', visits: 0, months: 0, firstVisit: null, firstSeasonEnd: null, firstSeasonCents: 0, detail: `${money(priceCents)} ${BILLING_BASIS_LABELS[basis]}` })
  if (!start) return empty()
  const first = planVisitDates(scheduleOf(t.seasons, start, weekday, null), start, addDaysYmd(start, 400))[0]
  if (!first) return empty()
  const season = seasonFor(t.seasons, first)
  if (!season) return empty()
  const wraps = season.from > season.to
  const year = Number(first.slice(0, 4)) + (wraps && first.slice(5) >= season.from ? 1 : 0)
  let end = `${year}-${season.to}`
  if (!isYmd(end)) end = `${year}-02-28`
  const dates = planVisitDates(scheduleOf(t.seasons, start, weekday, end), start, end)
  const months = new Set(dates.map((d) => d.slice(0, 7))).size
  const units = basis === 'per_visit' ? dates.length : basis === 'per_month' ? months : dates.length > 0 ? 1 : 0
  const seasonLabel = `${monthDayLabel(season.from)}–${monthDayLabel(season.to)}`
  const about = basis === 'per_month' ? `about ${months} month${months === 1 ? '' : 's'}` : basis === 'per_year' ? 'one yearly charge' : `about ${dates.length} visit${dates.length === 1 ? '' : 's'}`
  return {
    ...base,
    seasonLabel,
    visits: dates.length,
    months,
    firstVisit: dates[0] ?? null,
    firstSeasonEnd: end,
    firstSeasonCents: units * priceCents,
    detail: `${money(priceCents)} ${BILLING_BASIS_LABELS[basis]} · ${seasonLabel} · ${about}`,
  }
}

/** A short key of everything about a recurring line the customer relied on (goes into the quote fingerprint). */
export function recurringKey(t: Pick<RecurringTemplateFacts, 'id' | 'version'>, line: RecurringLineInput): string {
  return [t.id, t.version, line.plan_start_date ?? '', line.plan_weekday ?? ''].join(':')
}

/** What the approved recurring lines add to the sale amount (cents). 0 when there are none. `snapshot` is the approval's. */
export function approvalPlanValueCents(a: { snapshot: { recurring?: Array<{ chosen: boolean; firstSeasonCents: number }> } }): number {
  return (a.snapshot.recurring ?? []).filter((r) => r.chosen).reduce((n, r) => n + r.firstSeasonCents, 0)
}

/** The one-time part of an approval's total (tax included): `total_cents` (the SALE amount) minus the recurring first-season value. */
export function approvalOneTimeCents(a: { total_cents: number; snapshot: { recurring?: Array<{ chosen: boolean; firstSeasonCents: number }> } }): number {
  return a.total_cents - approvalPlanValueCents(a)
}
