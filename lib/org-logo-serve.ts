import type { SupabaseClient } from '@supabase/supabase-js'

import { orgLogoPath, type OrgLogoVariant, signFilesObject } from '@/lib/files/files-object'

/** Shared by `/api/org-logo/<orgId>` (signed-in surfaces, PDFs) and `/api/company-logo` (signed-out pages). */
export const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60
export const LOGO_CACHE = 'public, max-age=300, s-maxage=300'

/** Signed URL of the org's own `org/<orgId>/logo.<ext>` object (or `logo-dark.<ext>` for the dark variant, falling back to the main one), or null when it has none. */
export async function signedOrgLogoUrl(admin: SupabaseClient, orgId: string, variant: OrgLogoVariant = 'main'): Promise<string | null> {
  const { data: org } = await admin.from('orgs').select('logo_url, settings').eq('id', orgId).maybeSingle()
  const path = orgLogoPath(orgId, org, { variant })
  if (!path) return null
  return (await signFilesObject(admin, path, LOGO_SIGNED_URL_TTL_SECONDS)) ?? null
}
