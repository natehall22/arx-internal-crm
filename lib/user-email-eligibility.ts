import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Skip transactional CRM emails when the recipient user row is inactive (`users.active = false`).
 */
export async function isUserActiveForTransactionalEmail(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.from('users').select('active').eq('id', userId).maybeSingle()
  if (error || !data) return false
  return data.active !== false
}
