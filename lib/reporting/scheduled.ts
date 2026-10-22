/**
 * Emails saved reports on their schedule. Called by the 7am morning-update cron, once per org per day.
 * Each report runs AS ITS CREATOR (their scope and finance access), so a schedule can never show
 * a recipient more than its creator could see.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildReportContext, resultToCsv, runReport } from '@/lib/reporting/run'
import { parseSpec } from '@/lib/reporting/spec'

function dueToday(schedule: string, now: Date): boolean {
  if (schedule === 'daily') return true
  if (schedule === 'weekly_mon') return now.getUTCDay() === 1
  if (schedule === 'monthly_1') return now.getUTCDate() === 1
  return false
}

export async function sendScheduledReports(
  admin: SupabaseClient,
  orgId: string,
  now = new Date()
): Promise<{ sent: number; failed: number }> {
  const { data: reports } = await admin
    .from('saved_reports')
    .select('id, name, spec, schedule, schedule_recipients, created_by, last_sent_at')
    .eq('org_id', orgId)
    .not('schedule', 'is', null)
  const todayKey = now.toISOString().slice(0, 10)
  let sent = 0
  let failed = 0
  for (const r of reports ?? []) {
    if (!r.schedule || !dueToday(r.schedule, now)) continue
    if (r.last_sent_at && String(r.last_sent_at).slice(0, 10) === todayKey) continue
    try {
      const { data: creator } = await admin
        .from('users')
        .select('id, org_id, role, custom_role_id, team_id, region_id, active')
        .eq('id', r.created_by)
        .eq('org_id', orgId)
        .maybeSingle()
      const parsed = parseSpec(r.spec)
      if (!creator || creator.active === false || !parsed.ok) throw new Error('creator inactive or spec invalid')
      const ctx = await buildReportContext(admin, creator)
      const result = await runReport(admin, ctx, parsed.spec)
      const { getMailTransport } = await import('@/lib/setter-email')
      await getMailTransport().sendMail({
        from: getCrmEmailFrom(),
        to: r.schedule_recipients,
        subject: `${r.name} — ${todayKey}`,
        text: `Your scheduled report "${r.name}" is attached (${result.rows.length} rows).`,
        attachments: [{ filename: `${String(r.name).replace(/[^a-z0-9_-]+/gi, '-')}.csv`, content: resultToCsv(result), contentType: 'text/csv' }],
      })
      await admin.from('saved_reports').update({ last_sent_at: now.toISOString() }).eq('id', r.id)
      sent += 1
    } catch (error) {
      failed += 1
      console.error('[scheduled-reports] failed', r.id, error instanceof Error ? error.message : error)
    }
  }
  return { sent, failed }
}
