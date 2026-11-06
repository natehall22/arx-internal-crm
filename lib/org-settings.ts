import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingFunction } from '@/lib/org-brand'

/**
 * Set top-level `orgs.settings` keys without touching any other key (Known Redundancy #25). Uses the atomic SQL merge
 * `merge_org_settings` (migration 202611060010); until that migration is applied it falls back to read → merge → write
 * of only these keys. Brand fields have their own nested merge (`saveBrandSettings`) and must not come through here.
 */
export async function mergeOrgSettings(
  client: SupabaseClient,
  orgId: string,
  set: Record<string, unknown>
): Promise<{ error: string | null }> {
  if ('brand' in set) return { error: 'brand is saved through saveBrandSettings' }
  if (Object.keys(set).length === 0) return { error: null }

  const { error } = await client.rpc('merge_org_settings', { p_org_id: orgId, p_set: set })
  if (!error) return { error: null }
  if (!isMissingFunction(error)) return { error: error.message }

  const { data, error: readError } = await client.from('orgs').select('settings').eq('id', orgId).single()
  if (readError || !data) return { error: readError?.message ?? 'Organization not found' }
  const current = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? (data.settings as Record<string, unknown>) : {}
  const { error: writeError } = await client.from('orgs').update({ settings: { ...current, ...set } }).eq('id', orgId)
  return { error: writeError?.message ?? null }
}
