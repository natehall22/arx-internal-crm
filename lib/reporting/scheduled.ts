/**
 * Emails saved reports on their schedule. Called by the 7am morning-update cron, once per org per day.
 * Each recipient receives the report run AS THEMSELVES (their own scope and reports:financials), so a schedule can never
 * show a recipient more than they could open themselves; the creator must still be able to export it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { ReportAccessError, buildReportContext, resultToCsv, runReport } from '@/lib/reporting/run'
import { parseSpec } from '@/lib/reporting/report-spec'

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
    if (!r.schedule || !r.created_by || !dueToday(r.schedule, now)) continue
    if (r.last_sent_at && String(r.last_sent_at).slice(0, 10) === todayKey) continue
    // Claim today's send atomically so two overlapping cron fires cannot both email it.
    const { data: claimed } = await admin
      .from('saved_reports')
      .update({ last_sent_at: now.toISOString() })
      .eq('id', r.id)
      .or(r.last_sent_at ? `last_sent_at.eq.${r.last_sent_at}` : 'last_sent_at.is.null')
      .select('id')
    if (!claimed || claimed.length === 0) continue
    try {
      const { data: creator } = await admin
        .from('users')
        .select('id, org_id, role, custom_role_id, team_id, region_id, active')
        .eq('id', r.created_by)
        .eq('org_id', orgId)
        .maybeSingle()
      const parsed = parseSpec(r.spec)
      if (!creator || creator.active === false || !parsed.ok) throw new Error('creator inactive or spec invalid')
      const creatorCtx = await buildReportContext(admin, creator)
      // The creator must STILL be allowed to export this.
      if (!creatorCtx.canExport) throw new Error('creator can no longer export reports')
      // Each recipient gets the report AS THEMSELVES: their own scope and their own financial access. A recipient without
      // reports:financials never receives a financial column (or a financial-only report at all), whatever the creator can see.
      const { data: staff } = await admin
        .from('users')
        .select('id, org_id, role, custom_role_id, team_id, region_id, email')
        .eq('org_id', orgId)
        .eq('active', true)
        .in('email', r.schedule_recipients ?? [])
      if (!staff || staff.length === 0) throw new Error('no active recipients')
      const { getMailTransport } = await import('@/lib/setter-email')
      let delivered = 0
      for (const person of staff as Array<{ id: string; org_id: string; role: string; custom_role_id: string | null; team_id: string | null; region_id: string | null; email: string }>) {
        try {
          const ctx = await buildReportContext(admin, person)
          if (!ctx.canExport) continue
          const result = await runReport(admin, ctx, parsed.spec)
          await getMailTransport().sendMail({
            from: getCrmEmailFrom(),
            to: person.email,
            subject: `${r.name} — ${todayKey}`,
            text: `Your scheduled report "${r.name}" is attached (${result.rows.length} rows).`,
            attachments: [{ filename: `${String(r.name).replace(/[^a-z0-9_-]+/gi, '-')}.csv`, content: resultToCsv(result), contentType: 'text/csv' }],
          })
          delivered += 1
        } catch (error) {
          if (!(error instanceof ReportAccessError)) throw error
          // This person may not see that report (e.g. it needs reports:financials). They are skipped, not sent a reduced copy.
        }
      }
      if (delivered === 0) throw new Error('no recipient is allowed to receive this report')
      sent += 1
    } catch (error) {
      failed += 1
      // Release the claim so the next fire retries.
      await admin.from('saved_reports').update({ last_sent_at: r.last_sent_at ?? null }).eq('id', r.id)
      console.error('[scheduled-reports] failed', r.id, error instanceof Error ? error.message : error)
    }
  }
  return { sent, failed }
}
