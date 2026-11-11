/**
 * POST — send ONE purchase order (or its cancellation). With the materials send route
 * (/api/ops/jobs/[id]/supplier-orders/send) the only place an order is placed: nothing else (status change, cron,
 * background job) may call sendOrderToSupplier (lib/__tests__/supplier-send-door.test.ts).
 *   { kind: 'order'|'cancellation', previewToken, confirmResend, manual? }
 * `manual: true` = "I sent this myself": logged the same way, nothing is emailed.
 * `previewToken` must match what the server would preview right now, so a person always sends exactly what they just looked at.
 */
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { executePoSend, poSendStore } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'
import { sendOrderToSupplier } from '@/lib/suppliers/send-order'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { admin, orgId, authUser, profile } = a.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const result = await executePoSend(
      admin,
      orgId,
      params.id,
      {
        requested: body?.kind === 'cancellation' ? 'cancellation' : 'order',
        previewToken: typeof body?.previewToken === 'string' ? body.previewToken : '',
        confirmResend: body?.confirmResend === true,
        manual: body?.manual === true,
      },
      { id: authUser.id, name: profile.full_name ?? null, email: profile.email ?? null, canSend: a.ctx.access.canEdit },
      { store: poSendStore(admin), transmit: sendOrderToSupplier }
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.message, needsConfirm: result.needsConfirm ?? false, confirmMessage: result.confirmMessage ?? null }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('[purchase-orders/send] failed', error)
    return NextResponse.json({ error: 'Not sent. Try again or download and email it yourself.' }, { status: 500 })
  }
}
