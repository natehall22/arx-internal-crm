/**
 * One-page "Materials Order Sheet" PDF — emailed or handed to the supplier.
 *
 * Visual sibling of the Job Run Sheet PDF, in violet instead of magenta, so the two documents ops
 * sends are instantly tellable apart on a desk. Same hard rule: it fits on one page. Rows draw into
 * a bounded cursor and stop rather than spilling onto a second sheet a supplier will never see.
 */
import { jsPDF } from 'jspdf'

import type { JobMaterialOrderData } from '@/lib/job-material-order'

/** Deliberately loud, and deliberately not the run sheet's magenta. */
const ACCENT: [number, number, number] = [112, 0, 224]
const ACCENT_TINT: [number, number, number] = [242, 233, 255]
const INK: [number, number, number] = [44, 44, 42]
const MUTED: [number, number, number] = [107, 107, 102]
const RULE: [number, number, number] = [214, 212, 206]

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 32
const CONTENT_W = PAGE_W - MARGIN * 2
/** Nothing may draw below this — the footer owns the rest. */
const BODY_FLOOR = PAGE_H - 64

function setFill(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2])
}
function setText(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2])
}
function setDraw(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2])
}

/**
 * jsPDF's built-in Helvetica is WinAnsi-encoded, so characters outside it (notably the U+2212
 * minus that the materials list uses in "ridge 80.9 LF − 3' each end") render as garbage. Map the
 * few we actually emit down to their ASCII equivalents.
 */
function safe(value: string): string {
  return value
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
}

function formatPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

export function generateJobMaterialOrderPDF(data: JobMaterialOrderData): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })

  // ---- Masthead -------------------------------------------------------------
  setFill(doc, ACCENT)
  doc.rect(0, 0, PAGE_W, 62, 'F')

  setText(doc, [255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('MATERIALS ORDER SHEET', MARGIN, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(safe(`Job ${data.jobNumber}`), MARGIN, 44)

  const orgLine = [data.orgName, formatPhone(data.orgPhone)].filter(Boolean).join('  ·  ')
  doc.setFontSize(9)
  doc.text(safe(orgLine), PAGE_W - MARGIN, 44, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(safe(data.customerName), PAGE_W - MARGIN, 27, { align: 'right' })

  // ---- Job facts strip ------------------------------------------------------
  let y = 62
  setFill(doc, ACCENT_TINT)
  doc.rect(0, y, PAGE_W, 34, 'F')

  const printedAt = new Date(data.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  setText(doc, INK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const address = safe(data.address || '-')
  doc.text(doc.splitTextToSize(address, CONTENT_W - 180)[0] ?? '—', MARGIN, y + 14)
  doc.text(
    safe(`Proposal ${data.proposalNumber || '-'}   ·   Printed ${printedAt}`),
    MARGIN,
    y + 26
  )

  setText(doc, ACCENT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('SEND TO SUPPLIER', PAGE_W - MARGIN, y + 14, { align: 'right' })
  setText(doc, MUTED)
  doc.setFont('helvetica', 'normal')
  doc.text('Quantities from sold scope + roof measure', PAGE_W - MARGIN, y + 26, {
    align: 'right',
  })

  y += 34 + 20

  // ---- Sections -------------------------------------------------------------
  const QTY_X = PAGE_W - MARGIN
  let truncated = false

  if (data.isEmpty) {
    setText(doc, MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(
      'No measurement or sold scope on this job yet, so there is nothing to order.',
      MARGIN,
      y
    )
    doc.text('Add a roof measure in the CRM, then reprint.', MARGIN, y + 14)
    y += 34
  }

  for (const section of data.sections) {
    if (truncated) break
    if (y + 40 > BODY_FLOOR) {
      truncated = true
      break
    }

    setText(doc, ACCENT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(safe(section.title.toUpperCase()), MARGIN, y)
    y += 6
    setDraw(doc, ACCENT)
    doc.setLineWidth(1)
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 14

    for (const row of section.rows) {
      // A row needs its label line plus at least one detail line to be worth starting.
      if (y + 24 > BODY_FLOOR) {
        truncated = true
        break
      }

      setText(doc, INK)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text(safe(row.label), MARGIN, y)

      const qty = safe(row.qty || '-')
      doc.text(qty, QTY_X, y, { align: 'right' })

      // Reserve the right-hand column so a long detail never runs under the quantity.
      const qtyWidth = doc.getTextWidth(qty)
      const detailW = CONTENT_W - qtyWidth - 24
      y += 12

      const detailParts: string[] = []
      if (row.detail) detailParts.push(row.detail)
      if (row.note) detailParts.push(row.note)
      if (row.isEdited && row.computedQty) {
        detailParts.push(`Edited — CRM computed ${row.computedQty}`)
      }

      if (detailParts.length > 0) {
        setText(doc, MUTED)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        for (const part of detailParts) {
          const lines = doc.splitTextToSize(safe(part), detailW) as string[]
          for (const line of lines) {
            if (y > BODY_FLOOR) {
              truncated = true
              break
            }
            doc.text(line, MARGIN, y)
            y += 9.5
          }
          if (truncated) break
        }
      }

      y += 6
      if (y < BODY_FLOOR) {
        setDraw(doc, RULE)
        doc.setLineWidth(0.5)
        doc.line(MARGIN, y, PAGE_W - MARGIN, y)
      }
      // Clear of the rule before the next row's baseline, or the line strikes through its text.
      y += 15
      if (truncated) break
    }

    y += 12
  }

  // ---- Received-by block ----------------------------------------------------
  if (!truncated && y + 54 < BODY_FLOOR) {
    setDraw(doc, RULE)
    doc.setLineWidth(0.5)
    const lineY = y + 26
    doc.line(MARGIN, lineY, MARGIN + 200, lineY)
    doc.line(MARGIN + 224, lineY, MARGIN + 344, lineY)
    setText(doc, MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Delivered / received by', MARGIN, lineY + 11)
    doc.text('Date', MARGIN + 224, lineY + 11)
  }

  // ---- Footer ---------------------------------------------------------------
  setDraw(doc, RULE)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, PAGE_H - 46, PAGE_W - MARGIN, PAGE_H - 46)

  setText(doc, MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(
    truncated
      ? safe(`Job ${data.jobNumber} · Trimmed to one page - full list is on the job in the CRM`)
      : safe(`Job ${data.jobNumber} · Confirm counts on site before the truck leaves`),
    MARGIN,
    PAGE_H - 33
  )
  doc.text(safe(data.orgName), PAGE_W - MARGIN, PAGE_H - 33, { align: 'right' })

  return Buffer.from(doc.output('arraybuffer'))
}
