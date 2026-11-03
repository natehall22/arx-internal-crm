import type { SupabaseClient } from '@supabase/supabase-js'

import { draftMoveGuard } from '@/lib/supplier-order-switch'
import { sourcingFor, type SupplierOrderContext } from '@/lib/supplier-orders'

/**
 * Move ONE line of a DRAFT supplier PO to another active supplier (the "+ Add supplier" second card). Writes the same
 * per-line pick (job_material_order_overrides.vendor_id) the sourcing resolver already reads, so the card, preview, PDF
 * and send all follow it. Never sends. Same guards as the card switch ({@link draftMoveGuard}): nothing a supplier already holds moves.
 */

export type LineMovePlan =
  | { ok: false; status: 400 | 404 | 409; error: string }
  | { ok: true; itemKey: string; fromName: string; toName: string; label: string }

export function planLineSupplierMove(ctx: SupplierOrderContext, itemKey: string, toVendorId: string): LineMovePlan {
  if (!itemKey || !toVendorId) return { ok: false, status: 400, error: 'Pick a supplier.' }
  const group = sourcingFor(ctx).supplierGroups.find((g) => g.lines.some((l) => l.key === itemKey))
  if (!group) return { ok: false, status: 404, error: 'That item is no longer on a supplier order. Reload the page.' }
  const guard = draftMoveGuard(ctx, group.supplier.id, toVendorId)
  if (!guard.ok) return guard

  const label = group.lines.find((l) => l.key === itemKey)?.label ?? itemKey
  return { ok: true, itemKey, fromName: group.supplier.name, toName: guard.to.name, label }
}

export async function applyLineSupplierMove(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string; userId: string; toVendorId: string; plan: Extract<LineMovePlan, { ok: true }> }
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Upsert only these columns, so an existing row keeps its qty/excluded/note edits.
  const { error } = await admin.from('job_material_order_overrides').upsert(
    { org_id: args.orgId, job_id: args.jobId, item_key: args.plan.itemKey, vendor_id: args.toVendorId, updated_by: args.userId, updated_at: new Date().toISOString() },
    { onConflict: 'job_id,item_key' }
  )
  return error ? { ok: false, error: 'Could not save. Try again.' } : { ok: true }
}
