/**
 * ARX roof inspection report PDF engine.
 *
 * Direct port of the standalone ARX Roof Report Builder's pdf-lib renderer (charcoal/gold
 * brand format: cover, optional summary page, section dividers, one photo per page with
 * caption). Pure — takes a ReportDoc plus a photo-byte provider, returns PDF bytes.
 * Runs in the browser (builder) and would run in Node unchanged.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { ReportDoc, ReportSection } from './types'

const HEX = (h: string) =>
  rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)

const C = {
  charcoal: HEX('2B2A28'),
  infobox: HEX('34332F'),
  gold: HEX('B0904E'),
  cream: HEX('F4ECDC'),
  creamfill: HEX('F1E9D7'),
  body: HEX('333333'),
  footer: HEX('8A8A8A'),
  rule: HEX('D9D2C3'),
  white: rgb(1, 1, 1),
}

const PW = 612
const PH = 792
const COVER_LOGO_W = 150
const COVER_LOGO_H = 103 // 600×411 logo asset (~24% page width)
const COVER_LOGO_DY = COVER_LOGO_H - 30

// The standard PDF fonts (Helvetica) encode WinAnsi/CP1252 only. If a rep pastes an emoji or
// other non-Latin character into a caption, pdf-lib throws and generation fails. S() keeps the
// report safe to generate AND correct in any recipient's viewer by limiting text to characters
// the embedded font can actually render. Smart quotes / dashes / bullet / ellipsis are kept.
const WINANSI_EXTRA = new Set(
  Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ').map((c) => c.codePointAt(0) as number)
)
function S(t: unknown): string {
  if (t == null) return ''
  let out = ''
  for (const ch of String(t)) {
    const cp = ch.codePointAt(0) as number
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) { out += ' '; continue }
    if (cp >= 0x20 && cp <= 0x7e) { out += ch; continue }
    if (cp >= 0xa0 && cp <= 0xff) { out += ch; continue }
    if (WINANSI_EXTRA.has(cp)) { out += ch; continue }
    if (cp === 0x2026) { out += '...'; continue }
    if (cp === 0x00a0) { out += ' '; continue }
    if (cp === 0x2018 || cp === 0x2019 || cp === 0x2032) { out += "'"; continue }
    if (cp === 0x201c || cp === 0x201d || cp === 0x2033) { out += '"'; continue }
    if (cp === 0x2013 || cp === 0x2014) { out += '-'; continue }
    if (cp === 0x2022 || cp === 0x25cf) { out += '*'; continue }
    // anything else (emoji, CJK, symbols) is dropped so generation never fails
  }
  return out.replace(/  +/g, ' ').trim()
}

function splitLines(t: unknown): string[] {
  return String(t || '').split(/\r?\n/).map((l) => S(l)).filter(Boolean)
}

function wrapParagraph(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = S(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (font.widthOfTextAtSize(t, size) <= maxW) cur = t
    else {
      if (cur) lines.push(cur)
      if (font.widthOfTextAtSize(w, size) > maxW) {
        let chunk = ''
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= maxW) chunk += ch
          else { lines.push(chunk); chunk = ch }
        }
        cur = chunk
      } else cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function wrapText(text: unknown, font: PDFFont, size: number, maxW: number): string[] {
  const lines: string[] = []
  for (const para of String(text || '').split(/\r?\n/)) {
    if (!S(para)) continue
    lines.push(...wrapParagraph(para, font, size, maxW))
  }
  return lines
}

interface Fonts {
  reg: PDFFont
  bold: PDFFont
  obl: PDFFont
  logo: PDFImage | null
}

function drawCentered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  text = S(text)
  if (!text) return
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: (PW - w) / 2, y, size, font, color })
}

function drawCenteredBlock(page: PDFPage, text: string, baseY: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>, lineGap: number) {
  const lines = splitLines(text)
  if (!lines.length) return
  lines.forEach((ln, i) => {
    drawCentered(page, ln, baseY + (lines.length - 1 - i) * lineGap, font, size, color)
  })
}

function drawRight(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  text = S(text)
  if (!text) return
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: x - w, y, size, font, color })
}

function drawLogo(page: PDFPage, x: number, y: number, w: number, h: number, fonts: Fonts) {
  if (fonts.logo) {
    const ir = fonts.logo.width / fonts.logo.height
    const br = w / h
    let dw: number, dh: number
    if (ir > br) { dw = w; dh = w / ir } else { dh = h; dw = dh * ir }
    page.drawImage(fonts.logo, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh })
  } else {
    // fallback wordmark "ARX" sized to box, cream on charcoal
    const f = fonts.bold
    let size = h * 0.9
    while (f.widthOfTextAtSize('ARX', size) > w && size > 6) size -= 0.5
    const tw = f.widthOfTextAtSize('ARX', size)
    page.drawText('ARX', { x: x + (w - tw) / 2, y: y + (h - size * 0.72) / 2, size, font: f, color: C.cream })
  }
}

function coverFitDraw(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  // scale-to-cover the band, then mask overflow above with charcoal so it stays a clean band
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  const dx = x + (w - dw) / 2
  const dy = y + (h - dh) / 2
  page.drawImage(img, { x: dx, y: dy, width: dw, height: dh })
  if (y + h < PH) page.drawRectangle({ x: 0, y: y + h, width: PW, height: PH - (y + h), color: C.charcoal })
}

function drawInnerHeader(page: PDFPage, doc: ReportDoc, headerLabel: string, fonts: Fonts) {
  page.drawRectangle({ x: 0, y: 738, width: 612, height: 54, color: C.charcoal })
  page.drawRectangle({ x: 0, y: 735, width: 612, height: 3, color: C.gold })
  drawLogo(page, 54, 750, 39, 26, fonts)
  drawRight(page, headerLabel || '', 558, 762, fonts.bold, 11, C.cream)
  if ((doc.propertyAddressHeader || '').trim())
    drawRight(page, doc.propertyAddressHeader.trim(), 558, 748, fonts.reg, 8, C.gold)
}

function drawInnerFooter(page: PDFPage, doc: ReportDoc, pageNum: number, fonts: Fonts) {
  page.drawLine({ start: { x: 54, y: 56 }, end: { x: 558, y: 56 }, thickness: 0.75, color: C.rule })
  if ((doc.footerLine || '').trim())
    page.drawText(S(doc.footerLine.trim()), { x: 54, y: 44, size: 7.5, font: fonts.reg, color: C.footer })
  drawRight(page, 'Page ' + pageNum, 558, 44, fonts.reg, 7.5, C.footer)
}

function drawCover(page: PDFPage, doc: ReportDoc, heroImg: PDFImage | null, fonts: Fonts) {
  const cv = doc.cover
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.charcoal })
  const hasHero = !!heroImg
  let base: number
  if (heroImg) {
    coverFitDraw(page, heroImg, 0, 522, 612, 270)
    page.drawRectangle({ x: 0, y: 519, width: 612, height: 3, color: C.gold })
    page.drawRectangle({ x: 30, y: 30, width: 552, height: 480, borderColor: C.gold, borderWidth: 1 })
    base = 522
  } else {
    page.drawRectangle({ x: 30, y: 30, width: 552, height: 732, borderColor: C.gold, borderWidth: 1 })
    base = 792
  }
  const logoY = (hasHero ? base - 66 : 542) - COVER_LOGO_DY
  drawLogo(page, (PW - COVER_LOGO_W) / 2, logoY, COVER_LOGO_W, COVER_LOGO_H, fonts)
  const ruleY = (hasHero ? base - 92 : 502) - COVER_LOGO_DY
  page.drawRectangle({ x: 274, y: ruleY, width: 64, height: 3, color: C.gold })

  const titleLines = splitLines(cv.title || '')
  const t1y = (hasHero ? base - 132 : 432) - COVER_LOGO_DY
  const t2y = (hasHero ? base - 166 : 398) - COVER_LOGO_DY
  if (titleLines.length >= 1)
    drawCentered(page, titleLines[0], titleLines.length >= 2 ? t1y : (t1y + t2y) / 2, fonts.bold, 30, C.cream)
  if (titleLines.length >= 2) drawCentered(page, titleLines[1], t2y, fonts.bold, 30, C.cream)

  let subY = (hasHero ? base - 190 : 372) - COVER_LOGO_DY
  if (!titleLines.length) subY += hasHero ? 20 : 0
  if ((cv.subtitle || '').trim()) drawCentered(page, cv.subtitle.trim(), subY, fonts.reg, 12.5, C.gold)

  // info box: two columns, values wrapped to column width, vertically centered in the band
  const fields = cv.infoFields.filter((f) => (f.value || '').trim() !== '')
  const LX = 88, LW = 222, RX = 328, RW = 192
  const LBL = 9, VAL = 11.5, LV = 15, LH = 14, FG = 14
  const linesOf = (f: { value: string }, w: number) => {
    const ls = wrapText(f.value || '', fonts.bold, VAL, w)
    return ls.length ? ls : ['']
  }
  const fieldH = (f: { value: string }, w: number) => LV + (linesOf(f, w).length - 1) * LH
  if (fields.length) {
    const half = Math.ceil(fields.length / 2)
    const leftFields = fields.slice(0, half)
    const rightFields = fields.slice(half)
    const colH = (arr: typeof fields, w: number) =>
      arr.reduce((a, f, i) => a + fieldH(f, w) + (i < arr.length - 1 ? FG : 0), 0)
    const contentH = Math.max(colH(leftFields, LW), colH(rightFields, RW))
    const useH = 24 + contentH + 18
    const bandTop = subY - 18
    const bandBottom = hasHero ? 104 : 150
    let boxY = bandBottom + Math.max(0, (bandTop - bandBottom - useH) / 2)
    if (boxY + useH > bandTop) boxY = Math.max(bandBottom - 6, bandTop - useH)
    page.drawRectangle({ x: 54, y: boxY, width: 504, height: useH, color: C.infobox })
    const boxTop = boxY + useH
    const drawCol = (arr: typeof fields, x: number, w: number) => {
      let y = boxTop - 24
      for (const f of arr) {
        page.drawText(S((f.label || '').toUpperCase()), { x, y, size: LBL, font: fonts.reg, color: C.gold })
        linesOf(f, w).forEach((ln, i) => {
          page.drawText(ln, { x, y: y - LV - i * LH, size: VAL, font: fonts.bold, color: C.cream })
        })
        y -= fieldH(f, w) + FG
      }
    }
    drawCol(leftFields, LX, LW)
    drawCol(rightFields, RX, RW)
  }

  const noteY = hasHero ? 86 : 110
  if ((cv.note || '').trim()) drawCenteredBlock(page, cv.note.trim(), noteY, fonts.obl, 9.5, C.gold, 12)
  const fcY = hasHero ? 54 : 64
  if ((cv.footerContact || '').trim()) drawCentered(page, cv.footerContact.trim(), fcY, fonts.reg, 9, C.footer)
}

function drawDivider(page: PDFPage, doc: ReportDoc, section: ReportSection, photoCount: number, fonts: Fonts) {
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.charcoal })
  page.drawRectangle({ x: 30, y: 30, width: 552, height: 732, borderColor: C.gold, borderWidth: 1 })
  drawLogo(page, (PW - COVER_LOGO_W) / 2, 362 - COVER_LOGO_DY, COVER_LOGO_W, COVER_LOGO_H, fonts)
  page.drawRectangle({ x: 274, y: 322 - COVER_LOGO_DY, width: 64, height: 3, color: C.gold })
  if ((section.dividerTitle || '').trim())
    drawCentered(page, section.dividerTitle.trim(), 280 - COVER_LOGO_DY, fonts.bold, 30, C.cream)
  if ((section.dividerSubtitle || '').trim())
    drawCentered(page, section.dividerSubtitle.trim(), 252 - COVER_LOGO_DY, fonts.reg, 15, C.gold)
  const ct = photoCount === 1 ? '1 photograph' : `${photoCount} photographs`
  drawCentered(page, ct, 226 - COVER_LOGO_DY, fonts.reg, 11, C.footer)
}

function drawPhotoPage(
  page: PDFPage,
  doc: ReportDoc,
  img: PDFImage,
  section: ReportSection,
  globalIndex: number,
  total: number,
  caption: string,
  pageNum: number,
  fonts: Fonts
) {
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.white })
  drawInnerHeader(page, doc, section.headerLabel, fonts)
  drawInnerFooter(page, doc, pageNum, fonts)
  const band_top = 720, band_h = 636, band_w = 504, cx = 306
  const maxW = band_w
  const maxH = band_h - 34
  let drawW = maxW
  let drawH = drawW * (img.height / img.width)
  if (drawH > maxH) { drawH = maxH; drawW = drawH * (img.width / img.height) }
  const block_h = drawH + 26
  const top = band_top - (band_h - block_h) / 2
  const imgTop = top
  const imgBottom = top - drawH
  const imgX = cx - drawW / 2
  page.drawImage(img, { x: imgX, y: imgBottom, width: drawW, height: drawH })
  page.drawRectangle({ x: imgX, y: imgTop - 21, width: 96, height: 21, color: C.charcoal })
  page.drawText(`PHOTO ${globalIndex} / ${total}`, { x: imgX + 10, y: imgTop - 14, size: 9, font: fonts.bold, color: C.cream })
  if ((caption || '').trim()) {
    const lines = wrapText(caption.trim(), fonts.reg, 10.5, band_w - 40)
    let y = imgBottom - 18
    for (const ln of lines) {
      drawCentered(page, ln, y, fonts.reg, 10.5, C.body)
      y -= 14
    }
  }
}

function drawSummary(page: PDFPage, doc: ReportDoc, pageNum: number, fonts: Fonts) {
  const sm = doc.summary
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.white })
  drawInnerHeader(page, doc, sm.headerLabel, fonts)
  drawInnerFooter(page, doc, pageNum, fonts)
  const dark = rgb(0.17, 0.17, 0.16)
  const maxW = 504
  let y = 692
  if ((sm.title || '').trim()) {
    page.drawText(S(sm.title.trim()), { x: 54, y, size: 22, font: fonts.reg, color: dark })
    const tw = fonts.reg.widthOfTextAtSize(S(sm.title.trim()), 22)
    page.drawRectangle({ x: 54, y: y - 10, width: Math.min(tw, 300), height: 2.5, color: C.gold })
  }
  y -= 42
  for (const b of sm.blocks || []) {
    if ((b.heading || '').trim()) {
      page.drawText(S(b.heading.trim()), { x: 54, y, size: 12.5, font: fonts.bold, color: dark })
      y -= 16
    }
    const lines = wrapText(b.body || '', fonts.reg, 9.5, maxW)
    for (const ln of lines) {
      page.drawText(S(ln), { x: 54, y, size: 9.5, font: fonts.reg, color: C.body })
      y -= 13
    }
    y -= 10
  }
  const items = sm.requestItems || []
  if (items.length || (sm.requestTitle || '').trim()) {
    const innerW = maxW - 48
    const itemLines = items.map((it) => wrapText(it.body || '', fonts.reg, 9.5, innerW))
    let h = 14
    if ((sm.requestTitle || '').trim()) h += 22
    items.forEach((it, i) => {
      h += ((it.subhead || '').trim() ? 14 : 0) + itemLines[i].length * 13 + 8
    })
    h += 10
    const boxTop = y - 4
    const boxBottom = boxTop - h
    page.drawRectangle({ x: 54, y: boxBottom, width: maxW, height: h, color: C.creamfill })
    page.drawRectangle({ x: 54, y: boxBottom, width: 5, height: h, color: C.gold })
    let yy = boxTop - 22
    if ((sm.requestTitle || '').trim()) {
      page.drawText(S(sm.requestTitle.trim()), { x: 78, y: yy, size: 13, font: fonts.bold, color: dark })
      yy -= 22
    }
    items.forEach((it, i) => {
      if ((it.subhead || '').trim()) {
        page.drawText(S(it.subhead.trim()), { x: 78, y: yy, size: 10, font: fonts.bold, color: C.gold })
        yy -= 14
      }
      for (const ln of itemLines[i]) {
        page.drawText(S(ln), { x: 78, y: yy, size: 9.5, font: fonts.reg, color: C.body })
        yy -= 13
      }
      yy -= 8
    })
  }
}

// ---------------------------------------------------------------------------
// Homeowner's Guide (two appended pages, static claims-safe copy).
//
// Deliberately brand-neutral on materials — installer quality over shingle brand —
// and every red flag is one ARX itself passes (verifiable local presence, written
// scope, no deposit games). NC-specific rights copy (deductible + 3-day cancel on
// claim denial) mirrors NC Gen. Stat. Ch. 75 Art. 8; keep register consistent with
// the claims-safe rules used elsewhere (no promises about coverage outcomes).
// ---------------------------------------------------------------------------

const GUIDE_HEADER = "HOMEOWNER'S GUIDE"

const GUIDE_QUESTIONS: { q: string; sub: string }[] = [
  {
    q: 'Are you licensed and insured - and can I see proof?',
    sub: 'Ask for current general liability and workers’ compensation certificates before any work begins.',
  },
  {
    q: 'Do you have a local address and local references?',
    sub: 'A company with a real local presence will still be here for warranty service years from now.',
  },
  {
    q: 'Exactly what is included in your scope of work - and what is not?',
    sub: 'Everything in writing: tear-off, underlayment, flashings, ventilation, cleanup, and disposal.',
  },
  {
    q: 'What materials, by product name, will be installed?',
    sub: '“Architectural shingles” is not a product name. The full system - underlayment, drip edge, ventilation - should be itemized.',
  },
  {
    q: 'Who supervises the crew, and who do I call during the build?',
    sub: 'One accountable point of contact, from tear-off through final walkthrough.',
  },
  {
    q: 'How are hidden decking repairs found, priced, and approved?',
    sub: 'Rotten decking is only visible after tear-off. Repair pricing should be agreed in writing before the job starts.',
  },
  {
    q: 'What workmanship warranty do you provide - separate from the shingle warranty?',
    sub: 'Materials and installation are two different warranties. Get both in writing.',
  },
  {
    q: 'Who pulls the permit and schedules inspections?',
    sub: 'The contractor should. Being asked to pull your own permit shifts liability onto you.',
  },
]

const GUIDE_SYSTEM: { name: string; desc: string }[] = [
  { name: 'Roof decking', desc: 'the structural wood base everything else is fastened to.' },
  { name: 'Underlayment', desc: 'a secondary water barrier across the entire deck.' },
  { name: 'Drip edge', desc: 'directs runoff into the gutters and away from the fascia.' },
  { name: 'Shingles', desc: 'the visible first line of defense against the elements.' },
  { name: 'Ventilation', desc: 'lets attic heat and moisture escape; protects shingles from below.' },
  { name: 'Ridge cap', desc: 'seals and protects the roof peak.' },
]

const GUIDE_SYSTEM_CLOSER = 'Each layer matters - your written scope of work should name every one.'

const GUIDE_INSTALLER_BOX = {
  title: 'THE INSTALLER MATTERS MORE THAN THE SHINGLE BRAND',
  body:
    'Every major shingle manufacturer makes a quality product. Most roof problems come from installation - flashing, fastening, ventilation, underlayment - not the brand on the wrapper. Judge the company and its installation standards, not the logo on the shingle.',
}

const GUIDE_SHINGLE_TYPES: { label: string; body: string }[] = [
  {
    label: '3-Tab',
    body:
      'A single flat layer with notched tabs. The budget option: lighter, lower wind ratings, shorter warranties, and many manufacturers are phasing them out. Usually only worth it on a property you don’t plan to keep long.',
  },
  {
    label: 'Architectural (dimensional)',
    body:
      'Two or more bonded layers. Thicker, better wind performance, longer warranties, and a dimensional look. This is today’s standard - the right choice for most homes.',
  },
]

const GUIDE_CLASS_BOX = {
  title: 'IMPACT RATINGS: CLASS 1 TO CLASS 4',
  body:
    'Shingles are also rated for hail impact resistance (UL 2218), from Class 1 up to Class 4, the most resistant. Class 4 costs meaningfully more. Some insurers discount premiums for it - but some also attach cosmetic-damage exclusions to Class 4 roofs, which can limit future hail claims. In our experience, Class 3 is the sweet spot: solid impact resistance without the Class 4 price or the fine print. Either way, a quality architectural shingle installed correctly matters more than the rating - ask for the math before paying for any upgrade.',
}

const GUIDE_RED_FLAGS: string[] = [
  'Can’t produce a verifiable license, proof of insurance, or a local address.',
  'Offers to pay, waive, or “absorb” your insurance deductible - this is illegal in North Carolina.',
  'Guarantees your insurance claim will be approved. Only your carrier decides coverage.',
  'Demands a large cash deposit before work begins.',
  'Bids dramatically lower than everyone else - a lowball bid often grows through change orders.',
  'Has no written scope of work, or names no specific products.',
  'Won’t leave the estimate and paperwork with you to review on your own time.',
]

const GUIDE_RIGHTS_BOX = {
  title: 'IF YOUR PROJECT INVOLVES AN INSURANCE CLAIM',
  body:
    'Your adjuster - not your contractor - decides what your policy covers. Your deductible is yours to pay: by law, a contractor may not pay or waive it for you. If your claim is denied, North Carolina law gives you the right to cancel a storm-repair contract within three business days of the denial notice. Keep copies of everything: reports, estimates, and photos.',
}

const GUIDE_FINAL =
  'An informed homeowner is difficult to take advantage of. Compare complete scopes of work - not just the bottom line - and choose the company you trust to still be here in ten years.'

function drawGuideTitle(page: PDFPage, title: string, fonts: Fonts): number {
  const dark = rgb(0.17, 0.17, 0.16)
  const y = 692
  page.drawText(S(title), { x: 54, y, size: 22, font: fonts.reg, color: dark })
  const tw = fonts.reg.widthOfTextAtSize(S(title), 22)
  page.drawRectangle({ x: 54, y: y - 10, width: Math.min(tw, 340), height: 2.5, color: C.gold })
  return y - 40
}

/** Cream box with gold accent bar (same visual language as the summary request box). */
function drawGuideBox(page: PDFPage, top: number, title: string, body: string, fonts: Fonts): number {
  const dark = rgb(0.17, 0.17, 0.16)
  const maxW = 504
  const innerW = maxW - 48
  const lines = wrapText(body, fonts.reg, 9.5, innerW)
  const h = 14 + 20 + lines.length * 13 + 12
  const bottom = top - h
  page.drawRectangle({ x: 54, y: bottom, width: maxW, height: h, color: C.creamfill })
  page.drawRectangle({ x: 54, y: bottom, width: 5, height: h, color: C.gold })
  let yy = top - 22
  page.drawText(S(title), { x: 78, y: yy, size: 11, font: fonts.bold, color: dark })
  yy -= 18
  for (const ln of lines) {
    page.drawText(S(ln), { x: 78, y: yy, size: 9.5, font: fonts.reg, color: C.body })
    yy -= 13
  }
  return bottom
}

function drawGuidePage1(page: PDFPage, doc: ReportDoc, pageNum: number, fonts: Fonts) {
  const dark = rgb(0.17, 0.17, 0.16)
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.white })
  drawInnerHeader(page, doc, GUIDE_HEADER, fonts)
  drawInnerFooter(page, doc, pageNum, fonts)
  let y = drawGuideTitle(page, 'Choosing Your Roofer', fonts)
  const intro =
    'A new roof is a major investment. Whoever you choose to work with - ARX included - a reputable roofing company should be able to answer every question below in writing. Take your time, and ask.'
  for (const ln of wrapText(intro, fonts.obl, 9.5, 504)) {
    page.drawText(S(ln), { x: 54, y, size: 9.5, font: fonts.obl, color: C.body })
    y -= 13
  }
  y -= 10
  GUIDE_QUESTIONS.forEach((item, i) => {
    // checkbox + numbered question
    page.drawRectangle({ x: 54, y: y - 2, width: 11, height: 11, borderColor: C.gold, borderWidth: 1.2 })
    const qLines = wrapText(`${i + 1}.  ${item.q}`, fonts.bold, 10.5, 480)
    for (const ln of qLines) {
      page.drawText(S(ln), { x: 74, y, size: 10.5, font: fonts.bold, color: dark })
      y -= 14
    }
    for (const ln of wrapText(item.sub, fonts.reg, 9, 480)) {
      page.drawText(S(ln), { x: 74, y, size: 9, font: fonts.reg, color: C.body })
      y -= 12
    }
    y -= 9
  })
  y -= 4
  y = drawGuideBox(page, y, GUIDE_INSTALLER_BOX.title, GUIDE_INSTALLER_BOX.body, fonts) - 24
  page.drawText(S('Your roof is a system - not just shingles:'), { x: 54, y, size: 10.5, font: fonts.bold, color: dark })
  y -= 17
  const DESC_X = 180
  for (const c of GUIDE_SYSTEM) {
    page.drawText(S(c.name), { x: 54, y, size: 9.5, font: fonts.bold, color: C.gold })
    const descLines = wrapText(c.desc, fonts.reg, 9.5, 558 - DESC_X)
    for (const ln of descLines) {
      page.drawText(S(ln), { x: DESC_X, y, size: 9.5, font: fonts.reg, color: C.body })
      y -= 12.5
    }
    y -= 4.5
  }
  y -= 4
  drawCentered(page, GUIDE_SYSTEM_CLOSER, y, fonts.obl, 9.5, dark)
}

function drawGuidePage2(page: PDFPage, doc: ReportDoc, pageNum: number, fonts: Fonts) {
  const dark = rgb(0.17, 0.17, 0.16)
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.white })
  drawInnerHeader(page, doc, GUIDE_HEADER, fonts)
  drawInnerFooter(page, doc, pageNum, fonts)
  let y = drawGuideTitle(page, 'Know What You’re Buying', fonts)
  page.drawText(S('Shingle types, in plain terms:'), { x: 54, y, size: 10.5, font: fonts.bold, color: dark })
  y -= 18
  for (const t of GUIDE_SHINGLE_TYPES) {
    page.drawText(S(t.label), { x: 54, y, size: 10, font: fonts.bold, color: C.gold })
    y -= 13
    for (const ln of wrapText(t.body, fonts.reg, 9.5, 504)) {
      page.drawText(S(ln), { x: 54, y, size: 9.5, font: fonts.reg, color: C.body })
      y -= 12.5
    }
    y -= 8
  }
  y -= 2
  y = drawGuideBox(page, y, GUIDE_CLASS_BOX.title, GUIDE_CLASS_BOX.body, fonts) - 24
  page.drawText(S('Proceed with caution if a contractor:'), { x: 54, y, size: 10.5, font: fonts.bold, color: dark })
  y -= 18
  for (const flag of GUIDE_RED_FLAGS) {
    // x-mark bullet
    page.drawText('x', { x: 57, y: y - 0.5, size: 10, font: fonts.bold, color: HEX('B03A2E') })
    for (const ln of wrapText(flag, fonts.reg, 9.5, 480)) {
      page.drawText(S(ln), { x: 74, y, size: 9.5, font: fonts.reg, color: C.body })
      y -= 12.5
    }
    y -= 5.5
  }
  y -= 6
  y = drawGuideBox(page, y, GUIDE_RIGHTS_BOX.title, GUIDE_RIGHTS_BOX.body, fonts) - 24
  page.drawRectangle({ x: 274, y: y + 8, width: 64, height: 2.5, color: C.gold })
  y -= 10
  for (const ln of wrapText(GUIDE_FINAL, fonts.obl, 10, 420)) {
    drawCentered(page, ln, y, fonts.obl, 10, dark)
    y -= 14
  }
}

/** Ordered photo ids in the final document (section order, hero excluded). */
export function orderedPhotoIds(doc: ReportDoc, hasPhoto: (id: string) => boolean): string[] {
  const ids: string[] = []
  for (const s of doc.sections) {
    for (const pid of s.photoIds) {
      if (pid !== doc.cover.heroPhotoId && hasPhoto(pid)) ids.push(pid)
    }
  }
  return ids
}

export interface BuildPdfOptions {
  doc: ReportDoc
  /**
   * Returns JPEG bytes for a photo at the requested quality tier (rotation baked in),
   * or null if the photo is unavailable (it is then skipped).
   */
  getPhotoJpeg: (photoId: string, quality: number, maxSide: number) => Promise<Uint8Array | null>
  hasPhoto: (photoId: string) => boolean
  /** PNG bytes of the brand logo; wordmark fallback when null. */
  logoPng?: Uint8Array | null
  quality: number
  maxSide: number
}

export async function buildReportPdf(opts: BuildPdfOptions): Promise<Uint8Array> {
  const { doc: rdoc, getPhotoJpeg, hasPhoto, logoPng, quality, maxSide } = opts
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    obl: await doc.embedFont(StandardFonts.HelveticaOblique),
    logo: null,
  }
  if (logoPng) {
    try { fonts.logo = await doc.embedPng(logoPng) } catch { fonts.logo = null }
  }

  const embedCache: Record<string, PDFImage | null> = {}
  async function getEmbed(pid: string): Promise<PDFImage | null> {
    if (pid in embedCache) return embedCache[pid]
    const bytes = await getPhotoJpeg(pid, quality, maxSide)
    const img = bytes ? await doc.embedJpg(bytes) : null
    embedCache[pid] = img
    return img
  }

  // pageNo counts EVERY physical page (cover, summary, dividers, photos)
  let pageNo = 0

  const coverPage = doc.addPage([PW, PH])
  pageNo++
  let heroImg: PDFImage | null = null
  if (rdoc.cover.heroPhotoId && hasPhoto(rdoc.cover.heroPhotoId)) heroImg = await getEmbed(rdoc.cover.heroPhotoId)
  drawCover(coverPage, rdoc, heroImg, fonts)

  if (rdoc.summary && rdoc.summary.include) {
    const sp = doc.addPage([PW, PH])
    pageNo++
    drawSummary(sp, rdoc, pageNo, fonts)
  }

  // Resolve every embed up front so the "PHOTO n / total" denominator counts only photos
  // that actually made it into the document (a failed fetch can't skew the numbering).
  const embeddable = orderedPhotoIds(rdoc, hasPhoto)
  let total = 0
  for (const pid of embeddable) {
    if (await getEmbed(pid)) total++
  }
  let globalIndex = 0
  for (const s of rdoc.sections) {
    const sectionIds = s.photoIds.filter((pid) => pid !== rdoc.cover.heroPhotoId && hasPhoto(pid))
    const sectionCount = sectionIds.filter((pid) => embedCache[pid]).length
    const dividerPage = doc.addPage([PW, PH])
    pageNo++
    drawDivider(dividerPage, rdoc, s, sectionCount, fonts)
    for (const pid of sectionIds) {
      const img = await getEmbed(pid)
      if (!img) continue
      globalIndex++
      pageNo++
      const pg = doc.addPage([PW, PH])
      drawPhotoPage(pg, rdoc, img, s, globalIndex, total, rdoc.captions[pid] || '', pageNo, fonts)
    }
  }

  // Homeowner's Guide appendix — defaults ON; older docs without `guide` include it too.
  if (rdoc.guide?.include !== false) {
    const g1 = doc.addPage([PW, PH])
    pageNo++
    drawGuidePage1(g1, rdoc, pageNo, fonts)
    const g2 = doc.addPage([PW, PH])
    pageNo++
    drawGuidePage2(g2, rdoc, pageNo, fonts)
  }
  return await doc.save()
}

/**
 * Progressive quality tiers — lets very large (many-photo) reports still come in under
 * the 25 MB Gmail cap. First tier is the full-quality pass.
 */
export const PDF_TIERS = [
  { q: 0.8, s: 1280 },
  { q: 0.72, s: 1100 },
  { q: 0.66, s: 1000 },
  { q: 0.6, s: 900 },
  { q: 0.55, s: 800 },
  { q: 0.5, s: 700 },
] as const

export const PDF_SIZE_TARGET = 24.5 * 1048576 // aim under this; Gmail hard cap is 25 MB
