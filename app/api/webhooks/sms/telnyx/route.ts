import { waitUntil } from '@vercel/functions'
import { NextResponse } from 'next/server'

import { processSmsEvent } from '@/lib/sms/inbound'
import { testProvider } from '@/lib/sms/test-provider'
import { telnyxProvider } from '@/lib/sms/telnyx'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const MAX_BODY = 256 * 1024

/**
 * Telnyx webhook (public: every request must carry a valid `telnyx-signature-ed25519` over `<timestamp>|<raw body>` for
 * TELNYX_PUBLIC_KEY, and a timestamp within 5 minutes). ONE endpoint for every company and every address of this app: the
 * company is decided inside `processSmsEvent` by the company number in the event (never by the host or anything the sender
 * wrote). Always answers 2xx once the event is safely handled (or safely ignored) and 500 only when the carrier should retry.
 * With SMS_PROVIDER=test (never in production) the shared test token stands in for the carrier's key.
 * lib/sms/inbound.ts does the work.
 */
export async function POST(request: Request) {
  const provider = process.env.SMS_PROVIDER === 'test' && process.env.NODE_ENV !== 'production' ? testProvider : telnyxProvider
  if (!provider.canReceive()) return NextResponse.json({ error: 'Texting is not set up' }, { status: 503 })
  // Cap the body while it streams in (not after): a declared length over the cap, or a stream that runs past it, is refused.
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  const raw = await readCapped(request, MAX_BODY)
  if (raw === null) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  const check = provider.verifyWebhook(raw, request.headers, Date.now())
  if (!check.ok) return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  const event = provider.parseWebhook(raw)
  if (!event) return NextResponse.json({ error: 'Bad body' }, { status: 400 })
  // The carrier wants its 2xx within seconds: the answer text and the email to the company finish behind the response.
  const result = await processSmsEvent(createServiceClient(), event, new Date(), (work) => {
    waitUntil(work().catch((e) => console.error('[sms webhook] deferred step failed', e)))
  })
  return NextResponse.json({ ok: result.status === 200, handled: result.handled }, { status: result.status })
}

/** The request body as text, or null once it grows past `max` bytes (reading stops there). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
