import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrgEmailBlastSettings, resolveEmailBlastRecipients } from '@/lib/admin-email-blasts'
import { fetchMorningUpdateMetrics, type MorningUpdateMetrics } from '@/lib/morning-update-metrics'
import { getMailTransport } from '@/lib/setter-email'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-US')
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

const MORNING_UPDATE_FOOTER_QUOTE =
  'Yes, it is 5:30am. No, the coffee is not optional. The numbers, however, are.'

function buildMorningUpdateHtml(metrics: MorningUpdateMetrics, options?: { test?: boolean }): string {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Doors Knocked Yesterday', value: formatInteger(metrics.doorsKnockedYesterday) },
    { label: 'Doors Knocked Month To Date', value: formatInteger(metrics.doorsKnockedMonthToDate) },
    {
      label: 'Total Inspections Scheduled Yesterday',
      value: formatInteger(metrics.inspectionsScheduledYesterday),
    },
    {
      label: 'Total Inspections Scheduled Month To Date',
      value: formatInteger(metrics.inspectionsScheduledMonthToDate),
    },
    { label: 'Sales Yesterday', value: formatInteger(metrics.salesYesterday) },
    { label: 'Total Sales This Month', value: formatInteger(metrics.salesMonthToDate) },
    { label: 'Total Revenue Sold Last Month', value: formatCurrency(metrics.revenueLastMonth) },
    { label: 'Total Revenue Sold This Month', value: formatCurrency(metrics.revenueMonthToDate) },
    { label: 'Total Revenue Sold This Year', value: formatCurrency(metrics.revenueYearToDate) },
    {
      label: 'Inspections Going Through Insurance Last Month',
      value: formatInteger(metrics.insuranceInspectionsLastMonth),
    },
    {
      label: 'Inspections Going Through Insurance This Month',
      value: formatInteger(metrics.insuranceInspectionsMonthToDate),
    },
  ]

  const tableRows = rows
    .map(
      (row) =>
        `<tr><td style="padding: 10px 0; color: #6B7280; width: 280px; vertical-align: top;">${escapeHtml(row.label)}</td><td style="padding: 10px 0; color: #111827; font-weight: 600; font-size: 16px;">${escapeHtml(row.value)}</td></tr>`
    )
    .join('')

  return `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        ${options?.test ? '<p style="margin: 0 0 16px; padding: 10px 12px; background: #fef3c7; color: #92400e; border-radius: 8px; font-size: 13px; font-weight: 600;">Test email — not sent on the daily schedule.</p>' : ''}
        <h1 style="margin: 0 0 8px; color: #111827; font-size: 22px;">ARX Morning Update</h1>
        <p style="margin: 0 0 20px; color: #6B7280; font-size: 14px;">${escapeHtml(metrics.reportDateLabel)}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          ${tableRows}
        </table>
        <p style="color: #6B7280; font-size: 12px; margin-top: 20px;">
          Automated owner morning update from ARX CRM. Revenue reflects signed installation and repair agreements. Insurance inspections are counted when feedback is recorded as Insurance Follow Up or Waiting on Insurance.
        </p>
        <p style="color: #9CA3AF; font-size: 12px; font-style: italic; margin: 12px 0 0;">
          ${escapeHtml(MORNING_UPDATE_FOOTER_QUOTE)}
        </p>
      </div>
    `
}

export async function sendMorningUpdateEmail(
  supabase: SupabaseClient,
  params: {
    orgId: string
    metrics?: MorningUpdateMetrics
    /** Bypasses blast settings; sends only to these addresses with a [TEST] subject prefix. */
    testToEmails?: string[]
  }
): Promise<{ sent: number; skipped: boolean; reason?: string }> {
  if (!process.env.SMTP_HOST) {
    return { sent: 0, skipped: true, reason: 'smtp_not_configured' }
  }

  const isTest = Array.isArray(params.testToEmails) && params.testToEmails.length > 0
  let emails: string[] = []

  if (isTest) {
    emails = Array.from(
      new Set(
        params.testToEmails!
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.includes('@'))
      )
    )
  } else {
    const { data: orgRow, error: orgError } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', params.orgId)
      .maybeSingle()

    if (orgError) {
      console.error('sendMorningUpdateEmail: org settings query', orgError)
      throw orgError
    }

    const settings = getOrgEmailBlastSettings(orgRow?.settings)
    const resolved = await resolveEmailBlastRecipients(supabase, {
      orgId: params.orgId,
      blastType: 'morning_update',
      settings,
    })
    emails = resolved.emails
  }

  if (emails.length === 0) {
    return { sent: 0, skipped: true, reason: 'no_recipients' }
  }

  const metrics = params.metrics ?? (await fetchMorningUpdateMetrics(supabase, params.orgId))
  const transporter = getMailTransport()
  const subjectPrefix = isTest ? '[TEST] ' : ''
  const subject = `${subjectPrefix}ARX Morning Update — ${metrics.reportDateLabel}`
  const html = buildMorningUpdateHtml(metrics, { test: isTest })

  let sent = 0
  let failed = 0
  for (const to of emails) {
    try {
      await transporter.sendMail({
        from: 'info@arxroofing.com',
        to,
        subject,
        html,
      })
      sent += 1
    } catch (error) {
      failed += 1
      console.error('sendMorningUpdateEmail: send failed', to, error)
    }
  }

  if (sent === 0) {
    return { sent: 0, skipped: true, reason: failed > 0 ? 'send_failed' : 'no_recipients' }
  }

  return { sent, skipped: false }
}
