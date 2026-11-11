import { crossSiteWrite } from '@/lib/online-payments/access'
import { PORTAL_NO_STORE, portalJson, seeOther } from '@/lib/portal/api'
import { consumeLoginLink, logPortalEvent, portalOrgForRequest, PORTAL_LIMITS, setSessionCookie, startPortalSession, takePortalAttempt } from '@/lib/portal/server'
import { opaqueKey } from '@/lib/portal/tokens'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'
import { isOrgFeatureOn } from '@/lib/org-features-server'

export const dynamic = 'force-dynamic'
void PORTAL_NO_STORE

/** POST form { t } — the one tap on "Open my account": uses the emailed link (once) and starts a session. */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return portalJson({ error: 'Forbidden' }, 403)
  const orgId = await portalOrgForRequest()
  if (!orgId || !(await isOrgFeatureOn(orgId, 'customerPortal'))) return portalJson({ error: 'Not found' }, 404)
  const admin = createServiceClient()
  const ip = clientIpFromRequest(request)
  if (!(await takePortalAttempt(admin, `enter-ip:${opaqueKey(orgId, ip)}`, PORTAL_LIMITS.enterPerAddress))) return seeOther('/portal?problem=wait')
  const form = await request.formData().catch(() => null)
  const token = form?.get('t')
  const who = await consumeLoginLink(admin, token, orgId)
  if (!who) {
    await logPortalEvent(admin, orgId, { kind: 'login_failed', via: 'email_link', ip, detail: 'link not usable' })
    return seeOther('/portal?problem=link')
  }
  const s = await startPortalSession(admin, who.orgId, who.customerId)
  await logPortalEvent(admin, who.orgId, { kind: 'login', customerId: who.customerId, via: 'email_link', ip })
  return seeOther('/portal', { setCookie: (res) => setSessionCookie(res, s.token, s.expires) })
}
