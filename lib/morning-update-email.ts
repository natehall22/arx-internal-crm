import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrgEmailBlastSettings, resolveEmailBlastRecipients } from '@/lib/admin-email-blasts'
import { fetchMorningUpdateMetrics, type MorningUpdateMetrics } from '@/lib/morning-update-metrics'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'

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

function formatGoalShareValue(
  actual: number,
  goal: number | null,
  shareOfMonthPct: number | null,
  format: 'integer' | 'currency'
): string {
  const actualText = format === 'currency' ? formatCurrency(actual) : formatInteger(actual)
  if (goal == null) {
    return `${actualText} · No goal set`
  }
  const goalText = format === 'currency' ? formatCurrency(goal) : formatInteger(goal)
  const pctText = shareOfMonthPct != null ? ` (${shareOfMonthPct}% of month)` : ''
  return `${actualText} · goal ${goalText}${pctText}`
}

const MORNING_UPDATE_FOOTER_QUOTE =
  'Yes, it is 5:30am. No, the coffee is not optional. The numbers, however, are.'

function activityLabelPrefix(kind: MorningUpdateMetrics['activityPeriodKind']): string {
  return kind === 'weekend' ? 'Weekend' : 'Yesterday'
}

function formatOptionalInteger(value: number | null): string {
  return value == null ? 'Unavailable' : formatInteger(value)
}

function metricSection(
  heading: string,
  subline: string,
  metrics: {
    doors: number
    inspections: number
    proposals: number | null
    sales: number
    revenue: number
    insurance: number
  }
): string {
  const rows = [
    { label: 'Doors knocked', value: formatInteger(metrics.doors) },
    { label: 'Inspections scheduled', value: formatInteger(metrics.inspections) },
    { label: 'Proposals shown', value: formatOptionalInteger(metrics.proposals) },
    { label: 'Sales', value: formatInteger(metrics.sales) },
    { label: 'Revenue sold', value: formatCurrency(metrics.revenue) },
    { label: 'Inspections going through insurance', value: formatInteger(metrics.insurance) },
  ]
    .map(
      (row) =>
        `<tr><td style="padding: 8px 0; color: #6B7280; width: 280px; vertical-align: top;">${escapeHtml(row.label)}</td><td style="padding: 8px 0; color: #111827; font-weight: 600; font-size: 16px;">${escapeHtml(row.value)}</td></tr>`
    )
    .join('')

  return `
    <h2 style="margin: 26px 0 4px; color: #111827; font-size: 18px;">${escapeHtml(heading)}</h2>
    <p style="margin: 0 0 8px; color: #6B7280; font-size: 13px;">${subline}</p>
    <table style="width: 100%; border-collapse: collapse; margin: 0 0 8px;">${rows}</table>
  `
}

export function buildMorningUpdateHtml(metrics: MorningUpdateMetrics, options?: { test?: boolean }): string {
  const period = activityLabelPrefix(metrics.activityPeriodKind)

  const activitySubline =
    metrics.activityPeriodKind === 'weekend'
      ? `Weekend activity (${escapeHtml(metrics.activityPeriodLabel)})`
      : `Yesterday&apos;s activity (${escapeHtml(metrics.activityPeriodLabel)})`

  let lastWeekSection = ''
  if (metrics.lastWeekVsGoals) {
    const w = metrics.lastWeekVsGoals
    const weekRows = [
      {
        label: 'Proposals shown',
        value: formatOptionalInteger(w.proposalsShown),
      },
      {
        label: 'Doors',
        value: formatGoalShareValue(w.doors.actual, w.doors.goal, w.doors.shareOfMonthPct, 'integer'),
      },
      {
        label: 'Inspections set',
        value: formatGoalShareValue(w.sets.actual, w.sets.goal, w.sets.shareOfMonthPct, 'integer'),
      },
      {
        label: 'Sales',
        value: formatGoalShareValue(w.sales.actual, w.sales.goal, w.sales.shareOfMonthPct, 'integer'),
      },
      {
        label: 'Revenue',
        value: formatGoalShareValue(
          w.revenue.actual,
          w.revenue.goal,
          w.revenue.shareOfMonthPct,
          'currency'
        ),
      },
    ]
      .map(
        (row) =>
          `<tr><td style="padding: 8px 0; color: #2c2c2a; width: 280px; vertical-align: top;">${escapeHtml(row.label)}</td><td style="padding: 8px 0; color: #2c2c2a; font-weight: 600; font-size: 15px;">${escapeHtml(row.value)}</td></tr>`
      )
      .join('')

    lastWeekSection = `
        <h2 style="margin: 28px 0 6px; color: #111827; font-size: 17px;">Last week vs ${escapeHtml(w.monthGoalLabel)} goals</h2>
        <p style="margin: 0 0 12px; color: #2c2c2a; font-size: 13px;">${escapeHtml(w.rangeLabel)} totals as a share of this month&apos;s targets</p>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 8px;">
          ${weekRows}
        </table>
      `
  }

  return `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        ${options?.test ? '<p style="margin: 0 0 16px; padding: 10px 12px; background: #fef3c7; color: #92400e; border-radius: 8px; font-size: 13px; font-weight: 600;">Test email — not sent on the daily schedule.</p>' : ''}
        <h1 style="margin: 0 0 8px; color: #111827; font-size: 22px;">ARX Morning Update</h1>
        <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 600;">${escapeHtml(metrics.sentDateLabel)}</p>
        ${metricSection(period, activitySubline, {
          doors: metrics.doorsKnockedPeriod,
          inspections: metrics.inspectionsScheduledPeriod,
          proposals: metrics.proposalsShownPeriod,
          sales: metrics.salesPeriod,
          revenue: metrics.revenuePeriod,
          insurance: metrics.insuranceInspectionsPeriod,
        })}
        ${metricSection('Week to date', 'Sunday through yesterday', {
          doors: metrics.doorsKnockedWeekToDate,
          inspections: metrics.inspectionsScheduledWeekToDate,
          proposals: metrics.proposalsShownWeekToDate,
          sales: metrics.salesWeekToDate,
          revenue: metrics.revenueWeekToDate,
          insurance: metrics.insuranceInspectionsWeekToDate,
        })}
        ${metricSection('Month to date', 'First of the month through yesterday', {
          doors: metrics.doorsKnockedMonthToDate,
          inspections: metrics.inspectionsScheduledMonthToDate,
          proposals: metrics.proposalsShownMonthToDate,
          sales: metrics.salesMonthToDate,
          revenue: metrics.revenueMonthToDate,
          insurance: metrics.insuranceInspectionsMonthToDate,
        })}
        ${lastWeekSection}
        <p style="color: #6B7280; font-size: 12px; margin-top: 20px;">
          Automated owner morning update from ARX CRM. Proposals shown is based on unique opportunities with a generated proposal PDF during the period. Revenue reflects signed installation and repair agreements. Insurance inspections are counted when feedback is recorded as Insurance Follow Up or Waiting on Insurance.
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
  const subject = `${subjectPrefix}ARX Morning Update — ${metrics.sentDateLabel}`
  const html = buildMorningUpdateHtml(metrics, { test: isTest })

  let sent = 0
  let failed = 0
  for (const to of emails) {
    try {
      await transporter.sendMail({
        from: getCrmEmailFrom(),
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
