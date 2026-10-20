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

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  'full name': 'name',
  contact: 'name',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  company: 'company',
  brokerage: 'company',
  email: 'email',
  type: 'type',
  notes: 'notes',
}

export type PartnerImportRow = {
  name?: string
  phone?: string
  company?: string
  email?: string
  type?: string
  notes?: string
}

/** First row is the header; unknown columns are ignored. */
export function csvToPartnerRows(text: string): PartnerImportRow[] {
  const [header, ...body] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null)
  return body.map((cells) => {
    const out: Record<string, string> = {}
    keys.forEach((key, i) => {
      const value = (cells[i] ?? '').trim()
      if (key && value) out[key] = value
    })
    return out as PartnerImportRow
  })
}
