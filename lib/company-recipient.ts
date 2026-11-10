import type { SupabaseClient } from '@supabase/supabase-js'

export type CompanyRecipient = { id: string; email: string | null }

/**
 * THE rule for "which person in this company gets this" (a lead's owner, an internal alert). Never a hardcoded address.
 *
 * The configured people (e.g. a lead source's auto-assign user, `orgs.settings.web_leads_owner_id`) are used only
 * when they are ACTIVE users of the record's own company — a stale or copied id from another company never receives
 * another company's data. Otherwise the company's longest-standing active admin (ordered by created_at, so the answer
 * is stable). Null when the company has no active admin: callers then send nothing, never a fallback inbox.
 */
export async function resolveCompanyRecipient(
  admin: SupabaseClient,
  orgId: string,
  configuredIds: Array<string | null | undefined>,
  /** What it's for (e.g. 'web_lead'), logged when nobody can be emailed so an alert never vanishes silently. */
  purpose = 'alert'
): Promise<CompanyRecipient | null> {
  for (const id of configuredIds) {
    if (typeof id !== 'string' || !id.trim()) continue
    const { data } = await admin
      .from('users')
      .select('id, email')
      .eq('id', id.trim())
      .eq('org_id', orgId)
      .eq('active', true)
      .maybeSingle()
    if (data?.id) {
      const email = emailOrNull(data.email)
      if (!email) warnNoRecipient(orgId, purpose)
      return { id: data.id as string, email }
    }
    console.error('company recipient: configured user is not an active user of this company, skipped', { orgId, userId: id })
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
  const found = fallback?.id ? { id: fallback.id as string, email: emailOrNull(fallback.email) } : null
  if (!found?.email) warnNoRecipient(orgId, purpose)
  return found
}

/** Org id + purpose only — never customer details. */
function warnNoRecipient(orgId: string, purpose: string): void {
  console.warn('company recipient: nobody to email (no active admin with an email) — not sent', { orgId, purpose })
}

function emailOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.includes('@') ? v.trim() : null
}

/**
 * The company's own office inbox: `orgs.email` (the column, never a built-in default — a default belongs to another
 * company), else its longest-standing active admin's email. Null when neither exists.
 */
export async function resolveCompanyInboxEmail(admin: SupabaseClient, orgId: string, purpose = 'inbox'): Promise<string | null> {
  const { data } = await admin.from('orgs').select('email').eq('id', orgId).maybeSingle()
  const column = emailOrNull(data?.email)
  if (column) return column
  return (await resolveCompanyRecipient(admin, orgId, [], purpose))?.email ?? null
}
