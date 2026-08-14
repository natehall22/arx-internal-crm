import { NextRequest, NextResponse } from 'next/server'
import { getOrgEmailBlastSettings } from '@/lib/admin-email-blasts'
import { getBlastSendDate, runClaimedBlast, type BlastResult } from '@/lib/email-blast-ledger'
import { sendMorningUpdateEmail } from '@/lib/morning-update-email'
import { sendSetterFieldUpdateEmail } from '@/lib/setter-field-update-email'
import { isMorningUpdateSendWindow } from '@/lib/morning-update-schedule'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type SupabaseAdmin = ReturnType<typeof createServiceClient>

/**
 * The orgs fetch is the single call that takes the whole blast down when Postgres blips,
 * so it gets a few in-request attempts before we fall back to the next cron fire.
 */
async function fetchOrgsWithRetry(admin: SupabaseAdmin, attempts = 3) {
  let lastError: { message: string } | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await admin.from('orgs').select('id, settings')
    if (!error) return { data, error: null }

    lastError = error
    console.error(`[cron/morning-update] orgs fetch attempt ${attempt} failed:`, error.message)
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }

  return { data: null, error: lastError }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — morning-update cron will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isMorningUpdateSendWindow()) {
    return NextResponse.json({ skipped: true, reason: 'outside_send_window' })
  }

  const admin = createServiceClient()
  const sendDate = getBlastSendDate()
  const { data: orgRows, error: orgError } = await fetchOrgsWithRetry(admin)

  if (orgError) {
    console.error('[cron/morning-update] Failed to fetch orgs:', orgError.message)
    return NextResponse.json({ error: orgError.message, sendDate }, { status: 500 })
  }

  const results: Array<{ org_id: string; sent: number; skipped: boolean; reason?: string }> = []
  let hadError = false

  for (const org of orgRows || []) {
    const orgId = org.id as string
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
      settings.setter_field_update?.enabled
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
    { orgs: results.length, sentTotal, sendDate, results },
    // Surface failures as a failed cron run in Vercel rather than a silent 200.
    { status: hadError ? 500 : 200 }
  )
}
