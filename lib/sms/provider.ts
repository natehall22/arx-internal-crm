/**
 * The ONE small adapter between the CRM and a text-message carrier (server only). Everything else (the sender, the webhook,
 * the settings screen) talks to `SmsProvider` and never to a carrier directly, so changing carrier is one file.
 *
 *   SMS_PROVIDER=telnyx  → lib/sms/telnyx.ts (first choice: half Twilio's price, signed webhooks, one brand + campaign per company)
 *   SMS_PROVIDER=test    → lib/sms/test-provider.ts (records sends in memory; refused in production)
 *   unset                → no provider: nothing is sent and every text path says "texting isn't set up"
 * A Twilio file would implement the same interface (HMAC webhook signature, form-encoded API) — not built until needed.
 */
import { telnyxProvider } from '@/lib/sms/telnyx'
import { testProvider } from '@/lib/sms/test-provider'

export type SmsSendInput = {
  /** The company's own number (E.164). */
  from: string
  to: string
  text: string
  /** Stable per message (the send log's row id): a carrier that supports it can drop a duplicate. */
  idempotencyKey: string
}

export type SmsSendResult =
  | { ok: true; providerMessageId: string; segments: number | null; costMicros: number | null }
  | {
      ok: false
      /** This number will never work (landline, invalid): suppress it. */
      permanent: boolean
      /** The carrier blocked it because the person already texted STOP to the carrier. */
      optedOut?: boolean
      /** No definite answer (timeout): it may have gone out — never retried soon. */
      unknown?: boolean
      error: string
      code?: string
    }

/** What a carrier's webhook tells us, in the carrier-independent shape the rest of the app reads. */
export type SmsEvent =
  | {
      kind: 'inbound'
      /** The carrier's message id — the dedupe key. */
      id: string
      from: string
      to: string
      text: string
      mediaCount: number
      segments: number | null
      costMicros: number | null
      receivedAt: string
    }
  | {
      kind: 'status'
      id: string
      /** The company's number that sent it. */
      from: string
      to: string
      status: 'sent' | 'delivered' | 'failed'
      errorCode: string | null
      errorText: string | null
      segments: number | null
      costMicros: number | null
      at: string
    }
  | { kind: 'ignored'; id: string | null; type: string }

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export interface SmsProvider {
  id: 'telnyx' | 'twilio' | 'test'
  /** Keys / secrets present for sending? */
  canSend(): boolean
  /** Public key / secret present for checking webhooks? */
  canReceive(): boolean
  send(m: SmsSendInput): Promise<SmsSendResult>
  /** Is this request really from the carrier? Over the RAW body; checks its timestamp is recent. */
  verifyWebhook(rawBody: string, headers: Headers, nowMs: number): VerifyResult
  parseWebhook(rawBody: string): SmsEvent | null
}

/**
 * The platform's own per-message cost (what the carrier charges us), in millionths of a dollar — the only place these
 * numbers live. Telnyx list price Jan 2026: $0.004 out + about $0.0035 carrier fee; inbound about $0.003 (T-Mobile).
 * Overridable per deployment (env SMS_PRICE_OUT_MICROS / SMS_PRICE_IN_MICROS) when the contract price differs; the real
 * charge on a delivery receipt replaces the estimate.
 */
export function priceMicros(direction: 'out' | 'in', segments: number, providerId: SmsProvider['id'] = 'telnyx'): number {
  if (providerId === 'test') return 0
  const env = Number(process.env[direction === 'out' ? 'SMS_PRICE_OUT_MICROS' : 'SMS_PRICE_IN_MICROS'])
  const per = Number.isFinite(env) && env >= 0 && process.env[direction === 'out' ? 'SMS_PRICE_OUT_MICROS' : 'SMS_PRICE_IN_MICROS'] ? env : direction === 'out' ? 7500 : 3000
  return Math.round(per * Math.max(1, segments))
}

/** The configured carrier, or null (nothing is sent). The test provider is refused in production. */
export function getSmsProvider(): SmsProvider | null {
  const id = (process.env.SMS_PROVIDER || '').trim().toLowerCase()
  if (id === 'telnyx') return telnyxProvider
  if (id === 'test') return process.env.NODE_ENV === 'production' ? null : testProvider
  return null
}
