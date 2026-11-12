import type { SupabaseClient } from '@supabase/supabase-js'

import { mergeOrgSettings } from '@/lib/org-settings'
import { readSigningSettings, SIGNING_SETTINGS_KEY, type SigningSettings } from '@/lib/signing/settings'

/** The company's signing choices (server only). A read that fails reads as the defaults for that company's kind. */
export async function loadSigningSettings(admin: SupabaseClient, orgId: string): Promise<SigningSettings> {
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  return readSigningSettings((data as { settings?: unknown } | null)?.settings ?? {})
}

/** The ONE writer of `orgs.settings.signing` (owners only; the route checks). */
export async function saveSigningSettings(admin: SupabaseClient, orgId: string, next: SigningSettings): Promise<{ error: string | null }> {
  return mergeOrgSettings(admin, orgId, { ...next }, { path: [SIGNING_SETTINGS_KEY] })
}
