import type { SupabaseClient } from '@supabase/supabase-js'

import { isOwnerProfile } from '@/lib/super-admin'
import { decideSecondApproval } from '@/lib/suppliers/abc/gate'
import { estimateTotalCents } from '@/lib/suppliers/abc/payload'
import { logApiEvent } from '@/lib/suppliers/abc/settings-db'
import type { SupplierOrderContext, SendActor, SupplierOrderPreview } from '@/lib/supplier-orders'
import type { SupplierRecord } from '@/lib/material-sourcing'

type Profile = { is_super_admin?: boolean | null; role?: string | null; active?: boolean | null }

/**
 * `SendDeps.beforeTransmit` for the supplier-API second-approver rule. Email suppliers pass straight through.
 * Approvals are single-use: the row flips pending → used in one conditional UPDATE, so two people pressing
 * Send at once cannot both consume it.
 */
export function makeApiBeforeTransmit(admin: SupabaseClient, profile: Profile) {
  return async (args: { ctx: SupplierOrderContext; supplier: SupplierRecord; preview: SupplierOrderPreview; actor: SendActor; orderId: string }) => {
    const { ctx, supplier, preview, actor, orderId } = args
    if (supplier.connectionType !== 'api' || !supplier.api) return { ok: true as const }

    const estimated = estimateTotalCents(preview.lines, supplier.api.itemMap)
    const open = (ctx.apiApprovals ?? []).find((a) => a.supplierOrderId === orderId && a.contentHash === preview.contentHash && a.status === 'pending') ?? null
    const decision = decideSecondApproval({
      estimatedTotalCents: estimated,
      thresholdCents: supplier.api.secondApprovalCents,
      actor: { id: actor.id, isOwner: isOwnerProfile(profile) },
      open,
    })
    const base = { orgId: ctx.orgId, vendorId: supplier.id, jobId: ctx.jobId, actorUserId: actor.id, environment: supplier.api.environment }

    if (decision.action === 'allow') return { ok: true as const }

    if (decision.action === 'request') {
      const { error } = await admin.from('supplier_api_approvals').insert({
        org_id: ctx.orgId,
        vendor_id: supplier.id,
        job_id: ctx.jobId,
        supplier_order_id: orderId,
        content_hash: preview.contentHash,
        estimated_total_cents: estimated,
        requested_by: actor.id,
      })
      // A concurrent identical request (unique index) is fine: it is already waiting.
      if (error && error.code !== '23505') return { ok: false as const, status: 500, message: 'Could not save the approval request. Nothing was sent.' }
      await logApiEvent(admin, { ...base, event: 'approval_requested', detail: { po: preview.poLabel, estimatedTotalCents: estimated } })
      return { ok: false as const, status: 409, message: decision.message }
    }

    if (decision.action === 'block') return { ok: false as const, status: 409, message: decision.message }

    const now = new Date().toISOString()
    const { data, error } = await admin
      .from('supplier_api_approvals')
      .update({ status: 'used', decided_by: actor.id, decided_at: now, used_at: now })
      .eq('id', decision.approvalId)
      .eq('status', 'pending')
      .select('id')
    if (error || !data || data.length === 0) {
      return { ok: false as const, status: 409, message: 'This approval was just used or withdrawn. Refresh and review the order again.' }
    }
    await logApiEvent(admin, { ...base, event: 'approved', detail: { po: preview.poLabel, approvalId: decision.approvalId, estimatedTotalCents: estimated } })
    return { ok: true as const }
  }
}
