import { NextRequest, NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'
import { orgFeatureChecker } from '@/lib/org-features-server'
import { runAutoRollForOrg, runEndOfDayNudgeForOrg } from '@/lib/schedule-nightly-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Hourly: for companies with service plans AND the owner's switch on (Settings → Jobs → Nightly schedule; both default OFF) —
 * (1) auto-roll unstarted work left on a passed day to the next working day, (2) the end-of-day "close out" bell. Each company
 * acts only inside its own local hour window (lib/schedule-nightly.ts); both steps are idempotent. One company or step failing
 * never stops the rest. Kill switch: env SCHEDULE_NIGHTLY_CRON=false.
 */
export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'schedule-nightly')
  if (authFailure) return authFailure
  if (process.env.SCHEDULE_NIGHTLY_CRON === 'false') return NextResponse.json({ skipped: true, reason: 'SCHEDULE_NIGHTLY_CRON=false' })

  const admin = createServiceClient()
  const now = new Date()
  let orgs
  try {
    orgs = await loadCronOrgs(admin)
  } catch (e) {
    console.error('[cron/schedule-nightly] orgs fetch failed', e)
    return NextResponse.json({ error: 'orgs fetch failed' }, { status: 500 })
  }
  const servicePlansOn = orgFeatureChecker('servicePlans')
  const timeTrackingOn = orgFeatureChecker('timeTracking')
  const results: Array<Record<string, unknown>> = []
  let failed = false
  for (const org of orgs) {
    if (!(await servicePlansOn(org.id))) continue
    const row: Record<string, unknown> = { orgId: org.id }
    try {
      row.autoRoll = await runAutoRollForOrg(admin, org, now)
      if ((row.autoRoll as { error?: boolean }).error) failed = true // a lookup failed: this company was skipped this run (logged)
    } catch (e) {
      failed = true
      row.autoRoll = { error: true }
      console.error('[cron/schedule-nightly] auto-roll failed', { orgId: org.id, e })
    }
    try {
      row.endOfDay = await runEndOfDayNudgeForOrg(admin, org, now, { timeTracking: await timeTrackingOn(org.id) })
    } catch (e) {
      failed = true
      row.endOfDay = { error: true }
      console.error('[cron/schedule-nightly] end-of-day failed', { orgId: org.id, e })
    }
    results.push(row)
  }
  return NextResponse.json({ orgs: results.length, results }, { status: failed ? 500 : 200 })
}
