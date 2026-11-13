/**
 * Money a crew takes at the door — the pure rules (client-safe). Cash or a check is recorded as a PENDING collection; it is
 * not money until the office confirms it (lib/visit-collections-db.ts), and only that confirm writes real payments through
 * the invoice payment writer. A pending collection is therefore in no balance, no payroll figure and no QuickBooks event.
 */

export const COLLECTION_METHODS = ['cash', 'check'] as const
export type CollectionMethod = (typeof COLLECTION_METHODS)[number]
export const COLLECTION_METHOD_LABELS: Record<CollectionMethod, string> = { cash: 'Cash', check: 'Check' }

export const MAX_COLLECTION_CENTS = 100_000_000

export type CollectionInput = { amountCents: number; method: CollectionMethod; checkNumber: string | null; note: string | null; tapId: string | null }

/** Dollars typed on a phone ("45", "$45.50", 45.5) → whole cents, or null. */
export function dollarsToCents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(n)) return null
  const cents = Math.round(n * 100)
  return cents > 0 && cents <= MAX_COLLECTION_CENTS ? cents : null
}

/** Pure: a "Collected" tap body → clean values, or why not. `amount` is dollars (what the crew typed). */
export function cleanCollectionInput(body: unknown): { ok: true; value: CollectionInput } | { ok: false; error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const amountCents = dollarsToCents(b.amount)
  if (amountCents == null) return { ok: false, error: 'Enter the amount you collected' }
  if (!(COLLECTION_METHODS as readonly unknown[]).includes(b.method)) return { ok: false, error: 'Pick cash or check' }
  const method = b.method as CollectionMethod
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const tapId = typeof b.tapId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.tapId) ? b.tapId : null
  return { ok: true, value: { amountCents, method, checkNumber: method === 'check' ? text(b.checkNumber, 40) : null, note: text(b.note, 500), tapId } }
}

/** `jobId` set = a JOB invoice (paid through the job payment path); null/absent = a recurring-service invoice. */
export type OpenInvoice = { id: string; number: string; balanceCents: number; jobId?: string | null }

/**
 * Pure: which invoices a collection pays, oldest first (the list is already oldest first), never more than each one owes.
 * `leftoverCents` > 0 = the invoices no longer owe this much.
 */
export function allocateCollection(amountCents: number, invoices: OpenInvoice[]): { parts: Array<{ invoiceId: string; cents: number }>; leftoverCents: number } {
  let left = amountCents
  const parts: Array<{ invoiceId: string; cents: number }> = []
  for (const inv of invoices) {
    if (left <= 0) break
    const cents = Math.min(left, Math.max(0, inv.balanceCents))
    if (cents > 0) {
      parts.push({ invoiceId: inv.id, cents })
      left -= cents
    }
  }
  return { parts, leftoverCents: left }
}

export type OwedSummary = {
  /** Open customer invoices (job and service), oldest due first. */
  invoices: OpenInvoice[]
  /** Everything those invoices still owe. */
  totalCents: number
  /** Cash / checks a crew has taken that the office has not confirmed yet. */
  pendingCents: number
  /** What the crew can still take: owed minus what is already waiting for the office. Never below zero. */
  dueCents: number
}

export function summarizeOwed(invoices: OpenInvoice[], pendingCents: number): OwedSummary {
  const totalCents = invoices.reduce((sum, i) => sum + Math.max(0, i.balanceCents), 0)
  return { invoices, totalCents, pendingCents, dueCents: Math.max(0, totalCents - pendingCents) }
}

/** What a crew sees about money at one visit: how much the customer still owes, never a price line. */
export type CrewMoney = {
  /** Owed on the customer's open invoices minus cash / checks already waiting for the office. */
  dueCents: number
  /** Taken at the door, waiting for the office to confirm. */
  pendingCents: number
  /** A pay link can be made (online payments ready) and there is an invoice to pay. */
  canPayOnline: boolean
}
