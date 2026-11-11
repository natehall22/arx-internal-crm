import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE per-key writer for `orgs.settings` (Known Redundancy #25). One SQL function, `merge_org_settings` (migration
 * 202611060010), changes only the given keys at one place in settings — the top level (`path: []`) or one nested
 * object (`path: ['brand']`) — inside a single UPDATE, so a concurrent save of another key is never lost.
 * Users: job catch-up (top level), pricing (`/api/admin/pricing` org_settings, top level), brand (`lib/org-brand.ts` saveBrandSettings, path ['brand']), feature switches (`/api/admin/settings` type 'features', path ['features']), industry profile (lib/org-profile-server.ts + company seed, path ['profile']), sales tax (`lib/sales-tax-server.ts` saveSalesTaxSettings, path ['salesTax']).
 * Until the migration is applied, ONLY a missing function (PGRST202 / 42883) falls back to read → merge → write of
 * the same keys; any other error (permission denied, no such org) is returned.
 */

/** Only "the function does not exist yet" falls back; any other error (e.g. 42501 permission denied) is returned. */
export function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Pure twin of the SQL merge: `target = (target - remove) || set` at `path` (top level or one key); the rest is kept. */
export function mergeSettingsAt(current: unknown, path: string[], set: Record<string, unknown>, remove: string[] = []): Record<string, unknown> {
  if (path.length > 1) throw new Error('mergeSettingsAt: path deeper than one key')
  const settings = asObject(current)
  const target: Record<string, unknown> = { ...asObject(path.length ? settings[path[0]] : settings) }
  for (const k of remove) delete target[k]
  const merged = { ...target, ...set }
  return path.length ? { ...settings, [path[0]]: merged } : merged
}

export async function mergeOrgSettings(
  client: SupabaseClient,
  orgId: string,
  set: Record<string, unknown>,
  opts: { path?: string[]; remove?: string[] } = {}
): Promise<{ error: string | null }> {
  const path = opts.path ?? []
  const remove = opts.remove ?? []
  if (path.length > 1) return { error: 'Settings path is deeper than one key' }
  // Brand has validated fields; it is only ever written at path ['brand'] by saveBrandSettings.
  if (path.length === 0 && ('brand' in set || remove.includes('brand'))) return { error: 'brand is saved through saveBrandSettings' }
  // Feature switches are only ever written per key at path ['features'] (owner-only save, lib/org-features.ts).
  if (path.length === 0 && ('features' in set || remove.includes('features'))) return { error: 'features are saved per key at path [features]' }
  // The industry profile is only ever written at path ['profile'] (lib/org-profile-server.ts applyIndustryProfile + the seed).
  if (path.length === 0 && ('profile' in set || remove.includes('profile'))) return { error: 'profile is saved at path [profile]' }
  // Sales tax has validated fields; it is only ever written at path ['salesTax'] by saveSalesTaxSettings.
  if (path.length === 0 && ('salesTax' in set || remove.includes('salesTax'))) return { error: 'salesTax is saved through saveSalesTaxSettings' }
  if (Object.keys(set).length === 0 && remove.length === 0) return { error: null }

  const { error } = await client.rpc('merge_org_settings', { p_org_id: orgId, p_path: path, p_set: set, p_remove: remove })
  if (!error) return { error: null }
  if (!isMissingFunction(error)) return { error: error.message }

  const { data, error: readError } = await client.from('orgs').select('settings').eq('id', orgId).single()
  if (readError || !data) return { error: readError?.message ?? 'Organization not found' }
  const { error: writeError } = await client
    .from('orgs')
    .update({ settings: mergeSettingsAt((data as { settings?: unknown }).settings, path, set, remove) })
    .eq('id', orgId)
  return { error: writeError?.message ?? null }
}
