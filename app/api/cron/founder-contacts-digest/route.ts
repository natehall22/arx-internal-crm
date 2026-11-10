import { NextRequest, NextResponse } from 'next/server'
import { sendFounderContactsDigests } from '@/lib/founder-contacts'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgIds } from '@/lib/cron-orgs'

/**
 * Nightly email of contacts added on the founder calendar (vercel.json: 01:00 UTC =
 * 9pm EDT / 8pm EST). Each person gets their own. Re-runs are safe — only rows not yet
 * emailed are sent.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request, 'founder-contacts-digest cron')
  if (denied) return denied

  try {
    const admin = createServiceClient()
    // Only companies a background job may run for (lib/cron-orgs: active users, inside the deployment fence).
    const result = await sendFounderContactsDigests(admin, new Date(), await loadCronOrgIds(admin))
    return NextResponse.json(result)
  } catch (error) {
    console.error('[cron/founder-contacts-digest] failed', error)
    return NextResponse.json({ error: 'Digest failed' }, { status: 500 })
  }
}
