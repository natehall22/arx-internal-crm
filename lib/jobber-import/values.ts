/**
 * Move from Jobber — reading the values in Jobber's CSV cells. Pure and client-safe.
 * Money "$1,234.50" / "(5.00)"; dates in the account's own order (Jobber prints day/month or month/day depending on the
 * account's settings — a real export read "18/03/2025"); multi-value cells "+13135550101;7345550142"; line items
 * "Weekly mowing (1, $45.00), Edging (2, $20.00)" (Jobber: "with quantity and total price in parentheses").
 */

/** "$1,234.50" → 123450; "(5.00)" / "-$5" → -500; blank → null; unreadable → NaN (caller reports it). */
export function moneyCents(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim()
  if (!s || s === '-' || s === '—') return null
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$\s*-/.test(s)
  const digits = s.replace(/[()$,\s]/g, '').replace(/^-/, '').replace(/^[A-Z]{3}/i, '')
  if (!/^\d+(\.\d+)?$/.test(digits)) return NaN
  const cents = Math.round(Number(digits) * 100)
  return neg ? -cents : cents
}

export function numberValue(raw: string | null | undefined): number | null {
  const s = (raw ?? '').replace(/[,%\s]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

export function yesNo(raw: string | null | undefined): boolean | null {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (['true', 'yes', 'y', '1', 'x', 'active'].includes(s)) return true
  if (['false', 'no', 'n', '0', 'inactive', 'archived'].includes(s)) return false
  return null
}

export type DateOrder = 'mdy' | 'dmy'

const NUMERIC_DATE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:[ T].*)?$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

/**
 * Which order the numeric dates in these cells use. A first part above 12 proves day/month; a second part above 12
 * proves month/day. `ambiguous: true` = nothing proved it (every day ≤ 12): we read month/day, and the Check screen says so.
 */
export function detectDateOrder(values: Iterable<string>): { order: DateOrder; ambiguous: boolean; conflicting: boolean } {
  let dmy = false
  let mdy = false
  for (const v of Array.from(values)) {
    const m = NUMERIC_DATE.exec((v ?? '').trim())
    if (!m) continue
    if (Number(m[1]) > 12) dmy = true
    if (Number(m[2]) > 12) mdy = true
  }
  if (dmy && !mdy) return { order: 'dmy', ambiguous: false, conflicting: false }
  if (mdy && !dmy) return { order: 'mdy', ambiguous: false, conflicting: false }
  return { order: 'mdy', ambiguous: !dmy && !mdy, conflicting: dmy && mdy }
}

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** A Jobber date cell → "YYYY-MM-DD" (a calendar day, no zone), or null when blank / unreadable. */
export function parseDate(raw: string | null | undefined, order: DateOrder): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  let m = ISO_DATE.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = NUMERIC_DATE.exec(s)
  if (m) return order === 'dmy' ? ymd(+m[3], +m[2], +m[1]) : ymd(+m[3], +m[1], +m[2])
  // "Jan 5, 2025" / "January 5 2025" / "5 Jan 2025"
  const words = s.replace(/,/g, ' ').split(/\s+/)
  const mon = words.findIndex((w) => MONTHS[w.slice(0, 4).toLowerCase().replace(/\.$/, '')] || MONTHS[w.slice(0, 3).toLowerCase()])
  if (mon >= 0) {
    const month = MONTHS[words[mon].slice(0, 3).toLowerCase()]
    const nums = words.filter((w, i) => i !== mon && /^\d{1,4}$/.test(w)).map(Number)
    const year = nums.find((n) => n > 31)
    const day = nums.find((n) => n >= 1 && n <= 31)
    if (year && day) return ymd(year, month, day)
  }
  return null
}

/** Split a multi-value cell ("a@x.com, b@y.com" / "+1313…;734…" / one per line). */
export function splitMulti(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

/** Last 10 digits of a phone (the CRM's identity rule); null if fewer than 10 digits. */
export function phoneDigits(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
}

/** "Florida" → "FL"; "fl" → "FL"; anything else kept as typed (Canadian provinces, blanks). */
export function stateCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase()
  return STATES[s.toLowerCase()] ?? s
}

export type LineItem = { name: string; qty: number; totalCents: number }

/**
 * "Weekly mowing (1, $45.00), Edging (2, $20.00)" → items. Jobber documents the shape ("quantity and total price in
 * parentheses") but not the separator, so ", " / ";" / new lines between items all work. null = the cell is not in that
 * shape (the caller keeps the text as one line with the record's total instead of guessing).
 */
export function parseLineItems(raw: string | null | undefined): LineItem[] | null {
  const s = (raw ?? '').trim()
  if (!s) return []
  // One item at a time from the front of what is left (no sticky regex: the build targets ES5).
  const one = /^\s*(.+?)\s*\(\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\$?\s*-?[\d,]*\.?\d+)\s*\)\s*(?:[,;\n]|$)/
  const items: LineItem[] = []
  let at = 0
  while (at < s.length) {
    const m = one.exec(s.slice(at))
    if (!m) break
    const cents = moneyCents(m[3])
    if (cents === null || Number.isNaN(cents)) return null
    items.push({ name: m[1].replace(/^[,;\s]+/, '').trim().slice(0, 500), qty: Number(m[2]), totalCents: cents })
    at += m[0].length
  }
  if (!items.length || at < s.length) return null
  return items
}

/** J-ID "103432539_110583912" → client "103432539", property "110583912". */
export function splitJid(raw: string | null | undefined): { client: string | null; property: string | null } {
  const s = (raw ?? '').trim()
  if (!s) return { client: null, property: null }
  const [c, p] = s.split('_', 2)
  return { client: c?.trim() || null, property: p?.trim() || null }
}

/** For matching people by name across Jobber's reports: lower case, letters and digits only. */
export function nameKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
