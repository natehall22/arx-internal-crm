import { resolveCompanyFence } from '@/lib/company-host'
import { currentRequestCompanyInput } from '@/lib/company-host-server'
import { orgLogoHref } from '@/lib/files/files-object'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Whose signed-out page this is (login, reset password, privacy, terms). Resolved exactly like auth —
 * `resolveCompanyFence` (DEPLOYMENT_ORG_ID > the company web address) — from the host only, never the
 * company-code header. The original company's look ('legacy') appears ONLY when nothing fences the request
 * (unfenced legacy address, DEPLOYMENT_ORG_ID unset): the same rule as W1's `legacyBrandFallback()`.
 */
export type LoginCompany =
  | { state: 'legacy' }
  | { state: 'apex' } // the bare product domain: no company, no sign-in form
  | { state: 'unknown' } // no such company (middleware 404s first; belt and braces)
  | { state: 'unavailable' } // lookup failed
  | { state: 'company'; orgId: string; name: string; email: string; logoSrc: string | null }

export async function loadLoginCompany(): Promise<LoginCompany> {
  const fence = await resolveCompanyFence({ host: currentRequestCompanyInput().host })
  if (fence.kind === 'open') return { state: 'legacy' }
  if (fence.kind === 'closed') {
    if (fence.reason === 'apex') return { state: 'apex' }
    if (fence.reason === 'lookup_error') return { state: 'unavailable' }
    return { state: 'unknown' }
  }
  const { data: row, error } = await createServiceClient()
    .from('orgs')
    .select('id, name, email, logo_url, settings')
    .eq('id', fence.orgId)
    .maybeSingle()
  if (error || !row) return { state: 'unavailable' }
  // Raw columns on purpose: on main, lib/org-brand.ts still falls back to the original company's strings for blank
  // fields, which must never show on another company's page. Blank stays blank.
  return {
    state: 'company',
    orgId: fence.orgId,
    name: String(row.name ?? '').trim(),
    email: String(row.email ?? '').trim(),
    logoSrc: orgLogoHref(fence.orgId, row),
  }
}

/** What AuthShell shows for a signed-out page. `null` = the original company's look (legacy only). */
export function authShellCompanyFor(login: LoginCompany): { name: string | null; logoSrc: string | null } | null {
  if (login.state === 'legacy') return null
  if (login.state === 'company') return { name: login.name || null, logoSrc: login.logoSrc }
  return { name: null, logoSrc: null }
}
