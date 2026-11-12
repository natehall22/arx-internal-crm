/** Client-safe rules for "Undo payment" (server writer: lib/job-payment-undo.ts). */
export const UNDO_REASON_MAX = 300

/** The key of the reversal row of a payment: a double tap or a retry never writes a second one. */
export function undoKey(paymentId: string): string {
  return `undo:${paymentId}`
}

/** Why this row can never be undone here, or null. */
export function undoRefusal(p: { amount_cents: number; idempotency_key?: string | null }): string | null {
  if (p.amount_cents <= 0) return 'Only a payment can be undone, not a refund.'
  const key = p.idempotency_key ?? ''
  if (key.startsWith('stripe:')) return 'This was paid online. Refund it in Stripe and it will show here by itself.'
  return null
}
