/**
 * CRM order quantities are printed text like "20 sq · 58 bundles". ABC wants a number and a unit code,
 * so each mapped line names the word its quantity is written with ("bundles") and we read the number
 * in front of that word. Anything that is not exactly one such number is NOT guessed — the line is
 * reported as unreadable and the order stays on email.
 */
export function parseOrderQuantity(qtyText: string | null | undefined, unitWord: string): number | null {
  if (!qtyText || !unitWord) return null
  const word = unitWord.trim().toLowerCase()
  if (!word) return null
  const hits: number[] = []
  for (const part of qtyText.split(/[·•;|\n]/)) {
    const m = part.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z][a-z .\/-]*)$/)
    if (m && m[2].trim() === word) hits.push(Number(m[1]))
  }
  if (hits.length !== 1) return null
  const n = hits[0]
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null
}
