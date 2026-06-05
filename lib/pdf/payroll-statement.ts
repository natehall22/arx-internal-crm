import { jsPDF } from 'jspdf'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'
import { formatParticipantRoleLabel, formatPayrollMoney } from '@/lib/payroll-format'

/**
 * Server-only PDF (jsPDF). Mirrors PayrollStatementView sections without react-pdf in route handlers.
 */
export function buildPayrollStatementPdfBuffer(statement: PayrollStatementPayload): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 48
  const pageW = doc.internal.pageSize.getWidth()
  const contentW = pageW - 2 * margin
  let y = margin

  const ensureSpace = (needed: number) => {
    const pageH = doc.internal.pageSize.getHeight()
    if (y + needed > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Pay Statement', margin, y)
  y += 24

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`Rep: ${statement.rep.name}`, margin, y)
  y += 16
  doc.text(`Period: ${statement.period.label} — Pay date ${statement.period.payDate}`, margin, y)
  y += 24

  const summaryRows: Array<[string, string, boolean?]> = [
    ['Net payout', formatPayrollMoney(statement.totals.netPayout), true],
    ['Commission', formatPayrollMoney(statement.totals.grossCommission)],
    ['Hourly', formatPayrollMoney(statement.totals.hourlyEarnings)],
  ]
  if (statement.totals.periodUnitEarnings > 0) {
    summaryRows.push(['Sit / sale pay', formatPayrollMoney(statement.totals.periodUnitEarnings)])
  }
  summaryRows.push(['Chargebacks', `−${formatPayrollMoney(statement.totals.chargebacksApplied)}`])

  for (const [label, value, bold] of summaryRows) {
    ensureSpace(16)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(`${label}: ${value}`, margin, y)
    y += 16
  }

  if (statement.totals.hasDeficit) {
    ensureSpace(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(185, 28, 28)
    doc.text('Note: chargebacks exceed earnings this period.', margin, y)
    doc.setTextColor(0, 0, 0)
    y += 20
  } else {
    y += 8
  }

  if (statement.periodUnits?.lines?.length) {
    ensureSpace(24)
    doc.setFont('helvetica', 'bold')
    doc.text('Sit & sale pay', margin, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    for (const line of statement.periodUnits.lines) {
      ensureSpace(14)
      const text = `${line.customerName} — ${line.payTypeLabel} — ${line.eventDate || '—'} — ${formatPayrollMoney(line.amount)}`
      const wrapped = doc.splitTextToSize(text, contentW)
      doc.text(wrapped, margin, y)
      y += wrapped.length * 12
    }
    y += 8
    doc.setFontSize(11)
  }

  if (statement.hourly) {
    ensureSpace(24)
    doc.setFont('helvetica', 'bold')
    doc.text('Hourly earnings', margin, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    const h = statement.hourly
    doc.text(
      `Regular: ${h.regularHours} hrs × ${formatPayrollMoney(h.hourlyRate)} = ${formatPayrollMoney(h.regularEarnings)}`,
      margin,
      y
    )
    y += 14
    doc.text(
      `Overtime: ${h.overtimeHours} hrs × ${formatPayrollMoney(h.hourlyRate * 1.5)} = ${formatPayrollMoney(h.overtimeEarnings)}`,
      margin,
      y
    )
    y += 14
    doc.setFont('helvetica', 'bold')
    doc.text(`Subtotal: ${formatPayrollMoney(h.total)}`, margin, y)
    y += 20
    doc.setFont('helvetica', 'normal')
  }

  if (statement.deals.length > 0) {
    ensureSpace(24)
    doc.setFont('helvetica', 'bold')
    doc.text('Deals', margin, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    for (const d of statement.deals) {
      ensureSpace(14)
      const job = d.jobNumber ? ` (${d.jobNumber})` : ''
      const text = `${d.customerName || '—'}${job} — ${formatParticipantRoleLabel(d.role)} — ${formatPayrollMoney(d.dealTotal)}`
      const wrapped = doc.splitTextToSize(text, contentW)
      doc.text(wrapped, margin, y)
      y += wrapped.length * 12
    }
  }

  return Buffer.from(doc.output('arraybuffer'))
}

export function payrollStatementPdfFilename(periodLabel: string, userId: string): string {
  const safeLabel = periodLabel.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'period'
  return `pay-statement-${safeLabel}-${userId.slice(0, 8)}.pdf`
}
