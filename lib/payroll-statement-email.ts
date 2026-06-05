import type { PayrollStatementPayload } from '@/lib/payroll-statement'
import { formatPayrollMoney } from '@/lib/payroll-format'
import {
  buildPayrollStatementPdfBuffer,
  formatNegativePayrollMoney,
  payrollStatementPdfFilename,
} from '@/lib/pdf/payroll-statement'
import { getMailTransport } from '@/lib/setter-email'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildPayrollStatementEmailUrl(periodId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
  return `${base.replace(/\/$/, '')}/commissions/statement/${periodId}`
}

export function buildPayrollStatementEmailSubject(statement: PayrollStatementPayload): string {
  return `Pay statement — ${statement.period.label} — ${formatPayrollMoney(statement.totals.netPayout)}`
}

export function buildPayrollStatementEmailHtml(input: {
  recipientName: string
  statement: PayrollStatementPayload
  statementUrl: string
  pdfAttached: boolean
}): string {
  const { recipientName, statement, statementUrl, pdfAttached } = input
  const { period, totals } = statement

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Pay period', value: period.label },
    { label: 'Pay date', value: period.payDate },
    { label: 'Net payout', value: formatPayrollMoney(totals.netPayout) },
    { label: 'Commission', value: formatPayrollMoney(totals.grossCommission) },
    { label: 'Hourly', value: formatPayrollMoney(totals.hourlyEarnings) },
  ]
  if (totals.periodUnitEarnings > 0) {
    rows.push({ label: 'Sit / sale pay', value: formatPayrollMoney(totals.periodUnitEarnings) })
  }
  rows.push({ label: 'Chargebacks', value: formatNegativePayrollMoney(totals.chargebacksApplied) })
  rows.push({ label: 'Period status', value: period.status })

  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">${escapeHtml(r.label)}</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(r.value)}</td></tr>`
    )
    .join('')

  const deficitHtml = totals.hasDeficit
    ? '<p style="color: #B91C1C; font-weight: 600;">Note: chargebacks exceed earnings this period.</p>'
    : ''

  const attachmentNote = pdfAttached
    ? 'A one-page PDF summary is attached. Use the button below for customer-level detail in the CRM.'
    : 'Use the link below to view the full breakdown in the CRM.'

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #111827;">
      <h2 style="margin: 0 0 16px;">Your pay statement</h2>
      <p style="color: #374151;">Hi ${escapeHtml(recipientName)},</p>
      <p style="color: #374151;">
        Your pay statement for <strong>${escapeHtml(period.label)}</strong> is ready.
        ${attachmentNote}
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${rowsHtml}
      </table>
      ${deficitHtml}
      <p style="margin-top: 16px;">
        <a href="${escapeHtml(statementUrl)}" style="display: inline-block; background: #4F46E5; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          View pay statement in CRM
        </a>
      </p>
      <p style="color: #6B7280; font-size: 12px; margin-top: 16px;">
        This is an automated message from ARX CRM. If you have questions, contact your manager or payroll admin.
      </p>
    </div>
  `
}

export async function sendPayrollStatementEmail(input: {
  to: string
  recipientName: string
  recipientUserId: string
  statement: PayrollStatementPayload
  attachPdf?: boolean
}): Promise<{ statementUrl: string; pdfAttached: boolean }> {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP is not configured')
  }

  const statementUrl = buildPayrollStatementEmailUrl(input.statement.period.id)
  let pdfAttached = false
  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []

  if (input.attachPdf !== false) {
    try {
      const pdfBuffer = buildPayrollStatementPdfBuffer(input.statement, { statementUrl })
      attachments.push({
        filename: payrollStatementPdfFilename(input.statement.period.label, input.recipientUserId),
        content: pdfBuffer,
        contentType: 'application/pdf',
      })
      pdfAttached = true
    } catch (err) {
      console.error('payroll statement PDF generation failed', err)
    }
  }

  const fromAddress = process.env.SMTP_FROM || 'ARX Roofing <noreply@arxroofing.com>'
  const html = buildPayrollStatementEmailHtml({
    recipientName: input.recipientName,
    statement: input.statement,
    statementUrl,
    pdfAttached,
  })

  await getMailTransport().sendMail({
    from: fromAddress,
    to: input.to,
    subject: buildPayrollStatementEmailSubject(input.statement),
    html,
    attachments,
  })

  return { statementUrl, pdfAttached }
}
