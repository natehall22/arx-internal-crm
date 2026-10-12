import { NextRequest, NextResponse } from 'next/server'
import { sendFounderContactsDigests } from '@/lib/founder-contacts'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Nightly email of contacts added on the founder calendar (vercel.json: 01:00 UTC =
 * 9pm EDT / 8pm EST). Each person gets their own. Re-runs are safe — only rows not yet
 * emailed are sent.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — founder-contacts-digest cron will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sendFounderContactsDigests(createServiceClient())
    return NextResponse.json(result)
  } catch (error) {
    console.error('[cron/founder-contacts-digest] failed', error)
    return NextResponse.json({ error: 'Digest failed' }, { status: 500 })
  }
}
