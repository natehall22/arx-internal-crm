/**
 * "Today's sheet" PDF for one crew — the paper version of the crew phone page, for a clipboard. In stop order: customer first
 * name and address, gate / access notes, the office's notes, the services to do with empty boxes, and the amount to collect
 * if the customer owes anything. NEVER a price per service, a cost or a total: the data type has nowhere to put one.
 * Drawing kit shared with the job run sheet (lib/pdf/sheet-kit.ts); built by lib/crew-day-sheet.ts.
 */
import { jsPDF } from 'jspdf'

import { ACCENT, ACCENT_TINT, CONTENT_W, INK, MARGIN, MUTED, PAGE_H, PAGE_W, RULE, setDraw, setFill, setText, wrap } from '@/lib/pdf/sheet-kit'

export type CrewSheetVisit = {
  stop: number
  /** Customer's first name only. */
  firstName: string | null
  address: string | null
  what: string
  accessNotes: string | null
  notes: string | null
  /** Services to do (empty boxes). */
  checklist: string[]
  /** What the customer owes (the only money on the sheet), in cents; null / 0 = nothing to collect. */
  collectCents: number | null
}

export type CrewDaySheetData = { companyName: string; crewName: string; dateLabel: string; visits: CrewSheetVisit[] }

const BOX = 9
const LINE = 12.5
const HEADER_H = 58
const CONT_TOP = MARGIN + 6
const BOTTOM = PAGE_H - MARGIN

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function header(doc: jsPDF, d: CrewDaySheetData, first: boolean): number {
  if (!first) {
    setText(doc, MUTED)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(`${d.crewName}  ·  ${d.dateLabel}`, MARGIN, MARGIN)
    return CONT_TOP + 8
  }
  setFill(doc, ACCENT)
  doc.rect(0, 0, PAGE_W, HEADER_H, 'F')
  setText(doc, [255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text("TODAY'S SHEET", MARGIN, 25)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(wrap(doc, `${d.companyName}  ·  ${d.crewName}`, CONTENT_W * 0.6, 1)[0], MARGIN, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(d.dateLabel, PAGE_W - MARGIN, 25, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`${d.visits.length} visit${d.visits.length === 1 ? '' : 's'}`, PAGE_W - MARGIN, 42, { align: 'right' })
  return HEADER_H + 16
}

/** Lines a visit block needs, so a block is never split across pages. */
function measure(doc: jsPDF, v: CrewSheetVisit): { access: string[]; notes: string[]; address: string[]; rows: number; height: number } {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const address = wrap(doc, v.address ?? 'No address on file', CONTENT_W - 8, 2)
  const access = v.accessNotes ? wrap(doc, v.accessNotes, CONTENT_W - 24, 4) : []
  const notes = v.notes ? wrap(doc, v.notes, CONTENT_W - 8, 5) : []
  const rows = Math.ceil(v.checklist.length / 2)
  const height = 12 + 16 + address.length * LINE + 12 + (access.length ? access.length * 11.5 + 12 : 0) + (notes.length ? notes.length * 11.5 + 6 : 0) + (rows ? rows * 17 + 8 : 0) + (v.collectCents ? 24 : 0) + 12
  return { access, notes, address, rows, height }
}

export function generateCrewDaySheetPDF(data: CrewDaySheetData): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  let y = header(doc, data, true)
  if (data.visits.length === 0) {
    setText(doc, INK)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.text('No visits for this crew today.', MARGIN, y + 10)
  }
  for (const v of data.visits) {
    const m = measure(doc, v)
    if (y + m.height > BOTTOM) {
      doc.addPage()
      y = header(doc, data, false)
    }
    const top = y
    setDraw(doc, INK)
    doc.setLineWidth(1)
    doc.roundedRect(MARGIN, top, CONTENT_W, m.height - 6, 3, 3, 'S')
    let cy = top + 17
    setText(doc, ACCENT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(`STOP ${v.stop}`, MARGIN + 8, cy)
    setText(doc, INK)
    doc.setFontSize(13)
    doc.text(wrap(doc, `${v.firstName ?? 'Customer'}  ·  ${v.what}`, CONTENT_W - 70, 1)[0], MARGIN + 52, cy)
    cy += 15
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    for (const line of m.address) {
      doc.text(line, MARGIN + 8, cy)
      cy += LINE
    }
    cy += 2
    if (m.access.length) {
      const h = m.access.length * 11.5 + 8
      setFill(doc, ACCENT_TINT)
      doc.rect(MARGIN + 8, cy - 8, CONTENT_W - 16, h, 'F')
      setText(doc, INK)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('GATE / ACCESS:', MARGIN + 12, cy + 2)
      doc.setFont('helvetica', 'normal')
      m.access.forEach((line, i) => doc.text(line, MARGIN + 12 + (i === 0 ? 70 : 0), cy + 2 + i * 11.5))
      cy += h + 6
    }
    if (m.notes.length) {
      setText(doc, INK)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      for (const line of m.notes) {
        doc.text(line, MARGIN + 8, cy)
        cy += 11.5
      }
      cy += 6
    }
    if (m.rows) {
      const colW = (CONTENT_W - 16) / 2
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      v.checklist.forEach((label, i) => {
        const x = MARGIN + 8 + (i % 2) * colW
        const ry = cy + Math.floor(i / 2) * 17
        setDraw(doc, INK)
        doc.setLineWidth(1)
        doc.rect(x, ry - BOX + 1, BOX, BOX, 'S')
        setText(doc, INK)
        doc.text(wrap(doc, label, colW - 20, 1)[0], x + BOX + 6, ry)
      })
      cy += m.rows * 17 + 2
    }
    if (v.collectCents) {
      setDraw(doc, RULE)
      doc.setLineWidth(0.6)
      doc.line(MARGIN + 8, cy - 6, MARGIN + CONTENT_W - 8, cy - 6)
      setText(doc, INK)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text(`Customer owes ${money(v.collectCents)}`, MARGIN + 8, cy + 8)
    }
    y = top + m.height
  }
  const pages = doc.getNumberOfPages()
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      setText(doc, MUTED)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 16, { align: 'right' })
    }
  }
  return Buffer.from(doc.output('arraybuffer'))
}
