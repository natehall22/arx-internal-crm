/**
 * The "test" carrier: records what would have been sent and accepts webhooks carrying a shared token. Development and
 * tests only — `getSmsProvider` refuses it when NODE_ENV is production, and every method here refuses too.
 * Webhook trust: header `x-test-sms-token` equal to env SMS_TEST_WEBHOOK_TOKEN (set, at least 8 characters). The payload is
 * the Telnyx shape (same parser), so the whole inbound path runs without a Telnyx account.
 */
import { countSegments } from '@/lib/sms/segments'
import type { SmsProvider, SmsSendInput, SmsSendResult } from '@/lib/sms/provider'
import { parseTelnyxEvent } from '@/lib/sms/telnyx'

export type RecordedSms = SmsSendInput & { id: string; at: string }
const outbox: RecordedSms[] = []
let nextResult: (() => SmsSendResult | null) | null = null

/** Everything "sent" so far (newest last). */
export function testSmsOutbox(): readonly RecordedSms[] {
  return outbox
}
export function resetTestSms(): void {
  outbox.length = 0
  nextResult = null
}
/** Make the next sends fail / succeed on purpose (tests). `null` from the function = succeed as usual. */
export function setNextTestSmsResult(fn: (() => SmsSendResult | null) | null): void {
  nextResult = fn
}

const prod = () => process.env.NODE_ENV === 'production'

export const testProvider: SmsProvider = {
  id: 'test',
  canSend: () => !prod(),
  canReceive: () => !prod() && (process.env.SMS_TEST_WEBHOOK_TOKEN || '').length >= 8,
  async send(m) {
    if (prod()) return { ok: false, permanent: false, error: 'The test carrier is not available in production' }
    const forced = nextResult?.()
    if (forced) return forced
    const id = `test-${outbox.length + 1}-${m.idempotencyKey}`
    outbox.push({ ...m, id, at: new Date().toISOString() })
    return { ok: true, providerMessageId: id, segments: countSegments(m.text).segments, costMicros: 0 }
  },
  verifyWebhook(_raw, headers) {
    if (prod()) return { ok: false, reason: 'not_available' }
    const want = process.env.SMS_TEST_WEBHOOK_TOKEN || ''
    if (want.length < 8) return { ok: false, reason: 'not_configured' }
    return headers.get('x-test-sms-token') === want ? { ok: true } : { ok: false, reason: 'bad_signature' }
  },
  parseWebhook: parseTelnyxEvent,
}
