/**
 * Supplier purchase orders for a job — load, preview, send. Server-only.
 *
 * Safety model (owner: "we don't want to accidentally trigger those"):
 *   - Nothing here runs on its own. A send happens only from POST …/supplier-orders/send, which a
 *     person reaches by pressing "Send order to <Supplier>" on the preview.
 *   - The send re-builds the preview and refuses unless it matches what the person saw
 *     (`previewToken`), so a quantity edited in another tab can't slip out unseen.
 *   - Re-sends (same order again, revision, re-cancel) need a second confirmation.
 *   - One in-flight send per PO (unique index), every attempt logged, the PDF stored, and a
 *     failure never marks materials ordered.
 *
 * The PDF is the existing materials order sheet (lib/pdf/job-material-order.ts) with this
 * supplier's lines only — one renderer, one assembly (buildJobRunSheet).
 */
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { writeJobNote } from '@/lib/threads/job-notes'
import { materialOrderFromRunSheet, type JobMaterialOrderData } from '@/lib/job-material-order'
import { buildJobRunSheet } from '@/lib/job-run-sheet'
import { isTradeActive, primaryTradeForJobType } from '@/lib/job-trades'
import {
  canonicalContent,
  decideSend,
  describeOrderChanges,
  installerChangeWarnings,
  isMaterialSource,
  materialsOrderRollup,
  nextPoLetter,
  nonPoLabel,
  orderSubject,
  poLabel,
  poNumber,
  resolveSourcing,
  sectionsForLines,
  snapshotLines,
  sourcingSnapshot,
  supplierCardState,
  tradeLabel,
  type LastSend,
  type LineSnapshot,
  type MaterialSource,
  type MaterialsRollup,
  type OrderLine,
  type SendKind,
  type SourcingResult,
  type SourcingSnapshot,
  type SupplierCardState,
  type SupplierOrderRecord,
  type SupplierRecord,
  type TradeContext,
  type TradeOverride,
} from '@/lib/material-sourcing'
import { MATERIALS_ORDER_LIST_TRADE } from '@/lib/materials-order-list'
import type { DisplayMaterialsOrderItem } from '@/lib/materials-order-overrides'
import { renderJobMaterialOrderPDF } from '@/lib/pdf/job-material-order'
import { composeSupplierOrderEmail, type ComposedSupplierEmail, type SupplierOrderSender } from '@/lib/supplier-order-email'
import { loadOpenApprovals, loadSupplierApiSettings, type OpenApproval } from '@/lib/suppliers/abc/settings-db'
import { connectorFor, supplierChannelProblem, type SupplierOrderTransmission, type SupplierOrderTransmitResult } from '@/lib/suppliers/send-order'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import { FILES_BUCKET } from '@/lib/files/storage'
import { resolveOpsAccess } from '@/lib/ops-access'
import { isSuperAdmin, type SuperAdminProfile } from '@/lib/super-admin'
import { deriveMaterialsState } from '@/lib/job-materials-state'

/**
 * Who may do what. Viewing/previewing = the job board. Sending, cancelling and changing where a
 * line is bought = ops `jobs:edit` (or full access) or a super admin (owner).
 */
export async function resolveSupplierOrderAccess(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null } & NonNullable<SuperAdminProfile>
): Promise<{ canView: boolean; canSend: boolean }> {
  const access = await resolveOpsAccess(admin, userId, profile)
  return { canView: access.canJobBoard, canSend: access.canEditJobs || isSuperAdmin(profile) }
}

export const STALE_SEND_MS = 10 * 60 * 1000

export const NOT_SENT_MESSAGE = 'Not sent. Try again or download and email it yourself.'

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type SendRecord = {
  id: string
  supplierOrderId: string
  vendorId: string
  kind: SendKind
  status: 'sending' | 'sent' | 'failed' | 'unknown'
  createdAt: string
  sentAt: string | null
  toEmail: string
  poLabel: string
}

export type SupplierOrderContext = {
  orgId: string
  jobId: string
  jobNumber: string
  jobStatus: string
  primaryTrade: string
  address: string | null
  scheduledDate: string | null
  orgName: string
  orgPhone: string | null
  baseSheet: JobMaterialOrderData
  displayByKey: Map<string, DisplayMaterialsOrderItem>
  lines: OrderLine[]
  suppliers: SupplierRecord[]
  trades: TradeContext[]
  tradeOverrides: TradeOverride[]
  orgSourceDefaults: Record<string, MaterialSource>
  orders: SupplierOrderRecord[]
  sends: SendRecord[]
  /** Sourcing at the most recent successful send on this job (installer-change warning). */
  lastSentSourcing: SourcingSnapshot | null
  /** Second-approver requests still open on this job (supplier API orders only). */
  apiApprovals?: OpenApproval[]
}

export type LoadResult =
  | { ok: true; ctx: SupplierOrderContext }
  | { ok: false; reason: 'not_found' | 'setup_missing' }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function supplierFromRow(row: Record<string, unknown>): SupplierRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Supplier'),
    orderEmail: str(row.order_email),
    ccEmails: Array.isArray(row.order_cc_emails) ? (row.order_cc_emails as unknown[]).map(String).filter(Boolean) : [],
    accountNumber: str(row.account_number),
    defaultBranch: str(row.default_branch),
    defaultDeliveryNotes: str(row.default_delivery_notes),
    defaultForTrades: Array.isArray(row.default_for_trades) ? (row.default_for_trades as unknown[]).map(String) : [],
    active: row.active !== false,
    connectionType: row.connection_type === 'api' ? 'api' : 'email',
  }
}

export async function loadSupplierOrderContext(
  admin: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<LoadResult> {
  const sheet = await buildJobRunSheet(admin, orgId, jobId)
  if (!sheet) return { ok: false, reason: 'not_found' }

  const [apiSettings, apiApprovals] = await Promise.all([loadSupplierApiSettings(admin, orgId), loadOpenApprovals(admin, orgId, jobId)])
  const [vendorsRes, overridesRes, tradesRes, tradeOvRes, orgDefaultsRes, ordersRes, sendsRes] = await Promise.all([
    admin
      .from('vendors')
      .select('id, name, order_email, order_cc_emails, account_number, default_branch, default_delivery_notes, default_for_trades, active, connection_type')
      .eq('org_id', orgId)
      .is('deleted_at', null),
    admin
      .from('job_material_order_overrides')
      .select('item_key, vendor_id, material_source')
      .eq('job_id', jobId),
    admin
      .from('work_orders')
      .select('trade, status, assigned_sub_id, scheduled_date, created_at')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .not('trade', 'is', null),
    admin.from('job_trade_material_sources').select('trade, material_source, vendor_id').eq('org_id', orgId).eq('job_id', jobId),
    admin.from('org_trade_material_defaults').select('trade, material_source').eq('org_id', orgId),
    admin.from('supplier_orders').select('*').eq('org_id', orgId).eq('job_id', jobId),
    admin
      .from('supplier_order_sends')
      .select('id, supplier_order_id, vendor_id, kind, status, created_at, sent_at, to_email, po_label')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  // Before the migration is applied the new tables/columns don't exist — say so, don't 500.
  if (vendorsRes.error || overridesRes.error || tradeOvRes.error || orgDefaultsRes.error || ordersRes.error || sendsRes.error) {
    return { ok: false, reason: 'setup_missing' }
  }

  const lineOv = new Map<string, { vendorId: string | null; source: MaterialSource | null }>()
  for (const row of (overridesRes.data ?? []) as Record<string, unknown>[]) {
    lineOv.set(String(row.item_key), {
      vendorId: str(row.vendor_id),
      source: isMaterialSource(row.material_source) ? row.material_source : null,
    })
  }

  const displayByKey = new Map<string, DisplayMaterialsOrderItem>()
  const lines: OrderLine[] = sheet.materialOrder.map((item) => {
    displayByKey.set(item.key, item)
    const ov = lineOv.get(item.key)
    return {
      key: item.key,
      trade: MATERIALS_ORDER_LIST_TRADE,
      label: item.label,
      qty: item.qty,
      detail: item.detail,
      note: item.note,
      status: item.status,
      excluded: item.isExcluded,
      isEdited: item.isEdited,
      computedQty: item.computedQty,
      sourceOverride: ov?.source ?? null,
      vendorOverrideId: ov?.vendorId ?? null,
    }
  })

  // Trades: first active crew per trade, with its sub's "supplies materials" default.
  const tradeRows = ((tradesRes.data ?? []) as Record<string, unknown>[])
    .filter((r) => isTradeActive({ status: String(r.status ?? '') }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const subIds = Array.from(new Set(tradeRows.map((r) => str(r.assigned_sub_id)).filter((v): v is string => !!v)))
  const subsById = new Map<string, Record<string, unknown>>()
  if (subIds.length > 0) {
    const { data: subs } = await admin
      .from('sub_contractors')
      .select('id, company_name, supplies_materials')
      .eq('org_id', orgId)
      .in('id', subIds)
    for (const s of (subs ?? []) as Record<string, unknown>[]) subsById.set(String(s.id), s)
  }
  const trades: TradeContext[] = []
  for (const r of tradeRows) {
    const trade = String(r.trade)
    if (trades.some((t) => t.trade === trade)) continue
    const subId = str(r.assigned_sub_id)
    const sub = subId ? subsById.get(subId) : undefined
    trades.push({
      trade,
      installer: sub
        ? {
            subId: subId!,
            name: String(sub.company_name ?? 'Installer'),
            suppliesMaterials: typeof sub.supplies_materials === 'boolean' ? sub.supplies_materials : null,
          }
        : null,
      scheduled: !!str(r.scheduled_date),
    })
  }

  const orgSourceDefaults: Record<string, MaterialSource> = {}
  for (const row of (orgDefaultsRes.data ?? []) as Record<string, unknown>[]) {
    if (isMaterialSource(row.material_source)) orgSourceDefaults[String(row.trade)] = row.material_source
  }

  const sends: SendRecord[] = ((sendsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    supplierOrderId: String(r.supplier_order_id),
    vendorId: String(r.vendor_id),
    kind: r.kind as SendKind,
    status: r.status as SendRecord['status'],
    createdAt: String(r.created_at),
    sentAt: str(r.sent_at),
    toEmail: String(r.to_email ?? ''),
    poLabel: String(r.po_label ?? ''),
  }))

  const orderRows = (ordersRes.data ?? []) as Record<string, unknown>[]
  const lastSendIds = orderRows.map((o) => str(o.last_send_id)).filter((v): v is string => !!v)
  const linesBySend = new Map<string, LineSnapshot[]>()
  if (lastSendIds.length > 0) {
    const { data: sendLines } = await admin
      .from('supplier_order_send_lines')
      .select('send_id, line_key, trade, label, quantity_text, note, line_status')
      .eq('org_id', orgId)
      .in('send_id', lastSendIds)
    for (const l of (sendLines ?? []) as Record<string, unknown>[]) {
      const list = linesBySend.get(String(l.send_id)) ?? []
      list.push({
        key: String(l.line_key),
        trade: String(l.trade),
        label: String(l.label),
        qty: str(l.quantity_text),
        note: str(l.note),
        status: l.line_status as LineSnapshot['status'],
      })
      linesBySend.set(String(l.send_id), list)
    }
  }
  const orders: SupplierOrderRecord[] = orderRows.map((o) => ({
    id: String(o.id),
    vendorId: String(o.vendor_id),
    poLetter: String(o.po_letter),
    poNumber: String(o.po_number),
    revision: Number(o.revision ?? 0),
    status: o.status as SupplierOrderRecord['status'],
    lastLinesHash: str(o.last_lines_hash),
    lastContentHash: str(o.last_content_hash),
    lastLines: str(o.last_send_id) ? linesBySend.get(String(o.last_send_id)) ?? [] : null,
    lastDeliveryDate: str(o.last_delivery_date),
    lastDeliveryAddress: str(o.last_delivery_address),
    lastSentAt: str(o.last_sent_at),
    lastSentTo: str(o.last_sent_to),
    receivedAt: str(o.received_at),
  }))

  let lastSentSourcing: SourcingSnapshot | null = null
  const lastOk = sends.find((s) => s.status === 'sent' && s.kind !== 'cancellation')
  if (lastOk) {
    const { data: srcRows } = await admin
      .from('supplier_order_send_sourcing')
      .select('trade, material_source, installer_sub_id, installer_name, installer_supplies_materials')
      .eq('org_id', orgId)
      .eq('send_id', lastOk.id)
    if (srcRows && srcRows.length > 0) {
      lastSentSourcing = {}
      for (const r of srcRows as Record<string, unknown>[]) {
        lastSentSourcing[String(r.trade)] = {
          source: (isMaterialSource(r.material_source) ? r.material_source : 'supplier') as MaterialSource,
          subId: str(r.installer_sub_id),
          subName: str(r.installer_name),
          suppliesMaterials: typeof r.installer_supplies_materials === 'boolean' ? r.installer_supplies_materials : null,
        }
      }
    }
  }

  return {
    ok: true,
    ctx: {
      orgId,
      jobId,
      jobNumber: sheet.jobNumber || sheet.jobId,
      jobStatus: sheet.status,
      primaryTrade: primaryTradeForJobType(sheet.jobType),
      address: sheet.address ?? null,
      scheduledDate: sheet.scheduledDate,
      orgName: sheet.orgName,
      orgPhone: sheet.orgPhone,
      baseSheet: materialOrderFromRunSheet(sheet),
      displayByKey,
      lines,
      suppliers: ((vendorsRes.data ?? []) as Record<string, unknown>[]).map((row) => ({ ...supplierFromRow(row), api: apiSettings.get(String(row.id)) ?? null })),
      trades,
      tradeOverrides: ((tradeOvRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        trade: String(r.trade),
        source: isMaterialSource(r.material_source) ? r.material_source : null,
        vendorId: str(r.vendor_id),
      })),
      orgSourceDefaults,
      orders,
      sends,
      lastSentSourcing,
      apiApprovals,
    },
  }
}

export function sourcingFor(ctx: SupplierOrderContext): SourcingResult {
  return resolveSourcing({
    lines: ctx.lines,
    suppliers: ctx.suppliers,
    trades: ctx.trades,
    tradeOverrides: ctx.tradeOverrides,
    orgSourceDefaults: ctx.orgSourceDefaults,
    hash: sha256,
  })
}

// ---------------------------------------------------------------------------
// View (GET) — read-only
// ---------------------------------------------------------------------------

export type SupplierCard = {
  vendorId: string
  supplierName: string
  state: SupplierCardState
  orderStatus: SupplierOrderRecord['status'] | null
  poNumber: string
  lines: { key: string; label: string; qty: string | null; trade: string }[]
  blockers: string[]
  lastSentAt: string | null
  lastSentTo: string | null
  /** When the materials arrived; null = not marked received. */
  receivedAt: string | null
  canCancel: boolean
}

export type SupplierOrdersView = {
  jobNumber: string
  jobCancelled: boolean
  rollup: MaterialsRollup
  blockers: string[]
  warnings: string[]
  cards: SupplierCard[]
  nonPo: { label: string; source: MaterialSource; trade: string; lines: { key: string; label: string; qty: string | null }[] }[]
  unassigned: { key: string; label: string; qty: string | null; trade: string; problem: string | null }[]
  trades: { trade: string; label: string; source: MaterialSource | null; vendorId: string | null; installerName: string | null }[]
  lines: { key: string; label: string; qty: string | null; trade: string; source: MaterialSource; vendorId: string | null; sourceOverride: MaterialSource | null; vendorOverrideId: string | null }[]
  suppliers: { id: string; name: string }[]
  defaultDeliveryDate: string | null
  defaultDeliveryAddress: string | null
}

function usedLetters(ctx: SupplierOrderContext): string[] {
  return ctx.orders.map((o) => o.poLetter)
}

function previewPoNumber(ctx: SupplierOrderContext, vendorId: string): string {
  const existing = ctx.orders.find((o) => o.vendorId === vendorId)
  return existing ? existing.poNumber : poNumber(ctx.jobNumber, nextPoLetter(usedLetters(ctx)))
}

/** Day before the earliest crew date when it's still ahead; otherwise the person picks. */
export function defaultDeliveryDate(scheduledDate: string | null, today: Date): string | null {
  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return null
  const [y, m, d] = scheduledDate.split('-').map(Number)
  const dayBefore = new Date(Date.UTC(y, m - 1, d - 1))
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  if (dayBefore.getTime() < todayUtc) return null
  return dayBefore.toISOString().slice(0, 10)
}

export function buildSupplierOrdersView(ctx: SupplierOrderContext, now: Date = new Date()): SupplierOrdersView {
  const sourcing = sourcingFor(ctx)
  const rollup = materialsOrderRollup({ sourcing, orders: ctx.orders, trades: ctx.trades })
  const orderByVendor = new Map(ctx.orders.map((o) => [o.vendorId, o]))
  const supplierById = new Map(ctx.suppliers.map((s) => [s.id, s]))
  const jobCancelled = ctx.jobStatus === 'cancelled'

  const cards: SupplierCard[] = sourcing.supplierGroups.map((g) => {
    const order = orderByVendor.get(g.supplier.id) ?? null
    const channel = supplierChannelProblem(g.supplier, snapshotLines(g.lines))
    return {
      vendorId: g.supplier.id,
      supplierName: g.supplier.name,
      state: supplierCardState(g, order),
      orderStatus: order?.status ?? null,
      poNumber: previewPoNumber(ctx, g.supplier.id),
      lines: g.lines.map((l) => ({ key: l.key, label: l.label, qty: l.qty, trade: l.trade })),
      blockers: Array.from(new Set([...g.blockers, ...(channel ? [channel] : [])])),
      lastSentAt: order?.lastSentAt ?? null,
      lastSentTo: order?.lastSentTo ?? null,
      receivedAt: order?.receivedAt ?? null,
      canCancel: order?.status === 'sent',
    }
  })
  // POs already sent to a supplier that no longer has any lines (moved, excluded, source changed).
  for (const o of ctx.orders) {
    if (o.status === 'draft' || cards.some((c) => c.vendorId === o.vendorId)) continue
    const s = supplierById.get(o.vendorId)
    cards.push({
      vendorId: o.vendorId,
      supplierName: s?.name ?? 'Supplier',
      state: supplierCardState(null, o),
      orderStatus: o.status,
      poNumber: o.poNumber,
      lines: [],
      blockers: [],
      lastSentAt: o.lastSentAt,
      lastSentTo: o.lastSentTo,
      receivedAt: o.receivedAt,
      canCancel: o.status === 'sent',
    })
  }

  const warnings = installerChangeWarnings(ctx.lastSentSourcing, sourcingSnapshot(sourcing, ctx.trades))
  if (jobCancelled && ctx.orders.some((o) => o.status === 'sent')) {
    warnings.unshift('This job is cancelled but a supplier order was sent. Email a cancellation to each supplier below.')
  }

  const tradeOv = new Map(ctx.tradeOverrides.map((t) => [t.trade, t]))
  const tradeNames = Array.from(new Set(ctx.lines.map((l) => l.trade)))

  return {
    jobNumber: ctx.jobNumber,
    jobCancelled,
    rollup,
    blockers: [...(jobCancelled ? ['This job is cancelled — orders cannot be sent.'] : []), ...sourcing.blockers],
    warnings,
    cards,
    nonPo: sourcing.nonPo.map((g) => ({
      label: nonPoLabel(g),
      source: g.source,
      trade: g.trade,
      lines: g.lines.map((l) => ({ key: l.key, label: l.label, qty: l.qty })),
    })),
    unassigned: sourcing.unassigned.map((l) => ({ key: l.key, label: l.label, qty: l.qty, trade: l.trade, problem: l.problem })),
    trades: tradeNames.map((trade) => ({
      trade,
      label: tradeLabel(trade),
      source: tradeOv.get(trade)?.source ?? null,
      vendorId: tradeOv.get(trade)?.vendorId ?? null,
      installerName: ctx.trades.find((t) => t.trade === trade)?.installer?.name ?? null,
    })),
    lines: sourcing.lines.map((l) => ({
      key: l.key,
      label: l.label,
      qty: l.qty,
      trade: l.trade,
      source: l.source,
      vendorId: l.vendorId,
      sourceOverride: l.sourceOverride ?? null,
      vendorOverrideId: l.vendorOverrideId ?? null,
    })),
    suppliers: ctx.suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
    defaultDeliveryDate: defaultDeliveryDate(ctx.scheduledDate, now),
    defaultDeliveryAddress: ctx.address,
  }
}

// ---------------------------------------------------------------------------
// Preview — read-only; the send path calls the same function
// ---------------------------------------------------------------------------

export type PreviewRequest = {
  vendorId: string
  requested: 'order' | 'cancellation'
  deliveryDate: string | null
  deliveryAddress: string | null
  note: string | null
  /** "I sent this to the supplier myself": record it without emailing. Skips email/date/page blockers. */
  manual?: boolean
}

export type SupplierOrderPreview = {
  vendorId: string
  supplierName: string
  connectionType: 'email' | 'api'
  kind: SendKind
  revision: number
  poNumber: string
  poLabel: string
  email: ComposedSupplierEmail
  deliveryDate: string | null
  deliveryAddress: string | null
  deliveryNotes: string | null
  note: string | null
  changes: string[]
  notOnThisOrder: string[]
  lines: LineSnapshot[]
  linesHash: string
  contentHash: string
  /** Set when pressing Send needs a second "yes" (re-send, revision, re-cancel). */
  confirmMessage: string | null
  /** Any entry here = the Send button is disabled and the server refuses. */
  blockers: string[]
  previewToken: string
  sheet: JobMaterialOrderData
  pdf: Buffer | null
  sendButtonLabel: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cleanText(v: string | null | undefined, max = 1000): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

export function buildSupplierOrderPreview(
  ctx: SupplierOrderContext,
  req: PreviewRequest,
  sender: SupplierOrderSender,
  now: Date = new Date()
): { ok: true; preview: SupplierOrderPreview } | { ok: false; status: number; message: string } {
  const supplier = ctx.suppliers.find((s) => s.id === req.vendorId)
  if (!supplier) return { ok: false, status: 404, message: 'Supplier not found.' }

  const sourcing = sourcingFor(ctx)
  const group = sourcing.supplierGroups.find((g) => g.supplier.id === supplier.id) ?? null
  const order = ctx.orders.find((o) => o.vendorId === supplier.id) ?? null
  const isCancel = req.requested === 'cancellation'

  const deliveryDate = req.deliveryDate && DATE_RE.test(req.deliveryDate) ? req.deliveryDate : null
  const deliveryAddress = cleanText(req.deliveryAddress, 300) ?? ctx.address
  const note = cleanText(req.note)
  const deliveryNotes = supplier.defaultDeliveryNotes

  const lines = isCancel ? [] : group?.lines ?? []
  const linesHash = group?.linesHash ?? sha256('[]')
  const contentHash = sha256(canonicalContent(lines, deliveryDate, deliveryAddress))

  const blockers: string[] = []
  if (!isCancel) {
    if (ctx.jobStatus === 'cancelled') blockers.push('This job is cancelled — orders cannot be sent.')
    if (!group) blockers.push(`Nothing on this job is ordered from ${supplier.name} right now.`)
    blockers.push(...sourcing.blockers)
    if (group) blockers.push(...group.blockers.filter((b) => !(req.manual && /no order email/.test(b))))
    if (!req.manual && !deliveryDate) blockers.push('Pick a delivery date.')
    if (!req.manual && !deliveryAddress) blockers.push('Add a delivery address.')
  }
  const channelProblem = req.manual ? null : supplierChannelProblem(supplier, isCancel ? undefined : snapshotLines(lines))
  if (channelProblem) blockers.push(channelProblem)

  const latest = ctx.sends.find((s) => s.supplierOrderId === order?.id && (s.status === 'sent' || s.status === 'unknown')) ?? null
  const lastSend: LastSend = latest ? { status: latest.status as 'sent' | 'unknown', kind: latest.kind, at: latest.sentAt ?? latest.createdAt, to: latest.toEmail } : null
  const decision = decideSend({ requested: req.requested, order, contentHash, lastSend, now, timeZone: DEFAULT_TIMEZONE })
  if (!decision.ok) blockers.push(decision.message)

  const kind: SendKind = decision.ok ? decision.kind : isCancel ? 'cancellation' : 'order'
  // An API connector may only carry a first order: a revision/resend/cancel would be a second order or a no-op at the supplier.
  const kindProblem = req.manual ? null : connectorFor(supplier)?.kindProblem?.(kind) ?? null
  if (kindProblem) blockers.push(kindProblem)
  const revision = decision.ok ? decision.revision : order?.revision ?? 0
  const number = order?.poNumber ?? poNumber(ctx.jobNumber, nextPoLetter(usedLetters(ctx)))
  const label = poLabel(number, revision)

  // Where lines that left this PO went, so the revision says "now ordered from X".
  const movedTo: Record<string, string> = {}
  for (const g of sourcing.supplierGroups) {
    if (g.supplier.id === supplier.id) continue
    for (const l of g.lines) movedTo[l.key] = `now ordered from ${g.supplier.name}`
  }
  for (const l of sourcing.lines) {
    if (l.source === 'installer') movedTo[l.key] = 'now supplied by the installer'
    else if (l.source === 'customer') movedTo[l.key] = 'now supplied by the customer'
    else if (l.source === 'stock') movedTo[l.key] = 'now from our stock'
  }
  const changes =
    kind === 'revision'
      ? describeOrderChanges({
          previous: order?.lastLines ?? null,
          current: lines,
          previousDeliveryDate: order?.lastDeliveryDate ?? null,
          deliveryDate,
          previousDeliveryAddress: order?.lastDeliveryAddress ?? null,
          deliveryAddress,
          movedTo,
        })
      : []

  const groupTrades = new Set(group?.trades ?? [])
  const notOnThisOrder = sourcing.nonPo.filter((g) => groupTrades.has(g.trade)).map(nonPoLabel)

  const sections = sectionsForLines(lines)
  const subject = orderSubject({ kind, label, address: deliveryAddress, deliveryDate })
  const heading = kind === 'cancellation' ? `Cancel PO ${label}` : kind === 'revision' ? `Revised PO ${label}` : `PO ${label}`

  const sheet: JobMaterialOrderData = {
    ...ctx.baseSheet,
    // The job's product/accessories text describes the primary trade's materials — only the PO
    // that carries those lines prints it, so another supplier is never asked for them.
    product: groupTrades.has(ctx.primaryTrade) ? ctx.baseSheet.product : null,
    accessories: groupTrades.has(ctx.primaryTrade) ? ctx.baseSheet.accessories : null,
    sections: sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ctx.displayByKey.get(r.key) ?? displayFromLine(r)),
    })),
    isEmpty: lines.length === 0,
    generatedAt: now.toISOString(),
    purchaseOrder: {
      heading,
      supplierName: supplier.name,
      accountNumber: supplier.accountNumber,
      branch: supplier.defaultBranch,
      deliveryDate: deliveryDate ? deliveryDate : null,
      deliveryAddress,
      deliveryNotes,
      note,
      changes,
      notOnThisOrder,
    },
  }

  // Someone else already asked to send this exact order and it needs a second person.
  const waiting = supplier.connectionType === 'api' && order
    ? (ctx.apiApprovals ?? []).find((a) => a.supplierOrderId === order.id && a.contentHash === contentHash && a.status === 'pending' && a.requestedBy !== sender.id)
    : undefined
  const approvalPrompt = waiting
    ? `${waiting.requestedByName ?? 'Someone'} asked to send this order and it needs a second person to approve. Sending it now approves it and places the order with ${supplier.name}.`
    : null

  let pdf: Buffer | null = null
  if (!isCancel && lines.length > 0) {
    const rendered = renderJobMaterialOrderPDF(sheet)
    pdf = rendered.pdf
    if (rendered.truncated && !req.manual && supplier.connectionType !== 'api') {
      blockers.push('This order does not fit on one page, so it cannot be emailed from here. Download the order sheet and email it yourself.')
    }
  }

  const email = composeSupplierOrderEmail({
    kind,
    supplier,
    sender,
    orgName: ctx.orgName,
    orgPhone: ctx.orgPhone,
    jobNumber: ctx.jobNumber,
    poLabel: label,
    subject,
    deliveryDate,
    deliveryAddress,
    deliveryNotes,
    note,
    sections,
    changes,
  })

  const previewToken = sha256(
    JSON.stringify([kind, revision, label, email.to, email.cc, email.subject, contentHash, note, deliveryNotes, supplier.connectionType, apiFingerprint(supplier)])
  )

  const verb = kind === 'cancellation' ? 'Send cancellation to' : kind === 'revision' ? 'Send revised order to' : 'Send order to'
  return {
    ok: true,
    preview: {
      vendorId: supplier.id,
      supplierName: supplier.name,
      connectionType: supplier.connectionType,
      kind,
      revision,
      poNumber: number,
      poLabel: label,
      email,
      deliveryDate,
      deliveryAddress,
      deliveryNotes,
      note,
      changes,
      notOnThisOrder,
      lines: snapshotLines(lines),
      linesHash,
      contentHash,
      confirmMessage: decision.ok ? decision.confirmMessage ?? approvalPrompt : null,
      blockers: Array.from(new Set(blockers)),
      previewToken,
      sheet,
      pdf,
      sendButtonLabel: `${verb} ${supplier.name}`,
    },
  }
}

/** Everything about the API connection that changes what an order does, so a switch/environment/mapping change after the preview invalidates its token. */
function apiFingerprint(supplier: SupplierRecord): string | null {
  const a = supplier.api
  if (!a) return null
  return sha256(
    JSON.stringify([a.environment, a.orderingEnabled, a.orgOrderingEnabled, a.shipToNumber, a.branchNumber, a.deliveryService, [...a.itemMap].sort((x, y) => x.lineKey.localeCompare(y.lineKey))])
  )
}

function displayFromLine(l: OrderLine): DisplayMaterialsOrderItem {
  return {
    key: l.key,
    label: l.label,
    qty: l.qty,
    detail: l.detail,
    status: l.status,
    note: l.note,
    computedQty: l.computedQty ?? l.qty,
    computedDetail: l.detail,
    computedNote: l.note,
    isExcluded: false,
    isEdited: !!l.isEdited,
    overrideNote: null,
  }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SupplierOrderStore = {
  ensureSupplierOrder(args: { orgId: string; jobId: string; vendorId: string; jobNumber: string }): Promise<SupplierOrderRecord>
  expireStaleSends(supplierOrderId: string, olderThanIso: string): Promise<void>
  insertSend(row: Record<string, unknown>): Promise<{ id: string } | { conflict: true } | { error: string }>
  insertSendLines(rows: Record<string, unknown>[]): Promise<{ error?: string }>
  insertSendSourcing(rows: Record<string, unknown>[]): Promise<{ error?: string }>
  completeSend(id: string, patch: Record<string, unknown>): Promise<{ error?: string }>
  updateSupplierOrder(id: string, patch: Record<string, unknown>): Promise<{ error?: string }>
  uploadPdf(path: string, pdf: Buffer): Promise<{ error?: string }>
  insertJobNote(jobId: string, userId: string, note: string): Promise<void>
}

export type SendDeps = {
  store: SupplierOrderStore
  transmit: (order: SupplierOrderTransmission) => Promise<SupplierOrderTransmitResult>
  /** status-paths' markMaterialsOrdered, bound to the admin client. */
  markMaterialsOrdered: (args: { orgId: string; jobId: string }) => Promise<{ changed: boolean; error?: string }>
  /** Cancelling a PO takes "ordered" back off the job when materials are no longer all covered. */
  unmarkMaterialsOrdered?: (args: { orgId: string; jobId: string }) => Promise<unknown>
  now?: () => Date
  /**
   * Runs after the double-send checks and BEFORE a send row exists, only for real (non-manual) orders.
   * The supplier-API second-approver rule lives here; a refusal places nothing and leaves no send behind.
   */
  beforeTransmit?: (args: { ctx: SupplierOrderContext; supplier: SupplierRecord; preview: SupplierOrderPreview; actor: SendActor; orderId: string }) => Promise<{ ok: true } | { ok: false; status: number; message: string }>
}

export type SendActor = SupplierOrderSender & { canSend: boolean }

export type SendInput = PreviewRequest & { previewToken: string; confirmResend: boolean }

export type SendResult =
  | {
      ok: true
      sentAt: string
      poLabel: string
      kind: SendKind
      to: string
      rollup: MaterialsRollup
      materialsMarkedOrdered: boolean
      warning: string | null
    }
  | { ok: false; status: number; message: string; needsConfirm?: boolean; confirmMessage?: string; detail?: string }

export async function executeSupplierOrderSend(
  ctx: SupplierOrderContext,
  input: SendInput,
  actor: SendActor,
  deps: SendDeps
): Promise<SendResult> {
  const now = deps.now ?? (() => new Date())
  if (!actor.canSend) {
    return { ok: false, status: 403, message: 'Only people who can edit jobs (or an owner) can send supplier orders.' }
  }

  // "I sent it myself" only records an ORDER; a cancellation always goes through the preview.
  if (input.manual && input.requested !== 'order') {
    return { ok: false, status: 400, message: 'Only an order can be recorded as sent by hand.' }
  }
  const built = buildSupplierOrderPreview(ctx, input, actor, now())
  if (!built.ok) return built
  const preview = built.preview

  if (preview.blockers.length > 0) return { ok: false, status: 409, message: preview.blockers[0] }
  if (!input.manual && (!input.previewToken || input.previewToken !== preview.previewToken)) {
    return { ok: false, status: 409, message: 'The order changed since you opened the preview. Review it again before sending.' }
  }
  if (preview.confirmMessage && !input.confirmResend) {
    return { ok: false, status: 409, message: preview.confirmMessage, needsConfirm: true, confirmMessage: preview.confirmMessage }
  }

  const supplier = ctx.suppliers.find((s) => s.id === preview.vendorId)!
  const order = await deps.store.ensureSupplierOrder({ orgId: ctx.orgId, jobId: ctx.jobId, vendorId: supplier.id, jobNumber: ctx.jobNumber })
  if (order.poNumber !== preview.poNumber) {
    return { ok: false, status: 409, message: 'Another order on this job was just started. Review the preview again before sending.' }
  }

  // Another tab may have sent this PO since our context was loaded: the preview token matched the
  // OLD state, so refuse rather than double-send.
  const loadedOrder = ctx.orders.find((o) => o.vendorId === supplier.id) ?? null
  if (
    (loadedOrder?.lastSentAt ?? null) !== (order.lastSentAt ?? null) ||
    (loadedOrder?.status ?? 'draft') !== order.status ||
    (loadedOrder?.revision ?? 0) !== order.revision
  ) {
    return { ok: false, status: 409, message: 'This order was just sent or changed from another screen. Refresh and review it again.' }
  }

  if (!input.manual && deps.beforeTransmit) {
    const gate = await deps.beforeTransmit({ ctx, supplier, preview, actor, orderId: order.id })
    if (!gate.ok) return gate
  }

  const startedAt = now()
  await deps.store.expireStaleSends(order.id, new Date(startedAt.getTime() - STALE_SEND_MS).toISOString())
  const pdfSha = preview.pdf ? sha256(preview.pdf) : null
  const inserted = await deps.store.insertSend({
    org_id: ctx.orgId,
    job_id: ctx.jobId,
    supplier_order_id: order.id,
    vendor_id: supplier.id,
    kind: preview.kind,
    po_label: preview.poLabel,
    revision: preview.revision,
    connection_type: supplier.connectionType,
    status: 'sending',
    sent_by: actor.id,
    to_email: input.manual ? 'sent by hand' : preview.email.to || supplier.name,
    cc_emails: input.manual ? [] : preview.email.cc,
    subject: preview.email.subject,
    note: preview.note,
    delivery_date: preview.deliveryDate,
    delivery_address: preview.deliveryAddress,
    delivery_notes: preview.deliveryNotes,
    line_count: preview.lines.length,
    lines_hash: preview.linesHash,
    content_hash: preview.contentHash,
    pdf_sha256: pdfSha,
    created_at: startedAt.toISOString(),
  })
  if ('conflict' in inserted) {
    return { ok: false, status: 409, message: 'This order is already being sent. Wait a moment, then refresh.' }
  }
  if ('error' in inserted) {
    return { ok: false, status: 500, message: NOT_SENT_MESSAGE, detail: inserted.error }
  }
  const sendId = inserted.id

  const fail = async (message: string, detail: string): Promise<SendResult> => {
    await deps.store.completeSend(sendId, {
      status: 'failed',
      error: detail.slice(0, 1000),
      failed_at: now().toISOString(),
      completed_at: now().toISOString(),
    })
    return { ok: false, status: 502, message, detail }
  }

  // The lines + sourcing are recorded as rows before anything leaves, so every attempt is reportable.
  const lineRows = preview.lines.map((l) => ({
    org_id: ctx.orgId,
    send_id: sendId,
    supplier_order_id: order.id,
    job_id: ctx.jobId,
    vendor_id: supplier.id,
    line_key: l.key,
    trade: l.trade,
    label: l.label,
    quantity_text: l.qty,
    note: l.note,
    line_status: l.status,
    material_source: 'supplier',
  }))
  if (lineRows.length > 0) {
    const r = await deps.store.insertSendLines(lineRows)
    if (r.error) return fail(NOT_SENT_MESSAGE, `Could not record the order lines: ${r.error}`)
  }
  const snapshot = sourcingSnapshot(sourcingFor(ctx), ctx.trades)
  const srcRows = Object.entries(snapshot).map(([trade, s]) => ({
    org_id: ctx.orgId,
    send_id: sendId,
    job_id: ctx.jobId,
    trade,
    material_source: s.source,
    installer_sub_id: s.subId,
    installer_name: s.subName,
    installer_supplies_materials: s.suppliesMaterials,
  }))
  if (srcRows.length > 0) {
    const r = await deps.store.insertSendSourcing(srcRows)
    if (r.error) return fail(NOT_SENT_MESSAGE, `Could not record sourcing: ${r.error}`)
  }

  let storagePath: string | null = null
  if (preview.pdf) {
    storagePath = `${ctx.orgId}/jobs/${ctx.jobId}/supplier-orders/${preview.poLabel.replace(/[^A-Za-z0-9._-]/g, '-')}-${sendId}.pdf`
    const up = await deps.store.uploadPdf(storagePath, preview.pdf)
    if (up.error) return fail(NOT_SENT_MESSAGE, `Could not save a copy of the PDF: ${up.error}`)
  }

  let result: SupplierOrderTransmitResult
  try {
    result = input.manual
      ? { channel: 'email', reference: null }
      : await deps.transmit({
      kind: preview.kind,
      supplier,
      jobNumber: ctx.jobNumber,
      poLabel: preview.poLabel,
      deliveryDate: preview.deliveryDate,
      deliveryAddress: preview.deliveryAddress,
      deliveryNotes: preview.deliveryNotes,
      note: preview.note,
      lines: preview.lines,
      email: preview.email,
      pdf: preview.pdf,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // A clear refusal means nothing left. Anything else (timeout, dropped connection) may have
    // been accepted by the server, so record it as unknown: the next send asks for a second yes.
    const clearRefusal = (error as { refused?: boolean })?.refused === true || /refused|not set up|no order email|no API connection|invalid|rejected/i.test(detail)
    if (!clearRefusal) {
      await deps.store.completeSend(sendId, {
        status: 'unknown',
        error: detail.slice(0, 1000),
        completed_at: now().toISOString(),
      })
      return {
        ok: false,
        status: 502,
        message: 'Not sure this went out (the supplier did not answer). Check your sent mail or call them before sending again.',
        detail,
      }
    }
    return fail(NOT_SENT_MESSAGE, detail)
  }

  // ---- It went out. Everything below records it; none of it may un-send or re-send. ----
  const sentAt = now().toISOString()
  const sentTo = input.manual ? 'sent by hand' : preview.email.to || supplier.name
  let warning: string | null = null
  const done = await deps.store.completeSend(sendId, {
    status: 'sent',
    sent_at: sentAt,
    completed_at: sentAt,
    message_id: result.reference,
    pdf_storage_path: storagePath,
  })
  const isCancel = preview.kind === 'cancellation'
  const orderPatch: Record<string, unknown> = isCancel
    ? { status: 'cancelled', cancelled_at: sentAt, cancelled_by: actor.id, last_sent_at: sentAt, last_sent_to: sentTo, updated_at: sentAt }
    : {
        status: 'sent',
        revision: preview.revision,
        last_lines_hash: preview.linesHash,
        last_content_hash: preview.contentHash,
        last_send_id: sendId,
        last_delivery_date: preview.deliveryDate,
        last_delivery_address: preview.deliveryAddress,
        first_sent_at: order.lastSentAt ? undefined : sentAt,
        last_sent_at: sentAt,
        last_sent_by: actor.id,
        last_sent_to: sentTo,
        cancelled_at: null,
        cancelled_by: null,
        updated_at: sentAt,
      }
  for (const k of Object.keys(orderPatch)) if (orderPatch[k] === undefined) delete orderPatch[k]
  const upd = await deps.store.updateSupplierOrder(order.id, orderPatch)
  if (done.error || upd.error) {
    warning = 'Sent, but the CRM could not record it. Do not send again — tell an admin.'
  }

  // Rollup with this send applied.
  const updatedOrders = ctx.orders.filter((o) => o.id !== order.id)
  updatedOrders.push({
    ...order,
    status: isCancel ? 'cancelled' : 'sent',
    revision: isCancel ? order.revision : preview.revision,
    lastLinesHash: isCancel ? order.lastLinesHash : preview.linesHash,
    lastContentHash: isCancel ? order.lastContentHash : preview.contentHash,
    lastSentAt: sentAt,
    lastSentTo: preview.email.to,
  })
  const rollup = materialsOrderRollup({ sourcing: sourcingFor(ctx), orders: updatedOrders, trades: ctx.trades })

  let materialsMarkedOrdered = false
  if (!isCancel && rollup.allCovered && !warning) {
    try {
      const marked = await deps.markMaterialsOrdered({ orgId: ctx.orgId, jobId: ctx.jobId })
      materialsMarkedOrdered = marked.changed
    } catch {
      warning = 'Sent. The job status could not be updated — mark materials ordered by hand.'
    }
  }
  if (isCancel && !rollup.allCovered && deps.unmarkMaterialsOrdered) {
    await deps.unmarkMaterialsOrdered({ orgId: ctx.orgId, jobId: ctx.jobId }).catch(() => undefined)
  }

  const via = input.manual ? `${supplier.name} (sent by hand)` : supplier.connectionType === 'api' ? `${supplier.name} (by API)` : `${supplier.name} (${preview.email.to})`
  const who = actor.name || 'someone'
  const what =
    preview.kind === 'cancellation'
      ? `Cancellation of PO ${preview.poLabel} sent to ${via} by ${who}.`
      : preview.kind === 'revision'
        ? `Revised PO ${preview.poLabel} sent to ${via} by ${who}.${preview.changes.length ? ` Changes: ${preview.changes.join('; ')}.` : ''}`
        : preview.kind === 'resend'
          ? `PO ${preview.poLabel} sent again to ${via} by ${who}.`
          : `PO ${preview.poLabel} sent to ${via} by ${who}.`
  await deps.store.insertJobNote(ctx.jobId, actor.id, `${what} ${rollup.summary}.`).catch(() => undefined)

  return { ok: true, sentAt, poLabel: preview.poLabel, kind: preview.kind, to: input.manual ? 'sent by hand' : preview.email.to, rollup, materialsMarkedOrdered, warning }
}

/**
 * For status-paths: re-check "materials ordered" after something other than a send changes the
 * picture (e.g. an installer-supplied trade's crew gets scheduled). Never sends anything.
 */
export async function refreshMaterialsOrderedFromSuppliers(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  markMaterialsOrdered: SendDeps['markMaterialsOrdered']
): Promise<{ rollup: MaterialsRollup | null; changed: boolean }> {
  const loaded = await loadSupplierOrderContext(admin, orgId, jobId)
  if (!loaded.ok) return { rollup: null, changed: false }
  const rollup = materialsOrderRollup({ sourcing: sourcingFor(loaded.ctx), orders: loaded.ctx.orders, trades: loaded.ctx.trades })
  if (!rollup.allCovered) return { rollup, changed: false }
  const r = await markMaterialsOrdered({ orgId, jobId })
  return { rollup, changed: r.changed }
}

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

export function supabaseSupplierOrderStore(admin: SupabaseClient): SupplierOrderStore {
  return {
    async ensureSupplierOrder({ orgId, jobId, vendorId, jobNumber }) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: existing } = await admin
          .from('supplier_orders')
          .select('*')
          .eq('org_id', orgId)
          .eq('job_id', jobId)
          .eq('vendor_id', vendorId)
          .maybeSingle()
        if (existing) return orderFromRow(existing as Record<string, unknown>)
        const { data: used } = await admin.from('supplier_orders').select('po_letter').eq('org_id', orgId).eq('job_id', jobId)
        const letter = nextPoLetter(((used ?? []) as { po_letter: string }[]).map((u) => u.po_letter))
        const { data: created, error } = await admin
          .from('supplier_orders')
          .insert({ org_id: orgId, job_id: jobId, vendor_id: vendorId, po_letter: letter, po_number: poNumber(jobNumber, letter), status: 'draft' })
          .select('*')
          .single()
        if (created) return orderFromRow(created as Record<string, unknown>)
        if (error && error.code !== '23505') throw new Error(error.message)
      }
      throw new Error('Could not allocate a PO number')
    },
    async expireStaleSends(supplierOrderId, olderThanIso) {
      await admin
        .from('supplier_order_sends')
        .update({ status: 'unknown', completed_at: new Date().toISOString(), error: 'Send never finished' })
        .eq('supplier_order_id', supplierOrderId)
        .eq('status', 'sending')
        .lt('created_at', olderThanIso)
    },
    async insertSend(row) {
      const { data, error } = await admin.from('supplier_order_sends').insert(row).select('id').single()
      if (error) return error.code === '23505' ? { conflict: true } : { error: error.message }
      return { id: String((data as { id: string }).id) }
    },
    async insertSendLines(rows) {
      const { error } = await admin.from('supplier_order_send_lines').insert(rows)
      return error ? { error: error.message } : {}
    },
    async insertSendSourcing(rows) {
      const { error } = await admin.from('supplier_order_send_sourcing').insert(rows)
      return error ? { error: error.message } : {}
    },
    async completeSend(id, patch) {
      const { error } = await admin.from('supplier_order_sends').update(patch).eq('id', id)
      return error ? { error: error.message } : {}
    },
    async updateSupplierOrder(id, patch) {
      const { error } = await admin.from('supplier_orders').update(patch).eq('id', id)
      return error ? { error: error.message } : {}
    },
    async uploadPdf(path, pdf) {
      const { error } = await admin.storage.from(FILES_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
      return error ? { error: error.message } : {}
    },
    async insertJobNote(jobId, userId, note) {
      const { data: job } = await admin.from('production_jobs').select('org_id').eq('id', jobId).maybeSingle()
      const orgId = (job as { org_id: string } | null)?.org_id
      if (!orgId) return
      const res = await writeJobNote(admin, { orgId, jobId, userId, body: note, kind: 'system' })
      if (!res.ok) console.error('[supplier-orders] job note failed', res.error)
    },
  }
}

function orderFromRow(o: Record<string, unknown>): SupplierOrderRecord {
  return {
    id: String(o.id),
    vendorId: String(o.vendor_id),
    poLetter: String(o.po_letter),
    poNumber: String(o.po_number),
    revision: Number(o.revision ?? 0),
    status: o.status as SupplierOrderRecord['status'],
    lastLinesHash: str(o.last_lines_hash),
    lastContentHash: str(o.last_content_hash),
    lastLines: null,
    lastDeliveryDate: str(o.last_delivery_date),
    lastDeliveryAddress: str(o.last_delivery_address),
    lastSentAt: str(o.last_sent_at),
    lastSentTo: str(o.last_sent_to),
    receivedAt: str(o.received_at),
  }
}


/** The job's one materials answer, from its supplier orders (stored status only as the fallback). */
export function materialsStateForContext(ctx: SupplierOrderContext, stored: string | null) {
  const rollup = materialsOrderRollup({ sourcing: sourcingFor(ctx), orders: ctx.orders, trades: ctx.trades })
  return deriveMaterialsState({
    stored,
    suppliers: { rollup, sentOrders: ctx.orders.filter((o) => o.status === 'sent').map((o) => ({ receivedAt: o.receivedAt })) },
  })
}

/**
 * Keeps production_jobs.materials_status (what the board, reports and Needs-you read) in step with the supplier orders.
 * Runs after a send or a "received" change. Never moves the job's own status; only the materials mirror (+ the ordered date once).
 */
export async function syncMaterialsMirror(admin: SupabaseClient, orgId: string, jobId: string): Promise<{ changed: boolean; state: ReturnType<typeof deriveMaterialsState> | null }> {
  const loaded = await loadSupplierOrderContext(admin, orgId, jobId)
  if (!loaded.ok) return { changed: false, state: null }
  const { data: job } = await admin.from('production_jobs').select('materials_status, materials_ordered_at').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (!job) return { changed: false, state: null }
  const state = materialsStateForContext(loaded.ctx, (job as { materials_status: string | null }).materials_status)
  if (state.source !== 'suppliers' || state.mirror === (job as { materials_status: string | null }).materials_status) return { changed: false, state }
  const patch: Record<string, unknown> = { materials_status: state.mirror }
  if (state.mirror !== 'not_ordered' && !(job as { materials_ordered_at: string | null }).materials_ordered_at) patch.materials_ordered_at = new Date().toISOString()
  const { error } = await admin.from('production_jobs').update(patch).eq('id', jobId).eq('org_id', orgId)
  if (error) {
    console.error('[supplier-orders] materials mirror failed', error.message)
    return { changed: false, state }
  }
  return { changed: true, state }
}
