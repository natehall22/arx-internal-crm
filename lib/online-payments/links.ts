/**
 * Customer links for online payments: "pay this invoice" and "save a card for automatic payments". A link is a random
 * 256-bit token; only its SHA-256 is stored (`payment_links.token_hash`), so a database read never yields a working link.
 * The page lives on the company's own address (`orgAppUrl`, lib/company-links.ts) and refuses a token opened on another
 * company's address (lib/online-payments/public.ts).
 */
import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgAppUrl } from '@/lib/company-links'
import { orgDb } from '@/lib/supabase/org-db'

export type PaymentLinkKind = 'invoice' | 'save_card'

export const INVOICE_LINK_DAYS = 180
export const SAVE_CARD_LINK_DAYS = 14

export type PaymentLinkRow = {
  id: string
  org_id: string
  kind: PaymentLinkKind
  invoice_id: string | null
  customer_id: string | null
  expires_at: string
  revoked_at: string | null
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Pure: url-safe and token-sized (ours are 43 chars). Anything else is refused before a database read. */
export function isWellFormedLinkToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token)
}

export async function createPaymentLink(
  admin: SupabaseClient,
  orgId: string,
  target: { kind: 'invoice'; invoiceId: string } | { kind: 'save_card'; customerId: string },
  createdBy: string | null,
  now: Date = new Date()
): Promise<{ id: string; url: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url')
  const days = target.kind === 'invoice' ? INVOICE_LINK_DAYS : SAVE_CARD_LINK_DAYS
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString()
  const { data, error } = await orgDb(admin, orgId)
    .from('payment_links')
    .insert({
      kind: target.kind,
      token_hash: hashLinkToken(token),
      invoice_id: target.kind === 'invoice' ? target.invoiceId : null,
      customer_id: target.kind === 'save_card' ? target.customerId : null,
      created_by: createdBy,
      expires_at: expiresAt,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Could not make the link: ${error?.message ?? 'unknown'}`)
  const base = await orgAppUrl(orgId)
  return { id: (data as { id: string }).id, url: `${base}/pay/${token}`, expiresAt }
}

/** The live link for a token (not revoked, not expired), or null. */
export async function resolvePaymentLink(admin: SupabaseClient, token: unknown, now: Date = new Date()): Promise<PaymentLinkRow | null> {
  if (!isWellFormedLinkToken(token)) return null
  // org-scope-ok: lookup by a secret token's hash — the row it finds names its own company
  const { data } = await admin
    .from('payment_links')
    .select('id, org_id, kind, invoice_id, customer_id, expires_at, revoked_at')
    .eq('token_hash', hashLinkToken(token))
    .maybeSingle()
  const row = data as PaymentLinkRow | null
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= now.getTime()) return null
  return row
}

export async function revokePaymentLink(admin: SupabaseClient, orgId: string, linkId: string): Promise<void> {
  await orgDb(admin, orgId).from('payment_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId).is('revoked_at', null)
}

export async function touchPaymentLink(admin: SupabaseClient, orgId: string, linkId: string): Promise<void> {
  await orgDb(admin, orgId).from('payment_links').update({ last_opened_at: new Date().toISOString() }).eq('id', linkId)
}

/** A customer link may open at most this many Stripe pages per window (shared across server instances: SQL). */
export const LINK_ATTEMPTS = { limit: 10, windowSeconds: 15 * 60 }
/** Staff may make at most this many links for one invoice / customer per hour (each can be emailed). */
export const LINKS_PER_TARGET_PER_HOUR = 20

export async function takeLinkAttempt(admin: SupabaseClient, linkId: string): Promise<boolean> {
  const { data, error } = await admin.rpc('payment_link_take_attempt', { p_link: linkId, p_limit: LINK_ATTEMPTS.limit, p_window_seconds: LINK_ATTEMPTS.windowSeconds })
  if (error) {
    console.error('takeLinkAttempt failed (refusing)', error)
    return false
  }
  return data === true
}

export async function tooManyLinks(
  admin: SupabaseClient,
  orgId: string,
  target: { invoiceId: string } | { customerId: string },
  now: Date = new Date()
): Promise<boolean> {
  const since = new Date(now.getTime() - 3_600_000).toISOString()
  const q = orgDb(admin, orgId).from('payment_links').select('id', { count: 'exact', head: true }).gte('created_at', since)
  const { count } = await ('invoiceId' in target ? q.eq('invoice_id', target.invoiceId) : q.eq('customer_id', target.customerId))
  return (count ?? 0) >= LINKS_PER_TARGET_PER_HOUR
}
