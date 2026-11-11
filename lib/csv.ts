/** CSV reading shared by every importer (referral partners, Move from Jobber). Client-safe. */

/** Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

/**
 * Bytes of a CSV → text. UTF-8 first (Jobber's own exports, with or without a BOM); a file Excel re-saved on Windows is
 * Windows-1252 (é, ’, – as single bytes, invalid as UTF-8) and is decoded as that instead of turning into "�".
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(view).replace(/^﻿/, ''), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(view), encoding: 'windows-1252' }
  }
}
