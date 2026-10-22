/**
 * POST — ABC Supply ORDER_UPDATE webhook. Records the branch's order number and latest status on the send
 * that carries that confirmation number. It can only RECORD: nothing here can place, change or cancel an order.
 * ABC puts the shared secret from webhook registration in the Authorization header; unset secret = 503.
 */
import { NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/service'
import { logApiEvent } from '@/lib/suppliers/abc/settings-db'
import { secretMatches } from '@/lib/suppliers/abc/webhook'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const secret = process.env.ABC_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  if (!secretMatches(request.headers.get('authorization'), secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { salesOrder?: Record<string, unknown> } | null
  const so = body?.salesOrder
  const confirmation = typeof so?.confirmationNumber === 'string' ? so.confirmationNumber : null
  if (!so || !confirmation) return NextResponse.json({ ok: true, matched: false })

  const admin = createServiceClient()
  const { data: sends } = await admin
    .from('supplier_order_sends')
    .select('id, org_id, job_id, vendor_id')
    .eq('connection_type', 'api')
    .eq('message_id', confirmation)
    .limit(2)
  // Zero or ambiguous matches are acknowledged and ignored; ABC only needs a 2xx.
  if (!sends || sends.length !== 1) return NextResponse.json({ ok: true, matched: false })
  const send = sends[0] as { id: string; org_id: string; job_id: string; vendor_id: string }

  const status = typeof so.status === 'string' ? so.status.slice(0, 60) : null
  const orderNumber = typeof so.orderNumber === 'string' ? so.orderNumber.slice(0, 60) : null
  await admin
    .from('supplier_order_sends')
    .update({ supplier_status: status, supplier_order_number: orderNumber, supplier_status_at: new Date().toISOString() })
    .eq('id', send.id)
  await logApiEvent(admin, {
    orgId: send.org_id, vendorId: send.vendor_id, jobId: send.job_id, sendId: send.id, actorUserId: null,
    event: 'webhook', detail: { confirmation, status, orderNumber },
  })
  return NextResponse.json({ ok: true, matched: true })
}
