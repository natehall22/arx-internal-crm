/**
 * Purchase orders on a job or a service visit.
 *   GET  ?jobId=… | ?workOrderId=…  — this job's POs (roofing material orders included, read-only here) + the vendor list
 *   POST { jobId | workOrderId, id?, vendorId, lines[], date, dateKind, address, note, title } — save a DRAFT (one PO per vendor
 *        per job: the same vendor edits that PO). Sends nothing; sending is POST /api/ops/purchase-orders/[id]/send.
 */
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { isUuid, parsePoDraft } from '@/lib/purchase-orders'
import { listPurchaseOrders, loadPoTarget, loadVendorDirectory, savePoDraft, isPurchaseOrdersNotReady } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

function scopeOf(src: { get(k: string): unknown }): { jobId: string } | { workOrderId: string } | null {
  const jobId = src.get('jobId')
  const workOrderId = src.get('workOrderId')
  if (isUuid(jobId)) return { jobId }
  if (isUuid(workOrderId)) return { workOrderId }
  return null
}

export async function GET(request: NextRequest) {
  const a = await authorizePo('canView')
  if ('error' in a) return a.error
  const { admin, orgId, access } = a.ctx
  const scope = scopeOf(request.nextUrl.searchParams)
  if (!scope) return NextResponse.json({ error: 'jobId or workOrderId is required' }, { status: 400 })
  try {
    const target = await loadPoTarget(admin, orgId, scope)
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [orders, vendors] = await Promise.all([
      listPurchaseOrders(admin, orgId, scope, { showMoney: access.canSeeMoney }),
      access.canEdit ? loadVendorDirectory(admin, orgId) : Promise.resolve([]),
    ])
    return NextResponse.json({
      orders,
      vendors,
      canEdit: access.canEdit,
      canBill: access.canBill,
      showMoney: access.canSeeMoney,
      target: { reference: target.reference, address: target.address, scheduledDate: target.scheduledDate, cancelled: target.cancelled, jobId: target.jobId, workOrderId: target.workOrderId },
    })
  } catch (error) {
    console.error('[purchase-orders GET]', error)
    return NextResponse.json({ error: isPurchaseOrdersNotReady(error as never) ? 'Purchase orders are not switched on yet.' : 'Could not load orders.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { admin, orgId, authUser } = a.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const scope = scopeOf({ get: (k) => body?.[k] })
  if (!scope) return NextResponse.json({ error: 'jobId or workOrderId is required' }, { status: 400 })
  const parsed = parsePoDraft(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const target = await loadPoTarget(admin, orgId, scope)
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const existingId = isUuid(body?.id) ? (body?.id as string) : null
  const result = await savePoDraft(admin, target, authUser.id, parsed.value, existingId)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return NextResponse.json({ id: result.id, created: result.created })
}
