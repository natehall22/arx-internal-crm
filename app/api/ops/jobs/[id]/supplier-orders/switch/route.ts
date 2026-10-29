/**
 * POST { fromVendorId, toVendorId } — move a DRAFT supplier order to another active supplier. Never sends. Refused once the PO is sent.
 * Logged on the job (system note) with who and from/to. See lib/supplier-order-switch.ts.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { applySupplierSwitch, planSupplierSwitch } from '@/lib/supplier-order-switch'
import { loadSupplierOrderContext, resolveSupplierOrderAccess } from '@/lib/supplier-orders'
import { writeJobNote } from '@/lib/threads/job-notes'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let session: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    session = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = session
  const admin = createServiceClient()
  const access = await resolveSupplierOrderAccess(admin, authUser.id, profile)
  if (!access.canSend) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const fromVendorId = typeof body?.fromVendorId === 'string' ? body.fromVendorId : ''
  const toVendorId = typeof body?.toVendorId === 'string' ? body.toVendorId : ''

  try {
    const loaded = await loadSupplierOrderContext(admin, profile.org_id, params.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.reason === 'not_found' ? 'Job not found' : 'Supplier orders are not set up yet.' }, { status: loaded.reason === 'not_found' ? 404 : 409 })
    const plan = planSupplierSwitch(loaded.ctx, fromVendorId, toVendorId)
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status })

    const result = await applySupplierSwitch(admin, { orgId: profile.org_id, jobId: params.id, userId: profile.id, toVendorId, plan })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

    await writeJobNote(admin, {
      orgId: profile.org_id,
      jobId: params.id,
      userId: profile.id,
      kind: 'system',
      body: `Draft supplier order moved from ${plan.fromName} to ${plan.toName} (${plan.trades.join(', ')}).`,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[supplier-orders/switch] failed', error)
    return NextResponse.json({ error: 'Could not switch the supplier' }, { status: 500 })
  }
}
