/**
 * General purchase orders (any vendor or subcontractor) — load, draft, preview, send, receive, acknowledge, bill. Server-only.
 *
 * Same safety model as the roofing materials order (lib/supplier-orders.ts), on the same tables:
 *   - nothing here runs on its own; a PO leaves only from POST /api/ops/purchase-orders/[id]/send, which a person
 *     reaches by pressing "Send to <vendor>" on the preview;
 *   - the send re-builds the preview and refuses unless it matches what the person saw (`previewToken`);
 *   - a re-send / revision / re-cancel needs a second yes (`decideSend`); one in-flight send per PO; every attempt logged,
 *     the PDF stored, a failure marks nothing sent;
 *   - an API-connected vendor is refused (general POs go by email or "I sent it myself").
 * A vendor bill's cost goes into the job ledger through `addJobCostLine` — the one writer — once per bill.
 */
import { firstForeignRef } from '@/lib/supabase/org-db'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'crypto'

import { tryOrgAppUrl } from '@/lib/company-links'
import { addJobCostLine, loadJobCostLedger } from '@/lib/job-cost-ledger'
import {
  canonicalContent,
  decideSend,
  describeOrderChanges,
  nextPoLetter,
  poLabel,
  poNumber,
  type LineSnapshot,
  type SendKind,
  type SupplierOrderRecord,
  type SupplierRecord,
} from '@/lib/material-sourcing'
import { getOrgBrand } from '@/lib/org-brand'
import { renderPurchaseOrderPDF } from '@/lib/pdf/purchase-order'
import {
  BILL_TOLERANCE_CENTS,
  billCostDescription,
  centsToDollars,
  checkBillAgainstPo,
  clampReceived,
  derivePoStatus,
  dollarsToCents,
  formatMoney,
  isUuid,
  lineKey,
  lineQtyText,
  lineTotalCents,
  poTotalCents,
  sendStateOf,
  toOrderLines,
  type BillInput,
  type PoDateKind,
  type PoDraftInput,
  type PoKind,
  type PoStatus,
} from '@/lib/purchase-orders'
import { composePurchaseOrderEmail, type ComposedSupplierEmail, type SupplierOrderSender } from '@/lib/supplier-order-email'
import {
  NOT_SENT_MESSAGE,
  STALE_SEND_MS,
  sha256,
  supabaseSupplierOrderStore,
  supplierFromRow,
  type SupplierOrderStore,
} from '@/lib/supplier-orders'
import { supplierChannelProblem, type SupplierOrderTransmission, type SupplierOrderTransmitResult } from '@/lib/suppliers/send-order'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

export type PoScope = { jobId: string } | { workOrderId: string }

export type PoTarget = {
  orgId: string
  jobId: string | null
  workOrderId: string | null
  /** Job number, or the visit's work order number: the PO number's prefix. */
  reference: string
  customerName: string | null
  address: string | null
  scheduledDate: string | null
  cancelled: boolean
}

export type PoLineRow = {
  id: string
  position: number
  description: string
  quantity: number
  unit: string | null
  unitCostCents: number
  costType: string
  costCode: string | null
  pricebookItemId: string | null
  receivedQuantity: number
}

export type PoBillRow = {
  id: string
  billNumber: string | null
  billDate: string | null
  amountCents: number
  isCredit: boolean
  status: 'active' | 'void'
  costLineId: string | null
  createdAt: string
  notes: string | null
}

export type PurchaseOrder = {
  id: string
  kind: PoKind
  vendorId: string
  vendorName: string
  vendorType: string
  poNumber: string
  revision: number
  label: string
  status: PoStatus
  title: string | null
  date: string | null
  dateKind: PoDateKind
  address: string | null
  note: string | null
  jobId: string | null
  workOrderId: string | null
  lines: PoLineRow[]
  totalCents: number
  billedCents: number
  bills: PoBillRow[]
  firstSentAt: string | null
  lastSentAt: string | null
  lastSentTo: string | null
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  receivedAt: string | null
  /** Edited after it was sent: the next send is a revision. */
  changedSinceSent: boolean
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

function missing(error: { message?: string; code?: string } | null | undefined): boolean {
  return !!error && (error.code === '42P01' || error.code === '42703' || /purchase_order|supplier_orders\.(kind|work_order_id)|column .* does not exist|relation .* does not exist/i.test(error.message ?? ''))
}
export const isPurchaseOrdersNotReady = missing

// ---------------------------------------------------------------------------
// Target (the job or the service visit a PO belongs to)
// ---------------------------------------------------------------------------

export async function loadPoTarget(admin: SupabaseClient, orgId: string, scope: PoScope): Promise<PoTarget | null> {
  if ('jobId' in scope) {
    const { data: job } = await admin
      .from('production_jobs')
      .select('id, job_number, status, address_text, scheduled_date, customer:customers(name)')
      .eq('id', scope.jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return null
    const j = job as Record<string, unknown>
    const customer = Array.isArray(j.customer) ? j.customer[0] : j.customer
    return {
      orgId,
      jobId: String(j.id),
      workOrderId: null,
      reference: String(j.job_number ?? j.id),
      customerName: s((customer as { name?: unknown } | null)?.name),
      address: s(j.address_text),
      scheduledDate: s(j.scheduled_date),
      cancelled: j.status === 'cancelled',
    }
  }
  const { data: wo } = await admin
    .from('work_orders')
    .select('id, work_order_number, job_id, address, scheduled_date, status, customer:customers(name)')
    .eq('id', scope.workOrderId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!wo) return null
  const w = wo as Record<string, unknown>
  const customer = Array.isArray(w.customer) ? w.customer[0] : w.customer
  let jobAddress: string | null = null
  if (w.job_id) {
    const { data: job } = await admin.from('production_jobs').select('address_text').eq('id', String(w.job_id)).eq('org_id', orgId).maybeSingle()
    jobAddress = s((job as { address_text?: unknown } | null)?.address_text)
  }
  return {
    orgId,
    jobId: w.job_id ? String(w.job_id) : null,
    workOrderId: String(w.id),
    // A visit PO is numbered by its visit; one for an install trade crew keeps the job number + letter scheme.
    reference: String(w.work_order_number ?? w.id),
    customerName: s((customer as { name?: unknown } | null)?.name),
    address: s(w.address) ?? jobAddress,
    scheduledDate: s(w.scheduled_date),
    cancelled: w.status === 'cancelled',
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

type OrderRow = Record<string, unknown>

async function assemble(admin: SupabaseClient, orgId: string, rows: OrderRow[], showMoney: boolean): Promise<PurchaseOrder[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => String(r.id))
  const vendorIds = Array.from(new Set(rows.map((r) => String(r.vendor_id))))
  const [linesRes, billsRes, vendorsRes] = await Promise.all([
    admin.from('purchase_order_lines').select('*').eq('org_id', orgId).in('supplier_order_id', ids).order('position'),
    admin.from('purchase_order_bills').select('*').eq('org_id', orgId).in('supplier_order_id', ids).order('created_at'),
    admin.from('vendors').select('id, name, vendor_type').eq('org_id', orgId).in('id', vendorIds),
  ])
  if (linesRes.error && !missing(linesRes.error)) throw new Error(linesRes.error.message)
  const vendors = new Map(((vendorsRes.data ?? []) as OrderRow[]).map((v) => [String(v.id), v]))
  const linesBy = new Map<string, PoLineRow[]>()
  for (const l of (linesRes.data ?? []) as OrderRow[]) {
    const list = linesBy.get(String(l.supplier_order_id)) ?? []
    list.push({
      id: String(l.id),
      position: n(l.position),
      description: String(l.description),
      quantity: n(l.quantity),
      unit: s(l.unit),
      unitCostCents: showMoney ? Math.round(n(l.unit_cost) * 100) : 0,
      costType: String(l.cost_type ?? 'material'),
      costCode: s(l.cost_code),
      pricebookItemId: s(l.pricebook_item_id),
      receivedQuantity: n(l.received_quantity),
    })
    linesBy.set(String(l.supplier_order_id), list)
  }
  const billsBy = new Map<string, PoBillRow[]>()
  for (const b of (billsRes.data ?? []) as OrderRow[]) {
    const list = billsBy.get(String(b.supplier_order_id)) ?? []
    list.push({
      id: String(b.id),
      billNumber: s(b.bill_number),
      billDate: s(b.bill_date),
      amountCents: showMoney ? Math.round(n(b.amount) * 100) : 0,
      isCredit: b.is_credit === true,
      status: b.status === 'void' ? 'void' : 'active',
      costLineId: s(b.cost_line_id),
      createdAt: String(b.created_at),
      notes: s(b.notes),
    })
    billsBy.set(String(b.supplier_order_id), list)
  }
  return rows.map((r) => {
    const lines = linesBy.get(String(r.id)) ?? []
    const bills = billsBy.get(String(r.id)) ?? []
    const kind: PoKind = r.kind === 'general' ? 'general' : 'materials'
    const status = String(r.status) as PoStatus
    const revision = n(r.revision)
    const vendor = vendors.get(String(r.vendor_id))
    const billed = bills.filter((b) => b.status === 'active').reduce((sum, b) => sum + (b.isCredit ? -b.amountCents : b.amountCents), 0)
    return {
      id: String(r.id),
      kind,
      vendorId: String(r.vendor_id),
      vendorName: String(vendor?.name ?? 'Vendor'),
      vendorType: String(vendor?.vendor_type ?? 'supplier'),
      poNumber: String(r.po_number),
      revision,
      label: poLabel(String(r.po_number), revision),
      status,
      title: s(r.title),
      date: s(r.draft_date),
      dateKind: r.draft_date_kind === 'start' ? 'start' : 'delivery',
      address: s(r.draft_address),
      note: s(r.draft_note),
      jobId: s(r.job_id),
      workOrderId: s(r.work_order_id),
      lines,
      totalCents: poTotalCents(lines),
      billedCents: billed,
      bills,
      firstSentAt: s(r.first_sent_at),
      lastSentAt: s(r.last_sent_at),
      lastSentTo: s(r.last_sent_to),
      acknowledgedAt: s(r.acknowledged_at),
      acknowledgedBy: s(r.acknowledged_by),
      receivedAt: s(r.received_at),
      changedSinceSent: false,
    }
  })
}

/** Every PO on a job or visit — roofing material orders included (kind 'materials', no lines here). */
export async function listPurchaseOrders(admin: SupabaseClient, orgId: string, scope: PoScope, opts: { showMoney: boolean }): Promise<PurchaseOrder[]> {
  let q = admin.from('supplier_orders').select('*').eq('org_id', orgId)
  q = 'jobId' in scope ? q.eq('job_id', scope.jobId) : q.eq('work_order_id', scope.workOrderId)
  const { data, error } = await q.order('created_at')
  if (error) {
    if (missing(error)) return []
    throw new Error(error.message)
  }
  const orders = await assemble(admin, orgId, (data ?? []) as OrderRow[], opts.showMoney)
  // "Changed since sent": the lines/date/address no longer match what the last send recorded.
  for (const o of orders) {
    if (o.kind !== 'general' || o.status === 'draft' || o.status === 'cancelled') continue
    const row = (data as OrderRow[]).find((r) => String(r.id) === o.id)!
    const hash = sha256(canonicalContent(poOrderLines(o), o.date, o.address))
    o.changedSinceSent = !!row.last_content_hash && row.last_content_hash !== hash
  }
  return orders
}

export async function loadPurchaseOrder(admin: SupabaseClient, orgId: string, id: string, opts: { showMoney: boolean }): Promise<PurchaseOrder | null> {
  if (!isUuid(id)) return null
  const { data } = await admin.from('supplier_orders').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
  if (!data) return null
  const [po] = await assemble(admin, orgId, [data as OrderRow], opts.showMoney)
  if (po && po.kind === 'general' && po.status !== 'draft' && po.status !== 'cancelled') {
    po.changedSinceSent = !!(data as OrderRow).last_content_hash && (data as OrderRow).last_content_hash !== sha256(canonicalContent(poOrderLines(po), po.date, po.address))
  }
  return po
}

function poOrderLines(po: PurchaseOrder, withPrice = true) {
  return toOrderLines(
    po.lines.map((l, i) => ({
      key: lineKey(l, i),
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitCostCents: l.unitCostCents,
      costType: l.costType as never,
      costCode: l.costCode,
      pricebookItemId: l.pricebookItemId,
    }))
    , withPrice
  )
}

// ---------------------------------------------------------------------------
// Vendor directory
// ---------------------------------------------------------------------------

export type DirectoryVendor = {
  id: string
  name: string
  vendorType: 'supplier' | 'sub' | 'both'
  email: string | null
  phone: string | null
  trades: string[]
  connectionType: 'email' | 'api'
  /** Last time a PO went to them (newest first in pickers). */
  lastUsedAt: string | null
}

export async function loadVendorDirectory(admin: SupabaseClient, orgId: string): Promise<DirectoryVendor[]> {
  const { data, error } = await admin.from('vendors').select('*').eq('org_id', orgId).eq('active', true).is('deleted_at', null).order('name')
  if (error) throw new Error(error.message)
  const { data: recent } = await admin
    .from('supplier_orders')
    .select('vendor_id, last_sent_at, created_at')
    .eq('org_id', orgId)
    .eq('kind', 'general')
    .order('created_at', { ascending: false })
    .limit(200)
  const lastUsed = new Map<string, string>()
  for (const r of (recent ?? []) as OrderRow[]) if (!lastUsed.has(String(r.vendor_id))) lastUsed.set(String(r.vendor_id), String(r.last_sent_at ?? r.created_at))
  return ((data ?? []) as OrderRow[]).map((v) => ({
    id: String(v.id),
    name: String(v.name),
    vendorType: v.vendor_type === 'sub' ? 'sub' : v.vendor_type === 'both' ? 'both' : 'supplier',
    email: s(v.order_email) ?? s(v.email),
    phone: s(v.phone),
    trades: Array.isArray(v.trades) ? (v.trades as string[]) : [],
    connectionType: v.connection_type === 'api' ? 'api' : 'email',
    lastUsedAt: lastUsed.get(String(v.id)) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export type SaveDraftResult = { ok: true; id: string; created: boolean } | { ok: false; status: number; message: string }

/** One PO per vendor per job (per visit for a visit-only PO): saving to the same vendor edits that PO. */
export async function savePoDraft(
  admin: SupabaseClient,
  target: PoTarget,
  userId: string,
  input: PoDraftInput,
  existingId: string | null,
  /** An AI draft only STARTS an order: if the vendor already has one on this job (made or edited on screen meanwhile), nothing is replaced. */
  opts: { createOnly?: boolean } = {}
): Promise<SaveDraftResult> {
  const orgId = target.orgId
  if (target.cancelled) return { ok: false, status: 409, message: 'This job is cancelled, so orders cannot be changed.' }
  const { data: vendor } = await admin.from('vendors').select('id, active, deleted_at').eq('org_id', orgId).eq('id', input.vendorId).maybeSingle()
  if (!vendor || (vendor as OrderRow).deleted_at || (vendor as OrderRow).active === false) return { ok: false, status: 404, message: 'That vendor is not in your list.' }

  for (const l of input.lines) {
    if (await firstForeignRef(admin, orgId, { pricebook_item_id: ['pricebook_items', l.pricebookItemId] })) {
      return { ok: false, status: 400, message: 'One of the price book items is not in your price book.' }
    }
  }

  // Find the PO this edits: by id, else the vendor's PO on this job/visit.
  let q = admin.from('supplier_orders').select('*').eq('org_id', orgId).eq('kind', 'general').eq('vendor_id', input.vendorId)
  q = target.jobId ? q.eq('job_id', target.jobId) : q.is('job_id', null)
  q = target.workOrderId ? q.eq('work_order_id', target.workOrderId) : q.is('work_order_id', null)
  const { data: found } = await q.maybeSingle()
  let order = found as OrderRow | null
  if (existingId) {
    const { data: byId } = await admin.from('supplier_orders').select('*').eq('org_id', orgId).eq('id', existingId).maybeSingle()
    const b = byId as OrderRow | null
    // The order must belong to the job/visit being edited (the cancelled check above is on THIS target), same vendor, same company.
    if (!b || b.kind !== 'general' || b.vendor_id !== input.vendorId || (b.job_id ?? null) !== (target.jobId ?? null) || (b.work_order_id ?? null) !== (target.workOrderId ?? null)) {
      return { ok: false, status: 404, message: 'Order not found.' }
    }
    order = byId as OrderRow
  }
  if (opts.createOnly && order) return { ok: false, status: 409, message: 'This vendor already has an order on this job, so nothing was added. Change that order in the app.' }
  if (order && order.status === 'cancelled') {
    // A cancelled PO keeps its number; editing it reopens it as a revision on the next send.
  }

  let created = false
  if (!order) {
    created = true
    let inserted: OrderRow | null = null
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      let usedQ = admin.from('supplier_orders').select('po_letter').eq('org_id', orgId)
      usedQ = target.jobId ? usedQ.eq('job_id', target.jobId) : usedQ.eq('work_order_id', target.workOrderId as string)
      const { data: used } = await usedQ
      const letter = nextPoLetter(((used ?? []) as { po_letter: string | null }[]).map((u) => u.po_letter ?? ''))
      const { data: row, error } = await admin
        .from('supplier_orders')
        .insert({
          org_id: orgId,
          job_id: target.jobId,
          work_order_id: target.workOrderId,
          vendor_id: input.vendorId,
          kind: 'general',
          po_letter: letter,
          po_number: poNumber(target.reference, letter),
          status: 'draft',
          created_by: userId,
        })
        .select('*')
        .single()
      if (row) inserted = row as OrderRow
      else if (error && error.code !== '23505') {
        return { ok: false, status: missing(error) ? 409 : 500, message: missing(error) ? 'Purchase orders are not switched on yet (database update pending).' : 'Could not start the order. Try again.' }
      }
    }
    if (!inserted) return { ok: false, status: 409, message: 'Someone is making an order on this job right now. Try again.' }
    order = inserted
  }

  const orderId = String(order.id)
  const { data: existing } = await admin.from('purchase_order_lines').select('id, received_quantity').eq('org_id', orgId).eq('supplier_order_id', orderId)
  const existingIds = new Map(((existing ?? []) as OrderRow[]).map((l) => [String(l.id), n(l.received_quantity)]))
  const keep = new Set(input.lines.map((l) => l.id).filter((x): x is string => !!x && existingIds.has(x)))
  const removed = Array.from(existingIds.keys()).filter((id) => !keep.has(id))
  if (removed.some((id) => (existingIds.get(id) ?? 0) > 0)) {
    return { ok: false, status: 409, message: 'An item that was already received cannot be removed. Change its quantity instead.' }
  }
  // A received quantity may not exceed the new ordered quantity.
  for (const l of input.lines) {
    if (l.id && existingIds.has(l.id) && (existingIds.get(l.id) ?? 0) > l.quantity + 1e-9) {
      return { ok: false, status: 409, message: `"${l.description}" was already received (${existingIds.get(l.id)}). It cannot be less than that.` }
    }
  }

  if (removed.length > 0) {
    const { error } = await admin.from('purchase_order_lines').delete().eq('org_id', orgId).eq('supplier_order_id', orderId).in('id', removed)
    if (error) return { ok: false, status: 500, message: 'Could not save the items.' }
  }
  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i]
    const row = {
      position: i,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_cost: centsToDollars(l.unitCostCents),
      cost_type: l.costType,
      cost_code: l.costCode,
      pricebook_item_id: l.pricebookItemId,
      updated_at: new Date().toISOString(),
    }
    const { error } =
      l.id && existingIds.has(l.id)
        ? await admin.from('purchase_order_lines').update(row).eq('org_id', orgId).eq('supplier_order_id', orderId).eq('id', l.id)
        : await admin.from('purchase_order_lines').insert({ ...row, org_id: orgId, supplier_order_id: orderId })
    if (error) return { ok: false, status: 500, message: 'Could not save the items.' }
  }
  const { error: upd } = await admin
    .from('supplier_orders')
    .update({
      draft_date: input.date,
      draft_date_kind: input.dateKind,
      draft_address: input.address ?? target.address,
      draft_note: input.note,
      title: input.title,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('id', orderId)
  if (upd) return { ok: false, status: 500, message: 'Could not save the order.' }
  await refreshPoStatus(admin, orgId, orderId)
  return { ok: true, id: orderId, created }
}

/** Only a draft that was never sent may be thrown away; a sent PO is cancelled by email instead. */
export async function discardPoDraft(admin: SupabaseClient, orgId: string, id: string): Promise<{ ok: boolean; message?: string }> {
  const { data } = await admin.from('supplier_orders').select('id, kind, status, first_sent_at').eq('org_id', orgId).eq('id', id).maybeSingle()
  const o = data as OrderRow | null
  if (!o || o.kind !== 'general') return { ok: false, message: 'Order not found.' }
  if (o.status !== 'draft' || o.first_sent_at) return { ok: false, message: 'This order was sent. Cancel it by email instead.' }
  const { count } = await admin.from('purchase_order_bills').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('supplier_order_id', id)
  if ((count ?? 0) > 0) return { ok: false, message: 'This order has a bill on it.' }
  const { error } = await admin.from('supplier_orders').delete().eq('org_id', orgId).eq('id', id).eq('status', 'draft')
  return error ? { ok: false, message: 'Could not delete it.' } : { ok: true }
}

// ---------------------------------------------------------------------------
// Status refresh — the ONE writer of supplier_orders.status for a general PO
// ---------------------------------------------------------------------------

export async function refreshPoStatus(admin: SupabaseClient, orgId: string, id: string): Promise<PoStatus | null> {
  const po = await loadPurchaseOrder(admin, orgId, id, { showMoney: true })
  if (!po || po.kind !== 'general') return null
  const { data: row } = await admin.from('supplier_orders').select('first_sent_at, cancelled_at, acknowledged_at, billed_at').eq('org_id', orgId).eq('id', id).maybeSingle()
  const r = (row ?? {}) as OrderRow
  const status = derivePoStatus({
    firstSentAt: s(r.first_sent_at),
    cancelledAt: s(r.cancelled_at),
    acknowledgedAt: s(r.acknowledged_at),
    lines: po.lines,
    totalCents: po.totalCents,
    billedCents: po.billedCents,
  })
  const patch: Record<string, unknown> = {}
  if (status !== po.status) patch.status = status
  if (status === 'billed' && !r.billed_at) patch.billed_at = new Date().toISOString()
  if (status !== 'billed' && r.billed_at) patch.billed_at = null
  const allReceived = po.lines.length > 0 && po.lines.every((l) => l.receivedQuantity + 1e-9 >= l.quantity)
  if (allReceived && !po.receivedAt) patch.received_at = new Date().toISOString()
  if (!allReceived && po.receivedAt) patch.received_at = null
  if (Object.keys(patch).length > 0) {
    await admin.from('supplier_orders').update(patch).eq('org_id', orgId).eq('id', id)
  }
  return status
}

// ---------------------------------------------------------------------------
// Preview + send
// ---------------------------------------------------------------------------

export type PoPreviewRequest = { requested: 'order' | 'cancellation'; manual?: boolean }

export type PoPreview = {
  poId: string
  vendorName: string
  kind: SendKind
  revision: number
  poNumber: string
  poLabel: string
  email: ComposedSupplierEmail
  date: string | null
  dateKind: PoDateKind
  address: string | null
  note: string | null
  changes: string[]
  lines: LineSnapshot[]
  linesHash: string
  contentHash: string
  totalCents: number
  confirmMessage: string | null
  blockers: string[]
  previewToken: string
  sendButtonLabel: string
  pdf: Buffer | null
}

type PoContext = {
  po: PurchaseOrder
  vendor: SupplierRecord & { contactName: string | null }
  target: PoTarget
  orgName: string
  orgPhone: string | null
  order: SupplierOrderRecord
  lastLines: LineSnapshot[] | null
  lastSend: { status: 'sent' | 'unknown'; kind: SendKind; at: string; to: string } | null
  canLink: boolean
}

export async function loadPoContext(admin: SupabaseClient, orgId: string, poId: string): Promise<{ ok: true; ctx: PoContext } | { ok: false; status: number; message: string }> {
  const po = await loadPurchaseOrder(admin, orgId, poId, { showMoney: true })
  if (!po || po.kind !== 'general') return { ok: false, status: 404, message: 'Order not found.' }
  const [{ data: vrow }, target, brand, orderRowRes, sendsRes] = await Promise.all([
    admin.from('vendors').select('*').eq('org_id', orgId).eq('id', po.vendorId).maybeSingle(),
    loadPoTarget(admin, orgId, po.jobId ? { jobId: po.jobId } : { workOrderId: po.workOrderId as string }),
    getOrgBrand(admin, orgId),
    admin.from('supplier_orders').select('*').eq('org_id', orgId).eq('id', poId).maybeSingle(),
    admin
      .from('supplier_order_sends')
      .select('id, kind, status, created_at, sent_at, to_email')
      .eq('org_id', orgId)
      .eq('supplier_order_id', poId)
      .in('status', ['sent', 'unknown'])
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (!vrow || !target) return { ok: false, status: 404, message: 'Order not found.' }
  const row = orderRowRes.data as OrderRow
  const vendor = { ...supplierFromRow(vrow as OrderRow), contactName: s((vrow as OrderRow).contact_name) }
  let lastLines: LineSnapshot[] | null = null
  if (row.last_send_id) {
    const { data: sl } = await admin.from('supplier_order_send_lines').select('line_key, trade, label, quantity_text, note, line_status').eq('org_id', orgId).eq('send_id', String(row.last_send_id))
    lastLines = ((sl ?? []) as OrderRow[]).map((l) => ({ key: String(l.line_key), trade: String(l.trade), label: String(l.label), qty: s(l.quantity_text), note: s(l.note), status: 'ready' as const }))
  }
  const send = ((sendsRes.data ?? []) as OrderRow[])[0]
  const order: SupplierOrderRecord = {
    id: po.id,
    vendorId: po.vendorId,
    poLetter: String(row.po_letter ?? ''),
    poNumber: po.poNumber,
    revision: po.revision,
    status: sendStateOf(po.status),
    lastLinesHash: s(row.last_lines_hash),
    lastContentHash: s(row.last_content_hash),
    lastLines,
    lastDeliveryDate: s(row.last_delivery_date),
    lastDeliveryAddress: s(row.last_delivery_address),
    lastSentAt: po.lastSentAt,
    lastSentTo: po.lastSentTo,
    receivedAt: po.receivedAt,
  }
  const canLink = !!(await tryOrgAppUrl(orgId, 'purchase-order-confirm-link'))
  return {
    ok: true,
    ctx: {
      po,
      vendor,
      target,
      orgName: brand.name,
      orgPhone: brand.phone || null,
      order,
      lastLines,
      lastSend: send ? { status: send.status as 'sent' | 'unknown', kind: send.kind as SendKind, at: String(send.sent_at ?? send.created_at), to: String(send.to_email) } : null,
      canLink,
    },
  }
}

function poSubject(args: { kind: SendKind; label: string; address: string | null; date: string | null; dateKind: PoDateKind; fmt: (d: string | null) => string }): string {
  const where = (args.address || 'no address').trim()
  if (args.kind === 'cancellation') return `CANCEL PO ${args.label} – ${where}`
  const prefix = args.kind === 'revision' ? 'REVISED PO' : 'PO'
  return `${prefix} ${args.label} – ${where} – ${args.dateKind === 'start' ? 'start' : 'deliver'} ${args.fmt(args.date)}`
}

export function buildPoPreview(ctx: PoContext, req: PoPreviewRequest, sender: SupplierOrderSender, now: Date, ackUrl: string | null): PoPreview {
  const { po, vendor, target } = ctx
  const isCancel = req.requested === 'cancellation'
  // `lines` carries no prices: the send log (a table browser users can read) never holds unit costs, so changes are described
  // price-free; prices still move the content hash, so a price change is a revision, never a plain re-send.
  const lines = isCancel ? [] : poOrderLines(po, false)
  const contentHash = sha256(canonicalContent(poOrderLines(po), po.date, po.address))
  const linesHash = sha256(JSON.stringify(poOrderLines(po).map((l) => [l.key, l.label, l.qty, l.note])))

  const blockers: string[] = []
  if (!isCancel) {
    if (target.cancelled) blockers.push('This job is cancelled, so orders cannot be sent.')
    if (po.lines.length === 0) blockers.push('Add at least one item.')
  }
  if (vendor.connectionType === 'api') {
    if (!req.manual) blockers.push(`${vendor.name} is set up to order through an API. Send general orders by email: ask an owner to switch it in Settings → Vendors, or use "I sent this myself".`)
  } else {
    const channel = req.manual ? null : supplierChannelProblem(vendor)
    if (channel) blockers.push(channel.replace('Settings → Suppliers', 'Settings → Vendors'))
  }

  const decision = decideSend({ requested: req.requested, order: ctx.order, contentHash, lastSend: ctx.lastSend, now, timeZone: DEFAULT_TIMEZONE })
  if (!decision.ok) blockers.push(decision.message)
  const kind: SendKind = decision.ok ? decision.kind : isCancel ? 'cancellation' : 'order'
  const revision = decision.ok ? decision.revision : po.revision
  const label = poLabel(po.poNumber, revision)

  const changes =
    kind === 'revision'
      ? describeOrderChanges({
          previous: ctx.lastLines,
          current: lines,
          previousDeliveryDate: ctx.order.lastDeliveryDate,
          deliveryDate: po.date,
          previousDeliveryAddress: ctx.order.lastDeliveryAddress,
          deliveryAddress: po.address,
        })
      : []
  if (kind === 'revision' && changes.length === 0) changes.push('Unit prices changed.')

  const heading = kind === 'cancellation' ? `Cancel PO ${label}` : kind === 'revision' ? `Revised PO ${label}` : `PO ${label}`
  const fmt = (d: string | null) => {
    if (!d) return 'date TBD'
    const [y, m, dd] = d.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '')
  }
  const subject = poSubject({ kind, label, address: po.address, date: po.date, dateKind: po.dateKind, fmt })
  const total = poTotalCents(po.lines)
  const emailLines = po.lines.map((l) => ({
    description: l.description,
    qtyText: `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
    totalText: l.unitCostCents > 0 ? formatMoney(lineTotalCents(l.quantity, l.unitCostCents)) : null,
  }))
  const email = composePurchaseOrderEmail({
    kind,
    vendor,
    sender,
    orgName: ctx.orgName,
    orgPhone: ctx.orgPhone,
    reference: target.jobId ? target.reference : null,
    poLabel: label,
    subject,
    dateKind: po.dateKind,
    date: po.date,
    address: po.address,
    note: po.note,
    lines: emailLines,
    totalText: total > 0 ? formatMoney(total) : null,
    changes,
    ackUrl,
  })

  let pdf: Buffer | null = null
  if (!isCancel && po.lines.length > 0) {
    pdf = renderPurchaseOrderPDF({
      heading,
      orgName: ctx.orgName,
      orgPhone: ctx.orgPhone,
      vendorName: vendor.name,
      accountNumber: vendor.accountNumber,
      contactName: vendor.contactName,
      reference: target.reference,
      customerName: target.customerName,
      dateKind: po.dateKind,
      date: po.date,
      address: po.address,
      note: po.note,
      changes,
      lines: po.lines,
      generatedAt: now.toISOString(),
    }).pdf
  }

  const previewToken = sha256(JSON.stringify([kind, revision, label, email.to, email.cc, email.subject, contentHash, po.note, vendor.connectionType, !!ackUrl, po.lines.map((l) => [l.description, l.quantity, l.unit, l.unitCostCents])]))
  const verb = kind === 'cancellation' ? 'Send cancellation to' : kind === 'revision' ? 'Send revised order to' : 'Send order to'
  return {
    poId: po.id,
    vendorName: vendor.name,
    kind,
    revision,
    poNumber: po.poNumber,
    poLabel: label,
    email,
    date: po.date,
    dateKind: po.dateKind,
    address: po.address,
    note: po.note,
    changes,
    lines: lines.map((l) => ({ key: l.key, trade: l.trade, label: l.label, qty: l.qty, note: l.note, status: l.status })),
    linesHash,
    contentHash,
    totalCents: total,
    confirmMessage: decision.ok ? decision.confirmMessage : null,
    blockers: Array.from(new Set(blockers)),
    previewToken,
    sendButtonLabel: `${verb} ${vendor.name}`,
    pdf,
  }
}

export type PoSendDeps = {
  store: SupplierOrderStore
  transmit: (order: SupplierOrderTransmission) => Promise<SupplierOrderTransmitResult>
  now?: () => Date
}
export type PoSendInput = PoPreviewRequest & { previewToken: string; confirmResend: boolean }
export type PoSendActor = SupplierOrderSender & { canSend: boolean }
export type PoSendResult =
  | { ok: true; sentAt: string; poLabel: string; kind: SendKind; to: string; status: PoStatus | null; warning: string | null }
  | { ok: false; status: number; message: string; needsConfirm?: boolean; confirmMessage?: string; detail?: string }

const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export async function executePoSend(
  admin: SupabaseClient,
  orgId: string,
  poId: string,
  input: PoSendInput,
  actor: PoSendActor,
  deps: PoSendDeps
): Promise<PoSendResult> {
  const now = deps.now ?? (() => new Date())
  if (!actor.canSend) return { ok: false, status: 403, message: 'Only people who can edit jobs (or an owner) can send orders.' }
  if (input.manual && input.requested !== 'order') return { ok: false, status: 400, message: 'Only an order can be recorded as sent by hand.' }

  const loaded = await loadPoContext(admin, orgId, poId)
  if (!loaded.ok) return loaded
  const ctx = loaded.ctx
  // The preview shows a placeholder where the confirm link goes; the real token only exists at send time.
  const preview = buildPoPreview(ctx, input, actor, now(), ctx.canLink ? 'link' : null)
  if (preview.blockers.length > 0) return { ok: false, status: 409, message: preview.blockers[0] }
  if (!input.manual && (!input.previewToken || input.previewToken !== preview.previewToken)) {
    return { ok: false, status: 409, message: 'The order changed since you opened the preview. Review it again before sending.' }
  }
  if (preview.confirmMessage && !input.confirmResend) {
    return { ok: false, status: 409, message: preview.confirmMessage, needsConfirm: true, confirmMessage: preview.confirmMessage }
  }

  const { data: fresh } = await admin.from('supplier_orders').select('status, revision, last_sent_at').eq('org_id', orgId).eq('id', poId).maybeSingle()
  const f = (fresh ?? {}) as OrderRow
  if ((s(f.last_sent_at) ?? null) !== (ctx.po.lastSentAt ?? null) || n(f.revision) !== ctx.po.revision) {
    return { ok: false, status: 409, message: 'This order was just sent or changed from another screen. Refresh and review it again.' }
  }

  const { po, vendor, target } = ctx
  const startedAt = now()
  await deps.store.expireStaleSends(po.id, new Date(startedAt.getTime() - STALE_SEND_MS).toISOString())
  const inserted = await deps.store.insertSend({
    org_id: orgId,
    job_id: po.jobId,
    supplier_order_id: po.id,
    vendor_id: vendor.id,
    kind: preview.kind,
    po_label: preview.poLabel,
    revision: preview.revision,
    connection_type: vendor.connectionType,
    status: 'sending',
    sent_by: actor.id,
    to_email: input.manual ? 'sent by hand' : preview.email.to || vendor.name,
    cc_emails: input.manual ? [] : preview.email.cc,
    subject: preview.email.subject,
    note: preview.note,
    delivery_date: preview.date,
    delivery_address: preview.address,
    delivery_notes: null,
    line_count: preview.lines.length,
    lines_hash: preview.linesHash,
    content_hash: preview.contentHash,
    pdf_sha256: preview.pdf ? sha256(preview.pdf) : null,
    created_at: startedAt.toISOString(),
  })
  if ('conflict' in inserted) return { ok: false, status: 409, message: 'This order is already being sent. Wait a moment, then refresh.' }
  if ('error' in inserted) return { ok: false, status: 500, message: NOT_SENT_MESSAGE, detail: inserted.error }
  const sendId = inserted.id

  const fail = async (message: string, detail: string): Promise<PoSendResult> => {
    await deps.store.completeSend(sendId, { status: 'failed', error: detail.slice(0, 1000), failed_at: now().toISOString(), completed_at: now().toISOString() })
    return { ok: false, status: 502, message, detail }
  }

  const lineRows = po.lines.map((l, i) => ({
    org_id: orgId,
    send_id: sendId,
    supplier_order_id: po.id,
    job_id: po.jobId,
    vendor_id: vendor.id,
    line_key: lineKey(l, i),
    trade: l.costType,
    label: l.description,
    quantity_text: `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
    note: l.costCode ? `Code ${l.costCode}` : null,
    line_status: 'ready',
    material_source: 'supplier',
  }))
  if (preview.kind !== 'cancellation' && lineRows.length > 0) {
    const r = await deps.store.insertSendLines(lineRows)
    if (r.error) return fail(NOT_SENT_MESSAGE, `Could not record the order lines: ${r.error}`)
  }
  let storagePath: string | null = null
  if (preview.pdf) {
    storagePath = `${orgId}/purchase-orders/${po.id}/${preview.poLabel.replace(/[^A-Za-z0-9._-]/g, '-')}-${sendId}.pdf`
    const up = await deps.store.uploadPdf(storagePath, preview.pdf)
    if (up.error) return fail(NOT_SENT_MESSAGE, `Could not save a copy of the PDF: ${up.error}`)
  }

  // The vendor's one-tap confirm link: a fresh token per send (only its hash is stored). Not for a hand-sent or cancel send.
  let ackToken: string | null = null
  let email = preview.email
  if (!input.manual && preview.kind !== 'cancellation' && ctx.canLink) {
    ackToken = newToken()
    const base = await tryOrgAppUrl(orgId, 'purchase-order-confirm-link')
    if (base) {
      const link = `${base.replace(/\/$/, '')}/po/${ackToken}`
      email = buildPoPreview(ctx, input, actor, now(), link).email
    } else ackToken = null
  }

  let result: SupplierOrderTransmitResult
  try {
    result = input.manual
      ? { channel: 'email', reference: null }
      : await deps.transmit({
          kind: preview.kind,
          supplier: vendor,
          jobNumber: target.reference,
          poLabel: preview.poLabel,
          deliveryDate: preview.date,
          deliveryAddress: preview.address,
          deliveryNotes: null,
          note: preview.note,
          lines: preview.lines,
          email,
          pdf: preview.pdf,
        })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const clearRefusal = (error as { refused?: boolean })?.refused === true || /refused|not set up|no order email|no API connection|invalid|rejected/i.test(detail)
    if (!clearRefusal) {
      await deps.store.completeSend(sendId, { status: 'unknown', error: detail.slice(0, 1000), completed_at: now().toISOString() })
      return { ok: false, status: 502, message: 'Not sure this went out (the vendor did not answer). Check your sent mail or call them before sending again.', detail }
    }
    return fail(NOT_SENT_MESSAGE, detail)
  }

  // ---- It went out. Everything below records it; none of it may un-send or re-send. ----
  const sentAt = now().toISOString()
  const sentTo = input.manual ? 'sent by hand' : preview.email.to || vendor.name
  let warning: string | null = null
  const done = await deps.store.completeSend(sendId, { status: 'sent', sent_at: sentAt, completed_at: sentAt, message_id: result.reference, pdf_storage_path: storagePath })
  const isCancel = preview.kind === 'cancellation'
  const patch: Record<string, unknown> = isCancel
    ? { cancelled_at: sentAt, cancelled_by: actor.id, last_sent_at: sentAt, last_sent_to: sentTo, ack_token_hash: null, updated_at: sentAt }
    : {
        revision: preview.revision,
        last_lines_hash: preview.linesHash,
        last_content_hash: preview.contentHash,
        last_send_id: sendId,
        last_delivery_date: preview.date,
        last_delivery_address: preview.address,
        first_sent_at: po.firstSentAt ?? sentAt,
        last_sent_at: sentAt,
        last_sent_by: actor.id,
        last_sent_to: sentTo,
        cancelled_at: null,
        cancelled_by: null,
        // A changed order has to be confirmed (and delivered) again; a plain re-send keeps the confirmation.
        ...(preview.kind === 'revision' ? { acknowledged_at: null, acknowledged_by: null, acknowledged_note: null } : {}),
        ...(ackToken ? { ack_token_hash: hashToken(ackToken), ack_token_expires_at: new Date(now().getTime() + 90 * 86_400_000).toISOString() } : {}),
        updated_at: sentAt,
      }
  const upd = await deps.store.updateSupplierOrder(po.id, patch)
  if (done.error || upd.error) warning = 'Sent, but the CRM could not record it. Do not send again — tell an admin.'
  const status = await refreshPoStatus(admin, orgId, po.id).catch(() => null)

  if (po.jobId) {
    const via = input.manual ? `${vendor.name} (sent by hand)` : `${vendor.name} (${preview.email.to})`
    const who = actor.name || 'someone'
    const what = isCancel ? `Cancellation of PO ${preview.poLabel} sent to ${via} by ${who}.` : preview.kind === 'revision' ? `Revised PO ${preview.poLabel} sent to ${via} by ${who}.` : `PO ${preview.poLabel} sent to ${via} by ${who}.`
    await deps.store.insertJobNote(po.jobId, actor.id, what).catch(() => undefined)
  }
  return { ok: true, sentAt, poLabel: preview.poLabel, kind: preview.kind, to: sentTo, status, warning }
}

export function poSendStore(admin: SupabaseClient): SupplierOrderStore {
  return supabaseSupplierOrderStore(admin)
}

// ---------------------------------------------------------------------------
// Receive + acknowledge
// ---------------------------------------------------------------------------

export async function receivePo(
  admin: SupabaseClient,
  orgId: string,
  poId: string,
  change: { all: true } | { lines: { lineId: string; quantity: number }[] }
): Promise<{ ok: true; status: PoStatus | null } | { ok: false; status: number; message: string }> {
  const po = await loadPurchaseOrder(admin, orgId, poId, { showMoney: false })
  if (!po || po.kind !== 'general') return { ok: false, status: 404, message: 'Order not found.' }
  if (po.status === 'draft' || po.status === 'cancelled') return { ok: false, status: 409, message: 'Only an order that was sent can be marked received.' }
  const updates = 'all' in change ? po.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) : change.lines
  for (const u of updates) {
    const line = po.lines.find((l) => l.id === u.lineId)
    if (!line) return { ok: false, status: 404, message: 'Item not found.' }
    if (!Number.isFinite(u.quantity)) return { ok: false, status: 400, message: 'Enter a number.' }
    const { error } = await admin
      .from('purchase_order_lines')
      .update({ received_quantity: clampReceived(u.quantity, line.quantity), updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('supplier_order_id', poId)
      .eq('id', u.lineId)
    if (error) return { ok: false, status: 500, message: 'Could not save. Try again.' }
  }
  return { ok: true, status: await refreshPoStatus(admin, orgId, poId) }
}

export async function acknowledgeByStaff(admin: SupabaseClient, orgId: string, poId: string): Promise<{ ok: boolean; message?: string }> {
  const po = await loadPurchaseOrder(admin, orgId, poId, { showMoney: false })
  if (!po || po.kind !== 'general') return { ok: false, message: 'Order not found.' }
  if (po.status !== 'sent') return { ok: false, message: 'Only a sent order can be marked confirmed.' }
  await admin.from('supplier_orders').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: 'staff' }).eq('org_id', orgId).eq('id', poId)
  await refreshPoStatus(admin, orgId, poId)
  return { ok: true }
}

export type VendorLinkView = {
  orgName: string
  poLabel: string
  vendorName: string
  dateKind: PoDateKind
  date: string | null
  address: string | null
  note: string | null
  lines: { description: string; quantity: number; unit: string | null; unitCostCents: number }[]
  totalCents: number
  acknowledgedAt: string | null
  cancelled: boolean
}

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/

/** Public: what the vendor sees on their confirm link. Company comes ONLY from the token's own order. */
/** `orgAllowed` is the host fence (fenceAllowsOrg): a link opened on another company's address is treated as not valid, like /pay. */
export async function loadVendorLinkView(admin: SupabaseClient, token: string, orgAllowed: (orgId: string) => boolean): Promise<VendorLinkView | null> {
  if (!TOKEN_RE.test(token)) return null
  const { data } = await admin
    // org-scope-ok: public vendor link; the company comes from the order the secret token (SHA-256 hash, unique) points at
    .from('supplier_orders')
    .select('id, org_id, status, ack_token_expires_at, acknowledged_at, kind')
    .eq('ack_token_hash', hashToken(token))
    .maybeSingle()
  const row = data as OrderRow | null
  if (!row || row.kind !== 'general' || !orgAllowed(String(row.org_id))) return null
  if (row.ack_token_expires_at && new Date(String(row.ack_token_expires_at)).getTime() < Date.now()) return null
  const orgId = String(row.org_id)
  const po = await loadPurchaseOrder(admin, orgId, String(row.id), { showMoney: true })
  if (!po || po.status === 'draft') return null
  const brand = await getOrgBrand(admin, orgId)
  return {
    orgName: brand.name,
    poLabel: po.label,
    vendorName: po.vendorName,
    dateKind: po.dateKind,
    date: po.date,
    address: po.address,
    note: po.note,
    lines: po.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents })),
    totalCents: po.totalCents,
    acknowledgedAt: po.acknowledgedAt,
    cancelled: po.status === 'cancelled',
  }
}

export async function acknowledgeByToken(admin: SupabaseClient, token: string, note: string | null, orgAllowed: (orgId: string) => boolean): Promise<{ ok: boolean; message?: string }> {
  if (!TOKEN_RE.test(token)) return { ok: false, message: 'This link is not valid.' }
  const { data } = await admin
    // org-scope-ok: public vendor link; the company comes from the order the secret token (SHA-256 hash, unique) points at
    .from('supplier_orders')
    .select('id, org_id, status, ack_token_expires_at, acknowledged_at, kind')
    .eq('ack_token_hash', hashToken(token))
    .maybeSingle()
  const row = data as OrderRow | null
  if (!row || row.kind !== 'general' || !orgAllowed(String(row.org_id))) return { ok: false, message: 'This link is not valid.' }
  if (row.ack_token_expires_at && new Date(String(row.ack_token_expires_at)).getTime() < Date.now()) return { ok: false, message: 'This link has expired. Please reply to the email instead.' }
  if (row.status === 'cancelled') return { ok: false, message: 'This order was cancelled.' }
  if (row.status === 'draft') return { ok: false, message: 'This link is not valid.' }
  if (row.acknowledged_at) return { ok: true }
  const orgId = String(row.org_id)
  await admin
    .from('supplier_orders')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: 'vendor_link', acknowledged_note: note ? note.replace(/\s+/g, ' ').trim().slice(0, 500) : null })
    .eq('id', String(row.id))
    .eq('org_id', orgId)
    .is('acknowledged_at', null)
  await refreshPoStatus(admin, orgId, String(row.id))
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Vendor bills
// ---------------------------------------------------------------------------

export type RecordBillResult =
  | { ok: true; billId: string; costLineId: string | null; status: PoStatus | null; warning: string | null }
  | { ok: false; status: number; message: string; needsConfirm?: boolean; confirmKind?: 'over' | 'duplicate' }

export async function recordPoBill(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  poId: string,
  input: BillInput,
  confirm: { over: boolean; duplicate: boolean }
): Promise<RecordBillResult> {
  const po = await loadPurchaseOrder(admin, orgId, poId, { showMoney: true })
  if (!po || po.kind !== 'general') return { ok: false, status: 404, message: 'Order not found.' }
  if (po.status === 'draft' || po.status === 'cancelled') return { ok: false, status: 409, message: 'Record a bill once the order has been sent.' }

  // A repeat of the same bill sheet (double tap, retry) answers with the bill already recorded, before any check.
  if (input.clientKey) {
    const { data: prior } = await admin.from('purchase_order_bills').select('id, cost_line_id').eq('org_id', orgId).eq('supplier_order_id', poId).eq('client_key', input.clientKey).maybeSingle()
    if (prior) {
      const p = prior as OrderRow
      return { ok: true, billId: String(p.id), costLineId: s(p.cost_line_id), status: await refreshPoStatus(admin, orgId, poId), warning: null }
    }
  }
  if (!input.isCredit) {
    const check = checkBillAgainstPo(po.totalCents, po.billedCents, input.amountCents)
    if (check.message && !confirm.over) return { ok: false, status: 409, message: check.message, needsConfirm: true, confirmKind: 'over' }
  }

  // The same money entered by hand on the job's cost list = a double count; ask first.
  if (po.jobId && !confirm.duplicate) {
    try {
      const ledger = await loadJobCostLedger(admin, orgId, [po.jobId])
      const dup = (ledger.get(po.jobId)?.lines ?? []).find((l) => l.vendor_id === po.vendorId && l.source !== 'vendor_bill' && Math.round(Math.abs(l.amount) * 100) === input.amountCents)
      if (dup) {
        return { ok: false, status: 409, needsConfirm: true, confirmKind: 'duplicate', message: `A ${formatMoney(input.amountCents)} cost for ${po.vendorName} is already on this job ("${dup.description}"). Record this bill anyway? It would count twice.` }
      }
    } catch {
      // The ledger being unreadable must not block recording a bill; the unique bill-number guard still applies.
    }
  }

  const { data: bill, error } = await admin
    .from('purchase_order_bills')
    .insert({
      client_key: input.clientKey ?? null,
      org_id: orgId,
      supplier_order_id: poId,
      vendor_id: po.vendorId,
      job_id: po.jobId,
      bill_number: input.billNumber,
      bill_date: input.billDate,
      amount: centsToDollars(input.amountCents),
      is_credit: input.isCredit,
      cost_type: input.costType,
      notes: input.notes,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505' && input.clientKey) {
      const { data: again } = await admin.from('purchase_order_bills').select('id, cost_line_id').eq('org_id', orgId).eq('supplier_order_id', poId).eq('client_key', input.clientKey).maybeSingle()
      if (again) return { ok: true, billId: String((again as OrderRow).id), costLineId: s((again as OrderRow).cost_line_id), status: await refreshPoStatus(admin, orgId, poId), warning: null }
    }
    if (error.code === '23505') return { ok: false, status: 409, message: `Bill ${input.billNumber ?? ''} is already recorded on this order.`.replace('  ', ' ') }
    return { ok: false, status: 500, message: 'Could not record the bill.' }
  }
  const billId = String((bill as { id: string }).id)

  // Atomic over-the-order check: the first look above can be raced by two simultaneous bills, so count again now that this one is in.
  if (!input.isCredit && !confirm.over) {
    const { data: all } = await admin.from('purchase_order_bills').select('amount, is_credit').eq('org_id', orgId).eq('supplier_order_id', poId).eq('status', 'active')
    const billedNow = ((all ?? []) as OrderRow[]).reduce((sum, b) => sum + (b.is_credit ? -1 : 1) * Math.round(n(b.amount) * 100), 0)
    const check = checkBillAgainstPo(po.totalCents, billedNow - input.amountCents, input.amountCents)
    if (check.message) {
      await admin.from('purchase_order_bills').delete().eq('org_id', orgId).eq('id', billId)
      return { ok: false, status: 409, message: check.message, needsConfirm: true, confirmKind: 'over' }
    }
  }

  let costLineId: string | null = null
  let warning: string | null = null
  if (po.jobId) {
    const written = await addJobCostLine(admin, {
      orgId,
      jobId: po.jobId,
      userId,
      description: billCostDescription(po.poNumber, po.vendorName, input.billNumber),
      amount: centsToDollars(input.amountCents),
      costType: input.costType,
      credit: input.isCredit,
      vendorId: po.vendorId,
      source: 'vendor_bill',
      incurredOn: input.billDate,
      purchaseOrderBillId: billId,
    })
    if (!written.ok) {
      await admin.from('purchase_order_bills').delete().eq('org_id', orgId).eq('id', billId)
      return { ok: false, status: 500, message: 'Could not add the cost to the job, so the bill was not recorded. Try again.' }
    }
    costLineId = written.line.id
    await admin.from('purchase_order_bills').update({ cost_line_id: costLineId }).eq('org_id', orgId).eq('id', billId)
  } else {
    warning = 'Recorded on the order. This visit is not on a job, so it is not in a job budget.'
  }
  const status = await refreshPoStatus(admin, orgId, poId)
  return { ok: true, billId, costLineId, status, warning }
}

export async function voidPoBill(admin: SupabaseClient, orgId: string, userId: string, poId: string, billId: string): Promise<{ ok: boolean; status?: PoStatus | null; message?: string }> {
  const { data } = await admin.from('purchase_order_bills').select('id, status, cost_line_id').eq('org_id', orgId).eq('supplier_order_id', poId).eq('id', billId).maybeSingle()
  const b = data as OrderRow | null
  if (!b) return { ok: false, message: 'Bill not found.' }
  if (b.status === 'void') return { ok: true, status: await refreshPoStatus(admin, orgId, poId) }
  if (b.cost_line_id) {
    // Same soft delete the cost list uses: drops out of every total.
    const { error } = await admin
      .from('job_cost_lines')
      .update({ status: 'archived', deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('org_id', orgId)
      .eq('id', String(b.cost_line_id))
    if (error) return { ok: false, message: 'Could not remove the cost from the job. Try again.' }
  }
  const { error } = await admin.from('purchase_order_bills').update({ status: 'void', voided_at: new Date().toISOString(), voided_by: userId }).eq('org_id', orgId).eq('id', billId)
  if (error) return { ok: false, message: 'Could not void the bill.' }
  return { ok: true, status: await refreshPoStatus(admin, orgId, poId) }
}

export { BILL_TOLERANCE_CENTS, dollarsToCents }
