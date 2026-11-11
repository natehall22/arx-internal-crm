/**
 * Existing customer links that open a (light) portal session: the pay link (/pay/<token>) and the signing link
 * (/contracts/sign/<token>). The link must be live AND belong to the company whose address it is opened on.
 *
 * NOT the inspection-report link (/r/<token>): it is built to be forwarded to neighbours and insurance carriers, so it
 * must never be a key to a customer's invoices. The report page offers the normal emailed sign-in instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolvePaymentLink } from '@/lib/online-payments/links'
import { invoiceCustomerId } from '@/lib/online-payments/checkout'
import { findOrgInvoice } from '@/lib/invoices'
import { orgDb } from '@/lib/supabase/org-db'

export type LinkSource = 'pay' | 'sign'
export type LinkCustomer = { orgId: string; customerId: string; via: 'pay_link' | 'sign_link' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The customer a live link belongs to, only when the link is this company's (`hostOrgId`). null = not a usable link. */
export async function customerFromLink(admin: SupabaseClient, source: LinkSource, token: unknown, hostOrgId: string): Promise<LinkCustomer | null> {
  if (source === 'pay') {
    const link = await resolvePaymentLink(admin, token)
    if (!link || link.org_id !== hostOrgId) return null
    if (link.kind === 'save_card') return link.customer_id ? { orgId: link.org_id, customerId: link.customer_id, via: 'pay_link' } : null
    if (!link.invoice_id) return null
    const invoice = await findOrgInvoice(admin, link.invoice_id, link.org_id)
    if (!invoice) return null
    const customerId = await invoiceCustomerId(admin, link.org_id, invoice)
    return customerId ? { orgId: link.org_id, customerId, via: 'pay_link' } : null
  }
  if (typeof token !== 'string' || !UUID_RE.test(token)) return null
  // org-scope-ok: lookup by a secret signing token — the row it finds names its own company, compared to the host company below
  const { data } = await admin.from('order_form_contracts').select('org_id, opportunity_id, token_expires_at, status').eq('signing_token', token).maybeSingle()
  const c = data as { org_id: string; opportunity_id: string | null; token_expires_at: string; status: string } | null
  if (!c || c.org_id !== hostOrgId || !c.opportunity_id || Date.parse(c.token_expires_at) <= Date.now() || c.status === 'voided') return null
  const { data: opp } = await orgDb(admin, c.org_id).from('opportunities').select('customer_id').eq('id', c.opportunity_id).maybeSingle()
  const customerId = (opp as { customer_id?: string | null } | null)?.customer_id
  return customerId ? { orgId: c.org_id, customerId, via: 'sign_link' } : null
}
