import type { SupabaseClient } from '@supabase/supabase-js'

/** Typo-tolerant search over messages the viewer may read (visibility enforced in SQL `search_messages`). */
export type MessageHit = {
  id: string
  opportunity_id: string | null
  lead_id: string | null
  customer_id: string | null
  body: string
  created_at: string
  score: number
  /** where it lives — the jump target */
  href: string | null
}

export async function searchMessages(admin: SupabaseClient, orgId: string, viewerId: string, q: string, limit = 20): Promise<MessageHit[]> {
  const text = q.trim().slice(0, 200)
  if (text.length < 2) return []
  const { data, error } = await admin.rpc('search_messages', { p_org: orgId, p_viewer: viewerId, p_q: text, p_limit: limit })
  if (error) throw new Error(`search: ${error.message}`)
  return ((data ?? []) as MessageHit[]).map((h) => ({
    ...h,
    body: h.body.length > 240 ? `${h.body.slice(0, 240)}…` : h.body,
    href:
      h.customer_id && h.opportunity_id
        ? `/c/${h.customer_id}/d/${h.opportunity_id}/overview/n/${h.id}`
        : h.lead_id
          ? `/c/lead/${h.lead_id}`
          : null,
  }))
}
