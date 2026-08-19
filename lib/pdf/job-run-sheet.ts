/**
 * One-page "Job Run Sheet" PDF — printed or emailed to whoever is running the job.
 *
 * Hard requirement: it is ALWAYS exactly one page. Every section draws into a bounded
 * cursor that truncates rather than spilling, and the footer sits at a fixed y. If a job has
 * more detail than fits, the sheet shows what matters most and points back at the CRM.
 */
import { jsPDF } from 'jspdf'

import type { JobRunSheetData } from '@/lib/job-run-sheet'

/** Deliberately loud so the sheet is unmistakable on a desk or in a truck. */
const ACCENT: [number, number, number] = [230, 0, 122]
const ACCENT_TINT: [number, number, number] = [255, 232, 245]
const INK: [number, number, number] = [44, 44, 42]
const MUTED: [number, number, number] = [107, 107, 102]
const RULE: [number, number, number] = [214, 212, 206]

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 32
const CONTENT_W = PAGE_W - MARGIN * 2

const PHOTO_CHECKLIST = [
  'Before / all elevations',
  'Decking after tear-off',
  'Underlayment + I&W',
  'Flashings + pipe boots',
  'Ridge / hip cap',
  'After / all elevations',
  'Yard + gutters cleaned',
  'Magnet sweep done',
]

function setFill(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2])
}
function setText(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2])
}
function setDraw(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2])
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'NOT SCHEDULED'
  // Date-only column: noon anchor keeps it on the intended calendar day regardless of TZ.
  const d = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(d.getTime())) return 'NOT SCHEDULED'
  return d
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    })
    .toUpperCase()
}

function formatTime(time: string | null): string | null {
  if (!time) return null
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  if (!Number.isFinite(h)) return null
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${mStr ?? '00'} ${suffix}`
}

/** Wraps on width and hard-caps line count, marking the cut so nobody assumes they saw it all. */
function wrap(doc: jsPDF, text: string, width: number, maxLines: number): string[] {
  const raw = doc.splitTextToSize(text, width) as string[]
  if (raw.length <= maxLines) return raw
  const kept = raw.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')} …`
  return kept
}

/** A bounded drawing column: everything is clipped to `bottom` so the page can never overflow. */
class Column {
  /** Sections that had content but no room left on the page. */
  readonly skipped: string[] = []

  constructor(
    private doc: jsPDF,
    readonly x: number,
    readonly width: number,
    private y: number,
    private bottom: number
  ) {}

  get remaining(): number {
    return this.bottom - this.y
  }

  get cursor(): number {
    return this.y
  }

  heading(label: string): boolean {
    if (this.remaining < 24) return false
    setText(this.doc, ACCENT)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(7.5)
    this.doc.text(label.toUpperCase(), this.x, this.y)
    this.y += 3.5
    setDraw(this.doc, ACCENT)
    this.doc.setLineWidth(0.8)
    this.doc.line(this.x, this.y, this.x + this.width, this.y)
    this.y += 10
    return true
  }

  body(text: string, opts: { size?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 9
    const lineH = size + 2.5
    const maxLines = Math.max(0, Math.floor(this.remaining / lineH))
    if (maxLines === 0) return
    setText(this.doc, INK)
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    this.doc.setFontSize(size)
    for (const line of wrap(this.doc, text, this.width, maxLines)) {
      this.doc.text(line, this.x, this.y)
      this.y += lineH
    }
  }

  /**
   * Renders a section only when it has content, so empty fields never leave dead headings.
   * A section that has content but no room is recorded in {@link skipped} — dropping crew-facing
   * scope silently (gutters, decking, accessories) is exactly how a job gets built wrong.
   */
  section(label: string, text: string | null | undefined, opts: { size?: number } = {}): void {
    if (!text) return
    if (this.remaining < 30 || !this.heading(label)) {
      this.skipped.push(label)
      return
    }
    this.body(text, opts)
    this.y += 8
  }

  labelValueRows(rows: { label: string; value: string }[]): void {
    const lineH = 11.5
    setText(this.doc, INK)
    this.doc.setFontSize(8.5)
    const valueX = this.x + this.width
    for (const row of rows) {
      if (this.remaining < lineH) break
      this.doc.setFont('helvetica', 'normal')
      setText(this.doc, MUTED)
      this.doc.text(row.label, this.x, this.y)
      this.doc.setFont('helvetica', 'bold')
      setText(this.doc, INK)
      this.doc.text(row.value, valueX, this.y, { align: 'right' })
      this.y += lineH
    }
    this.y += 8
  }

  gap(n: number): void {
    this.y += n
  }
}

function drawHeader(doc: jsPDF, data: JobRunSheetData): number {
  const barH = 66
  setFill(doc, ACCENT)
  doc.rect(0, 0, PAGE_W, barH, 'F')

  setText(doc, [255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text('JOB RUN SHEET', MARGIN, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const subtitle = [data.orgName, `Job ${data.jobNumber}`, titleCase(data.jobType)].join('  ·  ')
  doc.text(subtitle, MARGIN, 41)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  const addressLines = wrap(doc, data.address, CONTENT_W * 0.6, 1)
  doc.text(addressLines[0], MARGIN, 56)

  // Right rail: the date is the single most-scanned thing on the sheet.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(formatDate(data.scheduledDate), PAGE_W - MARGIN, 30, { align: 'right' })

  const timeBits = [formatTime(data.scheduledTimeStart) ?? 'Start TBD']
  if (data.estimatedDurationHours != null) timeBits.push(`~${data.estimatedDurationHours} hr`)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(timeBits.join('  ·  '), PAGE_W - MARGIN, 45, { align: 'right' })

  doc.setFontSize(8.5)
  doc.text(`Status: ${titleCase(data.status)}`, PAGE_W - MARGIN, 57, { align: 'right' })

  return barH
}

function drawContactCards(doc: jsPDF, data: JobRunSheetData, top: number): number {
  const cards = [data.homeowner, data.runningJob, data.soldBy].filter(
    (c): c is NonNullable<typeof c> => c != null
  )
  const gutter = 10
  const cardW = (CONTENT_W - gutter * (cards.length - 1)) / cards.length
  const cardH = 50

  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + gutter)
    setFill(doc, [248, 247, 244])
    setDraw(doc, RULE)
    doc.setLineWidth(0.6)
    doc.roundedRect(x, top, cardW, cardH, 3, 3, 'FD')

    setText(doc, MUTED)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(card.label.toUpperCase(), x + 8, top + 13)

    setText(doc, INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(wrap(doc, card.name, cardW - 16, 1)[0], x + 8, top + 28)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    const phone = formatPhone(card.phone)
    if (phone) {
      doc.text(phone, x + 8, top + 42)
    } else {
      setText(doc, MUTED)
      doc.setFontSize(9)
      doc.text('No phone on file', x + 8, top + 42)
    }
  })

  return top + cardH
}

/**
 * The strip is a single line. The schedule note is 100% ops-authored (nothing computes it), so it
 * is only placed here when it genuinely fits — otherwise the caller promotes it into the
 * heads-up box rather than letting an ops instruction get clipped to an ellipsis.
 */
function drawFactStrip(
  doc: jsPDF,
  data: JobRunSheetData,
  top: number
): { bottom: number; scheduleNoteShown: boolean } {
  const facts: string[] = []
  facts.push(
    data.permitRequired
      ? `Permit: ${data.permitNumber ? `#${data.permitNumber}` : 'REQUIRED — confirm before start'}`
      : 'Permit: not required'
  )
  if (data.proposalNumber) facts.push(`Proposal ${data.proposalNumber}`)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)

  const scheduleNote = data.fields.schedule_note.value?.replace(/\s*\n\s*/g, ' ') ?? null
  let scheduleNoteShown = false
  if (scheduleNote) {
    const candidate = [...facts, scheduleNote].join('     ·     ')
    if ((doc.splitTextToSize(candidate, CONTENT_W - 16) as string[]).length === 1) {
      facts.push(scheduleNote)
      scheduleNoteShown = true
    }
  }

  const h = 18
  setFill(doc, ACCENT_TINT)
  doc.rect(MARGIN, top, CONTENT_W, h, 'F')
  setText(doc, INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(wrap(doc, facts.join('     ·     '), CONTENT_W - 16, 1)[0], MARGIN + 8, top + 12)

  return { bottom: top + h, scheduleNoteShown }
}

function drawHeadsUp(doc: jsPDF, data: JobRunSheetData, top: number, bottom: number): number {
  if (data.headsUp.length === 0 || bottom - top < 40) return top

  const padX = 10
  const innerW = CONTENT_W - padX * 2 - 4
  const boxTop = top

  // Measure first so the box is drawn behind text at exactly the right height.
  doc.setFontSize(8.5)
  const blocks: { label: string | null; lines: string[] }[] = []
  let contentH = 18 // heading
  for (const item of data.headsUp) {
    doc.setFont('helvetica', 'normal')
    const available = bottom - boxTop - contentH - 12
    const maxLines = Math.max(0, Math.floor(available / 11) - 1)
    if (maxLines <= 0) break
    const lines = wrap(doc, item.body, innerW, Math.min(maxLines, 6))
    if (lines.length === 0) continue
    blocks.push({ label: item.label, lines })
    contentH += (item.label ? 11 : 0) + lines.length * 11 + 4
  }
  if (blocks.length === 0) return top

  const boxH = Math.min(contentH + 8, bottom - boxTop)
  setFill(doc, ACCENT_TINT)
  setDraw(doc, ACCENT)
  doc.setLineWidth(1.4)
  doc.roundedRect(MARGIN, boxTop, CONTENT_W, boxH, 4, 4, 'FD')

  let y = boxTop + 15
  setText(doc, ACCENT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('READ BEFORE YOU START', MARGIN + padX, y)
  y += 14

  for (const block of blocks) {
    if (block.label) {
      setText(doc, ACCENT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(block.label.toUpperCase(), MARGIN + padX, y)
      y += 11
    }

    setText(doc, INK)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    for (const line of block.lines) {
      doc.text(line, MARGIN + padX, y)
      y += 11
    }
    y += 4
  }

  if (blocks.length < data.headsUp.length) {
    setText(doc, MUTED)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7.5)
    doc.text('More notes in the CRM — see job page.', MARGIN + padX, boxTop + boxH - 6)
  }

  return boxTop + boxH
}

/** Tells the reader when a section could not fit, so nothing is lost without a trace. */
function drawSkippedNotice(doc: jsPDF, labels: string[], top: number): number {
  if (labels.length === 0) return top
  setText(doc, ACCENT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  const text = `NO ROOM TO PRINT: ${labels.join(' · ')} — open the job page in the CRM for these.`
  doc.text(wrap(doc, text, CONTENT_W, 1)[0], MARGIN, top + 8)
  return top + 14
}

/** Fills leftover space with ruled lines so the crew can write on site instead of staring at air. */
function drawFieldNotes(doc: jsPDF, top: number, bottom: number): void {
  const height = bottom - top
  if (height < 56) return

  setText(doc, MUTED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('NOTES FROM THE FIELD (changes, extras, damage found)', MARGIN, top + 9)

  setDraw(doc, RULE)
  doc.setLineWidth(0.5)
  const lineGap = 18
  let y = top + 26
  while (y <= bottom - 4) {
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += lineGap
  }
}

function drawFooter(doc: jsPDF, data: JobRunSheetData, top: number): void {
  setDraw(doc, RULE)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, top, PAGE_W - MARGIN, top)

  let y = top + 14
  setText(doc, ACCENT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('PHOTO CHECKLIST — REQUIRED BEFORE JOB IS PAID', MARGIN, y)
  y += 12

  const cols = 4
  const colW = CONTENT_W / cols
  setText(doc, INK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  PHOTO_CHECKLIST.forEach((item, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = MARGIN + col * colW
    const itemY = y + row * 14
    setDraw(doc, INK)
    doc.setLineWidth(0.7)
    doc.rect(x, itemY - 7, 8, 8)
    doc.text(item, x + 12, itemY)
  })
  y += Math.ceil(PHOTO_CHECKLIST.length / cols) * 14 + 8

  setDraw(doc, INK)
  doc.setLineWidth(0.7)
  setText(doc, MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)

  doc.text('Crew lead', MARGIN, y + 9)
  doc.line(MARGIN + 48, y + 10, MARGIN + 230, y + 10)
  doc.text('Date', MARGIN + 250, y + 9)
  doc.line(MARGIN + 275, y + 10, MARGIN + 380, y + 10)
  doc.text('Squares installed', MARGIN + 396, y + 9)
  doc.line(MARGIN + 470, y + 10, PAGE_W - MARGIN, y + 10)

  setText(doc, MUTED)
  doc.setFontSize(7)
  const stamp = new Date(data.generatedAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })
  // Flagging ops edits keeps a printed copy honest about whether it is raw CRM data.
  const editedTag = data.anyEdits ? ' · Edited by ops' : ''
  doc.text(
    `${data.orgName}${data.orgPhone ? ` · ${formatPhone(data.orgPhone)}` : ''} · Job ${data.jobNumber} · Generated ${stamp} ET${editedTag} · Questions? Call the office before you improvise.`,
    PAGE_W / 2,
    PAGE_H - 18,
    { align: 'center' }
  )
}

export function generateJobRunSheetPDF(data: JobRunSheetData): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })

  let y = drawHeader(doc, data)
  y = drawContactCards(doc, data, y + 12)
  const strip = drawFactStrip(doc, data, y + 12)
  y = strip.bottom

  // A schedule note too long for the strip leads the heads-up box instead of being clipped.
  const scheduleNote = data.fields.schedule_note.value
  const headsUp: JobRunSheetData['headsUp'] =
    scheduleNote && !strip.scheduleNoteShown
      ? [{ label: 'Schedule', body: scheduleNote }, ...data.headsUp]
      : data.headsUp
  const sheet: JobRunSheetData = { ...data, headsUp }

  // Fixed budgets keep the sheet on one page: body columns, then heads-up, then footer.
  const footerTop = PAGE_H - 118
  const bodyTop = y + 14
  const headsUpH = headsUp.length > 0 ? 150 : 0
  const bodyBottom = footerTop - 12 - headsUpH

  const gutter = 18
  const leftW = CONTENT_W * 0.56
  const rightW = CONTENT_W - leftW - gutter

  const f = data.fields
  const left = new Column(doc, MARGIN, leftW, bodyTop, bodyBottom)
  left.section(f.scope_of_work.label, f.scope_of_work.value)
  left.section(f.materials_and_products.label, f.materials_and_products.value)
  left.section(f.tear_off_and_decking.label, f.tear_off_and_decking.value)
  left.section(f.accessories.label, f.accessories.value)

  const right = new Column(doc, MARGIN + leftW + gutter, rightW, bodyTop, bodyBottom)
  if (data.measurements.length > 0 && right.heading('Measurements')) {
    right.labelValueRows(data.measurements)
  }
  right.section(f.add_ons_sold.label, f.add_ons_sold.value, { size: 8.5 })

  // Heads-up sits directly under whichever column ran longest, not at a fixed offset —
  // otherwise a short job leaves a canyon of white space in the middle of the sheet.
  const bodyEnd = drawSkippedNotice(doc, [...left.skipped, ...right.skipped], Math.max(left.cursor, right.cursor) + 4)
  const headsUpBottom =
    headsUpH > 0 ? drawHeadsUp(doc, sheet, bodyEnd + 14, footerTop - 12) : bodyEnd

  drawFieldNotes(doc, headsUpBottom + 14, footerTop - 12)
  drawFooter(doc, data, footerTop)

  return Buffer.from(doc.output('arraybuffer'))
}
