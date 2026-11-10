import { headers } from 'next/headers'

import {
  COMPANY_CODE_HEADER,
  RESOLVED_LOOKUPS_HEADER,
  resolveCompanyFence,
  verifyResolvedLookups,
  type CompanyFence,
} from '@/lib/company-host'

/** Host + company-code header of the current server request (null outside a request, e.g. in tests). */
export function currentRequestCompanyInput(): { host: string | null; companyCode: string | null; resolvedHeader: string | null } {
  try {
    const h = headers()
    return { host: h.get('host'), companyCode: h.get(COMPANY_CODE_HEADER), resolvedHeader: h.get(RESOLVED_LOOKUPS_HEADER) }
  } catch {
    return { host: null, companyCode: null, resolvedHeader: null }
  }
}

/** The company fence for the current server request (Server Components, route handlers, lib/auth.ts). */
export async function getRequestCompanyFence(): Promise<CompanyFence> {
  const input = currentRequestCompanyInput()
  const resolved = await verifyResolvedLookups(input.resolvedHeader, input.host, input.companyCode)
  return resolveCompanyFence({ host: input.host, companyCode: input.companyCode, resolved })
}

/** Same fence from the host only (signed-out pages, web login): the company-code header is never consulted. */
export async function getRequestHostFence(): Promise<CompanyFence> {
  const input = currentRequestCompanyInput()
  const resolved = await verifyResolvedLookups(input.resolvedHeader, input.host, input.companyCode)
  return resolveCompanyFence({ host: input.host, resolved: resolved ? { host: resolved.host } : null })
}
