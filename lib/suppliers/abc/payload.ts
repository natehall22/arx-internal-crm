import { parseOrderQuantity } from '@/lib/suppliers/abc/quantity'
import type { ItemMapRow, SupplierApiSettings } from '@/lib/suppliers/abc/types'

export const ABC_MAX_PO_LENGTH = 16
export const ABC_MAX_LINES = 99

export type AbcLineInput = { key: string; label: string; qty: string | null; note: string | null }

export type AbcOrderBody = {
  requestId: string
  purchaseOrder: string
  branchNumber: string
  deliveryService: string
  typeCode: 'SO'
  dates: { deliveryRequestedFor: string }
  currency: 'USD'
  shipTo: { number: string; name: string; address: { line1: string } }
  orderComments: Array<{ code: 'H'; description: string }>
  lines: Array<{
    id: string
    itemNumber: string
    orderedQty: { value: number; uom: string }
    comments?: { description: string }
  }>
}

export type AbcPayloadResult = { ok: true; body: AbcOrderBody[]; estimatedTotalCents: number | null } | { ok: false; problems: string[] }

/** What the Preview shows as blockers: lines with no item mapping or a quantity we can't read. */
export function lineProblems(lines: AbcLineInput[], map: ItemMapRow[]): string[] {
  const byKey = new Map(map.map((m) => [m.lineKey, m]))
  const out: string[] = []
  for (const l of lines) {
    const m = byKey.get(l.key)
    if (!m) out.push(`"${l.label}" has no ABC item number yet`)
    else if (parseOrderQuantity(l.qty, m.qtyUnitWord) === null) {
      out.push(`"${l.label}": cannot read a ${m.qtyUnitWord} quantity from "${l.qty ?? 'nothing'}"`)
    }
  }
  return out
}

/** Estimated total in cents, or null when any line has no estimated price (then the amount is UNKNOWN). */
export function estimateTotalCents(lines: AbcLineInput[], map: ItemMapRow[]): number | null {
  const byKey = new Map(map.map((m) => [m.lineKey, m]))
  let total = 0
  for (const l of lines) {
    const m = byKey.get(l.key)
    if (!m || m.estUnitPriceCents === null) return null
    const qty = parseOrderQuantity(l.qty, m.qtyUnitWord)
    if (qty === null) return null
    total += Math.round(qty * m.estUnitPriceCents)
  }
  return total
}

export function buildAbcOrder(args: {
  settings: SupplierApiSettings
  requestId: string
  poLabel: string
  jobNumber: string
  deliveryDate: string | null
  deliveryAddress: string | null
  deliveryNotes: string | null
  note: string | null
  lines: AbcLineInput[]
}): AbcPayloadResult {
  const { settings: s } = args
  const problems: string[] = []
  if (!s.shipToNumber) problems.push('ABC ship-to number is not set')
  if (!s.branchNumber) problems.push('ABC branch number is not set')
  if (!args.deliveryDate) problems.push('Pick a delivery date')
  if (!args.deliveryAddress) problems.push('Add a delivery address')
  if (args.poLabel.length > ABC_MAX_PO_LENGTH) problems.push(`PO number "${args.poLabel}" is longer than ABC's ${ABC_MAX_PO_LENGTH} characters`)
  if (args.lines.length === 0) problems.push('The order has no lines')
  if (args.lines.length > ABC_MAX_LINES) problems.push(`ABC takes at most ${ABC_MAX_LINES} lines per order`)
  problems.push(...lineProblems(args.lines, s.itemMap))
  if (problems.length > 0) return { ok: false, problems }

  const byKey = new Map(s.itemMap.map((m) => [m.lineKey, m]))
  const comment = [args.deliveryNotes, args.note].filter(Boolean).join(' — ').slice(0, 255)
  const body: AbcOrderBody = {
    requestId: args.requestId,
    purchaseOrder: args.poLabel,
    branchNumber: s.branchNumber!,
    deliveryService: s.deliveryService,
    typeCode: 'SO',
    dates: { deliveryRequestedFor: args.deliveryDate! },
    currency: 'USD',
    shipTo: { number: s.shipToNumber!, name: `Job ${args.jobNumber}`.slice(0, 60), address: { line1: args.deliveryAddress!.slice(0, 100) } },
    orderComments: comment ? [{ code: 'H', description: comment }] : [],
    lines: args.lines.map((l, i) => {
      const m = byKey.get(l.key)!
      return {
        id: String(i + 1),
        itemNumber: m.itemNumber,
        orderedQty: { value: parseOrderQuantity(l.qty, m.qtyUnitWord)!, uom: m.uom },
        ...(l.note ? { comments: { description: l.note.slice(0, 255) } } : {}),
      }
    }),
  }
  return { ok: true, body: [body], estimatedTotalCents: estimateTotalCents(args.lines, s.itemMap) }
}
