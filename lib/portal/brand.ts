import type { SupabaseClient } from '@supabase/supabase-js'

import type { PortalCompany } from '@/components/portal/PortalShell'
import { orgLogoHref } from '@/lib/files/files-object'
import { getDocumentBrand } from '@/lib/org-brand'

/** The company's own name, contact and logo for every portal screen (identity from the org row only). */
export async function loadPortalCompany(admin: SupabaseClient, orgId: string): Promise<PortalCompany> {
  const brand = await getDocumentBrand(admin, orgId)
  // org-scope-ok: orgs is keyed by its own id (this company)
  const { data: org } = await admin.from('orgs').select('logo_url, settings').eq('id', orgId).maybeSingle()
  return { name: brand.casualName || brand.name, phone: brand.phone, email: brand.email, logoHref: orgLogoHref(orgId, (org ?? {}) as Parameters<typeof orgLogoHref>[1]) }
}
