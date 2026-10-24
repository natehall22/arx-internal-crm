/**
 * GET   — the job's supplier orders: one card per supplier, what's not on any PO and why,
 *         "N of M suppliers ordered", warnings. Read-only.
 * PATCH — where a TRADE's materials come from on this job: { trade, material_source, vendor_id }.
 *         Changes what the next preview shows; never sends anything.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isMaterialSource } from '@/lib/material-sourcing'
import { createServiceClient } from '@/lib/supabase/service'
import { buildSupplierOrdersView, loadSupplierOrderContext, materialsStateForContext, resolveSupplierOrderAccess } from '@/lib/supplier-orders'

export const dynamic = 'force-dynamic'

async function authorize() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    const access = await resolveSupplierOrderAccess(admin, authUser.id, profile)
    return { admin, authUser, profile, ...access }
  } catch {
    return null
  }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const loaded = await loadSupplierOrderContext(auth.admin, auth.profile.org_id, params.id)
    if (!loaded.ok && loaded.reason === 'not_found') return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!loaded.ok) {
      return NextResponse.json({ setupMissing: true, message: 'Emailing orders is not switched on yet (database update pending).' })
    }
    const { data: stored } = await auth.admin.from('production_jobs').select('materials_status').eq('id', params.id).eq('org_id', auth.profile.org_id).maybeSingle()
    return NextResponse.json({
      ...buildSupplierOrdersView(loaded.ctx),
      // The ONE materials answer (derived from the supplier orders; the stored status is only the fallback).
      materialsState: materialsStateForContext(loaded.ctx, (stored as { materials_status: string | null } | null)?.materials_status ?? null),
      canSend: auth.canSend,
    })
  } catch (error) {
    console.error('[supplier-orders] GET failed', error)
    return NextResponse.json({ error: 'Could not load supplier orders' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canSend) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const trade = typeof body?.trade === 'string' ? body.trade.trim().toLowerCase() : ''
  if (!trade || trade.length > 40) return NextResponse.json({ error: 'trade is required' }, { status: 400 })
  const source = body?.material_source == null || body.material_source === '' ? null : body.material_source
  if (source !== null && !isMaterialSource(source)) return NextResponse.json({ error: 'Unknown material source' }, { status: 400 })
  const vendorId = typeof body?.vendor_id === 'string' && body.vendor_id ? body.vendor_id : null

  const admin = auth.admin
  const orgId = auth.profile.org_id
  const { data: job } = await admin.from('production_jobs').select('id').eq('id', params.id).eq('org_id', orgId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (vendorId) {
    const { data: vendor } = await admin.from('vendors').select('id').eq('id', vendorId).eq('org_id', orgId).is('deleted_at', null).maybeSingle()
    if (!vendor) return NextResponse.json({ error: 'Supplier not found' }, { status: 400 })
  }

  if (source === null && vendorId === null) {
    const { error } = await admin.from('job_trade_material_sources').delete().eq('org_id', orgId).eq('job_id', params.id).eq('trade', trade)
    if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  const { error } = await admin.from('job_trade_material_sources').upsert(
    {
      org_id: orgId,
      job_id: params.id,
      trade,
      material_source: source,
      vendor_id: source === null || source === 'supplier' ? vendorId : null,
      updated_by: auth.authUser.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id,trade' }
  )
  if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
