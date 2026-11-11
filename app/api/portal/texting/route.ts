import { portalJson, requirePortalApi } from '@/lib/portal/api'
import { loadPortalCompany } from '@/lib/portal/brand'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { latestConsent, recordConsent } from '@/lib/sms/consent'
import { normalizeUsPhone } from '@/lib/sms/phone'
import { suppressAddress, suppressionOf } from '@/lib/customer-message-suppressions'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * POST { on: boolean } — the customer turns texts from the company on or off for the phone number we have for them.
 * "On" stores proof (the exact words, their IP and browser) as a portal consent row; "off" stores a revoke row. A number
 * that texted STOP can only be turned back on by texting START, so this refuses rather than overriding it.
 */
export async function POST(request: Request) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const { admin, session, ip } = c
  if (!(await isOrgFeatureOn(session.orgId, 'texting'))) return portalJson({ error: 'Texting is not turned on.' }, 404)
  const raw = (await request.json().catch(() => ({}))) as { on?: unknown }
  if (typeof raw.on !== 'boolean') return portalJson({ error: 'Choose on or off.' }, 400)
  const { data } = await orgDb(admin, session.orgId).from('customers').select('phone').eq('id', session.customerId).maybeSingle()
  const phone = normalizeUsPhone((data as { phone?: string | null } | null)?.phone)
  if (!phone) return portalJson({ error: 'We do not have a mobile number for you. Please call us to add one.' }, 400)
  if (raw.on && (await suppressionOf(admin, session.orgId, 'sms', phone))) {
    return portalJson({ error: 'You asked us to stop texting this number. Text START to our number to turn texts back on.' }, 409)
  }
  const company = await loadPortalCompany(admin, session.orgId)
  // Turning texts OFF is a real opt-out: it goes on the one opt-out list too (the sender checks that list first).
  if (!raw.on) await suppressAddress(admin, session.orgId, 'sms', phone, 'unsubscribed', { detail: 'Turned off in the customer account' })
  const r = await recordConsent(admin, session.orgId, {
    customerId: session.customerId,
    phone,
    status: raw.on ? 'granted' : 'revoked',
    source: 'portal',
    companyName: company.name,
    evidence: { ip, userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300) },
  })
  if (!r.ok) return portalJson({ error: r.error }, r.optedOut ? 409 : 500)
  return portalJson({ ok: true, on: raw.on })
}

/** GET — is texting on for this customer, and what does the box say. */
export async function GET(request: Request) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const { admin, session } = c
  if (!(await isOrgFeatureOn(session.orgId, 'texting'))) return portalJson({ available: false })
  const { data } = await orgDb(admin, session.orgId).from('customers').select('phone').eq('id', session.customerId).maybeSingle()
  const phone = normalizeUsPhone((data as { phone?: string | null } | null)?.phone)
  if (!phone) return portalJson({ available: false })
  const [latest, stopped] = await Promise.all([latestConsent(admin, session.orgId, phone), suppressionOf(admin, session.orgId, 'sms', phone)])
  return portalJson({ available: true, on: !stopped && latest?.status === 'granted', stopped: !!stopped })
}
