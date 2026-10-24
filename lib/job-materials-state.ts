/**
 * ONE answer to "where are this job's materials?" - used by the header summary, the Materials tab, the board and the workflow.
 *
 * With a supplier plan (suppliers to order from, or installer-supplied trades) the answer comes from the supplier orders:
 *   nothing sent        -> not_ordered
 *   some sent           -> partial   ("2 of 3 ordered")
 *   all sent            -> ordered
 *   all sent + received -> received
 * Without one (non-roofing jobs, no scope, older jobs) the stored `production_jobs.materials_status` is the fallback.
 * The stored column is a MIRROR: it is rewritten from this function whenever an order is sent or received, so the board,
 * reports and Needs-you keep reading it and cannot disagree for long.
 */
import type { MaterialsRollup } from '@/lib/material-sourcing'

export type MaterialsStateKey = 'none' | 'not_ordered' | 'partial' | 'ordered' | 'received'

export type MaterialsState = {
  key: MaterialsStateKey
  label: string
  /** Tailwind text colour class. */
  color: string
  /** e.g. "2 of 3 ordered"; empty when there is nothing to add. */
  detail: string
  /** 'suppliers' when derived from supplier orders, 'recorded' when it is the stored status. */
  source: 'suppliers' | 'recorded'
  /** The value to write to production_jobs.materials_status to keep the mirror in step. */
  mirror: 'not_ordered' | 'ordered' | 'partial' | 'received'
}

const LOOK: Record<MaterialsStateKey, { label: string; color: string; mirror: MaterialsState['mirror'] }> = {
  none: { label: 'Nothing to order', color: 'text-gray-700', mirror: 'not_ordered' },
  not_ordered: { label: 'Not ordered', color: 'text-gray-700', mirror: 'not_ordered' },
  partial: { label: 'Partly ordered', color: 'text-amber-600', mirror: 'partial' },
  ordered: { label: 'Ordered', color: 'text-blue-600', mirror: 'ordered' },
  received: { label: 'Received', color: 'text-green-600', mirror: 'received' },
}

function build(key: MaterialsStateKey, source: MaterialsState['source'], detail = ''): MaterialsState {
  return { key, source, detail, ...LOOK[key] }
}

export type SupplierStateInput = {
  rollup: Pick<MaterialsRollup, 'covered' | 'total' | 'allCovered'>
  /** One entry per supplier purchase order that was sent (not draft / cancelled). */
  sentOrders: Array<{ receivedAt: string | null }>
}

export function storedMaterialsKey(stored: string | null | undefined): MaterialsStateKey {
  switch (stored) {
    case 'ordered': return 'ordered'
    case 'partial': return 'partial'
    case 'received': return 'received'
    default: return 'not_ordered'
  }
}

export function deriveMaterialsState(input: { stored: string | null | undefined; suppliers?: SupplierStateInput | null }): MaterialsState {
  const s = input.suppliers
  if (!s || s.rollup.total === 0) return build(storedMaterialsKey(input.stored), 'recorded')
  const { covered, total, allCovered } = s.rollup
  if (covered === 0) return build('not_ordered', 'suppliers', `0 of ${total} ordered`)
  if (!allCovered) return build('partial', 'suppliers', `${covered} of ${total} ordered`)
  const allReceived = s.sentOrders.length > 0 && s.sentOrders.every((o) => !!o.receivedAt)
  if (allReceived) return build('received', 'suppliers', `${total} of ${total} received`)
  const received = s.sentOrders.filter((o) => !!o.receivedAt).length
  return build('ordered', 'suppliers', received > 0 ? `${received} of ${s.sentOrders.length} received` : `${total} of ${total} ordered`)
}

/** Per-supplier display state on a card: Draft / Sent / Received (plus the existing change / cancel states). */
export function supplierDisplayState(card: { state: string; orderStatus: string | null; receivedAt?: string | null }): 'draft' | 'sent' | 'received' | 'changed' | 'needs_cancellation' | 'cancelled' {
  if (card.state === 'cancelled') return 'cancelled'
  if (card.state === 'needs_cancellation') return 'needs_cancellation'
  if (card.state === 'changed') return 'changed'
  if (card.state === 'sent') return card.receivedAt ? 'received' : 'sent'
  return 'draft'
}
