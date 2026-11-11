import { portalJson, requirePortalApi } from '@/lib/portal/api'
import { PORTAL_LIMITS, takePortalAttempt } from '@/lib/portal/server'
import { notifyCompanyOfPortalMessage } from '@/lib/portal/messages'
import { postCustomerMessage } from '@/lib/threads/post-message'

export const dynamic = 'force-dynamic'

/** POST { body } — the customer writes to the company. Written to the customer's thread (postCustomerMessage) and the company is emailed. */
export async function POST(request: Request) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const { admin, session } = c
  const raw = (await request.json().catch(() => ({}))) as { body?: unknown }
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  if (!body) return portalJson({ error: 'Write a message first.' }, 400)
  if (body.length > 2000) return portalJson({ error: 'That message is too long. Please keep it under 2,000 characters.' }, 400)
  if (!(await takePortalAttempt(admin, `msg:${session.customerId}`, PORTAL_LIMITS.messagesPerCustomer))) return portalJson({ error: 'You have sent a lot of messages. Please call us instead, or try again later.' }, 429)
  const r = await postCustomerMessage(admin, { orgId: session.orgId, customerId: session.customerId, body })
  if (!r.ok) {
    console.error('portal message insert failed', r.error)
    return portalJson({ error: 'We could not send that. Please try again or call us.' }, 500)
  }
  await notifyCompanyOfPortalMessage(admin, session.orgId, session.customerId, body)
  return portalJson({ ok: true })
}
