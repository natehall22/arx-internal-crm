import { NextRequest, NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'
import { runLeadReminderForOrg, type LeadReminderRun } from '@/lib/leads-waiting'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Hourly: one bell notification per lead the first time it has waited the company's N hours with no contact logged
 * (Settings → Lead routing; OFF until a company turns it on, so it costs a settings read). One company failing never
 * stops the others.
 */
export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'untouched-leads')
  if (authFailure) return authFailure

  const admin = createServiceClient()
  const now = new Date()
  let orgs
  try {
    orgs = await loadCronOrgs(admin)
  } catch (e) {
    console.error('[cron/untouched-leads] orgs fetch failed', e)
    return NextResponse.json({ error: 'orgs fetch failed' }, { status: 500 })
  }
  const results: LeadReminderRun[] = []
  let failed = false
  for (const org of orgs) {
    try {
      results.push(await runLeadReminderForOrg(admin, org, now))
    } catch (e) {
      failed = true
      console.error('[cron/untouched-leads] company failed', { orgId: org.id, e })
      results.push({ orgId: org.id, considered: 0, notified: 0 })
    }
  }
  return NextResponse.json({ orgs: results.length, notified: results.reduce((n, r) => n + r.notified, 0), results }, { status: failed ? 500 : 200 })
}
