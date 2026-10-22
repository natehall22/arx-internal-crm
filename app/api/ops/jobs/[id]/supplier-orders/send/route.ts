/**
 * POST — send ONE supplier's order (or cancellation). The only route that places an order:
 * nothing else (status change, cron, background job) may call sendOrderToSupplier.
 *   { vendorId, kind: 'order'|'cancellation', deliveryDate, deliveryAddress, note, previewToken, confirmResend, manual? }
 * `manual: true` = "I sent this to the supplier myself": recorded in the same log and roll-up, nothing is emailed.
 * `previewToken` must match what the server would preview right now, so a person always sends
 * exactly what they just looked at.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { markMaterialsOrdered, unmarkMaterialsOrdered } from '@/lib/job-status-events'
import { createServiceClient } from '@/lib/supabase/service'
import { sendOrderToSupplier } from '@/lib/suppliers/send-order'
import {
  executeSupplierOrderSend,
  loadSupplierOrderContext,
  resolveSupplierOrderAccess,
  supabaseSupplierOrderStore,
} from '@/lib/supplier-orders'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    const access = await resolveSupplierOrderAccess(admin, authUser.id, profile)
    auth = { admin, authUser, profile, ...access }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!auth.canSend) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const vendorId = str(body?.vendorId)
  if (!vendorId) return NextResponse.json({ error: 'vendorId is required' }, { status: 400 })

  try {
    const loaded = await loadSupplierOrderContext(auth.admin, auth.profile.org_id, params.id)
    if (!loaded.ok) {
      return NextResponse.json(
        { error: loaded.reason === 'not_found' ? 'Job not found' : 'Emailing orders is not switched on yet.' },
        { status: loaded.reason === 'not_found' ? 404 : 409 }
      )
    }
    const result = await executeSupplierOrderSend(
      loaded.ctx,
      {
        vendorId,
        requested: body?.kind === 'cancellation' ? 'cancellation' : 'order',
        deliveryDate: str(body?.deliveryDate),
        deliveryAddress: str(body?.deliveryAddress),
        note: str(body?.note),
        previewToken: str(body?.previewToken) ?? '',
        confirmResend: body?.confirmResend === true,
        manual: body?.manual === true,
      },
      {
        id: auth.authUser.id,
        name: auth.profile.full_name ?? null,
        email: auth.profile.email ?? null,
        canSend: auth.canSend,
      },
      {
        store: supabaseSupplierOrderStore(auth.admin),
        transmit: sendOrderToSupplier,
        markMaterialsOrdered: ({ orgId, jobId }) =>
          markMaterialsOrdered(auth.admin, { orgId, jobId, source: 'one_tap' }),
        unmarkMaterialsOrdered: ({ orgId, jobId }) => unmarkMaterialsOrdered(auth.admin, { orgId, jobId }),
      }
    )
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, needsConfirm: result.needsConfirm ?? false, confirmMessage: result.confirmMessage ?? null },
        { status: result.status }
      )
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('[supplier-orders/send] failed', error)
    return NextResponse.json({ error: 'Not sent. Try again or download and email it yourself.' }, { status: 500 })
  }
}
