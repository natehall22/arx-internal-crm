import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveSupplierOrderAccess, syncMaterialsMirror } from '@/lib/supplier-orders'

export const dynamic = 'force-dynamic'

/**
 * POST { vendorId, received: boolean } - mark one supplier's order received (the materials arrived), or undo it.
 * Only an order that was SENT can be received. The job's materials status follows (all sent + all received = Received).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let ctx
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    ctx = { admin, authUser, profile, ...(await resolveSupplierOrderAccess(admin, authUser.id, profile)) }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ctx.canSend) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return NextResponse.json({ error: 'JSON only' }, { status: 415 })
  const body = (await request.json().catch(() => null)) as { vendorId?: string; received?: boolean } | null
  if (!body?.vendorId || typeof body.received !== 'boolean') return NextResponse.json({ error: 'vendorId and received are required' }, { status: 400 })

  const orgId = ctx.profile.org_id
  const { data: order } = await ctx.admin
    .from('supplier_orders')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('job_id', params.id)
    .eq('vendor_id', body.vendorId)
    .maybeSingle()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'sent') return NextResponse.json({ error: 'Only an order that was sent can be marked received' }, { status: 409 })

  const { error } = await ctx.admin
    .from('supplier_orders')
    .update(body.received ? { received_at: new Date().toISOString(), received_by: ctx.profile.id } : { received_at: null, received_by: null })
    .eq('id', order.id)
    .eq('org_id', orgId)
  if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 })

  const sync = await syncMaterialsMirror(ctx.admin, orgId, params.id)
  return NextResponse.json({ ok: true, materialsState: sync.state })
}
