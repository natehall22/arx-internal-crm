import type { SupabaseClient } from '@supabase/supabase-js'

import { activeTrades, loadOrgTrades } from '@/lib/org-trades'
import { loadCustomerProperties } from '@/lib/properties-db'
import { propertyDisplayName } from '@/lib/properties'
import type { ServicePlanAccess } from '@/lib/service-plans-access'
import { loadTemplates } from '@/lib/service-plans-db'
import type { PlanPricing } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export function hideTierPrices(p: PlanPricing, prices: boolean): PlanPricing {
  return prices ? p : { ...p, tiers: p.tiers.map((t) => ({ ...t, price: 0 })) }
}

/**
 * What the ONE plan form needs (components/service-plans/PlanForm.tsx): the customer's properties (none for a new
 * customer), the company's service types, crews, people for follow-on steps (editors only) and plan types. Used by
 * GET /api/customers/[id]/service-plans and GET /api/service-plans (new customer + plan).
 */
export async function loadPlanEditorOptions(admin: SupabaseClient, orgId: string, access: ServicePlanAccess, customerId: string | null) {
  const [props, trades, subs, users, templates] = await Promise.all([
    customerId ? loadCustomerProperties(admin, orgId, customerId, { accessNotes: false }) : Promise.resolve({ ready: true, properties: [] }),
    loadOrgTrades(admin, orgId),
    orgDb(admin, orgId).from('sub_contractors').select('id, company_name').eq('active', true).order('company_name'),
    access.edit ? orgDb(admin, orgId).from('users').select('id, full_name').eq('active', true).order('full_name') : Promise.resolve({ data: [] }),
    loadTemplates(admin, orgId, { activeOnly: true }),
  ])
  return {
    prices: access.prices,
    properties: props.properties.map((p) => ({ id: p.id, name: propertyDisplayName(p) })),
    trades: activeTrades(trades).map((t) => ({ slug: t.slug, label: t.label })),
    crews: ((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => ({ id: s.id, name: s.company_name ?? 'Crew' })),
    people: ((users.data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ id: u.id, name: u.full_name || 'Unnamed user' })),
    // What the company sells: a new plan starts from one of these (copied at sale).
    templates: templates.templates.map((t) => ({ ...t, pricing: hideTierPrices(t.pricing, access.prices) })),
  }
}
