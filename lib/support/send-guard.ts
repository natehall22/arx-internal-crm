/**
 * Outbound safety for a support session (server only). While a request carries a valid support cookie, nothing may leave the
 * company: customer emails and texts, payment links and charges, supplier orders, calendar invitations, QuickBooks pushes.
 * This is DELIBERATELY decided on the request (the signed cookie), never on the company, so cron jobs and webhooks for the same
 * company are untouched. It mirrors the demo company's suppression (lib/demo-org.ts) at the same single doors — no second
 * mechanism — but refuses (or skips) instead of faking a "sent": a customer must never be told, or a log never say, that
 * something went out when it did not. Each block is logged as 'blocked_send'. Signature only (no database): a cookie we signed
 * blocks sends even if its grant just ended — the safe side.
 */
import { cookies } from 'next/headers'

import { createServiceClient } from '@/lib/supabase/service'
import { logSupportEvent } from '@/lib/support/access'
import { supportCookieFrom, verifySupportToken, type SupportSessionPayload } from '@/lib/support/token'

export class SupportSendBlockedError extends Error {
  readonly code = 'support_send_blocked'
  constructor(what: string) {
    super(`Support session: ${what} is blocked while you are inside a company as support`)
    this.name = 'SupportSendBlockedError'
  }
}

/** The signed support session of the current request, or null (no request, no cookie, forged, expired). */
export async function currentSupportSession(): Promise<SupportSessionPayload | null> {
  let value: string | null = null
  try {
    value = supportCookieFrom(cookies())
  } catch {
    return null // not in a request (cron, webhook, tests)
  }
  return value ? verifySupportToken(value, 'session') : null
}

/** True (and logged) when this request is a support session: the caller must not send. */
export async function supportBlocksSend(what: string, detail: Record<string, unknown> = {}): Promise<boolean> {
  const s = await currentSupportSession()
  if (!s) return false
  try {
    await logSupportEvent(createServiceClient(), { orgId: s.o, staffUserId: s.s, actingAsUserId: s.a, level: s.l, event: 'blocked_send', detail: { what, ...detail } })
  } catch (e) {
    console.error('[support] could not log a blocked send', e) // still blocked
  }
  return true
}

/** For doors that can throw: refuse the send. */
export async function assertNoSupportSend(what: string, detail: Record<string, unknown> = {}): Promise<void> {
  if (await supportBlocksSend(what, detail)) throw new SupportSendBlockedError(what)
}
