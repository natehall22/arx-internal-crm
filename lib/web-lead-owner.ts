import type { SupabaseClient } from '@supabase/supabase-js'

export type WebLeadOwner = { id: string; email: string | null }

/**
 * Who owns (and is emailed about) a lead that arrives from a website / lead-source webhook.
 *
 * The configured people (the lead source's auto-assign user, then `orgs.settings.web_leads_owner_id`) are used only
 * when they are ACTIVE users of the lead's own company — a stale or copied id from another company never receives
 * another company's lead. Otherwise the company's longest-standing active admin (ordered by created_at, so the answer
 * is stable; it used to be "any admin", unordered). Null when the company has no active admin.
 */
export async function resolveWebLeadOwner(
  admin: SupabaseClient,
  orgId: string,
  configuredIds: Array<string | null | undefined>
): Promise<WebLeadOwner | null> {
  for (const id of configuredIds) {
    if (typeof id !== 'string' || !id.trim()) continue
    const { data } = await admin
      .from('users')
      .select('id, email')
      .eq('id', id.trim())
      .eq('org_id', orgId)
      .eq('active', true)
      .maybeSingle()
    if (data?.id) return { id: data.id as string, email: emailOrNull(data.email) }
    console.error('web lead owner: configured user is not an active user of this company, skipped', { orgId, userId: id })
  }

  const { data: fallback } = await admin
    .from('users')
    .select('id, email')
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return fallback?.id ? { id: fallback.id as string, email: emailOrNull(fallback.email) } : null
}

function emailOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.includes('@') ? v.trim() : null
}
