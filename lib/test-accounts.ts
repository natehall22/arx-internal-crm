import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ids of internal test/demo accounts (`users.is_test_account`). They earn no pay lines, no default plan, and no
 * leaderboard or report credit. The column is additive: before the migration (or on a read error) this is empty,
 * which can only ever show MORE people, never hide a real one.
 */
export async function loadTestAccountIds(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await admin.from('users').select('id').eq('org_id', orgId).eq('is_test_account', true)
  if (error) return new Set()
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}
