import { crossSiteWrite } from '@/lib/online-payments/access'
import { portalJson, seeOther } from '@/lib/portal/api'
import { customerFromLink } from '@/lib/portal/from-links'
import { logPortalEvent, portalOrgForRequest, PORTAL_LIMITS, setSessionCookie, startPortalSession, takePortalAttempt } from '@/lib/portal/server'
import { opaqueKey } from '@/lib/portal/tokens'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST form { source: 'pay' | 'sign', token } — "See everything on my account" on a pay / signing page. The link must be live
 * and this company's; the session it opens is LIGHT (lib/portal/server.ts portalCaps). Anything else → the normal sign-in page.
 */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return portalJson({ error: 'Forbidden' }, 403)
  const orgId = await portalOrgForRequest()
  if (!orgId) return portalJson({ error: 'Not found' }, 404)
  const admin = createServiceClient()
  const ip = clientIpFromRequest(request)
  if (!(await takePortalAttempt(admin, `enter-ip:${opaqueKey(orgId, ip)}`, PORTAL_LIMITS.enterPerAddress))) return seeOther('/portal?problem=wait')
  const form = await request.formData().catch(() => null)
  const source = form?.get('source')
  const who = (await isOrgFeatureOn(orgId, 'customerPortal')) && (source === 'pay' || source === 'sign') ? await customerFromLink(admin, source, form?.get('token'), orgId) : null
  if (!who) {
    await logPortalEvent(admin, orgId, { kind: 'login_failed', via: `${String(source).slice(0, 10)}_link`, ip, detail: 'link not usable' })
    return seeOther('/portal')
  }
  const s = await startPortalSession(admin, who.orgId, who.customerId, who.via)
  await logPortalEvent(admin, who.orgId, { kind: 'login_via_link', customerId: who.customerId, via: who.via, ip })
  return seeOther('/portal', { setCookie: (res) => setSessionCookie(res, s.token, s.expires) })
}
