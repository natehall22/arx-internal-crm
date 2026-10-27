import type { SupabaseClient } from '@supabase/supabase-js'

import { sourcingFor, type SupplierOrderContext } from '@/lib/supplier-orders'

/**
 * Move a DRAFT supplier PO to a different active supplier. Per-trade defaults stay in vendors.default_for_trades; this
 * only changes where THIS job's lines on one card are bought (the same per-trade pick the sourcing resolver already
 * reads), so the preview, the PDF and the send all follow it and use the new supplier's order email. Never sends.
 *
 * Only while the PO is a draft: a card whose PO was sent (or cancelled), or a target that already has a sent/cancelled
 * PO on this job, is refused — that is a change to something a supplier already holds, not a draft.
 */

export type SwitchPlan =
  | { ok: false; status: 400 | 404 | 409; error: string }
  | {
      ok: true
      trades: string[]
      lineKeys: string[]
      fromName: string
      toName: string
      /** The draft PO row for the old supplier: re-pointed at the new supplier, dropped (the new one already has a draft), or none yet. */
      draft: { action: 'move' | 'drop'; orderId: string } | { action: 'none' }
    }

export function planSupplierSwitch(ctx: SupplierOrderContext, fromVendorId: string, toVendorId: string): SwitchPlan {
  if (!fromVendorId || !toVendorId || fromVendorId === toVendorId) return { ok: false, status: 400, error: 'Pick a different supplier.' }
  if (ctx.jobStatus === 'cancelled') return { ok: false, status: 409, error: 'This job is cancelled.' }
  const to = ctx.suppliers.find((s) => s.id === toVendorId)
  if (!to || !to.active) return { ok: false, status: 400, error: 'That supplier is not active. An owner can turn it on in Settings → Suppliers.' }

  const group = sourcingFor(ctx).supplierGroups.find((g) => g.supplier.id === fromVendorId)
  if (!group) return { ok: false, status: 404, error: 'That order is no longer on this job. Reload the page.' }

  const fromOrder = ctx.orders.find((o) => o.vendorId === fromVendorId) ?? null
  const toOrder = ctx.orders.find((o) => o.vendorId === toVendorId) ?? null
  if (fromOrder && fromOrder.status !== 'draft') return { ok: false, status: 409, error: 'This order was already sent. Only a draft can change supplier.' }
  if (toOrder && toOrder.status !== 'draft') return { ok: false, status: 409, error: `${to.name} already has a sent order on this job. Only a draft can change supplier.` }
  const inFlight = ctx.sends.some((s) => (s.vendorId === fromVendorId || s.vendorId === toVendorId) && s.status === 'sending')
  if (inFlight) return { ok: false, status: 409, error: 'An email for this job is being sent right now. Wait a minute and try again.' }

  return {
    ok: true,
    trades: group.trades,
    lineKeys: group.lines.map((l) => l.key),
    fromName: group.supplier.name,
    toName: to.name,
    draft: fromOrder ? { action: toOrder ? 'drop' : 'move', orderId: fromOrder.id } : { action: 'none' },
  }
}

export async function applySupplierSwitch(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string; userId: string; toVendorId: string; plan: Extract<SwitchPlan, { ok: true }> }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId, jobId, toVendorId, plan } = args

  // 1. The per-trade pick (keeps any "installer buys it" style source the trade already has).
  const { data: existing, error: readError } = await admin.from('job_trade_material_sources').select('trade, material_source').eq('org_id', orgId).eq('job_id', jobId).in('trade', plan.trades)
  if (readError) return { ok: false, error: 'Could not save. Try again.' }
  const sourceByTrade = new Map((existing ?? []).map((r: { trade: string; material_source: string | null }) => [r.trade, r.material_source]))
  const now = new Date().toISOString()
  const { error: tradeError } = await admin.from('job_trade_material_sources').upsert(
    plan.trades.map((trade) => ({ org_id: orgId, job_id: jobId, trade, material_source: sourceByTrade.get(trade) ?? null, vendor_id: toVendorId, updated_by: args.userId, updated_at: now })),
    { onConflict: 'job_id,trade' }
  )
  if (tradeError) return { ok: false, error: 'Could not save. Try again.' }

  // 2. A line that had its own supplier pick (which beats the trade's) follows too.
  if (plan.lineKeys.length > 0) {
    const { error: lineError } = await admin.from('job_material_order_overrides').update({ vendor_id: toVendorId }).eq('job_id', jobId).in('item_key', plan.lineKeys).not('vendor_id', 'is', null)
    if (lineError) return { ok: false, error: 'Could not save. Try again.' }
  }

  // 3. The draft PO row. Guarded on status so a send that finished a moment ago is never rewritten.
  if (plan.draft.action === 'move') {
    await admin.from('supplier_orders').update({ vendor_id: toVendorId, updated_at: now }).eq('id', plan.draft.orderId).eq('org_id', orgId).eq('status', 'draft')
  } else if (plan.draft.action === 'drop') {
    await admin.from('supplier_orders').delete().eq('id', plan.draft.orderId).eq('org_id', orgId).eq('status', 'draft')
  }
  return { ok: true }
}
