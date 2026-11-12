import type { SupabaseClient } from '@supabase/supabase-js'

import { mergeOrgSettings } from '@/lib/org-settings'
import { defaultSigningSettings, readSigningSettings, SIGNING_SETTINGS_KEY, type SigningSettings } from '@/lib/signing/settings'

/**
 * The company's signing choices (server only). A read that FAILS fails closed: the consent step counts as on (a signature is
 * never taken without the notice because a settings read hiccuped); everything else reads as off.
 */
export async function loadSigningSettings(admin: SupabaseClient, orgId: string): Promise<SigningSettings> {
  const { data, error } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  if (error) {
    console.error('[signing] could not read the company signing settings; consent treated as required', error.message)
    return { ...defaultSigningSettings(false), consentStep: true }
  }
  return readSigningSettings((data as { settings?: unknown } | null)?.settings ?? {})
}

/** The ONE writer of `orgs.settings.signing` (owners only; the route checks). */
export async function saveSigningSettings(admin: SupabaseClient, orgId: string, next: SigningSettings): Promise<{ error: string | null }> {
  return mergeOrgSettings(admin, orgId, { ...next }, { path: [SIGNING_SETTINGS_KEY] })
}
