/**
 * Selections & allowances (project tools). PURE, client-safe.
 *
 * A selection is something the customer picks (tile, faucet, paint) against an ALLOWANCE the contract carried. The
 * difference = chosen price − allowance: over → the customer pays more and it goes through the EXISTING change order
 * (job_change_orders, signed); under → a credit that is shown but never moved by itself (the office decides, same as today).
 */
import { roundMoney } from '@/lib/money'

export type SelectionOption = { id: string; label: string; price: number }
export const MAX_SELECTION_OPTIONS = 12

export type SelectionRow = {
  id: string
  item: string
  allowance: number
  options: SelectionOption[]
  chosen_option_id: string | null
  chosen_label: string | null
  chosen_price: number | null
  due_date: string | null
  status: 'draft' | 'sent' | 'chosen' | 'cancelled'
  change_order_id: string | null
}

/** Chosen price − allowance. Positive = overage the customer pays; negative = under allowance (credit). */
export function priceDifference(allowance: number, chosenPrice: number | null | undefined): number | null {
  if (chosenPrice === null || chosenPrice === undefined) return null
  return roundMoney(Number(chosenPrice) - Number(allowance || 0)) || 0
}

export type SelectionState = 'not_sent' | 'waiting_customer' | 'overdue' | 'waiting_signature' | 'approved' | 'cancelled'

export const SELECTION_STATE_LABELS: Record<SelectionState, string> = {
  not_sent: 'Not sent',
  waiting_customer: 'Waiting on customer',
  overdue: 'Past due',
  waiting_signature: 'Waiting for signature',
  approved: 'Approved',
  cancelled: 'Cancelled',
}

/** Plain colors: green = done, amber = waiting, red = past due, gray = nothing to do yet. */
export const SELECTION_STATE_TONE: Record<SelectionState, 'green' | 'amber' | 'red' | 'gray'> = {
  not_sent: 'gray',
  waiting_customer: 'amber',
  overdue: 'red',
  waiting_signature: 'amber',
  approved: 'green',
  cancelled: 'gray',
}

/** What to show for a selection. `changeOrderStatus` = status of its change order ('completed' = signed). */
export function selectionState(s: Pick<SelectionRow, 'status' | 'chosen_price' | 'allowance' | 'change_order_id' | 'due_date'>, changeOrderStatus: string | null, todayYmd: string): SelectionState {
  if (s.status === 'cancelled') return 'cancelled'
  if (s.status === 'chosen') {
    const diff = priceDifference(s.allowance, s.chosen_price) ?? 0
    if (diff > 0) return s.change_order_id && changeOrderStatus === 'completed' ? 'approved' : 'waiting_signature'
    return 'approved'
  }
  if (s.due_date && s.due_date < todayYmd) return 'overdue'
  return s.status === 'sent' ? 'waiting_customer' : 'not_sent'
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? roundMoney(n) : null
}

/** Options from a request body (label + price each); drops blanks, caps the count, keeps/assigns stable ids. */
export function parseSelectionOptions(raw: unknown): SelectionOption[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Add at least one option' }
  const out: SelectionOption[] = []
  const used = new Set<string>()
  for (const o of raw) {
    const label = typeof (o as { label?: unknown })?.label === 'string' ? (o as { label: string }).label.trim().slice(0, 120) : ''
    const price = num((o as { price?: unknown })?.price)
    if (!label && (o as { price?: unknown })?.price === undefined) continue
    if (!label) return { error: 'Every option needs a name' }
    if (price === null) return { error: `“${label}” needs a price` }
    let id = typeof (o as { id?: unknown })?.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test((o as { id: string }).id) ? (o as { id: string }).id : ''
    if (!id || used.has(id)) id = `o${out.length + 1}${Math.random().toString(36).slice(2, 6)}`
    used.add(id)
    out.push({ id, label, price })
  }
  if (out.length === 0) return { error: 'Add at least one option' }
  if (out.length > MAX_SELECTION_OPTIONS) return { error: `At most ${MAX_SELECTION_OPTIONS} options` }
  return out
}

export function readStoredOptions(v: unknown): SelectionOption[] {
  if (!Array.isArray(v)) return []
  const out: SelectionOption[] = []
  for (const o of v) {
    const id = typeof o?.id === 'string' ? o.id : ''
    const label = typeof o?.label === 'string' ? o.label : ''
    const price = num(o?.price)
    if (id && label && price !== null) out.push({ id, label, price })
  }
  return out
}

/** The change order's description for an approved overage. Short, plain, names the item and the numbers. */
export function selectionChangeOrderDescription(s: { item: string; allowance: number; chosen_label: string; chosen_price: number }): string {
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const over = roundMoney(s.chosen_price - s.allowance)
  return `Selection: ${s.item} — ${s.chosen_label} (${money(s.chosen_price)}). Allowance ${money(s.allowance)}; the customer pays the ${money(over)} difference.`
}

/** Next CO-001 style number after the highest one on a project. */
export function nextChangeOrderNumber(existing: ReadonlyArray<string>): string {
  const max = existing.reduce((m, c) => {
    const n = parseInt(String(c).replace(/^CO-/, ''), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  return `CO-${String(max + 1).padStart(3, '0')}`
}
