/**
 * "Last contact: Nov 12 · call by Jake" — the ONE loader and the ONE wording. Derived from the contact logging that already exists
 * (activities of type call / text / email / visit on the customer: lib/customer-contact.ts is the writer's vocabulary); nothing new
 * is written. Visibility is applied in SQL (`customer_last_contact` uses the same evaluator as thread search), so a contact the
 * viewer may not read never shows its date.
 *
 * Not included on purpose: referral-partner touches. A customer has no link to a partner (a builder is a customer, not a partner),
 * and a deal's `referral_partner_id` means "who referred it", which is not contact WITH the customer. When a real customer↔partner
 * link exists, add its touches inside `customer_last_contact` — this file does not change.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { CONTACT_KIND_LABELS, isContactKind } from '@/lib/customer-contact'
import { formatDateShort } from '@/lib/format'

export type LastContact = { at: string; kind: string; byName: string | null }

const CHUNK = 1500

/** Newest logged contact per customer the viewer may see. Best effort: before the migration is applied (or on a failure) → empty. */
export async function loadLastContacts(admin: SupabaseClient, orgId: string, viewerId: string, customerIds: string[]): Promise<Map<string, LastContact>> {
  const out = new Map<string, LastContact>()
  const ids = Array.from(new Set(customerIds.filter(Boolean)))
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin.rpc('customer_last_contact', { p_org: orgId, p_viewer: viewerId, p_customer_ids: ids.slice(i, i + CHUNK) })
    if (error) {
      console.error('last contact skipped', error.message)
      return out
    }
    for (const r of (data ?? []) as Array<{ customer_id: string; at: string; kind: string; by_name: string | null }>) {
      out.set(r.customer_id, { at: r.at, kind: r.kind, byName: r.by_name })
    }
  }
  return out
}

/** "Nov 12 · call by Jake" (first name only); "No contact logged" when there is none. */
export function describeLastContact(c: LastContact | null | undefined): string {
  if (!c) return 'No contact logged'
  const kind = isContactKind(c.kind) ? CONTACT_KIND_LABELS[c.kind].toLowerCase() : c.kind
  const first = (c.byName ?? '').trim().split(/\s+/)[0]
  return `${formatDateShort(c.at)} · ${kind}${first ? ` by ${first}` : ''}`
}
