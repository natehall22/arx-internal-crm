import { createHash } from 'crypto'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'
import { formatPayrollMoney } from '@/lib/payroll-format'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Stable hash for resend tracking / idempotency comparison. */
export function computeStatementHash(statement: PayrollStatementPayload): string {
  const canonical = {
    periodId: statement.period.id,
    mode: statement.mode,
    netPayout: statement.totals.netPayout,
    grossCommission: statement.totals.grossCommission,
    hourlyEarnings: statement.totals.hourlyEarnings,
    chargebacksApplied: statement.totals.chargebacksApplied,
    deals: statement.deals
      .map((d) => ({
        jobId: d.jobId,
        role: d.role,
        grossAmount: d.grossAmount,
        dealTotal: d.dealTotal,
      }))
      .sort((a, b) => `${a.jobId}|${a.role}`.localeCompare(`${b.jobId}|${b.role}`)),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function payrollStatementEmailSubject(statement: PayrollStatementPayload): string {
  const kind = statement.mode === 'final' ? 'Pay statement' : 'Pay statement (estimate)'
  return `${kind} — ${statement.period.label}`
}

export function renderPayrollStatementEmailHtml(input: {
  statement: PayrollStatementPayload
  statementUrl: string
}): string {
  const { statement, statementUrl } = input
  const { rep, period, totals, mode, dataFreshnessNote } = statement

  const bannerTitle = mode === 'final' ? 'Official pay statement' : 'Estimated pay statement'
  const bannerBg = mode === 'final' ? '#EEF2FF' : '#FFFBEB'
  const bannerBorder = mode === 'final' ? '#C7D2FE' : '#FDE68A'
  const bannerText = mode === 'final' ? '#312E81' : '#92400E'

  const disclaimer =
    mode === 'final'
      ? 'This is your official pay statement for the period below. It is not the dashboard “estimated pay this week” number (that uses a different calculation).'
      : 'This period is not locked yet — amounts may change. Do not treat this as final pay. Dashboard weekly estimates use a separate system.'

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #111827;">
      <div style="border: 1px solid ${bannerBorder}; background: ${bannerBg}; color: ${bannerText}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px; font-size: 18px; font-weight: bold;">${escapeHtml(bannerTitle)}</p>
        <p style="margin: 0; font-size: 14px;">${escapeHtml(dataFreshnessNote)}</p>
      </div>
      <p style="font-size: 15px;">Hi ${escapeHtml(rep.name)},</p>
      <p style="font-size: 14px; color: #374151;">Your pay summary for <strong>${escapeHtml(period.label)}</strong> (pay date ${escapeHtml(period.payDate)}):</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #6B7280; width: 160px;">Net payout</td>
          <td style="padding: 8px 0; font-size: 20px; font-weight: bold;">${escapeHtml(formatPayrollMoney(totals.netPayout))}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7280;">Commission (gross)</td>
          <td style="padding: 8px 0;">${escapeHtml(formatPayrollMoney(totals.grossCommission))}</td>
        </tr>
        ${
          totals.hourlyEarnings > 0
            ? `<tr>
          <td style="padding: 8px 0; color: #6B7280;">Hourly pay</td>
          <td style="padding: 8px 0;">${escapeHtml(formatPayrollMoney(totals.hourlyEarnings))}</td>
        </tr>`
            : ''
        }
        ${
          totals.chargebacksApplied > 0
            ? `<tr>
          <td style="padding: 8px 0; color: #6B7280;">Chargebacks</td>
          <td style="padding: 8px 0; color: #B91C1C;">−${escapeHtml(formatPayrollMoney(totals.chargebacksApplied))}</td>
        </tr>`
            : ''
        }
      </table>
      <p style="margin: 20px 0;">
        <a href="${escapeHtml(statementUrl)}" style="display: inline-block; background: #4F46E5; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;">View full statement</a>
      </p>
      <p style="font-size: 12px; color: #6B7280; line-height: 1.5;">${escapeHtml(disclaimer)}</p>
      <p style="font-size: 12px; color: #9CA3AF; margin-top: 16px;">Open the link above for deal-by-deal breakdown, hourly details, and chargebacks. Automated message from ARX CRM — do not reply.</p>
    </div>
  `.trim()
}

export function resolvePayrollStatementUrl(appUrl: string, periodId: string): string {
  const base = appUrl.replace(/\/$/, '')
  return `${base}/commissions/statement/${periodId}`
}
