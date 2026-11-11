/**
 * Billing recurring service (pure, client-safe): which done visits are ready to bill, and how they group into invoices.
 * The DB side is lib/service-billing-db.ts; the one writer is SQL create_service_invoice (migration 202611110060), which
 * re-checks "already billed" under a lock — this module only decides what to ASK for.
 *
 * Units of billing (from the plan's billing basis, as the visit was priced when planned — service_visit_charges):
 *   - a VISIT of a per-visit plan, at its price snapshot;
 *   - a PLAN-MONTH of a monthly plan (any month with at least one done OR skipped visit — the fee follows the plan, not the
 *     weather), at the plan's price on the 1st of that month ("new price starts on" honoured); its done visits are listed
 *     on the invoice at $0. A paused plan has no visits in its paused weeks, so a paused month doesn't bill.
 * Not billed here: yearly plans (billed once a year — not built), visits with no price, follow-on step visits (an
 * inspection after a cleaning is part of the plan), anything already on a non-void invoice.
 *
 * Grouping (the office's choice on the Ready to bill screen):
 *   - 'visit': one invoice per unit (a visit, or a plan-month);
 *   - 'month': one invoice per customer per month, every unit of that month on it.
 * A month that isn't over waits unless the office includes it — a monthly biller runs this on the 1st for last month.
 */
import { formatInTimeZone } from 'date-fns-tz'

import { addDaysYmd, planPriceOn, SERVICE_STEP, type BillingBasis } from '@/lib/service-plans'
import { computeDocumentSalesTax, type SalesTaxSettings } from '@/lib/sales-tax'
import { invoiceItemDateLabel, lineTotalCents } from '@/lib/invoice-lines'

export type BillingGrouping = 'visit' | 'month'
export const BILLING_GROUPINGS: readonly BillingGrouping[] = ['month', 'visit']

/** A done visit as the loader hands it over (prices in dollars, as stored). */
export type DoneVisit = {
  visitId: string
  planId: string
  customerId: string | null
  propertyId: string | null
  servedOn: string
  visitStep: string
  price: number | null
  taxable: boolean
  /** A skipped visit (not done): bills nothing itself, but shows a monthly-fee plan ran that month. */
  skipped?: boolean
}

export type BillingPlanFacts = {
  id: string
  name: string
  billing_basis: BillingBasis
  price: number | null
  previous_price: number | null
  price_starts_on: string | null
  taxable: boolean
  customer_id: string
  property_id: string | null
}

export type BillingUnit = {
  /** 'v:<visit>' or 'm:<plan>:<YYYY-MM>' — stable across loads (the screen's selection keys build on it). */
  key: string
  kind: 'visit' | 'month'
  customerId: string
  propertyId: string | null
  planId: string
  planName: string
  /** YYYY-MM the work belongs to. */
  month: string
  /** The visit day (visit units) or the month's first day (plan-month units). */
  date: string
  amountCents: number
  taxable: boolean
  /** The visit itself (visit units) or the month's done visits, listed at $0 (plan-month units). */
  visits: Array<{ visitId: string; date: string }>
}

export type NotBillableReason = 'no_price' | 'yearly' | 'hourly'
export type NotBillable = { visitId: string; customerId: string | null; planName: string; date: string; reason: NotBillableReason }

export type ServiceLine = {
  description: string
  qty: number
  unit_price_cents: number
  taxable: boolean
  work_order_id?: string
  service_date?: string
  service_plan_id?: string
  billing_month?: string
}

export type DraftInvoice = {
  /** 'v:<visit>' / 'm:<plan>:<YYYY-MM>' in visit grouping; 'c:<customer>:<YYYY-MM>' in month grouping. */
  key: string
  customerId: string
  /** The one property every line is at, else null (lines then name their address). */
  propertyId: string | null
  month: string
  units: BillingUnit[]
  lines: ServiceLine[]
  subtotalCents: number
}

export const dollarsToCents = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : Math.round(v * 100))

export function monthOf(ymd: string): string {
  return ymd.slice(0, 7)
}

export function monthFirstDay(month: string): string {
  return `${month}-01`
}

/** "November 2026" for 2026-11. */
export function monthLabel(month: string): string {
  return formatInTimeZone(new Date(`${month}-01T12:00:00Z`), 'UTC', 'MMMM yyyy')
}

/** Units ready to bill, and done visits that can't be billed here (with why). `billed` = what non-void invoices hold. */
export function buildBillingUnits(
  visits: readonly DoneVisit[],
  plans: ReadonlyMap<string, BillingPlanFacts>,
  billed: { visitIds: ReadonlySet<string>; planMonths: ReadonlySet<string> }
): { units: BillingUnit[]; notBillable: NotBillable[] } {
  const units: BillingUnit[] = []
  const notBillable: NotBillable[] = []
  const months = new Map<string, BillingUnit>()
  for (const v of visits) {
    if ((v.visitStep || SERVICE_STEP) !== SERVICE_STEP) continue // follow-on steps are part of the plan
    if (billed.visitIds.has(v.visitId)) continue
    const plan = plans.get(v.planId)
    const customerId = v.customerId ?? plan?.customer_id ?? null
    if (!plan || !customerId) continue // a plan that no longer loads (deleted customer) never bills by accident
    const month = monthOf(v.servedOn)
    // A skipped visit bills nothing on a per-visit plan; on a monthly-fee plan the month still bills (the plan's own
    // billing basis decides). A paused plan has no visits in its paused weeks, so a paused month never bills.
    if (v.skipped && plan.billing_basis !== 'per_month') continue
    if (!v.skipped && v.price != null && v.price > 0) {
      units.push({
        key: `v:${v.visitId}`,
        kind: 'visit',
        customerId,
        propertyId: v.propertyId ?? plan.property_id,
        planId: plan.id,
        planName: plan.name,
        month,
        date: v.servedOn,
        amountCents: dollarsToCents(v.price),
        taxable: v.taxable,
        visits: [{ visitId: v.visitId, date: v.servedOn }],
      })
      continue
    }
    if (plan.billing_basis === 'per_month') {
      const mkey = `${plan.id}|${monthFirstDay(month)}`
      if (billed.planMonths.has(mkey)) continue // the month is billed; a visit done after that rides on it
      let unit = months.get(mkey)
      if (!unit) {
        const price = planPriceOn(plan, monthFirstDay(month))
        unit = {
          key: `m:${plan.id}:${month}`,
          kind: 'month',
          customerId,
          propertyId: plan.property_id ?? v.propertyId,
          planId: plan.id,
          planName: plan.name,
          month,
          date: monthFirstDay(month),
          amountCents: dollarsToCents(price),
          taxable: plan.taxable,
          visits: [],
        }
        months.set(mkey, unit)
      }
      if (!v.skipped) unit.visits.push({ visitId: v.visitId, date: v.servedOn })
      continue
    }
    notBillable.push({ visitId: v.visitId, customerId, planName: plan.name, date: v.servedOn, reason: plan.billing_basis === 'per_year' ? 'yearly' : plan.billing_basis === 'per_hour' ? 'hourly' : 'no_price' })
  }
  for (const u of Array.from(months.values())) {
    if (u.amountCents > 0) {
      u.visits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      units.push(u)
    } else {
      for (const v of u.visits) notBillable.push({ visitId: v.visitId, customerId: u.customerId, planName: u.planName, date: v.date, reason: 'no_price' })
      if (u.visits.length === 0) notBillable.push({ visitId: u.key, customerId: u.customerId, planName: u.planName, date: u.date, reason: 'no_price' })
    }
  }
  units.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1))
  return { units, notBillable }
}

/** A unit waits while its month isn't over (unless the office includes this month). Visit-by-visit billing never waits. */
export function unitWaits(u: BillingUnit, grouping: BillingGrouping, currentMonth: string, includeCurrentMonth: boolean): boolean {
  if (includeCurrentMonth || u.month < currentMonth) return false
  return grouping === 'month' || u.kind === 'month'
}

/**
 * Bill exactly what the office saw: keep only units it previewed (by key) and, inside a month, only the visits it saw.
 * A visit finished after the screen loaded waits for the next run (it is not on any invoice, so it shows again).
 */
export function onlyPreviewed(units: readonly BillingUnit[], unitKeys: ReadonlySet<string>, visitIds: ReadonlySet<string>): BillingUnit[] {
  const out: BillingUnit[] = []
  for (const u of units) {
    if (!unitKeys.has(u.key)) continue
    if (u.kind === 'visit') {
      if (visitIds.has(u.visits[0].visitId)) out.push(u)
    } else out.push({ ...u, visits: u.visits.filter((v) => visitIds.has(v.visitId)) })
  }
  return out
}

/** Pure: the invoice lines for a set of units (one customer). `address` names a line's property when they differ. */
export function serviceInvoiceLines(units: readonly BillingUnit[], address: (propertyId: string | null) => string | null): { lines: ServiceLine[]; propertyId: string | null } {
  const props = new Set(units.map((u) => u.propertyId ?? ''))
  const many = props.size > 1
  const where = (u: BillingUnit) => {
    const a = many ? address(u.propertyId) : null
    return a ? `${a} · ` : ''
  }
  const lines: ServiceLine[] = []
  for (const u of units) {
    if (u.kind === 'visit') {
      const v = u.visits[0]
      lines.push({
        description: `${where(u)}${u.planName}`,
        qty: 1,
        unit_price_cents: u.amountCents,
        taxable: u.taxable,
        work_order_id: v.visitId,
        service_date: v.date,
        service_plan_id: u.planId,
      })
    } else {
      lines.push({
        description: `${where(u)}${u.planName} — ${monthLabel(u.month)}`,
        qty: 1,
        unit_price_cents: u.amountCents,
        taxable: u.taxable,
        service_plan_id: u.planId,
        billing_month: monthFirstDay(u.month),
      })
      for (const v of u.visits) {
        lines.push({
          description: `${where(u)}${u.planName} visit (included)`,
          qty: 1,
          unit_price_cents: 0,
          taxable: false,
          work_order_id: v.visitId,
          service_date: v.date,
          service_plan_id: u.planId,
        })
      }
    }
  }
  return { lines, propertyId: many ? null : (units[0]?.propertyId ?? null) }
}

/** Pure: the invoices a batch would make. Units that wait are left out (the caller shows them as "this month so far"). */
export function groupDraftInvoices(
  units: readonly BillingUnit[],
  grouping: BillingGrouping,
  address: (propertyId: string | null) => string | null
): DraftInvoice[] {
  const groups = new Map<string, BillingUnit[]>()
  for (const u of units) {
    const key = grouping === 'visit' ? u.key : `c:${u.customerId}:${u.month}`
    const list = groups.get(key)
    if (list) list.push(u)
    else groups.set(key, [u])
  }
  const out: DraftInvoice[] = []
  for (const [key, list] of Array.from(groups.entries())) {
    const { lines, propertyId } = serviceInvoiceLines(list, address)
    out.push({
      key,
      customerId: list[0].customerId,
      propertyId,
      month: list[0].month,
      units: list,
      lines,
      subtotalCents: lines.reduce((s, l) => s + lineTotalCents(l.qty, l.unit_price_cents), 0),
    })
  }
  return out
}

/** Preview of an invoice's tax and total — the same calculation the invoice itself runs (lib/sales-tax.ts). */
export function draftInvoiceTotals(d: Pick<DraftInvoice, 'lines'>, settings: SalesTaxSettings | null, customerExempt: boolean): { subtotalCents: number; taxCents: number; totalCents: number } {
  const tax = computeDocumentSalesTax({
    settings,
    lines: d.lines.map((l) => ({ amountCents: lineTotalCents(l.qty, l.unit_price_cents), taxable: l.taxable })),
    customerExempt,
  })
  return { subtotalCents: tax.subtotalCents, taxCents: tax.taxCents, totalCents: tax.totalCents }
}

/** Default look-back for done visits not yet billed. Older ones need "Look back further". */
export const BILLING_LOOKBACK_DAYS = 120
export const MAX_BILLING_LOOKBACK_DAYS = 730

export function lookbackFrom(today: string, days: number): string {
  const d = Math.min(Math.max(Math.round(days) || BILLING_LOOKBACK_DAYS, 1), MAX_BILLING_LOOKBACK_DAYS)
  return addDaysYmd(today, -d)
}

export { invoiceItemDateLabel as visitDateLabel }
