/**
 * GET — exactly what "Send order to <vendor>" would send, without sending it. ?kind=order|cancellation, &format=pdf for the PDF.
 * Read-only: writes nothing, sends nothing.
 */
import { NextRequest, NextResponse } from 'next/server'

import { buildPoPreview, loadPoContext } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  const { admin, orgId, authUser, profile } = a.ctx
  const loaded = await loadPoContext(admin, orgId, params.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.message }, { status: loaded.status })
  const q = request.nextUrl.searchParams
  const requested = q.get('kind') === 'cancellation' ? 'cancellation' : 'order'
  const manual = q.get('manual') === '1'
  const p = buildPoPreview(loaded.ctx, { requested, manual }, { id: authUser.id, name: profile.full_name ?? null, email: profile.email ?? null }, new Date(), loaded.ctx.canLink ? '(a one-tap confirm link is added when it is sent)' : null)
  if (q.get('format') === 'pdf') {
    if (!p.pdf) return NextResponse.json({ error: 'Nothing to print yet.' }, { status: 404 })
    return new NextResponse(new Uint8Array(p.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="PO ${p.poLabel}.pdf"`, 'Cache-Control': 'private, no-store' } })
  }
  return NextResponse.json({
    preview: {
      poId: p.poId,
      vendorName: p.vendorName,
      kind: p.kind,
      poLabel: p.poLabel,
      to: p.email.to,
      cc: p.email.cc,
      subject: p.email.subject,
      body: p.email.text,
      changes: p.changes,
      totalCents: p.totalCents,
      lineCount: p.lines.length,
      confirmMessage: p.confirmMessage,
      blockers: p.blockers,
      previewToken: p.previewToken,
      sendButtonLabel: p.sendButtonLabel,
      hasPdf: !!p.pdf,
    },
  })
}
