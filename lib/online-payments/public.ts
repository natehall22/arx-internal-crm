/**
 * The customer's pay page (`/pay/<token>`, no login) — what it shows and the one guard every public use of a link
 * passes: the token must be live AND the page must be opened on that company's own address (host fence,
 * lib/company-host.ts): a link opened on another company's address is "not found". Company brand only, never the product.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { orgLogoHref } from '@/lib/files/files-object'
import { findOrgInvoice } from '@/lib/invoices'
import { getDocumentBrand } from '@/lib/org-brand'
import { orgDb } from '@/lib/supabase/org-db'
import { loadOnlinePayments, type OnlinePayments } from '@/lib/online-payments/accounts'
import { cardLabel, loadCardOnFile } from '@/lib/online-payments/cards'
import { invoiceCustomerId, payableCents } from '@/lib/online-payments/checkout'
import { resolvePaymentLink, type PaymentLinkRow } from '@/lib/online-payments/links'
import { autopayConsentText, MIN_PARTIAL_CENTS } from '@/lib/online-payments/settings'

export type PayPageState = 'pay' | 'paid' | 'processing' | 'void' | 'unavailable' | 'save_card' | 'card_saved'

export type PayPageView = {
  kind: 'invoice' | 'save_card'
  state: PayPageState
  company: { name: string; phone: string; email: string; logoHref: string | null }
  customerName: string
  invoice: { number: string; totalCents: number; balanceCents: number; payableCents: number; processingCents: number } | null
  allowPartial: boolean
  minPartialCents: number
  bankPayments: boolean
  canSaveCard: boolean
  consentText: string
  cardOnFile: string | null
}

/** The live link for this request, or null (bad token, expired, revoked, or the wrong company's address). */
export async function resolvePublicLink(admin: SupabaseClient, token: unknown): Promise<PaymentLinkRow | null> {
  const link = await resolvePaymentLink(admin, token)
  if (!link) return null
  const fence = await getRequestHostFence()
  return fenceAllowsOrg(fence, link.org_id) ? link : null
}

export async function loadPayPageView(admin: SupabaseClient, link: PaymentLinkRow, op?: OnlinePayments): Promise<PayPageView | null> {
  const orgId = link.org_id
  const online = op ?? (await loadOnlinePayments(admin, orgId))
  const brand = await getDocumentBrand(admin, orgId)
  const { data: org } = await admin.from('orgs').select('logo_url, settings').eq('id', orgId).maybeSingle()
  const logoHref = orgLogoHref(orgId, (org ?? {}) as Parameters<typeof orgLogoHref>[1])
  const company = { name: brand.casualName || brand.name, phone: brand.phone, email: brand.email, logoHref }
  const base = {
    company,
    allowPartial: online.settings.allowPartial,
    minPartialCents: MIN_PARTIAL_CENTS,
    bankPayments: online.settings.bankPayments,
    consentText: autopayConsentText(brand.name),
  }

  if (link.kind === 'save_card') {
    if (!link.customer_id) return null
    const { data: c } = await orgDb(admin, orgId).from('customers').select('name').eq('id', link.customer_id).maybeSingle()
    if (!c) return null
    const card = await loadCardOnFile(admin, orgId, link.customer_id)
    return {
      ...base,
      kind: 'save_card',
      state: online.ready && online.settings.autopay ? 'save_card' : 'unavailable',
      customerName: (c as { name?: string | null }).name || '',
      invoice: null,
      canSaveCard: true,
      cardOnFile: card?.autopay ? cardLabel(card) : null,
    }
  }

  if (!link.invoice_id) return null
  const invoice = await findOrgInvoice(admin, link.invoice_id, orgId)
  if (!invoice) return null
  // org-scope-ok: invoice found in orgId by findOrgInvoice above
  const { data: inv } = await admin.from('job_invoices').select('invoice_number, total_cents').eq('id', invoice.id).maybeSingle()
  const i = (inv ?? {}) as { invoice_number?: string; total_cents?: number }
  const pay = await payableCents(admin, orgId, invoice.id)
  const customerId = await invoiceCustomerId(admin, orgId, invoice)
  const { data: c } = customerId ? await orgDb(admin, orgId).from('customers').select('name').eq('id', customerId).maybeSingle() : { data: null }
  const state: PayPageState =
    invoice.status === 'void'
      ? 'void'
      : pay.balanceCents <= 0
        ? 'paid'
        : pay.payableCents <= 0
          ? 'processing'
          : !online.ready || (invoice.status === 'draft' && invoice.job_id)
            ? 'unavailable'
            : 'pay'
  return {
    ...base,
    kind: 'invoice',
    state,
    customerName: (c as { name?: string | null } | null)?.name || '',
    invoice: { number: i.invoice_number ?? '', totalCents: Number(i.total_cents) || 0, balanceCents: Math.max(0, pay.balanceCents), payableCents: pay.payableCents, processingCents: pay.processingCents },
    canSaveCard: online.settings.autopay && !invoice.job_id && !!customerId,
    cardOnFile: null,
  }
}
