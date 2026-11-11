import { parseCsv } from '@/lib/csv'

export { parseCsv }

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
