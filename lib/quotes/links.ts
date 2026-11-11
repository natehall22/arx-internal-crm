/**
 * The customer's quote link (`/q/<token>`): a random 256-bit token, only its SHA-256 stored (`quote_links.token_hash`), so a
 * database read never yields a working link. Expiring, revocable, one live link per proposal (making a new one revokes the
 * older ones, so a forwarded old link stops working). Token hashing and shape checks are the payment link's own helpers
 * (lib/online-payments/links.ts) — one way to hash and validate a customer token.
 */
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgAppUrl } from '@/lib/company-links'
import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { hashLinkToken, isWellFormedLinkToken } from '@/lib/online-payments/links'
import { orgDb } from '@/lib/supabase/org-db'

export type QuoteLinkRow = {
  id: string
  org_id: string
  proposal_id: string
  expires_at: string
  revoked_at: string | null
  first_opened_at: string | null
}

export async function createQuoteLink(
  admin: SupabaseClient,
  orgId: string,
  proposalId: string,
  createdBy: string | null,
  days: number,
  now: Date = new Date()
): Promise<{ id: string; url: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString()
  // The older links stop working first, so there is never a moment with two live ones.
  await orgDb(admin, orgId).from('quote_links').update({ revoked_at: now.toISOString() }).eq('proposal_id', proposalId).is('revoked_at', null)
  const { data, error } = await orgDb(admin, orgId)
    .from('quote_links')
    .insert({ proposal_id: proposalId, token_hash: hashLinkToken(token), created_by: createdBy, expires_at: expiresAt })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Could not make the link: ${error?.message ?? 'unknown'}`)
  const base = await orgAppUrl(orgId)
  return { id: (data as { id: string }).id, url: `${base}/q/${token}`, expiresAt }
}

/** The live link for a token (not revoked, not expired), or null. */
export async function resolveQuoteLink(admin: SupabaseClient, token: unknown, now: Date = new Date()): Promise<QuoteLinkRow | null> {
  if (!isWellFormedLinkToken(token)) return null
  // org-scope-ok: lookup by a secret token's hash — the row it finds names its own company
  const { data } = await admin
    .from('quote_links')
    .select('id, org_id, proposal_id, expires_at, revoked_at, first_opened_at')
    .eq('token_hash', hashLinkToken(token))
    .maybeSingle()
  const row = data as QuoteLinkRow | null
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= now.getTime()) return null
  return row
}

/** The live link for this request, or null: bad token, expired, revoked, or opened on another company's address. */
export async function resolvePublicQuoteLink(admin: SupabaseClient, token: unknown): Promise<QuoteLinkRow | null> {
  const link = await resolveQuoteLink(admin, token)
  if (!link) return null
  return fenceAllowsOrg(await getRequestHostFence(), link.org_id) ? link : null
}

export async function touchQuoteLink(admin: SupabaseClient, link: QuoteLinkRow, now: Date = new Date()): Promise<void> {
  const patch: Record<string, string> = { last_opened_at: now.toISOString() }
  if (!link.first_opened_at) patch.first_opened_at = now.toISOString()
  await orgDb(admin, link.org_id).from('quote_links').update(patch).eq('id', link.id)
}

export async function revokeQuoteLinks(admin: SupabaseClient, orgId: string, proposalId: string, now: Date = new Date()): Promise<void> {
  await orgDb(admin, orgId).from('quote_links').update({ revoked_at: now.toISOString() }).eq('proposal_id', proposalId).is('revoked_at', null)
}
