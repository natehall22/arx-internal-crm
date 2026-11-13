/**
 * Shared drawing kit for the one-page printed sheets (job run sheet, crew day sheet): colours, page size, the colour
 * setters, line wrapping that marks a cut, and the bounded Column that can never spill off the page. ONE copy — a sheet
 * only adds its own header and sections (lib/pdf/job-run-sheet.ts, lib/pdf/crew-day-sheet.ts).
 */
import type { jsPDF } from 'jspdf'

/** Deliberately loud so the sheet is unmistakable on a desk or in a truck. */
export const ACCENT: [number, number, number] = [230, 0, 122]
export const ACCENT_TINT: [number, number, number] = [255, 232, 245]
export const INK: [number, number, number] = [44, 44, 42]
export const MUTED: [number, number, number] = [107, 107, 102]
export const RULE: [number, number, number] = [214, 212, 206]

export const PAGE_W = 612
export const PAGE_H = 792
export const MARGIN = 32
export const CONTENT_W = PAGE_W - MARGIN * 2

export function setFill(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2])
}
export function setText(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2])
}
export function setDraw(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2])
}

/** Wraps on width and hard-caps line count, marking the cut so nobody assumes they saw it all. */
export function wrap(doc: jsPDF, text: string, width: number, maxLines: number): string[] {
  const raw = doc.splitTextToSize(text, width) as string[]
  if (raw.length <= maxLines) return raw
  const kept = raw.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')} …`
  return kept
}

/** A bounded drawing column: everything is clipped to `bottom` so the page can never overflow. */
export class Column {
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
