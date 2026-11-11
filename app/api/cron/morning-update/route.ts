import { NextRequest, NextResponse } from 'next/server'
import { orgFeatureChecker } from '@/lib/org-features-server'
import { getOrgEmailBlastSettings } from '@/lib/admin-email-blasts'
import { ensureCheckups } from '@/lib/checkups'
import { retryDueCommissionChanges } from '@/lib/payroll-commission-change'
import { ensureServiceVisits } from '@/lib/service-plans-db'
import { autoCloseForgotten } from '@/lib/time-tracking-db'
import { getBlastSendDate, runClaimedBlast, type BlastResult } from '@/lib/email-blast-ledger'
import { sendMorningUpdateEmail } from '@/lib/morning-update-email'
import { sendSetterFieldUpdateEmail } from '@/lib/setter-field-update-email'
import { isMorningUpdateSendWindow } from '@/lib/morning-update-schedule'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs, type CronOrg } from '@/lib/cron-orgs'
import { sendScheduledReports } from '@/lib/reporting/scheduled'

export const dynamic = 'force-dynamic'

type SupabaseAdmin = ReturnType<typeof createServiceClient>

/**
 * The orgs fetch is the single call that takes the whole blast down when Postgres blips,
 * so it gets a few in-request attempts before we fall back to the next cron fire.
 * Only companies a background job may run for (lib/cron-orgs: active users, inside the deployment fence).
 */
async function fetchOrgsWithRetry(admin: SupabaseAdmin, attempts = 3): Promise<{ data: CronOrg[] | null; error: { message: string } | null }> {
  let lastError: { message: string } | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { data: await loadCronOrgs(admin), error: null }
    } catch (error) {
      lastError = { message: error instanceof Error ? error.message : String(error) }
    }
    console.error(`[cron/morning-update] orgs fetch attempt ${attempt} failed:`, lastError.message)
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }

  return { data: null, error: lastError }
}

export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'morning-update')
  if (authFailure) return authFailure

  const now = new Date()
  const admin = createServiceClient()
  const { data: orgRows, error: orgError } = await fetchOrgsWithRetry(admin)

  if (orgError) {
    console.error('[cron/morning-update] Failed to fetch orgs:', orgError.message)
    return NextResponse.json({ error: orgError.message }, { status: 500 })
  }

  const results: Array<{ org_id: string; sent: number; skipped: boolean; reason?: string }> = []
  let hadError = false

  const canvassingOn = orgFeatureChecker('canvassing')
  const servicePlansOn = orgFeatureChecker('servicePlans')
  const timeTrackingOn = orgFeatureChecker('timeTracking')
  const hourlyBillingOn = orgFeatureChecker('hourlyBilling')
  for (const org of orgRows || []) {
    const orgId = org.id
    // Each company's morning is its own: 5:30am in `orgs.timezone`, and the once-a-day claim is keyed to
    // that company's calendar date (the manual resend uses the same date, see resend-today).
    if (!isMorningUpdateSendWindow(now, org.timezone)) {
      results.push({ org_id: orgId, sent: 0, skipped: true, reason: 'outside_send_window' })
      continue
    }
    const sendDate = getBlastSendDate(now, org.timezone)
    // Saved reports on a schedule go out with the morning update; independent of the blast switches.
    await sendScheduledReports(admin, orgId).catch((error) => {
      console.error(`[cron/morning-update] scheduled reports failed for org ${orgId}:`, error)
    })
    // Customer checkups coming due are created here, every morning, whether or not any email goes out
    // (idempotent; the assignee is told once about new ones). Off unless the org turned checkups on.
    await ensureCheckups(admin, orgId).catch((error) => {
      console.error(`[cron/morning-update] checkups failed for org ${orgId}:`, error)
    })
    // Service plan visits for the next weeks, the same way (idempotent; only companies using service plans).
    if (await servicePlansOn(orgId)) {
      await ensureServiceVisits(admin, orgId, { now, timeZone: org.timezone }).catch((error) => {
        console.error(`[cron/morning-update] service visits failed for org ${orgId}:`, error)
      })
    }
    // Commission changes that couldn't be written yet (an approval was running, or the new pay week isn't on): retried
    // every morning (lib/payroll-commission-change.ts; nothing waiting = one empty read).
    if (await hourlyBillingOn(orgId)) {
      await retryDueCommissionChanges(admin, orgId).catch((error) => {
        console.error(`[cron/morning-update] commission change retry failed for org ${orgId}:`, error)
      })
    }
    // Clocks left running overnight are stopped at the last tap and flagged before anyone's morning (time clock companies).
    if (await timeTrackingOn(orgId)) {
      await autoCloseForgotten(admin, orgId, { now }).catch((error) => {
        console.error(`[cron/morning-update] time clock auto-close failed for org ${orgId}:`, error)
      })
    }
    const settings = getOrgEmailBlastSettings(org.settings)
    if (!settings.morning_update?.enabled && !settings.setter_field_update?.enabled) {
      results.push({ org_id: orgId, sent: 0, skipped: true, reason: 'disabled' })
      continue
    }

    // Settled independently: a failure in one blast must not block or re-send the other.
    const sends = await Promise.all([
      settings.morning_update?.enabled
        ? runClaimedBlast(admin, {
            orgId,
            blastType: 'morning_update',
            sendDate,
            send: () => sendMorningUpdateEmail(admin, { orgId }),
          })
        : Promise.resolve<BlastResult>({ sent: 0, skipped: true, reason: 'morning_update_disabled' }),
      // The setter field update is canvass knock data: not sent when door knocking is switched off.
      settings.setter_field_update?.enabled && (await canvassingOn(orgId))
        ? runClaimedBlast(admin, {
            orgId,
            blastType: 'setter_field_update',
            sendDate,
            send: () => sendSetterFieldUpdateEmail(admin, { orgId }),
          })
        : Promise.resolve<BlastResult>({ sent: 0, skipped: true, reason: 'setter_field_update_disabled' }),
    ].map((promise) =>
      promise.catch((error): BlastResult => {
        hadError = true
        console.error(`[cron/morning-update] Error for org ${orgId}:`, error)
        return {
          sent: 0,
          skipped: true,
          reason: error instanceof Error ? error.message : 'send_failed',
        }
      })
    ))

    results.push({
      org_id: orgId,
      sent: sends.reduce((sum, result) => sum + result.sent, 0),
      skipped: sends.every((result) => result.skipped),
      reason: sends.map((result) => result.reason).filter(Boolean).join(',') || undefined,
    })
  }

  const sentTotal = results.reduce((sum, row) => sum + row.sent, 0)
  return NextResponse.json(
    { orgs: results.length, sentTotal, results },
    // Surface failures as a failed cron run in Vercel rather than a silent 200.
    { status: hadError ? 500 : 200 }
  )
}
