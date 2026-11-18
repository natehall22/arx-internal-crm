/**
 * Recurring lines in the quote builder (server only): what the builder may save, and which plan templates it may offer.
 * A recurring line is a `proposal_line_items` row tied to a service plan template (`service_plan_template_id`); it carries
 * NO one-time amount (`line_total` 0), its `unit_price` is the plan price (a salesperson may override the template's), and
 * seasons / frequency / billing basis always come from the template. Only offered when BOTH `servicePlans` and
 * `quoteApproval` are on, so a company without plans on quotes (every roofing company) never sees or stores one.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { loadOrgFeatures } from '@/lib/org-features'
import { isRecurringLine, templateOfferedOnQuote } from '@/lib/quotes/recurring'
import { BILLING_BASIS_LABELS, isYmd, scheduleSummary, type BillingBasis } from '@/lib/service-plans'
import { loadTemplate, loadTemplates } from '@/lib/service-plans-db'

export type BuilderPlanTemplate = { id: string; name: string; billing_basis: BillingBasis; basisLabel: string; schedule: string; defaultPrice: number | null }

/** Both company switches on? */
export async function recurringQuoteLinesOn(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const f = await loadOrgFeatures(admin, orgId)
  return f.servicePlans && f.quoteApproval
}

/** The templates the builder offers (active, not hourly, takes a typed price). Empty when the switches are off. */
export async function builderPlanTemplates(admin: SupabaseClient, orgId: string): Promise<BuilderPlanTemplate[]> {
  if (!(await recurringQuoteLinesOn(admin, orgId))) return []
  const { templates } = await loadTemplates(admin, orgId, { activeOnly: true })
  return templates
    .filter((t) => templateOfferedOnQuote({ active: t.active, billing_basis: t.billing_basis, allowCustom: t.pricing.allowCustom }))
    .map((t) => ({ id: t.id, name: t.name, billing_basis: t.billing_basis, basisLabel: BILLING_BASIS_LABELS[t.billing_basis], schedule: scheduleSummary(t.seasons), defaultPrice: t.pricing.tiers[0]?.price ?? null }))
}

const UNIT: Record<BillingBasis, string> = { per_visit: 'visit', per_month: 'month', per_year: 'year', per_hour: 'hour' }

/** Check + normalise the recurring lines of a builder save. Lines with no template pass through untouched. */
export async function cleanRecurringLines<T extends Record<string, unknown>>(admin: SupabaseClient, orgId: string, lines: readonly T[]): Promise<{ ok: true; lines: T[] } | { ok: false; error: string }> {
  if (!lines.some((l) => isRecurringLine(l as { service_plan_template_id?: string | null }))) return { ok: true, lines: [...lines] }
  if (!(await recurringQuoteLinesOn(admin, orgId))) return { ok: false, error: 'Recurring service lines need Service plans and Online quote approval turned on.' }
  const out: T[] = []
  for (const l of lines) {
    if (!isRecurringLine(l as { service_plan_template_id?: string | null })) {
      out.push(l)
      continue
    }
    const t = await loadTemplate(admin, orgId, String(l.service_plan_template_id))
    if (!t || !templateOfferedOnQuote({ active: t.active, billing_basis: t.billing_basis, allowCustom: t.pricing.allowCustom })) return { ok: false, error: 'That plan template is not offered on quotes.' }
    const price = Number(l.unit_price)
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return { ok: false, error: `Enter a price for ${t.name}.` }
    if (!isYmd(l.plan_start_date)) return { ok: false, error: `Pick the start date for ${t.name}.` }
    const wd = l.plan_weekday
    if (wd != null && wd !== '' && !(Number.isInteger(Number(wd)) && Number(wd) >= 0 && Number(wd) <= 6)) return { ok: false, error: 'Pick a valid visit day.' }
    out.push({
      ...l,
      service_plan_template_id: t.id,
      plan_start_date: l.plan_start_date,
      plan_weekday: wd == null || wd === '' ? null : Number(wd),
      name: String(l.name ?? '').trim() || t.name,
      category: 'Recurring service',
      unit: UNIT[t.billing_basis],
      quantity: 1,
      unit_price: roundMoney(price),
      line_total: 0,
      is_adder: false,
      price_type: null,
      taxable: null,
    })
  }
  return { ok: true, lines: out }
}
