import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCustomerDisplayName, upsertCustomer } from '@/lib/customers'

export type LeadIdentity = {
  id: string
  customer_id?: string | null
  homeowner_name?: string | null
  phone?: string | null
  email?: string | null
  address_text?: string | null
}

/**
 * The customer a NEW opportunity should hang off. A customer row used to appear only at contract signing, so
 * a deal had no Customer File until it sold. Now it exists from the moment an inspection is booked (the deal
 * is created): an existing customer wins (repeat / second property), else one is created from the lead.
 * Same matching rule as everywhere (`findExistingCustomer`: real email, last-10 phone, exact name+address).
 *
 * Never blocks booking: any failure returns null and the deal is created as before (the backfill and the
 * next touch link it). Does NOT write leads.customer_id (canvass reads it as "existing customer") and does NOT
 * enqueue a QuickBooks event — QuickBooks only hears about a customer at signing, as before.
 */
export async function customerIdForLead(admin: SupabaseClient, orgId: string, lead: LeadIdentity | null | undefined): Promise<string | null> {
  if (!lead) return null
  if (lead.customer_id) return lead.customer_id
  const hasIdentity = !!(lead.homeowner_name?.trim() || lead.phone?.trim() || lead.email?.trim() || lead.address_text?.trim())
  if (!hasIdentity) return null
  try {
    const { customer_id } = await upsertCustomer(
      admin,
      orgId,
      {
        name: resolveCustomerDisplayName({ name: lead.homeowner_name, address_text: lead.address_text, phone: lead.phone, fallbackIdHint: lead.id.slice(0, 8) }),
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        address_text: lead.address_text ?? null,
      },
      { skipIntegrations: true }
    )
    return customer_id
  } catch (e) {
    console.error('customerIdForLead failed (deal created without a customer):', e)
    return null
  }
}
