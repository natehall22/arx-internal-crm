import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { jsPDF } from 'jspdf'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'
import { ARX_DEFAULT_OFFICE_ADDRESS } from '@/lib/company-address'
import { formatPayrollMoney } from '@/lib/payroll-format'

const COLORS = {
  navy: [30, 58, 95] as const,
  indigo: [79, 70, 229] as const,
  title: [17, 24, 39] as const,
  body: [75, 85, 99] as const,
  muted: [107, 114, 128] as const,
  border: [229, 231, 235] as const,
  headerBg: [249, 250, 251] as const,
  netBg: [238, 242, 255] as const,
  red: [185, 28, 28] as const,
  alertBg: [254, 242, 242] as const,
}

const COMPANY = {
  name: 'ARX Roofing & Exteriors',
  address: ARX_DEFAULT_OFFICE_ADDRESS,
  phone: '704-313-8834',
  email: 'info@arxroofing.com',
  logoPath: join(process.cwd(), 'public', 'brand', 'arx-shield.png'),
}

type Rgb = readonly [number, number, number]

function setTextColor(doc: jsPDF, c: Rgb) {
  doc.setTextColor(c[0], c[1], c[2])
}

function setFillColor(doc: jsPDF, c: Rgb) {
  doc.setFillColor(c[0], c[1], c[2])
}

function setDrawColor(doc: jsPDF, c: Rgb) {
  doc.setDrawColor(c[0], c[1], c[2])
}

/** ASCII hyphen-minus — avoids garbled U+2212 in Helvetica */
export function formatNegativePayrollMoney(n: number): string {
  const abs = Math.abs(Number(n) || 0)
  return `-${abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
}

function displayDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function titleCaseStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type TableCol = { key: string; title: string; width: number; align?: 'left' | 'right' }

function drawTableHeader(doc: jsPDF, x: number, y: number, cols: TableCol[], rowH: number): number {
  setFillColor(doc, COLORS.headerBg)
  setDrawColor(doc, COLORS.border)
  doc.setLineWidth(0.5)
  const totalW = cols.reduce((s, c) => s + c.width, 0)
  doc.rect(x, y, totalW, rowH, 'FD')

  let cx = x
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  setTextColor(doc, COLORS.muted)
  for (const col of cols) {
    if (col !== cols[0]) doc.line(cx, y, cx, y + rowH)
    const tx = col.align === 'right' ? cx + col.width - 8 : cx + 8
    doc.text(col.title, tx, y + 14, { align: col.align ?? 'left' })
    cx += col.width
  }
  return y + rowH
}

function drawTableRow(
  doc: jsPDF,
  x: number,
  y: number,
  cols: TableCol[],
  rowH: number,
  cells: Record<string, string>,
  opts?: { bold?: boolean; fill?: Rgb; valueColor?: Rgb; subtitle?: string }
): number {
  const totalW = cols.reduce((s, c) => s + c.width, 0)
  if (opts?.fill) {
    setFillColor(doc, opts.fill)
    doc.rect(x, y, totalW, rowH, 'F')
  }
  setDrawColor(doc, COLORS.border)
  doc.setLineWidth(0.5)
  doc.rect(x, y, totalW, rowH, 'S')

  let cx = x
  doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
  doc.setFontSize(9)
  for (const col of cols) {
    if (col !== cols[0]) doc.line(cx, y, cx, y + rowH)
    setTextColor(doc, opts?.valueColor && col.align === 'right' ? opts.valueColor : COLORS.body)
    const tx = col.align === 'right' ? cx + col.width - 8 : cx + 8
    const text = cells[col.key] ?? ''
    const clipped = doc.splitTextToSize(text, col.width - 16)[0] || text
    doc.text(clipped, tx, y + (opts?.subtitle && col.key === 'label' ? 12 : 14), {
      align: col.align ?? 'left',
    })
    cx += col.width
  }

  if (opts?.subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    setTextColor(doc, COLORS.muted)
    doc.text(opts.subtitle, x + 8, y + 22)
  }

  return y + rowH
}

function buildActivitySummary(statement: PayrollStatementPayload): string | null {
  const parts: string[] = []
  if (statement.deals.length > 0) {
    parts.push(`${statement.deals.length} commission deal${statement.deals.length === 1 ? '' : 's'}`)
  }
  if (statement.periodUnits && statement.periodUnits.total > 0) {
    const sit = statement.periodUnits.sitCount
    const sale = statement.periodUnits.saleCount
    if (sit > 0) parts.push(`${sit} sit${sit === 1 ? '' : 's'}`)
    if (sale > 0) parts.push(`${sale} sale${sale === 1 ? '' : 's'}`)
  }
  if (statement.hourly && statement.hourly.total > 0) {
    const h = statement.hourly
    parts.push(`${h.regularHours + h.overtimeHours} hourly hrs`)
  }
  if (statement.chargebacks.length > 0) {
    parts.push(`${statement.chargebacks.length} chargeback${statement.chargebacks.length === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * One-page branded pay summary for email attachment. Customer/deal detail lives in the CRM link.
 */
export function buildPayrollStatementPdfBuffer(
  statement: PayrollStatementPayload,
  opts?: { statementUrl?: string }
): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const contentW = pageW - 2 * margin
  let y = margin

  // Header: logo + company block
  if (existsSync(COMPANY.logoPath)) {
    try {
      const buf = readFileSync(COMPANY.logoPath)
      const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
      doc.addImage(dataUrl, 'PNG', margin, y, 72, 48)
    } catch {
      /* skip broken logo */
    }
  }

  const companyX = margin + 84
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  setTextColor(doc, COLORS.title)
  doc.text(COMPANY.name, companyX, y + 14)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  setTextColor(doc, COLORS.muted)
  const addressLines = doc.splitTextToSize(COMPANY.address.replace('\n', ', '), contentW - 84)
  doc.text(addressLines, companyX, y + 28)
  doc.text(`${COMPANY.phone} · ${COMPANY.email}`, companyX, y + 28 + addressLines.length * 11 + 2)
  y += 72

  setDrawColor(doc, COLORS.indigo)
  doc.setLineWidth(2)
  doc.line(margin, y, pageW - margin, y)
  y += 20

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  setTextColor(doc, COLORS.navy)
  doc.text('Pay Statement Summary', pageW / 2, y, { align: 'center' })
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  setTextColor(doc, COLORS.muted)
  doc.text('One-page earnings summary for this pay period', pageW / 2, y, { align: 'center' })
  y += 28

  // Meta card
  const metaH = 52
  setFillColor(doc, COLORS.headerBg)
  setDrawColor(doc, COLORS.border)
  doc.setLineWidth(1)
  doc.rect(margin, y, contentW, metaH, 'FD')

  const colW = contentW / 2
  const metaRows: Array<[string, string]> = [
    ['Consultant', statement.rep.name],
    ['Period', statement.period.label],
    ['Pay date', displayDate(statement.period.payDate)],
    ['Status', titleCaseStatus(statement.period.status)],
  ]
  metaRows.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const mx = margin + 12 + col * colW
    const my = y + 14 + row * 22
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    setTextColor(doc, COLORS.muted)
    doc.text(label.toUpperCase(), mx, my)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    setTextColor(doc, COLORS.title)
    doc.text(value, mx, my + 12)
  })
  y += metaH + 20

  // Net payout highlight
  const netBoxH = 56
  setFillColor(doc, COLORS.netBg)
  setDrawColor(doc, COLORS.indigo)
  doc.setLineWidth(1)
  doc.rect(margin, y, contentW, netBoxH, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  setTextColor(doc, COLORS.muted)
  doc.text('NET PAYOUT', margin + 16, y + 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  setTextColor(doc, COLORS.navy)
  doc.text(formatPayrollMoney(statement.totals.netPayout), margin + 16, y + 44)
  y += netBoxH + 20

  if (statement.totals.hasDeficit) {
    setFillColor(doc, COLORS.alertBg)
    setDrawColor(doc, COLORS.red)
    doc.setLineWidth(1)
    doc.rect(margin, y, contentW, 36, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    setTextColor(doc, COLORS.red)
    doc.text('Deficit — chargebacks exceed earnings', margin + 10, y + 14)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Net payout ${formatPayrollMoney(statement.totals.netPayout)} after ${formatNegativePayrollMoney(statement.totals.chargebacksApplied)} in chargebacks.`,
      margin + 10,
      y + 28
    )
    y += 44
  }

  // Earnings breakdown table
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  setTextColor(doc, COLORS.navy)
  doc.text('Earnings breakdown', margin, y)
  y += 16

  const summaryCols: TableCol[] = [
    { key: 'label', title: 'Category', width: contentW * 0.62, align: 'left' },
    { key: 'amount', title: 'Amount', width: contentW * 0.38, align: 'right' },
  ]
  y = drawTableHeader(doc, margin, y, summaryCols, 20)

  const summaryRows: Array<{
    label: string
    amount: string
    subtitle?: string
    red?: boolean
    bold?: boolean
    fill?: Rgb
  }> = [
    { label: 'Commission', amount: formatPayrollMoney(statement.totals.grossCommission) },
  ]

  if (statement.hourly) {
    const h = statement.hourly
    summaryRows.push({
      label: 'Hourly',
      amount: formatPayrollMoney(statement.totals.hourlyEarnings),
      subtitle:
        h.total > 0
          ? `${h.regularHours} reg + ${h.overtimeHours} OT hrs @ ${formatPayrollMoney(h.hourlyRate)}/hr`
          : undefined,
    })
  } else {
    summaryRows.push({ label: 'Hourly', amount: formatPayrollMoney(statement.totals.hourlyEarnings) })
  }

  if (statement.totals.periodUnitEarnings > 0 && statement.periodUnits) {
    const pu = statement.periodUnits
    const unitParts = pu.components
      .filter((c) => c.count > 0)
      .map((c) => `${c.count} ${c.label.toLowerCase()}`)
    summaryRows.push({
      label: 'Sit / sale pay',
      amount: formatPayrollMoney(statement.totals.periodUnitEarnings),
      subtitle: unitParts.length > 0 ? unitParts.join(', ') : undefined,
    })
  }

  summaryRows.push({
    label: 'Chargebacks',
    amount: formatNegativePayrollMoney(statement.totals.chargebacksApplied),
    red: statement.totals.chargebacksApplied > 0,
  })

  for (const row of summaryRows) {
    const rowH = row.subtitle ? 30 : 22
    y = drawTableRow(
      doc,
      margin,
      y,
      summaryCols,
      rowH,
      { label: row.label, amount: row.amount },
      { valueColor: row.red ? COLORS.red : undefined, subtitle: row.subtitle }
    )
  }
  y += 20

  const activity = buildActivitySummary(statement)
  if (activity) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    setTextColor(doc, COLORS.body)
    doc.text(`Period activity: ${activity}`, margin, y)
    y += 18
  }

  // CRM callout
  const calloutH = opts?.statementUrl ? 52 : 40
  setFillColor(doc, COLORS.headerBg)
  setDrawColor(doc, COLORS.border)
  doc.setLineWidth(1)
  doc.rect(margin, y, contentW, calloutH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  setTextColor(doc, COLORS.navy)
  doc.text('Full statement detail', margin + 12, y + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  setTextColor(doc, COLORS.body)
  const detailLines = doc.splitTextToSize(
    'Customer names, deal-level commission, sit/sale line items, and chargeback detail are available in ARX CRM using the link in your pay statement email.',
    contentW - 24
  )
  doc.text(detailLines, margin + 12, y + 30)
  if (opts?.statementUrl) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    setTextColor(doc, COLORS.indigo)
    doc.text(opts.statementUrl, margin + 12, y + calloutH - 10)
  }
  y += calloutH + 24

  // Footer
  const footerY = pageH - 40
  setDrawColor(doc, COLORS.border)
  doc.setLineWidth(0.5)
  doc.line(margin, footerY, pageW - margin, footerY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  setTextColor(doc, COLORS.muted)
  doc.text(`Generated ${displayDate(new Date().toISOString())}`, margin, footerY + 14)
  doc.text(`Confidential — for ${statement.rep.name} only. Do not distribute.`, margin, footerY + 26)

  return Buffer.from(doc.output('arraybuffer'))
}

export function payrollStatementPdfFilename(periodLabel: string, userId: string): string {
  const safeLabel = periodLabel.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'period'
  return `pay-statement-${safeLabel}-${userId.slice(0, 8)}.pdf`
}
