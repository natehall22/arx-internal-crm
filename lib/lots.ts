/**
 * Lots — a builder's lots in one development, typed, pasted or uploaded. Pure and client-safe: reading the list into rows.
 * Saving them: lib/lots-db.ts. A lot is a property (lib/properties.ts) with a development name and a lot number.
 */
import { parseCsv } from '@/lib/csv'

export type LotRow = { lot: string; address: string; city: string; state: string; zip: string }

export const LOTS_MAX_ROWS = 1000
/** Rows per request: each can also make a job and its crews, so a long list is sent in small batches with a progress line. */
export const LOTS_BATCH = 25

const HEADERS: Record<keyof LotRow, RegExp> = {
  lot: /^(lot|lot\s*(#|no\.?|number|num))$/i,
  address: /^(address|street|street\s*address|address\s*1|address\s*line\s*1)$/i,
  city: /^city$/i,
  state: /^(state|st)$/i,
  zip: /^(zip|zip\s*code|postal\s*code)$/i,
}
const ORDER: Array<keyof LotRow> = ['lot', 'address', 'city', 'state', 'zip']

export type ParsedLots = { rows: LotRow[]; problems: string[] }

/**
 * Reads a pasted list or a CSV file: one lot per line. A first line naming columns (Lot, Address, City, State, ZIP, any
 * order) is used; otherwise the columns are Lot, Address, City, State, ZIP in that order. A line with only a lot number is fine
 * (the address is filled in from the development name). Tabs (copied from a spreadsheet) work like commas.
 */
export function parseLots(text: string): ParsedLots {
  const grid = parseCsv(text.replace(/\t/g, ',')).map((r) => r.map((c) => c.trim()))
  const problems: string[] = []
  if (grid.length === 0) return { rows: [], problems }
  const head = grid[0]
  const map: Partial<Record<keyof LotRow, number>> = {}
  head.forEach((cell, i) => {
    for (const k of ORDER) if (map[k] === undefined && HEADERS[k].test(cell)) map[k] = i
  })
  const hasHeader = map.lot !== undefined || map.address !== undefined
  if (!hasHeader) ORDER.forEach((k, i) => (map[k] = i))
  const body = hasHeader ? grid.slice(1) : grid
  const rows: LotRow[] = []
  const seen = new Set<string>()
  body.forEach((r, idx) => {
    const get = (k: keyof LotRow) => (map[k] === undefined ? '' : (r[map[k] as number] ?? ''))
    const row: LotRow = { lot: get('lot'), address: get('address'), city: get('city'), state: get('state'), zip: get('zip') }
    const line = idx + 1 + (hasHeader ? 1 : 0)
    if (!row.lot) {
      problems.push(`Line ${line}: no lot number`)
      return
    }
    const key = row.lot.toLowerCase()
    if (seen.has(key)) {
      problems.push(`Line ${line}: lot ${row.lot} is listed twice (kept the first)`)
      return
    }
    seen.add(key)
    rows.push(row)
  })
  if (rows.length > LOTS_MAX_ROWS) {
    problems.push(`Only the first ${LOTS_MAX_ROWS} lots are used; add the rest in a second go`)
    rows.length = LOTS_MAX_ROWS
  }
  return { rows, problems }
}

/** The street line a lot gets when the list has none: "Lot 14, Oak Ridge" (unique per development, so it is a real property). */
export function placeholderLotAddress(lot: string, development: string): string {
  const l = /^(lot|#)/i.test(lot.trim()) ? lot.trim() : `Lot ${lot.trim()}`
  return `${l}, ${development.trim()}`
}
