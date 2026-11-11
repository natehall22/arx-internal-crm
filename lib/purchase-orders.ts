/**
 * Purchase orders for any vendor or subcontractor — the rules. Pure and client-safe (no database, no mail).
 *
 * ONE purchase-order system. A PO is a `supplier_orders` row. Its `kind` says where its lines come from:
 *   'materials' — the roofing material order (lib/supplier-orders.ts, quantities computed from the sold scope), unchanged;
 *   'general'   — a vendor or sub, lines typed or picked from the price book (this module + lib/purchase-orders-db.ts).
 * Both share the vendors directory, PO numbers (`<job number>-<letter>`), the send log, the double-send guard
 * (`decideSend`) and the one send door (lib/suppliers/send-order.ts).
 *
 * Money is dollars with 2 decimals in the database and integer CENTS here (never float arithmetic on dollars).
 */
import { JOB_COST_TYPES, normalizeJobCostType, type JobCostType } from '@/lib/job-cost-ledger'
import type { OrderLine, SupplierOrderRecord } from '@/lib/material-sourcing'

export const PO_STATUSES = ['draft', 'sent', 'acknowledged', 'partially_received', 'received', 'billed', 'cancelled'] as const
export type PoStatus = (typeof PO_STATUSES)[number]

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  acknowledged: 'Confirmed by vendor',
  partially_received: 'Partly received',
  received: 'Received',
  billed: 'Billed',
  cancelled: 'Cancelled',
}

export const PO_MAX_LINES = 60
export const BILL_TOLERANCE_CENTS = 5

export type PoKind = 'materials' | 'general'
export type PoDateKind = 'delivery' | 'start'

export type PoLineInput = {
  id?: string | null
  description: string
  quantity: number
  unit: string | null
  unitCostCents: number
  costType: JobCostType
  costCode: string | null
  pricebookItemId: string | null
}

export type PoDraftInput = {
  vendorId: string
  lines: PoLineInput[]
  date: string | null
  dateKind: PoDateKind
  address: string | null
  note: string | null
  title: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

export function dollarsToCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null
  return Math.round(n * 100)
}

export const centsToDollars = (cents: number): number => Math.round(cents) / 100

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Quantity as printed: 4 → "4", 2.5 → "2.5" (never "2.500"). */
export function formatQuantity(q: number): string {
  return String(Math.round(q * 1000) / 1000)
}

/** Integer math: round(qty × unit cents), the same cents on screen, in the PDF and on the bill check. */
export function lineTotalCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents)
}

export function poTotalCents(lines: Pick<PoLineInput, 'quantity' | 'unitCostCents'>[]): number {
  return lines.reduce((sum, l) => sum + lineTotalCents(l.quantity, l.unitCostCents), 0)
}

/** Validates an untrusted body into a draft, or says what is wrong in plain words. */
export function parsePoDraft(body: Record<string, unknown> | null): { ok: true; value: PoDraftInput } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Nothing to save.' }
  if (!isUuid(body.vendorId)) return { ok: false, error: 'Pick who this order is for.' }
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length === 0) return { ok: false, error: 'Add at least one item.' }
  if (rawLines.length > PO_MAX_LINES) return { ok: false, error: `At most ${PO_MAX_LINES} items on one order.` }
  const lines: PoLineInput[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const r = (rawLines[i] ?? {}) as Record<string, unknown>
    const description = text(r.description, 200)
    if (!description) return { ok: false, error: `Item ${i + 1} needs a description.` }
    const quantity = typeof r.quantity === 'number' ? r.quantity : Number(r.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return { ok: false, error: `Item ${i + 1} needs a quantity above zero.` }
    const unitCostCents = r.unitCost === undefined || r.unitCost === null || r.unitCost === '' ? 0 : dollarsToCents(r.unitCost)
    if (unitCostCents === null) return { ok: false, error: `Item ${i + 1} has a price that is not a number.` }
    lines.push({
      id: isUuid(r.id) ? r.id : null,
      description,
      quantity: Math.round(quantity * 1000) / 1000,
      unit: text(r.unit, 20),
      unitCostCents,
      costType: normalizeJobCostType(r.costType, 'material'),
      costCode: text(r.costCode, 40),
      pricebookItemId: isUuid(r.pricebookItemId) ? r.pricebookItemId : null,
    })
  }
  const date = typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : null
  return {
    ok: true,
    value: {
      vendorId: body.vendorId,
      lines,
      date,
      dateKind: body.dateKind === 'start' ? 'start' : 'delivery',
      address: text(body.address, 300),
      note: text(body.note, 1000),
      title: text(body.title, 120),
    },
  }
}

// ---------------------------------------------------------------------------
// Status — derived from facts, written by ONE refresh (lib/purchase-orders-db.ts refreshPoStatus)
// ---------------------------------------------------------------------------

export function derivePoStatus(f: {
  firstSentAt: string | null
  cancelledAt: string | null
  acknowledgedAt: string | null
  lines: { quantity: number; receivedQuantity: number }[]
  totalCents: number
  billedCents: number
}): PoStatus {
  if (f.cancelledAt) return 'cancelled'
  if (!f.firstSentAt) return 'draft'
  if (f.billedCents > 0 && f.totalCents > 0 && f.billedCents >= f.totalCents - BILL_TOLERANCE_CENTS) return 'billed'
  const anyReceived = f.lines.some((l) => l.receivedQuantity > 0)
  const allReceived = f.lines.length > 0 && f.lines.every((l) => l.receivedQuantity + 1e-9 >= l.quantity)
  if (allReceived) return 'received'
  if (anyReceived) return 'partially_received'
  if (f.acknowledgedAt) return 'acknowledged'
  return 'sent'
}

/** What decideSend (lib/material-sourcing.ts) understands: only draft / sent / cancelled. */
export function sendStateOf(status: PoStatus): SupplierOrderRecord['status'] {
  return status === 'draft' ? 'draft' : status === 'cancelled' ? 'cancelled' : 'sent'
}

/** Receiving only makes sense once the vendor has the order. */
export const canReceive = (s: PoStatus) => s === 'sent' || s === 'acknowledged' || s === 'partially_received' || s === 'received' || s === 'billed'
export const canBill = (s: PoStatus) => canReceive(s)
export const canEditLines = (s: PoStatus) => s !== 'cancelled'

/** Clamp a received quantity: never negative, never past what was ordered. */
export function clampReceived(quantity: number, ordered: number): number {
  return Math.min(Math.max(0, Math.round(quantity * 1000) / 1000), ordered)
}

// ---------------------------------------------------------------------------
// The shapes the shared send log / double-send guard / change description expect
// ---------------------------------------------------------------------------

export function lineQtyText(l: { quantity: number; unit: string | null; unitCostCents: number }): string {
  const q = `${formatQuantity(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`
  return l.unitCostCents > 0 ? `${q} @ ${formatMoney(l.unitCostCents)}` : q
}

/** A PO line as the shared OrderLine, so describeOrderChanges / canonicalContent / the send log work unchanged. */
export function toOrderLines(lines: (PoLineInput & { key: string })[]): OrderLine[] {
  return lines.map((l) => ({
    key: l.key,
    trade: l.costType,
    label: l.description,
    qty: lineQtyText(l),
    detail: null,
    note: l.costCode ? `Code ${l.costCode}` : null,
    status: 'ready' as const,
    excluded: false,
  }))
}

/** Stable key for a line that has no id yet (hash/preview before save): position + text. */
export const lineKey = (l: { id?: string | null }, index: number): string => l.id ?? `new-${index}`

// ---------------------------------------------------------------------------
// Vendor bills
// ---------------------------------------------------------------------------

export type BillCheck = { overBy: number; message: string | null }

/** A bill that takes billed past the PO total is allowed (freight, change) but is said out loud. */
export function checkBillAgainstPo(totalCents: number, billedBeforeCents: number, newBillCents: number): BillCheck {
  const overBy = billedBeforeCents + newBillCents - totalCents
  if (totalCents > 0 && overBy > BILL_TOLERANCE_CENTS) {
    return { overBy, message: `Bills would total ${formatMoney(billedBeforeCents + newBillCents)}, ${formatMoney(overBy)} more than this order (${formatMoney(totalCents)}). Record it anyway?` }
  }
  return { overBy: Math.max(0, overBy), message: null }
}

export type BillInput = { amountCents: number; billNumber: string | null; billDate: string | null; isCredit: boolean; notes: string | null; costType: JobCostType }

export function parseBillInput(body: Record<string, unknown> | null): { ok: true; value: BillInput } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Nothing to save.' }
  const amountCents = dollarsToCents(body.amount)
  if (amountCents === null || amountCents <= 0) return { ok: false, error: 'Enter the bill amount (more than $0).' }
  const billDate = typeof body.billDate === 'string' && DATE_RE.test(body.billDate) ? body.billDate : null
  return {
    ok: true,
    value: {
      amountCents,
      billNumber: text(body.billNumber, 60),
      billDate,
      isCredit: body.isCredit === true,
      notes: text(body.notes, 500),
      costType: normalizeJobCostType(body.costType, 'material'),
    },
  }
}

/** Dominant cost type of a PO (the biggest line total) — the default bucket for its bills. */
export function dominantCostType(lines: Pick<PoLineInput, 'quantity' | 'unitCostCents' | 'costType'>[]): JobCostType {
  const sums = new Map<JobCostType, number>()
  for (const l of lines) sums.set(l.costType, (sums.get(l.costType) ?? 0) + lineTotalCents(l.quantity, l.unitCostCents))
  let best: JobCostType = 'material'
  let bestSum = -1
  for (const t of JOB_COST_TYPES) {
    const v = sums.get(t) ?? 0
    if (v > bestSum) {
      best = t
      bestSum = v
    }
  }
  return best
}

/** The cost line description a bill produces, readable in the job's cost list. */
export function billCostDescription(poNumber: string, vendorName: string, billNumber: string | null): string {
  return `Vendor bill – ${vendorName}${billNumber ? ` #${billNumber}` : ''} (PO ${poNumber})`.slice(0, 200)
}
