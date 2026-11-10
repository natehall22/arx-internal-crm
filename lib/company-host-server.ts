import { headers } from 'next/headers'

import { COMPANY_CODE_HEADER, resolveCompanyFence, type CompanyFence } from '@/lib/company-host'

/** Host + company-code header of the current server request (null outside a request, e.g. in tests). */
export function currentRequestCompanyInput(): { host: string | null; companyCode: string | null } {
  try {
    const h = headers()
    return { host: h.get('host'), companyCode: h.get(COMPANY_CODE_HEADER) }
  } catch {
    return { host: null, companyCode: null }
  }
}

/** The company fence for the current server request (Server Components, route handlers, lib/auth.ts). */
export function getRequestCompanyFence(): Promise<CompanyFence> {
  return resolveCompanyFence(currentRequestCompanyInput())
}
