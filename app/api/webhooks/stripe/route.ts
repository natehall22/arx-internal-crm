import { NextResponse } from 'next/server'

import { verifyStripeSignature } from '@/lib/stripe/api'
import { handleStripeWebhookEvent } from '@/lib/online-payments/webhook'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Stripe Connect webhook (public; every request must carry a valid `Stripe-Signature` for STRIPE_WEBHOOK_SECRET over the
 * RAW body). One endpoint for all companies; the company comes from the event's connected account only.
 * lib/online-payments/webhook.ts does the work.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Online payments are not set up' }, { status: 503 })
  const raw = await request.text()
  if (raw.length > 512 * 1024) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  const check = verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)
  if (!check.ok) return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  let event: Record<string, unknown>
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Bad body' }, { status: 400 })
  }
  try {
    const result = await handleStripeWebhookEvent(createServiceClient(), event)
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('POST /api/webhooks/stripe failed', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
