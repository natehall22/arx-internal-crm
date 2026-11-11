import { generateKeyPairSync, sign } from 'node:crypto'

import { parseTelnyxEvent, telnyxProvider } from '@/lib/sms/telnyx'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const raw32 = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32)
const NOW = Date.UTC(2026, 10, 17, 15, 0, 0)
const body = JSON.stringify({ data: { event_type: 'message.received', payload: { id: 'm1' } } })

function headers(b: string, ts: number, key = privateKey): Headers {
  const sig = sign(null, Buffer.from(`${ts}|${b}`), key).toString('base64')
  return new Headers({ 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': String(ts) })
}

describe('Telnyx webhook signature', () => {
  const old = process.env.TELNYX_PUBLIC_KEY
  afterEach(() => {
    process.env.TELNYX_PUBLIC_KEY = old
  })
  const ts = Math.floor(NOW / 1000)

  it.each([
    ['raw base64 key', () => raw32.toString('base64')],
    ['SPKI DER key', () => (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64')],
    ['PEM key', () => publicKey.export({ format: 'pem', type: 'spki' }) as string],
  ])('accepts a good signature (%s)', (_n, k) => {
    process.env.TELNYX_PUBLIC_KEY = k()
    expect(telnyxProvider.verifyWebhook(body, headers(body, ts), NOW)).toEqual({ ok: true })
  })
  it('refuses a changed body, a wrong key, a stale or future timestamp, and missing headers', () => {
    process.env.TELNYX_PUBLIC_KEY = raw32.toString('base64')
    expect(telnyxProvider.verifyWebhook(body + ' ', headers(body, ts), NOW)).toMatchObject({ ok: false, reason: 'bad_signature' })
    const other = generateKeyPairSync('ed25519')
    expect(telnyxProvider.verifyWebhook(body, headers(body, ts, other.privateKey), NOW)).toMatchObject({ ok: false, reason: 'bad_signature' })
    expect(telnyxProvider.verifyWebhook(body, headers(body, ts - 400), NOW)).toMatchObject({ ok: false, reason: 'stale' })
    expect(telnyxProvider.verifyWebhook(body, headers(body, ts + 400), NOW)).toMatchObject({ ok: false, reason: 'stale' })
    expect(telnyxProvider.verifyWebhook(body, new Headers(), NOW)).toMatchObject({ ok: false, reason: 'missing_headers' })
    expect(telnyxProvider.verifyWebhook(body, new Headers({ 'telnyx-signature-ed25519': 'AAAA', 'telnyx-timestamp': String(ts) }), NOW)).toMatchObject({ ok: false, reason: 'bad_signature' })
    expect(telnyxProvider.verifyWebhook(body, new Headers({ 'telnyx-signature-ed25519': 'x', 'telnyx-timestamp': 'abc' }), NOW)).toMatchObject({ ok: false })
  })
  it('refuses everything when no key is configured', () => {
    delete process.env.TELNYX_PUBLIC_KEY
    expect(telnyxProvider.verifyWebhook(body, headers(body, ts), NOW)).toMatchObject({ ok: false, reason: 'not_configured' })
  })
})

describe('Telnyx payloads', () => {
  it('reads an inbound text', () => {
    const e = parseTelnyxEvent(JSON.stringify({ data: { event_type: 'message.received', occurred_at: '2026-11-17T15:00:00Z', payload: { id: 'abc', text: 'hi', from: { phone_number: '+18505550100' }, to: [{ phone_number: '+18505550199' }], media: [{}], parts: 1, cost: { amount: '0.004' } } } }))
    expect(e).toMatchObject({ kind: 'inbound', id: 'abc', from: '+18505550100', to: '+18505550199', text: 'hi', mediaCount: 1, costMicros: 4000 })
  })
  it('reads delivery results', () => {
    const e = parseTelnyxEvent(JSON.stringify({ data: { event_type: 'message.finalized', payload: { id: 'x', to: [{ phone_number: '+18505550100', status: 'delivery_failed' }], errors: [{ code: '40300', title: 'Blocked' }] } } }))
    expect(e).toMatchObject({ kind: 'status', status: 'failed', errorCode: '40300' })
    const d = parseTelnyxEvent(JSON.stringify({ data: { event_type: 'message.finalized', payload: { id: 'x', to: [{ phone_number: '+18505550100', status: 'delivered' }] } } }))
    expect(d).toMatchObject({ kind: 'status', status: 'delivered' })
  })
  it('ignores unknown events and junk', () => {
    expect(parseTelnyxEvent('not json')).toBeNull()
    expect(parseTelnyxEvent(JSON.stringify({ data: { event_type: 'something.else', payload: { id: 'z' } } }))).toMatchObject({ kind: 'ignored' })
    expect(parseTelnyxEvent(JSON.stringify({ data: { event_type: 'message.received', payload: {} } }))).toMatchObject({ kind: 'ignored' })
  })
})
