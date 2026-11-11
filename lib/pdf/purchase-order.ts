/**
 * Purchase order PDF for any vendor or subcontractor (a general PO). Visual sibling of the materials order sheet
 * (lib/pdf/job-material-order.ts — untouched; roofing material orders still print from it), same palette and
 * masthead, but a priced table that may run over several pages (a vendor must see every line, so nothing is trimmed).
 */
import { jsPDF } from 'jspdf'

import { formatDeliveryDate } from '@/lib/material-sourcing'
import { formatMoney, formatQuantity, lineTotalCents } from '@/lib/purchase-orders'

const ACCENT: [number, number, number] = [112, 0, 224]
const ACCENT_TINT: [number, number, number] = [242, 233, 255]
const INK: [number, number, number] = [44, 44, 42]
const MUTED: [number, number, number] = [107, 107, 102]
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 32
const CONTENT_W = PAGE_W - MARGIN * 2
const FLOOR = PAGE_H - 56

export type PurchaseOrderPdfData = {
  heading: string // "PO 26-0141-B", "REVISED PO …", "CANCEL PO …"
  orgName: string
  orgPhone: string | null
  vendorName: string
  accountNumber: string | null
  contactName: string | null
  /** Job number (or visit number) this is for. */
  reference: string | null
  customerName: string | null
  dateKind: 'delivery' | 'start'
  date: string | null
  address: string | null
  note: string | null
  changes: string[]
  lines: { description: string; quantity: number; unit: string | null; unitCostCents: number; costCode: string | null }[]
  /** Show prices (a PO to a vendor does). */
  generatedAt: string
}

const safe = (v: string) =>
  v
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '')

function phone(p: string | null): string | null {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p
}

export function renderPurchaseOrderPDF(data: PurchaseOrderPdfData): { pdf: Buffer; pages: number } {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])

  // Masthead
  fill(ACCENT)
  doc.rect(0, 0, PAGE_W, 62, 'F')
  ink([255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(safe(data.heading.toUpperCase()), MARGIN, 27)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(safe(data.reference ? `Job ${data.reference}` : 'Purchase order'), MARGIN, 44)
  doc.setFontSize(9)
  doc.text(safe([data.orgName, phone(data.orgPhone)].filter(Boolean).join('  ·  ')), PAGE_W - MARGIN, 44, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(safe(data.customerName ?? ''), PAGE_W - MARGIN, 27, { align: 'right' })

  // Vendor strip
  fill(ACCENT_TINT)
  doc.rect(0, 62, PAGE_W, 34, 'F')
  ink(INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(safe(`To: ${data.vendorName}`), MARGIN, 76)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(safe([data.contactName ? `Attn ${data.contactName}` : null, data.accountNumber ? `Acct ${data.accountNumber}` : null].filter(Boolean).join('  ·  ') || ' '), MARGIN, 89)
  const printed = new Date(data.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  ink(MUTED)
  doc.text(`Printed ${printed}`, PAGE_W - MARGIN, 76, { align: 'right' })

  let y = 120
  const block = (label: string, body: string | null, bold = false) => {
    if (!body) return
    ink(ACCENT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(label, MARGIN, y)
    ink(INK)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(10)
    const wrapped = doc.splitTextToSize(safe(body), CONTENT_W - 110) as string[]
    wrapped.forEach((line, i) => doc.text(line, MARGIN + 110, y + i * 12))
    y += wrapped.length * 12 + 6
  }
  block(data.dateKind === 'start' ? 'START ON' : 'DELIVER ON', formatDeliveryDate(data.date), true)
  block(data.dateKind === 'start' ? 'WORK AT' : 'DELIVER TO', data.address)
  block('NOTE', data.note)
  if (data.changes.length > 0) {
    block('WHAT CHANGED', data.changes.map((c) => `- ${c}`).join('\n'))
  }
  y += 8

  const colQty = PAGE_W - MARGIN - 180
  const colUnit = PAGE_W - MARGIN - 90
  const colTotal = PAGE_W - MARGIN
  const header = () => {
    ink(ACCENT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('ITEM', MARGIN, y)
    doc.text('QTY', colQty, y, { align: 'right' })
    doc.text('EACH', colUnit, y, { align: 'right' })
    doc.text('TOTAL', colTotal, y, { align: 'right' })
    y += 5
    doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.setLineWidth(1)
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 13
  }
  header()

  let total = 0
  for (const l of data.lines) {
    const desc = doc.splitTextToSize(safe(l.description + (l.costCode ? `  [${l.costCode}]` : '')), colQty - MARGIN - 70) as string[]
    const need = desc.length * 12 + 6
    if (y + need > FLOOR) {
      doc.addPage()
      y = 48
      header()
    }
    const lineTotal = lineTotalCents(l.quantity, l.unitCostCents)
    total += lineTotal
    ink(INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    desc.forEach((line, i) => doc.text(line, MARGIN, y + i * 12))
    doc.setFont('helvetica', 'normal')
    doc.text(safe(`${formatQuantity(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`), colQty, y, { align: 'right' })
    doc.text(l.unitCostCents > 0 ? formatMoney(l.unitCostCents) : '-', colUnit, y, { align: 'right' })
    doc.text(l.unitCostCents > 0 ? formatMoney(lineTotal) : '-', colTotal, y, { align: 'right' })
    y += need
  }

  if (y + 40 > FLOOR) {
    doc.addPage()
    y = 48
  }
  y += 4
  doc.setDrawColor(INK[0], INK[1], INK[2])
  doc.setLineWidth(0.5)
  doc.line(colUnit - 60, y, PAGE_W - MARGIN, y)
  y += 16
  ink(INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('TOTAL', colUnit - 60, y)
  doc.text(formatMoney(total), colTotal, y, { align: 'right' })

  // Page numbers (no filler footer; only when it runs long)
  const pages = doc.getNumberOfPages()
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      ink(MUTED)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 24, { align: 'right' })
    }
  }
  return { pdf: Buffer.from(doc.output('arraybuffer')), pages }
}
