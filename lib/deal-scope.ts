/**
 * Closers (rep / sales_rep / closer) see prices, proposals and contracts only on deals they are on.
 * The rule is in SQL (arx_private.opp_mine, migration 202610290080) and also gates their database token (RLS);
 * the service-role APIs ask the same question here so the app and the database cannot disagree.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const CLOSER_ROLES = new Set(['rep', 'sales_rep', 'closer'])

/** Mirrors public.is_closer_self(). */
export function isCloserScoped(profile: { role?: string | null; is_super_admin?: boolean | null }): boolean {
  return !profile.is_super_admin && CLOSER_ROLES.has(String(profile.role ?? '').toLowerCase().trim())
}

/** Which of these deals (opportunities) are this user's own (same SQL rule as RLS). */
export async function myOpportunityIds(admin: SupabaseClient, userId: string, ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const mine = new Set<string>()
  if (unique.length === 0) return mine
  const { data, error } = await admin.rpc('my_opportunity_ids', { p_user: userId, p_ids: unique })
  if (error) throw new Error(`my_opportunity_ids: ${error.message}`)
  for (const row of (data ?? []) as Array<string | { my_opportunity_ids?: string }>) mine.add(typeof row === 'string' ? row : String(row.my_opportunity_ids))
  return mine
}

/** A proposal / contract / job belongs to a closer when they created it or its deal is theirs. Everyone else: always true. */
export async function mayAccessDealDoc(
  admin: SupabaseClient,
  profile: { id: string; role?: string | null; is_super_admin?: boolean | null },
  doc: { created_by?: string | null; opportunity_id?: string | null }
): Promise<boolean> {
  if (!isCloserScoped(profile)) return true
  if (doc.created_by === profile.id) return true
  return !!doc.opportunity_id && (await myOpportunityIds(admin, profile.id, [doc.opportunity_id])).has(doc.opportunity_id)
}
