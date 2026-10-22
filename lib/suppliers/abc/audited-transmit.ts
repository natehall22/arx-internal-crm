import type { SupabaseClient } from '@supabase/supabase-js'

import { logApiEvent } from '@/lib/suppliers/abc/settings-db'
import { sendOrderToSupplier, type SupplierOrderTransmission } from '@/lib/suppliers/send-order'

/** Wraps the one send door so every API attempt leaves an append-only audit row (before and after). Email sends pass through untouched. */
export function makeAuditedTransmit(admin: SupabaseClient, who: { orgId: string; jobId: string; userId: string }) {
  return async (order: SupplierOrderTransmission) => {
    const api = order.supplier.connectionType === 'api' ? order.supplier.api : null
    if (!api) return sendOrderToSupplier(order)
    const base = { orgId: who.orgId, vendorId: order.supplier.id, jobId: who.jobId, actorUserId: who.userId, environment: api.environment }
    await logApiEvent(admin, { ...base, event: 'submit_attempt', detail: { po: order.poLabel, kind: order.kind, lines: order.lines.length, deliveryDate: order.deliveryDate } })
    try {
      const result = await sendOrderToSupplier(order)
      await logApiEvent(admin, { ...base, event: 'submit_ok', detail: { po: order.poLabel, confirmation: result.reference } })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Same split the send flow uses: a definite refusal vs "not sure it went out".
      const refused = (error as { refused?: boolean })?.refused === true || /refused|not set up|no order email|no API connection|invalid|rejected/i.test(message)
      await logApiEvent(admin, { ...base, event: refused ? 'submit_refused' : 'submit_unknown', detail: { po: order.poLabel, error: message.slice(0, 500) } })
      throw error
    }
  }
}
