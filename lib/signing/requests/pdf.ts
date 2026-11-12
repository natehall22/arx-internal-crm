/**
 * PDF reading and stamping for send-any-PDF (server only). The signed copy is the ORIGINAL bytes with the signers' marks
 * drawn on top (pdf-lib, no re-layout), so what the customer read is exactly what they signed.
 */
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import { LIMITS, type FieldValue, type PlacedField } from '@/lib/signing/requests/types'

export type PdfInfo = { pageCount: number; pages: Array<{ width: number; height: number; rotation: 0 | 90 | 180 | 270 }> }
export type PdfInfoResult = { ok: true; info: PdfInfo } | { ok: false; error: string }

export async function readPdfInfo(bytes: Uint8Array): Promise<PdfInfoResult> {
  if (bytes.byteLength === 0) return { ok: false, error: 'That file is empty' }
  if (bytes.byteLength > LIMITS.maxPdfBytes) return { ok: false, error: `That PDF is larger than ${Math.round(LIMITS.maxPdfBytes / 1048576)} MB` }
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1')
  if (!head.includes('%PDF-')) return { ok: false, error: 'That does not look like a PDF' }
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    const pages = doc.getPages().map((p) => {
      const { width, height } = p.getSize()
      const r = ((p.getRotation().angle % 360) + 360) % 360
      return { width, height, rotation: (r === 90 || r === 180 || r === 270 ? r : 0) as 0 | 90 | 180 | 270 }
    })
    if (pages.length === 0) return { ok: false, error: 'That PDF has no pages' }
    if (pages.length > LIMITS.maxPages) return { ok: false, error: `That PDF has more than ${LIMITS.maxPages} pages` }
    return { ok: true, info: { pageCount: pages.length, pages } }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/encrypt/i.test(msg)) return { ok: false, error: 'That PDF is password protected. Save an unlocked copy and try again.' }
    return { ok: false, error: 'That PDF could not be read. Try printing it to a new PDF.' }
  }
}

/**
 * A box given as fractions of the DISPLAYED page (top-left origin, what the signer sees) -> the point to draw at in the PDF's
 * own coordinates (bottom-left origin, before /Rotate). The anchor is the box's visual bottom-left; content drawn there with
 * `rotate: degrees(rotation)` reads upright on screen for every page rotation.
 */
export function anchorFor(page: { width: number; height: number; rotation: 0 | 90 | 180 | 270; x0?: number; y0?: number }, box: { x: number; y: number; w: number; h: number }) {
  const W = page.width
  const H = page.height
  const visW = page.rotation === 90 || page.rotation === 270 ? H : W
  const visH = page.rotation === 90 || page.rotation === 270 ? W : H
  const vx = box.x * visW
  const vyBottom = (box.y + box.h) * visH
  const vw = box.w * visW
  const vh = box.h * visH
  let ux: number
  let uy: number
  switch (page.rotation) {
    case 90: ux = vyBottom; uy = vx; break
    case 180: ux = W - vx; uy = vyBottom; break
    case 270: ux = W - vyBottom; uy = H - vx; break
    default: ux = vx; uy = H - vyBottom
  }
  return { x: ux + (page.x0 ?? 0), y: uy + (page.y0 ?? 0), width: vw, height: vh, rotate: degrees(page.rotation) }
}

/** Helvetica / Times only encode Latin-1ish text: anything else becomes "?" instead of failing the whole signing. */
export function safeText(font: PDFFont, s: string): string {
  const set = new Set(font.getCharacterSet())
  return Array.from(s.replace(/[\r\n\t]+/g, ' ')).map((ch) => (set.has(ch.codePointAt(0) as number) ? ch : '?')).join('')
}

export type StampSigner = { role_key: string; signature_data: string | null; initials_data: string | null; name: string }
export type StampField = PlacedField & { value: FieldValue }

const INK = rgb(0.07, 0.09, 0.15)

async function drawMark(doc: PDFDocument, page: PDFPage, geo: ReturnType<typeof anchorFor>, mark: string, fonts: { script: PDFFont; sans: PDFFont }) {
  if (mark.startsWith('typed:')) {
    const text = safeText(fonts.script, mark.slice(6).trim())
    let size = Math.min(geo.height * 0.75, 26)
    const wAt = (s: number) => fonts.script.widthOfTextAtSize(text, s)
    while (size > 6 && wAt(size) > geo.width) size -= 0.5
    page.drawText(text, { x: geo.x, y: geo.y + geo.height * 0.2, size, font: fonts.script, color: INK, rotate: geo.rotate })
    return
  }
  const m = /^data:image\/png;base64,(.+)$/.exec(mark)
  if (!m) return
  const img = await doc.embedPng(Buffer.from(m[1], 'base64'))
  const scale = Math.min(geo.width / img.width, geo.height / img.height)
  page.drawImage(img, { x: geo.x, y: geo.y, width: img.width * scale, height: img.height * scale, rotate: geo.rotate })
}

/** The signed PDF: the original with every filled field drawn on it. */
export async function stampSignedPdf(source: Uint8Array, fields: readonly StampField[], signers: readonly StampSigner[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { updateMetadata: false })
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const pages = doc.getPages()
  const bySigner = new Map(signers.map((s) => [s.role_key, s]))
  for (const f of fields) {
    const page = pages[f.page]
    if (!page) continue
    const { width, height } = page.getSize()
    const r = ((page.getRotation().angle % 360) + 360) % 360
    const geo = anchorFor({ width, height, rotation: (r === 90 || r === 180 || r === 270 ? r : 0) as 0 | 90 | 180 | 270 }, f)
    const signer = bySigner.get(f.roleKey)
    if (f.kind === 'signature' || f.kind === 'initials') {
      const mark = f.kind === 'signature' ? signer?.signature_data : signer?.initials_data
      if (mark) await drawMark(doc, page, geo, mark, { script, sans })
      continue
    }
    if (f.kind === 'checkbox') {
      if (f.value === true) {
        const s = Math.min(geo.width, geo.height)
        // A check mark made of two strokes (the standard fonts have no tick glyph), drawn in the displayed orientation.
        const pt = (fx: number, fy: number) => anchorFor({ width, height, rotation: (r === 90 || r === 180 || r === 270 ? r : 0) as 0 | 90 | 180 | 270 }, { x: f.x + fx * f.w, y: f.y + fy * f.h, w: 0, h: 0 })
        const a = pt(0.15, 0.55), b = pt(0.4, 0.85), c = pt(0.85, 0.15)
        page.drawLine({ start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, thickness: Math.max(1, s * 0.12), color: INK })
        page.drawLine({ start: { x: b.x, y: b.y }, end: { x: c.x, y: c.y }, thickness: Math.max(1, s * 0.12), color: INK })
      }
      continue
    }
    const raw = f.kind === 'name' ? String(f.value || signer?.name || '') : String(f.value ?? '')
    if (!raw.trim()) continue
    const text = safeText(sans, raw.trim())
    let size = Math.min(geo.height * 0.72, 12)
    while (size > 5 && sans.widthOfTextAtSize(text, size) > geo.width) size -= 0.5
    page.drawText(text, { x: geo.x, y: geo.y + geo.height * 0.25, size, font: sans, color: INK, rotate: geo.rotate })
  }
  doc.setProducer('Signed copy')
  return doc.save({ useObjectStreams: false })
}
