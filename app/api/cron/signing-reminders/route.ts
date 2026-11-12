import { NextRequest, NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'
import { runSigningRemindersForOrg, type ReminderRun } from '@/lib/signing/lifecycle'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Hourly: automatic signing reminders (default day 2 and day 5 after a document was sent, editable per company) for every
 * company that turned them on (Settings → Signing; OFF until an owner does). Daytime only in the company's own time zone.
 * A company with reminders off costs one settings read. One company failing never stops the others.
 */
export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'signing-reminders')
  if (authFailure) return authFailure
  if (process.env.SIGNING_REMINDERS_CRON === 'false') return NextResponse.json({ skipped: true, reason: 'SIGNING_REMINDERS_CRON=false' })

  const admin = createServiceClient()
  const now = new Date()
  let orgs
  try {
    orgs = await loadCronOrgs(admin)
  } catch (e) {
    console.error('[cron/signing-reminders] orgs fetch failed', e)
    return NextResponse.json({ error: 'orgs fetch failed' }, { status: 500 })
  }
  const results: ReminderRun[] = []
  let failed = false
  for (const org of orgs) {
    try {
      results.push(await runSigningRemindersForOrg(admin, org, now))
    } catch (e) {
      failed = true
      console.error('[cron/signing-reminders] company failed', { orgId: org.id, e })
      results.push({ orgId: org.id, considered: 0, sent: 0 })
    }
  }
  return NextResponse.json({ orgs: results.length, sent: results.reduce((n, r) => n + r.sent, 0), results }, { status: failed ? 500 : 200 })
}
