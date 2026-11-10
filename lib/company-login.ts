import { classifyHost, lookupCompanyBySubdomain } from '@/lib/company-host'
import { currentRequestCompanyInput } from '@/lib/company-host-server'
import { orgLogoHref } from '@/lib/files/files-object'
import { resolveOrgBrand } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'

export type LoginCompany =
  | { state: 'legacy' } // no company address in play: today's page, unchanged
  | { state: 'apex' } // the bare product domain: no company, no sign-in form
  | { state: 'unknown' } // company-shaped address that is no company (middleware 404s first; belt and braces)
  | { state: 'unavailable' } // lookup failed
  | { state: 'company'; orgId: string; name: string; logoSrc: string | null }

/** Whose login page this request is, from the host only (never the company-code header). */
export async function loadLoginCompany(): Promise<LoginCompany> {
  const { host } = currentRequestCompanyInput()
  const kind = classifyHost(host)
  if (kind.kind === 'off' || kind.kind === 'legacy') return { state: 'legacy' }
  if (kind.kind === 'apex') return { state: 'apex' }
  if (kind.kind === 'invalid') return { state: 'unknown' }
  const found = await lookupCompanyBySubdomain(kind.subdomain)
  if (found.status === 'not_found') return { state: 'unknown' }
  if (found.status === 'error') return { state: 'unavailable' }
  const { data: row, error } = await createServiceClient()
    .from('orgs')
    .select('id, name, phone, email, address, logo_url, settings')
    .eq('id', found.orgId)
    .maybeSingle()
  if (error || !row) return { state: 'unavailable' }
  return {
    state: 'company',
    orgId: found.orgId,
    name: resolveOrgBrand(row).name,
    logoSrc: orgLogoHref(found.orgId, row),
  }
}
