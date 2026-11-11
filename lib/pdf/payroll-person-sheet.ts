import { jsPDF } from 'jspdf'

import type { PaySheet, PaySheetColors } from '@/lib/payroll-pay-sheet'

/**
 * The pay sheet PDF: landscape letter, a header band (logo + company name, person, pay date), a bordered table (customer, address,
 * pay type, amount, running total), a highlighted total block. Colors and logo are the company's own. A preview carries a large
 * "PREVIEW - not final" mark and the day it was made; an approved week carries neither. No footer.
 */
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const dateWords = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export type Logo = { data: Uint8Array; format: 'PNG' | 'JPEG' } | null

export function buildPersonPaySheetPdf(sheet: PaySheet, input: { companyName: string; colors: PaySheetColors; logo: Logo; generatedOn: string }): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  doc.setCreationDate(new Date('2000-01-01T00:00:00Z')) // the file bytes depend only on the sheet (golden test)
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 36
  const c = { primary: rgb(input.colors.primary), accent: rgb(input.colors.accent), text: rgb(input.colors.text), light: rgb(input.colors.light) }
  const fill = (col: [number, number, number]) => doc.setFillColor(col[0], col[1], col[2])
  const ink = (col: [number, number, number]) => doc.setTextColor(col[0], col[1], col[2])

  const band = () => {
    fill(c.primary)
    doc.rect(0, 0, W, 86, 'F')
    let x = M
    if (input.logo) {
      try {
        doc.addImage(input.logo.data, input.logo.format, M, 16, 54, 54)
        x = M + 66
      } catch {
        /* a logo that will not draw leaves the name alone */
      }
    }
    ink([255, 255, 255])
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(input.companyName, x, 44)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text('Pay sheet', x, 62)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(sheet.person, W - M, 40, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text(`Pay date ${dateWords(sheet.payDate)}`, W - M, 58, { align: 'right' })
    if (sheet.preview) doc.text(`Preview made ${dateWords(input.generatedOn)}`, W - M, 74, { align: 'right' })
  }
  const cols = sheet.showMath
    ? { customer: M, address: M + 120, type: M + 290, math: M + 430, amount: W - M - 90, running: W - M }
    : { customer: M, address: M + 190, type: M + 430, math: 0, amount: W - M - 120, running: W - M }
  const head = (y: number) => {
    fill(c.light)
    doc.rect(M, y - 14, W - 2 * M, 22, 'F')
    ink(c.text)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Customer', cols.customer + 6, y)
    doc.text('Address', cols.address, y)
    doc.text('Pay type', cols.type, y)
    if (sheet.showMath) doc.text('How', cols.math, y)
    doc.text('Amount', cols.amount, y, { align: 'right' })
    doc.text('Running total', cols.running - 6, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    return y + 24
  }
  const mark = () => {
    if (!sheet.preview) return
    doc.saveGraphicsState()
    doc.setGState(doc.GState({ opacity: 0.14 }))
    ink(c.accent)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(64)
    doc.text('PREVIEW - not final', W / 2, H / 2 + 40, { align: 'center', angle: 25 })
    doc.restoreGraphicsState()
  }

  band()
  mark()
  let y = head(122)
  doc.setFontSize(10)
  doc.setDrawColor(c.accent[0], c.accent[1], c.accent[2])
  doc.setLineWidth(0.5)
  const top = y - 38
  for (const r of sheet.rows) {
    if (y > H - M - 110) {
      doc.rect(M, top, W - 2 * M, y - 12 - top)
      doc.addPage()
      mark()
      y = head(M + 20)
    }
    ink(c.text)
    doc.text(doc.splitTextToSize(r.customer, 175)[0] ?? '', cols.customer + 6, y)
    doc.text(doc.splitTextToSize(r.address, sheet.showMath ? 160 : 230)[0] ?? '', cols.address, y)
    doc.text(doc.splitTextToSize(r.payType, sheet.showMath ? 130 : 190)[0] ?? '', cols.type, y)
    if (sheet.showMath && r.math) doc.text(doc.splitTextToSize(r.math, 210)[0] ?? '', cols.math, y)
    doc.text(money(r.amount), cols.amount, y, { align: 'right' })
    doc.text(money(r.running), cols.running - 6, y, { align: 'right' })
    doc.line(M, y + 8, W - M, y + 8)
    y += 22
  }
  doc.rect(M, top, W - 2 * M, Math.max(y - 12 - top, 24))
  if (sheet.carried > 0) {
    ink(c.text)
    doc.text(`${money(sheet.carried)} is carried to next week (a check cannot go below $0).`, M + 6, y + 6)
    y += 22
  }
  // The total block
  y = Math.min(y + 18, H - M - 52)
  fill(c.primary)
  doc.rect(W - M - 300, y, 300, 46, 'F')
  ink([255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('TOTAL TO PAY', W - M - 286, y + 28)
  doc.setFontSize(20)
  doc.text(money(sheet.total), W - M - 14, y + 31, { align: 'right' })
  return Buffer.from(doc.output('arraybuffer'))
}
