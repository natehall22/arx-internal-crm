/**
 * Approved quote -> service plans (server only). One plan per recurring line the customer approved, made through the EXISTING
 * plan code (`createServicePlan`, which copies the template and tops up the visits) on the property found by the one address
 * match rule (`findOrCreateProperty`). No second plan or pricing model: the line's price is the plan's price.
 *
 * Repeatable: `service_plans.quote_line_id` is unique, so a retry (or two runners) finds the plan that already exists and
 * returns it. No card is saved and no autopay is started here — the confirmation email carries the existing save-card link,
 * which the customer completes (and consents on) themselves.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { upsertCustomer } from '@/lib/customers'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { loadCardOnFile } from '@/lib/online-payments/cards'
import { createPaymentLink, tooManyLinks } from '@/lib/online-payments/links'
import { createServicePlan, findOrCreateProperty, loadServicePlan } from '@/lib/service-plans-db'
import { addDaysYmd, planVisitDates, ymdInZone, type ServicePlan } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'
import type { ApprovalSnapshot } from '@/lib/quotes/approve'

export type QuotePlanResult = { lineId: string; name: string; planId: string; customerId: string; startDate: string; firstVisit: string | null; created: boolean }

export function firstVisitOf(plan: Pick<ServicePlan, 'status' | 'start_date' | 'end_date' | 'paused_until' | 'seasons' | 'preferred_weekday'>, from?: string): string | null {
  const start = from && from > plan.start_date ? from : plan.start_date
  return planVisitDates(plan, start, addDaysYmd(start, 400))[0] ?? null
}

/** Plans already made for these quote lines (read-only; the cancel wording and the staff card use it). */
export async function plansForQuoteLines(admin: SupabaseClient, orgId: string, lineIds: string[]): Promise<Array<{ id: string; quote_line_id: string; status: string; customer_id: string }>> {
  if (lineIds.length === 0) return []
  const { data, error } = await orgDb(admin, orgId).from('service_plans').select('id, quote_line_id, status, customer_id').in('quote_line_id', lineIds)
  if (error) return []
  return (data ?? []) as Array<{ id: string; quote_line_id: string; status: string; customer_id: string }>
}

/** How many service plans (not ended) a quote's recurring lines made. Cancelling the sale does not end them; the office ends them by hand. */
export async function livePlanCountForProposal(admin: SupabaseClient, orgId: string, proposalId: string | null): Promise<number> {
  if (!proposalId) return 0
  const { data, error } = await orgDb(admin, orgId).from('proposal_line_items').select('id').eq('proposal_id', proposalId).not('service_plan_template_id', 'is', null)
  if (error) return 0
  const plans = await plansForQuoteLines(admin, orgId, ((data ?? []) as Array<{ id: string }>).map((r) => r.id))
  return plans.filter((p) => p.status !== 'ended').length
}

export async function ensureQuotePlans(
  admin: SupabaseClient,
  orgId: string,
  args: {
    snapshot: Pick<ApprovalSnapshot, 'recurring'>
    opportunityId: string | null
    customer: { name: string; email: string | null; phone: string | null; address: string }
    userId: string | null
    approvalId?: string | null
    now?: Date
  }
): Promise<QuotePlanResult[]> {
  const chosen = (args.snapshot.recurring ?? []).filter((r) => r.chosen)
  if (chosen.length === 0) return []
  const db = orgDb(admin, orgId)
  const today = ymdInZone(args.now ?? new Date(), await loadOrgTimeZone(admin, orgId))
  const lookup = async (lineId: string) => {
    const { data } = await db.from('service_plans').select('id, customer_id').eq('quote_line_id', lineId).maybeSingle()
    return (data as { id: string; customer_id: string } | null) ?? null
  }
  let customerId: string | null = null
  let propertyId: string | null = null
  let soldBy: string | null | undefined
  let oppCustomerId: string | null = null
  const out: QuotePlanResult[] = []
  for (const r of chosen) {
    const have = await lookup(r.lineId)
    if (have) {
      const plan = await loadServicePlan(admin, orgId, have.id)
      out.push({ lineId: r.lineId, name: r.name, planId: have.id, customerId: have.customer_id, startDate: plan?.start_date ?? r.startDate, firstVisit: plan ? firstVisitOf(plan, today) : null, created: false })
      continue
    }
    if (!args.userId) throw new Error('no one to own the service plan')
    if (soldBy === undefined) {
      const { data: o } = args.opportunityId ? await db.from('opportunities').select('customer_id, owner_user_id').eq('id', args.opportunityId).maybeSingle() : { data: null }
      const row = o as { customer_id?: string | null; owner_user_id?: string | null } | null
      soldBy = row?.owner_user_id ?? null
      oppCustomerId = row?.customer_id ?? null
    }
    if (!customerId) {
      customerId = oppCustomerId
      // The deal's customer; a deal with none goes through the one customer matching rule (phone / email / name + address).
      if (!customerId) customerId = (await upsertCustomer(admin, orgId, { name: args.customer.name, email: args.customer.email, phone: args.customer.phone, address_text: args.customer.address })).customer_id
    }
    if (!propertyId) {
      const found = await findOrCreateProperty(admin, orgId, args.userId, customerId, args.customer.address, { address_line1: args.customer.address }, { accessNotes: false })
      if (!found.ok) throw new Error(`property: ${found.error}`)
      propertyId = found.propertyId
    }
    // TODO(recurring commission): pay nothing yet. Owner direction (2026-11-17): a % of each PAID visit invoice for the first season,
    // stopping if the customer cancels; rule to be set with the comp plans. `sold_by_user_id` + `quote_approval_id` on the plan are the hook.
    const made = await createServicePlan(
      admin,
      orgId,
      args.userId,
      customerId,
      { template_id: r.templateId, property_id: propertyId, start_date: r.startDate < today ? today : r.startDate, price: r.priceCents / 100, ...(r.weekday != null ? { preferred_weekday: r.weekday } : {}) },
      args.now,
      { quoteLineId: r.lineId, soldByUserId: soldBy ?? null, quoteApprovalId: args.approvalId ?? null }
    )
    if (made.ok) {
      out.push({ lineId: r.lineId, name: r.name, planId: made.plan.id, customerId, startDate: made.plan.start_date, firstVisit: firstVisitOf(made.plan, today), created: true })
      continue
    }
    // A second runner may have just made it (unique quote_line_id): use that plan.
    const raced = await lookup(r.lineId)
    if (!raced) throw new Error(`service plan: ${made.error}`)
    const plan = await loadServicePlan(admin, orgId, raced.id)
    out.push({ lineId: r.lineId, name: r.name, planId: raced.id, customerId: raced.customer_id, startDate: plan?.start_date ?? r.startDate, firstVisit: plan ? firstVisitOf(plan, today) : null, created: false })
  }
  return out
}

/**
 * The existing "save your card" link (lib/online-payments, the customer enters the card and gives consent on Stripe's page)
 * for the confirmation email — or null when automatic payments are not set up, a card is already saved, or no link can be made.
 * Nothing is charged or saved without the customer's own act.
 */
export async function saveCardLinkFor(admin: SupabaseClient, orgId: string, customerId: string): Promise<string | null> {
  try {
    const op = await loadOnlinePayments(admin, orgId)
    if (!op.ready || !op.settings.autopay) return null
    if (await loadCardOnFile(admin, orgId, customerId)) return null
    if (await tooManyLinks(admin, orgId, { customerId })) return null
    return (await createPaymentLink(admin, orgId, { kind: 'save_card', customerId }, null)).url
  } catch (e) {
    console.error('quote approval: save-card link not made', e)
    return null
  }
}
