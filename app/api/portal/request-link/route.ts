import { crossSiteWrite } from '@/lib/online-payments/access'
import { portalJson } from '@/lib/portal/api'
import { requestLoginLink, portalOrgForRequest } from '@/lib/portal/server'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST { identifier } — "email me a link". The answer is identical whether or not anyone matched (and takes about the same
 * time); the link goes only to the email already on file for the matching customer(s) of THIS address's company.
 */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return portalJson({ error: 'Forbidden' }, 403)
  const orgId = await portalOrgForRequest()
  if (!orgId) return portalJson({ error: 'Not found' }, 404)
  const body = (await request.json().catch(() => ({}))) as { identifier?: unknown }
  await requestLoginLink(createServiceClient(), orgId, body.identifier, clientIpFromRequest(request))
  return portalJson({ ok: true })
}
