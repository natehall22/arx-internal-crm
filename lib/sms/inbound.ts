/**
 * Everything a carrier tells us by webhook (server only) — the work behind `/api/webhooks/sms/telnyx`, after the route has
 * checked the signature. The company is decided by ONE thing: the company number the text was sent to (inbound) or sent
 * from (a delivery receipt). Never by the web address the request came in on, and never by anything the sender wrote.
 *
 * Inbound text:
 *   1. record it in `sms_inbound` FIRST (unique per carrier message id) — a retried delivery finds it and stops;
 *   2. STOP / QUIT / END / CANCEL / UNSUBSCRIBE / STOPALL / REVOKE / OPT OUT, or a plain-language "please stop texting me":
 *      suppress the number, write a revoke row, answer once; the text also goes to the customer's thread (and, when it
 *      was a phrase rather than a keyword, to the owner's Today list so a wrong guess is seen). HELP: answer with the
 *      company's phone and email. START: lift the opt-out, record the new consent, answer;
 *   3. anything else: matched to the ONE customer with that number in that company (several: the one we last texted;
 *      still unsure, or none: "needs staff" — never a new customer) and written into their thread through the one
 *      conversation write path (`postCustomerMessage`, origin 'sms', audience team), the company emailed.
 * Delivery receipt: updates the send log row (delivered / failed + the carrier's reason); a number the carrier says can
 * never get texts is suppressed; the carrier's real cost replaces the estimate in the usage log.
 *
 * If anything fails after step 1 the claim is released and the route answers 500, so the carrier's retry does the work.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendComplianceText } from '@/lib/customer-messages-db'
import { suppressAddress, suppressionOf, unsuppressAddress } from '@/lib/customer-message-suppressions'
import { notifyCompanyOfPortalMessage } from '@/lib/portal/messages'
import { helpReply, startReply, stopReply } from '@/lib/sms/compliance'
import { latestConsent, recordConsent } from '@/lib/sms/consent'
import { findOrgByNumber, smsNotReadyReason } from '@/lib/sms/org-sms'
import { loadOrgFeatures } from '@/lib/org-features'
import { normalizeUsPhone, last10 } from '@/lib/sms/phone'
import { classifyInbound, type InboundKind } from '@/lib/sms/keywords'
import { priceMicros, type SmsEvent } from '@/lib/sms/provider'
import { countSegments } from '@/lib/sms/segments'
import { logUsage, setUsageCost } from '@/lib/sms/usage'
import { TELNYX_BAD_NUMBER_CODES, TELNYX_OPTED_OUT_CODE } from '@/lib/sms/telnyx'
import { postCustomerMessage } from '@/lib/threads/post-message'
import { orgDb } from '@/lib/supabase/org-db'

export type WebhookOutcome =
  | { status: 200; handled: 'duplicate' | 'unknown_number' | 'not_this_copy' | 'ignored' | 'bad_sender' | 'texting_off' | InboundKind | 'unmatched' | 'status' | 'status_unknown' }
  | { status: 500; handled: 'error' | 'status_not_saved_yet' }

const BODY_MAX = 1600
const STATUS_RETRY_WINDOW_MS = 30 * 60_000

/** Env SMS_COMPLIANCE_AUTO_REPLY=false when the carrier already answers STOP / HELP itself (never both). */
const autoReplyOn = (): boolean => process.env.SMS_COMPLIANCE_AUTO_REPLY !== 'false'

type Company = { id: string; name: string; phone: string; email: string }

async function loadCompany(admin: SupabaseClient, orgId: string): Promise<Company> {
  const { data } = await admin.from('orgs').select('id, name, phone, email').eq('id', orgId).maybeSingle()
  const o = (data ?? {}) as { name?: string | null; phone?: string | null; email?: string | null }
  return { id: orgId, name: (o.name ?? '').trim() || 'We', phone: (o.phone ?? '').trim(), email: (o.email ?? '').trim() }
}

/** The customers (this company only) whose phone is this number — the portal's one phone-matching rule (`portal_find_customers`). */
async function customersWithNumber(admin: SupabaseClient, orgId: string, phone: string): Promise<string[]> {
  const { data, error } = await admin.rpc('portal_find_customers', { p_org: orgId, p_email: null, p_phone10: last10(phone) })
  if (error) throw new Error(`customer match: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/** Several customers share a number: the one this company last texted at it, if it is one of them. */
async function lastTextedCustomer(admin: SupabaseClient, orgId: string, phone: string, among: string[]): Promise<string | null> {
  const { data } = await orgDb(admin, orgId)
    .from('customer_messages')
    .select('customer_id')
    .eq('channel', 'sms')
    .eq('to_address', phone)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const id = (data as { customer_id: string | null } | null)?.customer_id ?? null
  return id && among.includes(id) ? id : null
}

function threadBody(text: string, mediaCount: number): string {
  const t = text.trim().slice(0, BODY_MAX)
  if (mediaCount > 0) return `${t ? `${t}\n` : ''}(They also sent ${mediaCount === 1 ? 'a photo' : `${mediaCount} photos`} by text. Photos by text are not saved yet: ask them to send it another way.)`
  return t
}

/**
 * Slow work (the carrier-required answer, the email to the company) may finish after the HTTP answer: the route passes a
 * `defer` that hands it to `waitUntil`. The default runs it in place (tests, scripts). A deferred step that fails is logged,
 * never retried through the carrier (the answer's key makes a repeat harmless; the thread already has the text).
 */
export type Defer = (work: () => Promise<unknown>) => void | Promise<void>
const inPlace: Defer = async (work) => {
  await work()
}

export async function processSmsEvent(admin: SupabaseClient, ev: SmsEvent, now: Date = new Date(), defer: Defer = inPlace): Promise<WebhookOutcome> {
  try {
    if (ev.kind === 'inbound') return await processInbound(admin, ev, now, defer)
    if (ev.kind === 'status') return await processStatus(admin, ev)
    return { status: 200, handled: 'ignored' }
  } catch (e) {
    console.error('[sms webhook] failed', { kind: ev.kind, e })
    return { status: 500, handled: 'error' }
  }
}

async function processInbound(admin: SupabaseClient, ev: Extract<SmsEvent, { kind: 'inbound' }>, now: Date, defer: Defer): Promise<WebhookOutcome> {
  const org = await findOrgByNumber(admin, ev.to)
  if (!org) return { status: 200, handled: 'unknown_number' }
  const orgId = org.org_id
  // One copy per company (DEPLOYMENT_ORG_ID): a number that belongs to another company's copy is not ours to handle.
  const fence = (process.env.DEPLOYMENT_ORG_ID || '').trim()
  if (fence && fence !== orgId) return { status: 200, handled: 'not_this_copy' }
  const from = normalizeUsPhone(ev.from)
  if (!from) return { status: 200, handled: 'bad_sender' } // short codes, international senders: nothing to answer, nothing to match
  const text = (ev.text ?? '').slice(0, 4000)
  const kind: InboundKind = classifyInbound(text)
  // Texting switched off, or the number disconnected: the only thing still honored is a request to stop. Everything else
  // is dropped — nothing is posted to a thread, nothing answered, nobody emailed.
  const live = (await loadOrgFeatures(admin, orgId)).texting && !smsNotReadyReason(org)
  const isStop = kind === 'stop' || kind === 'optout_phrase' || kind === 'wrong_number'
  if (!live && !isStop) return { status: 200, handled: 'texting_off' }

  // Step 1: the claim. A second delivery of the same carrier message hits the unique key and stops here.
  const db = orgDb(admin, orgId)
  const flagged = kind === 'optout_phrase' || kind === 'wrong_number'
  const { data: claim, error: claimError } = await db
    .from('sms_inbound')
    .insert({ provider_message_id: ev.id, from_e164: from, to_e164: org.e164 ?? normalizeUsPhone(ev.to), body: text, media_count: ev.mediaCount, kind, status: flagged ? 'needs_staff' : 'handled', received_at: ev.receivedAt })
    .select('id')
    .single()
  if (claimError) {
    if (claimError.code === '23505') return { status: 200, handled: 'duplicate' }
    throw new Error(`inbound claim: ${claimError.message}`)
  }
  const inboundId = (claim as { id: string }).id

  try {
    const segments = ev.segments ?? Math.max(1, countSegments(text).segments)
    await logUsage(admin, orgId, { direction: 'in', kind: 'inbound', segments, costMicros: ev.costMicros ?? priceMicros('in', segments, org.provider), providerMessageId: ev.id, at: new Date(ev.receivedAt) })

    const ids = await customersWithNumber(admin, orgId, from)
    const customerId = ids.length === 1 ? ids[0] : ids.length > 1 ? await lastTextedCustomer(admin, orgId, from, ids) : null
    const company = await loadCompany(admin, orgId)
    if (!live) {
      // Switched off: record the opt-out (suppression + revoke row) and stop there.
      await suppressAddress(admin, orgId, 'sms', from, 'unsubscribed', { detail: kind === 'stop' ? 'Texted STOP' : `Texted: ${text.slice(0, 120)}` })
      const consent = await recordConsent(admin, orgId, { customerId, phone: from, status: 'revoked', source: 'sms_stop', evidence: { inboundId: ev.id, text: text.slice(0, 200), kind, texting: 'off' } })
      if (!consent.ok) throw new Error(consent.error)
      if (autoReplyOn()) await defer(() => sendComplianceText(admin, orgId, { inboundId: ev.id, to: from, text: stopReply(company), customerId }, now))
      return { status: 200, handled: kind }
    }

    if (kind === 'stop' || kind === 'optout_phrase' || kind === 'wrong_number') {
      await suppressAddress(admin, orgId, 'sms', from, 'unsubscribed', { detail: kind === 'stop' ? 'Texted STOP' : `Texted: ${text.slice(0, 120)}` })
      const consent = await recordConsent(admin, orgId, { customerId, phone: from, status: 'revoked', source: 'sms_stop', evidence: { inboundId: ev.id, text: text.slice(0, 200), kind } })
      if (!consent.ok) throw new Error(consent.error)
      if (autoReplyOn()) await defer(() => sendComplianceText(admin, orgId, { inboundId: ev.id, to: from, text: stopReply(company), customerId }, now))
    } else if (kind === 'start') {
      // START re-subscribes what they opted out of. From someone who never opted out (or never agreed to anything) it is
      // NOT a new agreement to be texted: no consent row, only the answer.
      const wasStopped = !!(await suppressionOf(admin, orgId, 'sms', from))
      const before = await latestConsent(admin, orgId, from)
      if (wasStopped || before?.status === 'revoked') {
        await unsuppressAddress(admin, orgId, 'sms', from)
        const consent = await recordConsent(admin, orgId, { customerId, phone: from, status: 'granted', source: 'sms_start', companyName: company.name, evidence: { inboundId: ev.id, reopens: before?.id ?? null } })
        if (!consent.ok) throw new Error(consent.error)
      }
      if (autoReplyOn()) await defer(() => sendComplianceText(admin, orgId, { inboundId: ev.id, to: from, text: startReply(company), customerId }, now))
    } else if (kind === 'help') {
      if (autoReplyOn()) await defer(() => sendComplianceText(admin, orgId, { inboundId: ev.id, to: from, text: helpReply({ name: company.name, phone: company.phone, email: company.email }), customerId }, now))
    }

    if (!customerId) {
      // Nobody (or not one person) to attach it to: it waits on the owner's Today list. Never creates a customer.
      if (kind === 'message') await db.from('sms_inbound').update({ status: 'needs_staff' }).eq('id', inboundId)
      return { status: 200, handled: kind === 'message' ? 'unmatched' : kind }
    }
    const posted = await postCustomerMessage(admin, { orgId, customerId, body: threadBody(text, ev.mediaCount), clientId: `sms:${ev.id}`, origin: 'sms' })
    if (!posted.ok) throw new Error(`thread: ${posted.error}`)
    await db.from('sms_inbound').update({ customer_id: customerId, activity_id: posted.id }).eq('id', inboundId)
    // Told by email like a portal message — except the bare keywords (STOP / HELP / START): those are already answered.
    if (kind === 'message' || flagged) await defer(() => notifyCompanyOfPortalMessage(admin, orgId, customerId, threadBody(text, ev.mediaCount), 'text'))
    return { status: 200, handled: kind }
  } catch (e) {
    // Release the claim: the carrier's retry must find nothing and do the work again (every step above is repeat-safe).
    await db.from('sms_inbound').delete().eq('id', inboundId)
    throw e
  }
}

async function processStatus(admin: SupabaseClient, ev: Extract<SmsEvent, { kind: 'status' }>): Promise<WebhookOutcome> {
  const org = await findOrgByNumber(admin, ev.from)
  if (!org) return { status: 200, handled: 'unknown_number' }
  const orgId = org.org_id
  const fence = (process.env.DEPLOYMENT_ORG_ID || '').trim()
  if (fence && fence !== orgId) return { status: 200, handled: 'not_this_copy' }
  const db = orgDb(admin, orgId)
  const { data } = await db.from('customer_messages').select('id, customer_id, to_address, delivery_status').eq('provider_message_id', ev.id).eq('channel', 'sms').maybeSingle()
  const row = data as { id: string; customer_id: string | null; to_address: string | null; delivery_status: string | null } | null
  // The receipt can beat our own save of the send (the carrier is fast): while it is recent, ask for a retry. Bounded: an
  // old receipt for a message we never recorded is dropped.
  if (!row) return Date.now() - Date.parse(ev.at) < STATUS_RETRY_WINDOW_MS ? { status: 500, handled: 'status_not_saved_yet' } : { status: 200, handled: 'status_unknown' }
  // delivered / failed are final: a late or repeated "sent" never undoes them.
  if (!((ev.status === 'sent' || ev.status === 'unconfirmed') && (row.delivery_status === 'delivered' || row.delivery_status === 'failed'))) {
    await db
      .from('customer_messages')
      .update({
        delivery_status: ev.status === 'unconfirmed' ? 'delivery_unconfirmed' : ev.status,
        ...(ev.status === 'delivered' ? { delivered_at: ev.at, provider_error: null } : {}),
        ...(ev.status === 'failed' ? { provider_error: [ev.errorCode, ev.errorText].filter(Boolean).join(': ').slice(0, 300) || 'Not delivered' } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
  }
  if (ev.status === 'failed' && row.to_address) {
    const code = ev.errorCode ?? ''
    if (TELNYX_BAD_NUMBER_CODES.has(code)) await suppressAddress(admin, orgId, 'sms', row.to_address, 'bounced', { messageId: row.id, detail: ev.errorText })
    else if (code === TELNYX_OPTED_OUT_CODE) {
      await suppressAddress(admin, orgId, 'sms', row.to_address, 'unsubscribed', { messageId: row.id, detail: 'The carrier says they texted STOP' })
      await recordConsent(admin, orgId, { customerId: row.customer_id, phone: row.to_address, status: 'revoked', source: 'sms_stop', evidence: { via: 'carrier_receipt', messageId: row.id } })
    }
  }
  if (ev.costMicros != null) await setUsageCost(admin, orgId, ev.id, ev.costMicros, ev.segments)
  return { status: 200, handled: 'status' }
}
