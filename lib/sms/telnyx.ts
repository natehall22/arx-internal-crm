/**
 * Telnyx adapter (server only): sending over their REST API, checking their Ed25519 webhook signature, and reading their
 * webhook shape. Env: TELNYX_API_KEY (sending), TELNYX_PUBLIC_KEY (webhooks; base64 raw 32-byte key or SPKI DER, or PEM),
 * optional TELNYX_MESSAGING_PROFILE_ID. Webhook headers: `telnyx-signature-ed25519` (base64 signature) and
 * `telnyx-timestamp`; the signed string is `<timestamp>|<raw body>`; a timestamp more than 5 minutes old is refused.
 * Delivery retries are duplicates of the same `data.id`: the webhook dedupes on it (lib/sms/inbound.ts).
 *
 * Error codes (developers.telnyx.com/docs/messaging/messages/error-codes): 40001 not routable (landline), 40012 invalid
 * destination, 40310 invalid 'to' → the number is bad for good; 40300 blocked (STOP) → the person opted out at the carrier.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto'

import type { SmsEvent, SmsProvider, SmsSendInput, SmsSendResult, VerifyResult } from '@/lib/sms/provider'

const API = 'https://api.telnyx.com/v2/messages'
const SEND_TIMEOUT_MS = 12_000
const MAX_SKEW_MS = 5 * 60_000
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** Codes that mean "this number can never receive our texts". */
export const TELNYX_BAD_NUMBER_CODES = new Set(['40001', '40012', '40310'])
export const TELNYX_OPTED_OUT_CODE = '40300'

function publicKey(): KeyObject | null {
  const raw = (process.env.TELNYX_PUBLIC_KEY || '').trim()
  if (!raw) return null
  try {
    if (raw.includes('BEGIN PUBLIC KEY')) return createPublicKey(raw)
    const der = Buffer.from(raw, 'base64')
    if (der.length === 32) return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, der]), format: 'der', type: 'spki' })
    return createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}
const micros = (amount: unknown): number | null => {
  const n = num(amount)
  return n == null ? null : Math.round(Math.abs(n) * 1_000_000)
}
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export const telnyxProvider: SmsProvider = {
  id: 'telnyx',
  canSend: () => !!(process.env.TELNYX_API_KEY || '').trim(),
  canReceive: () => publicKey() !== null,

  async send(m: SmsSendInput): Promise<SmsSendResult> {
    const key = (process.env.TELNYX_API_KEY || '').trim()
    if (!key) return { ok: false, permanent: false, error: 'Texting is not set up (no carrier key)' }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: m.from,
          to: m.to,
          text: m.text,
          type: 'SMS',
          ...(process.env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID.trim() } : {}),
          use_profile_webhooks: true,
        }),
        signal: ctl.signal,
      })
      const body = asObj(await res.json().catch(() => ({})))
      if (res.ok) {
        const d = asObj(body.data)
        const id = typeof d.id === 'string' ? d.id : null
        if (!id) return { ok: false, permanent: false, unknown: true, error: 'The carrier answered without a message id' }
        return { ok: true, providerMessageId: id, segments: num(d.parts), costMicros: micros(asObj(d.cost).amount) }
      }
      const err = asObj(Array.isArray(body.errors) ? body.errors[0] : null)
      const code = err.code != null ? String(err.code) : undefined
      const detail = typeof err.detail === 'string' ? err.detail : typeof err.title === 'string' ? err.title : `Carrier error ${res.status}`
      if (code === TELNYX_OPTED_OUT_CODE) return { ok: false, permanent: true, optedOut: true, error: detail, code }
      // A 4xx about the number is final; a 5xx / 429 / auth problem is not the number's fault.
      return { ok: false, permanent: !!code && TELNYX_BAD_NUMBER_CODES.has(code), error: detail.slice(0, 300), ...(code ? { code } : {}) }
    } catch (e) {
      // Timeout / dropped line after we started: the carrier may have taken it.
      return { ok: false, permanent: false, unknown: true, error: e instanceof Error ? e.message.slice(0, 200) : 'No answer from the carrier' }
    } finally {
      clearTimeout(timer)
    }
  },

  verifyWebhook(rawBody: string, headers: Headers, nowMs: number): VerifyResult {
    const key = publicKey()
    if (!key) return { ok: false, reason: 'not_configured' }
    const sig = headers.get('telnyx-signature-ed25519')
    const ts = headers.get('telnyx-timestamp')
    if (!sig || !ts) return { ok: false, reason: 'missing_headers' }
    const seconds = Number(ts)
    if (!Number.isFinite(seconds) || Math.abs(nowMs - seconds * 1000) > MAX_SKEW_MS) return { ok: false, reason: 'stale' }
    let signature: Buffer
    try {
      signature = Buffer.from(sig, 'base64')
    } catch {
      return { ok: false, reason: 'bad_signature' }
    }
    if (signature.length !== 64) return { ok: false, reason: 'bad_signature' }
    let good = false
    try {
      good = cryptoVerify(null, Buffer.from(`${ts}|${rawBody}`, 'utf8'), key, signature)
    } catch {
      good = false
    }
    return good ? { ok: true } : { ok: false, reason: 'bad_signature' }
  },

  parseWebhook(rawBody: string): SmsEvent | null {
    return parseTelnyxEvent(rawBody)
  },
}

/** Shared with the test provider (same payload shape, different trust). */
export function parseTelnyxEvent(rawBody: string): SmsEvent | null {
  let json: Record<string, unknown>
  try {
    json = asObj(JSON.parse(rawBody))
  } catch {
    return null
  }
  const data = asObj(json.data)
  const type = typeof data.event_type === 'string' ? data.event_type : ''
  const p = asObj(data.payload)
  const id = typeof p.id === 'string' && p.id ? p.id : null
  const from = typeof asObj(p.from).phone_number === 'string' ? (asObj(p.from).phone_number as string) : ''
  const toFirst = asObj(Array.isArray(p.to) ? p.to[0] : null)
  const to = typeof toFirst.phone_number === 'string' ? (toFirst.phone_number as string) : ''
  const at = typeof data.occurred_at === 'string' ? data.occurred_at : new Date().toISOString()
  if (!id) return { kind: 'ignored', id: null, type }
  if (type === 'message.received') {
    const media = Array.isArray(p.media) ? p.media.length : 0
    const cost = asObj(p.cost)
    return {
      kind: 'inbound',
      id,
      from,
      to,
      text: typeof p.text === 'string' ? p.text : '',
      mediaCount: media,
      segments: num(p.parts),
      costMicros: micros(cost.amount),
      receivedAt: typeof p.received_at === 'string' ? p.received_at : at,
    }
  }
  if (type === 'message.sent' || type === 'message.finalized') {
    const raw = typeof toFirst.status === 'string' ? toFirst.status : ''
    const errs = Array.isArray(p.errors) ? p.errors.map(asObj) : []
    const status: 'sent' | 'delivered' | 'failed' = type === 'message.sent' ? 'sent' : raw === 'delivered' ? 'delivered' : 'failed'
    return {
      kind: 'status',
      id,
      from,
      to,
      status,
      errorCode: errs[0]?.code != null ? String(errs[0].code) : null,
      errorText: typeof errs[0]?.detail === 'string' ? (errs[0].detail as string).slice(0, 300) : typeof errs[0]?.title === 'string' ? (errs[0].title as string).slice(0, 300) : null,
      segments: num(p.parts),
      costMicros: micros(asObj(p.cost).amount),
      at,
    }
  }
  return { kind: 'ignored', id, type }
}
