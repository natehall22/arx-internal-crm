/**
 * A quote link sent before the sale-credit rule has no confirmed closer, so the customer's approval is held. The customer gets a
 * friendly "your contractor needs to confirm a detail" and the sender gets a Needs-you row (lib/today.ts) until a new link is
 * sent after confirming the credit. Tolerant of a database where the column is not there yet (no rows, no error).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'

export const NEEDS_DETAIL_MESSAGE = 'Your contractor needs to confirm one detail before this can be approved. We have let them know and they will contact you shortly.'

export async function flagApprovalBlocked(admin: SupabaseClient, orgId: string, linkId: string): Promise<void> {
  const { error } = await orgDb(admin, orgId).from('quote_links').update({ approval_blocked_at: new Date().toISOString() }).eq('id', linkId).is('approval_blocked_at', null)
  if (error) console.error('quote link: could not flag the held approval', error.message)
}

export type BlockedQuote = { proposalId: string; customerName: string | null; proposalNumber: string | null }

export async function listBlockedQuotes(admin: SupabaseClient, orgId: string, opts: { createdBy?: string } = {}): Promise<BlockedQuote[]> {
  let q = orgDb(admin, orgId).from('quote_links').select('proposal_id, proposals(customer_name, proposal_number)').not('approval_blocked_at', 'is', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())
  if (opts.createdBy) q = q.eq('created_by', opts.createdBy)
  const { data, error } = await q.limit(50)
  if (error) return []
  const seen = new Set<string>()
  const out: BlockedQuote[] = []
  for (const r of (data ?? []) as Array<{ proposal_id: string; proposals?: { customer_name: string | null; proposal_number: string | null } | null }>) {
    if (seen.has(r.proposal_id)) continue
    seen.add(r.proposal_id)
    out.push({ proposalId: r.proposal_id, customerName: r.proposals?.customer_name ?? null, proposalNumber: r.proposals?.proposal_number ?? null })
  }
  return out
}
