/**
 * GET — exactly what "Send order to <Supplier>" would send, without sending it.
 *   ?vendorId=…&kind=order|cancellation&deliveryDate=YYYY-MM-DD&deliveryAddress=…&note=…
 *   &format=pdf returns the PO PDF itself (for the preview iframe).
 *
 * Read-only: writes nothing, sends nothing, allocates no PO number.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { buildSupplierOrderPreview, loadSupplierOrderContext, resolveSupplierOrderAccess } from '@/lib/supplier-orders'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  let auth
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    const access = await resolveSupplierOrderAccess(admin, authUser.id, profile)
    auth = { admin, authUser, profile, ...access }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!auth.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = request.nextUrl.searchParams
  const vendorId = q.get('vendorId') || ''
  if (!vendorId) return NextResponse.json({ error: 'vendorId is required' }, { status: 400 })
  const requested = q.get('kind') === 'cancellation' ? 'cancellation' : 'order'

  try {
    const loaded = await loadSupplierOrderContext(auth.admin, auth.profile.org_id, params.id)
    if (!loaded.ok) {
      return NextResponse.json(
        { error: loaded.reason === 'not_found' ? 'Job not found' : 'Emailing orders is not switched on yet.' },
        { status: loaded.reason === 'not_found' ? 404 : 409 }
      )
    }
    const built = buildSupplierOrderPreview(
      loaded.ctx,
      { vendorId, requested, deliveryDate: q.get('deliveryDate'), deliveryAddress: q.get('deliveryAddress'), note: q.get('note') },
      { id: auth.authUser.id, name: auth.profile.full_name ?? null, email: auth.profile.email ?? null }
    )
    if (!built.ok) return NextResponse.json({ error: built.message }, { status: built.status })
    const p = built.preview

    if (q.get('format') === 'pdf') {
      if (!p.pdf) return NextResponse.json({ error: 'No PDF for this preview' }, { status: 404 })
      return new NextResponse(new Uint8Array(p.pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${(p.email.attachmentName ?? 'PO.pdf').replace(/"/g, '')}"`,
          'Cache-Control': 'no-store, max-age=0',
        },
      })
    }

    const { pdf: _pdf, sheet: _sheet, ...rest } = p
    return NextResponse.json({ preview: { ...rest, hasPdf: !!p.pdf }, canSend: auth.canSend })
  } catch (error) {
    console.error('[supplier-orders/preview] failed', error)
    return NextResponse.json({ error: 'Could not build the preview' }, { status: 500 })
  }
}
