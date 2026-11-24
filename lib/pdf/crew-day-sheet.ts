/**
 * "Today's sheet" (the truck sheet) PDF for one crew — the paper version of the crew phone page, for a clipboard. First page top:
 * the office's note for the crew, the day's load list (empty boxes), the day's bed materials and machines. Then, in stop order:
 * customer first name and address, gate / access notes, the office's notes, the services to do with empty boxes, what to load for
 * that stop, its beds and machines, and the amount to collect if the customer owes anything. NEVER a price per service, per load
 * line, a cost or a total: the data type has nowhere to put one. Drawing kit shared with the job run sheet
 * (lib/pdf/sheet-kit.ts); built by lib/crew-day-sheet.ts.
 */
import { jsPDF } from 'jspdf'

import { ACCENT, ACCENT_TINT, CONTENT_W, INK, MARGIN, MUTED, PAGE_H, PAGE_W, RULE, setDraw, setFill, setText, wrap } from '@/lib/pdf/sheet-kit'

/** One thing to load: its name and how much ("Pine straw", "12"). Never a price. */
export type SheetLoadLine = { label: string; amount: string }

export type CrewSheetStop = {
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
  /** What to load for this stop (empty boxes). */
  load: SheetLoadLine[]
  /** The job's sold items could not be read: say so rather than print an empty list. */
  loadUnread: boolean
  /** Beds at this property from its newest yard measure ("est."). */
  beds: { bedSqft: number; mulchCuYd: number; strawBales: number } | null
  /** Machines this stop needs. */
  machines: string[]
}
/** Kept for older imports. */
export type CrewSheetVisit = CrewSheetStop

export type CrewDaySheetData = {
  companyName: string
  crewName: string
  dateLabel: string
  /** The office's note to the crew for the day (crew-visible by design). */
  officeNote: string | null
  /** The day's load: every stop's items added together. */
  load: SheetLoadLine[]
  /** The day's bed materials (each property once). */
  beds: { mulchCuYd: number; strawBales: number; properties: number } | null
  /** The day's machines, each once. */
  machines: string[]
  visits: CrewSheetStop[]
}

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
  doc.text(`${d.visits.length} stop${d.visits.length === 1 ? '' : 's'}`, PAGE_W - MARGIN, 42, { align: 'right' })
  return HEADER_H + 16
}

/** A list longer than a page can hold is cut with an honest last line, never silently. */
const MAX_DAY_LOAD = 60
const MAX_STOP_LOAD = 30
function capped(items: SheetLoadLine[], max: number): SheetLoadLine[] {
  if (items.length <= max) return items
  return [...items.slice(0, max - 1), { label: `… and ${items.length - max + 1} more (see the job)`, amount: '' }]
}

const bedsText = (b: { mulchCuYd: number; strawBales: number }) => `${b.mulchCuYd} cu yd mulch  ·  ${b.strawBales} bale${b.strawBales === 1 ? '' : 's'} pine straw`

/** Lines a stop block needs, so a block is never split across pages. */
function measure(doc: jsPDF, v: CrewSheetStop): { access: string[]; notes: string[]; address: string[]; rows: number; loadRows: number; extra: string[]; height: number } {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const address = wrap(doc, v.address ?? 'No address on file', CONTENT_W - 8, 2)
  const access = v.accessNotes ? wrap(doc, v.accessNotes, CONTENT_W - 24, 4) : []
  const notes = v.notes ? wrap(doc, v.notes, CONTENT_W - 8, 5) : []
  const rows = Math.ceil(v.checklist.length / 2)
  const loadRows = Math.ceil(capped(v.load, MAX_STOP_LOAD).length / 2)
  // Beds, machines and "could not read" notes: one wrapped line (or two) each, under the load boxes.
  const extra: string[] = []
  if (v.loadUnread) extra.push('Load list could not be read. Check the job before you leave.')
  if (v.beds) extra.push(`Beds (from yard measure, est.): ${bedsText(v.beds)}`)
  if (v.machines.length) extra.push(`Machines: ${v.machines.join(', ')}`)
  const extraLines = extra.flatMap((t) => wrap(doc, t, CONTENT_W - 16, 3))
  const height =
    12 + 16 + address.length * LINE + 12 + (access.length ? access.length * 11.5 + 12 : 0) + (notes.length ? notes.length * 11.5 + 6 : 0) + (rows ? rows * 17 + 8 : 0) +
    (loadRows ? 14 + loadRows * 17 + 6 : 0) + (extraLines.length ? extraLines.length * 12.5 + 8 : 0) + (v.collectCents ? 24 : 0) + 12
  return { access, notes, address, rows, loadRows, extra: extraLines, height }
}

/** Two columns of empty boxes with a label each (the load list, the day's and a stop's). Returns the height used. */
function boxes(doc: jsPDF, x: number, y: number, width: number, items: Array<{ label: string; amount?: string }>, size = 11): number {
  const colW = width / 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(size)
  items.forEach((it, i) => {
    const bx = x + (i % 2) * colW
    const ry = y + Math.floor(i / 2) * 17
    setDraw(doc, INK)
    doc.setLineWidth(1)
    if (!it.label.startsWith('…')) doc.rect(bx, ry - BOX + 1, BOX, BOX, 'S')
    setText(doc, INK)
    doc.setFont('helvetica', 'bold')
    const amt = it.amount ? `${it.amount}  ` : ''
    doc.text(amt, bx + BOX + 6, ry)
    const amtW = amt ? doc.getTextWidth(amt) : 0
    doc.setFont('helvetica', 'normal')
    doc.text(wrap(doc, it.label, colW - 20 - amtW, 1)[0], bx + BOX + 6 + amtW, ry)
  })
  return Math.ceil(items.length / 2) * 17
}

/** The top of page one: office note, the day's load list, beds and machines. Returns the new y; adds a page when it will not fit. */
function daySummary(doc: jsPDF, d: CrewDaySheetData, y: number): number {
  const note = d.officeNote ? wrap(doc, d.officeNote, CONTENT_W - 16, 12) : []
  const dayExtra: string[] = []
  if (d.beds) dayExtra.push(`Beds (from yard measure, est.): ${bedsText(d.beds)}`)
  if (d.machines.length) dayExtra.push(`Machines today: ${d.machines.join(', ')}`)
  const extra = dayExtra.flatMap((t) => wrap(doc, t, CONTENT_W - 16, 3))
  const dayLoadShown = capped(d.load, MAX_DAY_LOAD)
  const loadRows = Math.ceil(dayLoadShown.length / 2)
  if (!note.length && !d.load.length && !extra.length) return y
  let need = 4
  if (note.length) need += 20 + note.length * 12.5 + 10
  if (d.load.length) need += 18 + loadRows * 17 + 8
  if (extra.length) need += extra.length * 12.5 + 8
  if (y + need > BOTTOM) {
    doc.addPage()
    y = header(doc, d, false)
  }
  const top = y
  setDraw(doc, INK)
  doc.setLineWidth(1)
  doc.roundedRect(MARGIN, top, CONTENT_W, need - 6, 3, 3, 'S')
  let cy = top + 6
  if (note.length) {
    setFill(doc, ACCENT_TINT)
    doc.rect(MARGIN + 6, cy, CONTENT_W - 12, 20 + note.length * 12.5 + 2, 'F')
    setText(doc, INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('NOTE FROM THE OFFICE', MARGIN + 12, cy + 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    note.forEach((line, i) => doc.text(line, MARGIN + 12, cy + 27 + i * 12.5))
    cy += 20 + note.length * 12.5 + 10
  }
  if (d.load.length) {
    setText(doc, ACCENT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('LOAD LIST — TODAY', MARGIN + 8, cy + 11)
    cy += 18
    cy += boxes(doc, MARGIN + 8, cy + 8, CONTENT_W - 16, dayLoadShown) + 8
  }
  if (extra.length) {
    setText(doc, INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    extra.forEach((line, i) => doc.text(line, MARGIN + 8, cy + 10 + i * 12.5))
    cy += extra.length * 12.5 + 8
  }
  return top + need + 4
}

export function generateCrewDaySheetPDF(data: CrewDaySheetData): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  let y = header(doc, data, true)
  y = daySummary(doc, data, y)
  if (data.visits.length === 0) {
    setText(doc, INK)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.text('No stops for this crew today.', MARGIN, y + 10)
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
    if (m.loadRows) {
      setText(doc, ACCENT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.text('LOAD', MARGIN + 8, cy + 4)
      cy += 14
      cy += boxes(doc, MARGIN + 8, cy, CONTENT_W - 16, capped(v.load, MAX_STOP_LOAD)) + 6
    }
    if (m.extra.length) {
      setText(doc, INK)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      m.extra.forEach((line, i) => doc.text(line, MARGIN + 8, cy + 4 + i * 12.5))
      cy += m.extra.length * 12.5 + 8
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
