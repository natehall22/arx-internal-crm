import { NextRequest, NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'
import { runCustomerMessagesForOrg, type OrgRunResult } from '@/lib/customer-messages-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Every 15 minutes: automatic customer messages (visit reminders, "on the way" / "done", quote follow-ups, invoice
 * reminders; by email, and by text for a company with the `texting` switch and its own number) for every company a background job runs for (lib/cron-orgs.ts). Each company runs in its own time zone and
 * quiet hours; a company with the `customerMessages` switch off, or every message off, costs one settings read.
 * Kill switch: env CUSTOMER_MESSAGES_CRON=false. One company failing never stops the others.
 */
export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'customer-messages')
  if (authFailure) return authFailure
  if (process.env.CUSTOMER_MESSAGES_CRON === 'false') return NextResponse.json({ skipped: true, reason: 'CUSTOMER_MESSAGES_CRON=false' })

  const admin = createServiceClient()
  const now = new Date()
  let orgs
  try {
    orgs = await loadCronOrgs(admin)
  } catch (e) {
    console.error('[cron/customer-messages] orgs fetch failed', e)
    return NextResponse.json({ error: 'orgs fetch failed' }, { status: 500 })
  }
  const results: OrgRunResult[] = []
  let failed = false
  for (const org of orgs) {
    try {
      results.push(await runCustomerMessagesForOrg(admin, org.id, now))
    } catch (e) {
      failed = true
      console.error('[cron/customer-messages] company failed', { orgId: org.id, e })
      results.push({ orgId: org.id, skipped: 'error' })
    }
  }
  const sent = results.reduce((n, r) => n + (r.stats?.sent ?? 0) + (r.sms?.stats?.sent ?? 0), 0)
  return NextResponse.json({ orgs: results.length, sent, results }, { status: failed ? 500 : 200 })
}
