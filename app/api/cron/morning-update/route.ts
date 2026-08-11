import { NextRequest, NextResponse } from 'next/server'
import { getOrgEmailBlastSettings } from '@/lib/admin-email-blasts'
import { sendMorningUpdateEmail } from '@/lib/morning-update-email'
import { sendSetterFieldUpdateEmail } from '@/lib/setter-field-update-email'
import { isMorningUpdateSendWindow } from '@/lib/morning-update-schedule'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

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
  const { data: orgRows, error: orgError } = await admin.from('orgs').select('id, settings')

  if (orgError) {
    console.error('[cron/morning-update] Failed to fetch orgs:', orgError.message)
    return NextResponse.json({ error: orgError.message }, { status: 500 })
  }

  const results: Array<{ org_id: string; sent: number; skipped: boolean; reason?: string }> = []

  for (const org of orgRows || []) {
    const orgId = org.id as string
    const settings = getOrgEmailBlastSettings(org.settings)
    if (!settings.morning_update?.enabled && !settings.setter_field_update?.enabled) {
      results.push({ org_id: orgId, sent: 0, skipped: true, reason: 'disabled' })
      continue
    }

    try {
      const sends = await Promise.all([
        settings.morning_update?.enabled
          ? sendMorningUpdateEmail(admin, { orgId })
          : Promise.resolve({ sent: 0, skipped: true, reason: 'morning_update_disabled' }),
        settings.setter_field_update?.enabled
          ? sendSetterFieldUpdateEmail(admin, { orgId })
          : Promise.resolve({ sent: 0, skipped: true, reason: 'setter_field_update_disabled' }),
      ])
      results.push({
        org_id: orgId,
        sent: sends.reduce((sum, result) => sum + result.sent, 0),
        skipped: sends.every((result) => result.skipped),
        reason: sends.map((result) => result.reason).filter(Boolean).join(',') || undefined,
      })
    } catch (error) {
      console.error(`[cron/morning-update] Error for org ${orgId}:`, error)
      results.push({
        org_id: orgId,
        sent: 0,
        skipped: true,
        reason: error instanceof Error ? error.message : 'send_failed',
      })
    }
  }

  const sentTotal = results.reduce((sum, row) => sum + row.sent, 0)
  return NextResponse.json({ orgs: results.length, sentTotal, results })
}
