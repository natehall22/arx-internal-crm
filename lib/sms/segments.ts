/**
 * How many billable segments a text is (client-safe, pure) — and the one place that cleans text so it stays cheap.
 *
 * GSM-7 text: 160 characters in one segment, 153 per segment once it takes two or more. A SINGLE character outside the
 * GSM-7 alphabet (a curly apostrophe, an em dash, most emoji) turns the whole message into UCS-2: 70 / 67 per segment.
 * Emoji are two UTF-16 units. `toGsmSafe` swaps the typographic characters our wording and staff typing produce for plain
 * ones, so a normal message stays GSM-7.
 */

const GSM_BASIC = new Set(
  Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
)
/** Each of these is sent as an escape + the character: two units. */
const GSM_EXTENDED = new Set(Array.from('^{}\\[~]|€\f'))

const SWAPS: Array<[RegExp, string]> = [
  [/[‘’‚′`´]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, '-'],
  [/…/g, '...'],
  [/[     ]/g, ' '],
  [/[•·]/g, '-'],
  [/[​‌‍⁠﻿]/g, ''],
]

/** Typographic characters → plain ones, so the text stays GSM-7 where it can. Anything else is left as typed. */
export function toGsmSafe(text: string): string {
  let t = text
  for (const [re, to] of SWAPS) t = t.replace(re, to)
  return t
}

export type SegmentCount = { segments: number; encoding: 'GSM-7' | 'UCS-2'; units: number }

export function countSegments(text: string): SegmentCount {
  let gsm = 0
  let ok = true
  for (const ch of Array.from(text)) {
    if (GSM_BASIC.has(ch)) gsm += 1
    else if (GSM_EXTENDED.has(ch)) gsm += 2
    else {
      ok = false
      break
    }
  }
  if (ok) return { encoding: 'GSM-7', units: gsm, segments: gsm === 0 ? 0 : gsm <= 160 ? 1 : Math.ceil(gsm / 153) }
  const units = text.length // UTF-16 code units: an emoji is 2
  return { encoding: 'UCS-2', units, segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67) }
}
