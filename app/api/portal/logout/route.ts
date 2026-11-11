import { crossSiteWrite } from '@/lib/online-payments/access'
import { portalJson, seeOther } from '@/lib/portal/api'
import { clearSessionCookie, endPortalSession, getPortalSession } from '@/lib/portal/server'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** POST — sign out (the session is revoked in the database, not just forgotten by the browser). */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return portalJson({ error: 'Forbidden' }, 403)
  const admin = createServiceClient()
  const s = await getPortalSession(admin)
  if (s) await endPortalSession(admin, s, clientIpFromRequest(request))
  return seeOther('/portal', { setCookie: clearSessionCookie })
}
