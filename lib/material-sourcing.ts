/**
 * Where each order line's materials come from, and which supplier purchase orders that makes.
 *
 * Trade-agnostic on purpose: a trade is just a string ("roofing", "gutters", "electrical", …) and
 * suppliers, installers and company defaults are data. Nothing here knows about QXO, gutters or
 * roofs (ABC Supply is just a supplier row). Every line has exactly one material source:
 *
 *   supplier  — we buy it; ONLY these lines produce purchase orders, grouped by supplier
 *   installer — the sub for that trade buys it and bills us (labor + materials)
 *   customer  — owner-furnished (fixtures, appliances); no PO, noted on the sheet
 *   stock     — from our own stock; no PO, optional pick list
 *
 * Source:   line override → job/trade override → trade's sub supplies materials → company default → supplier
 * Supplier: line override → job/trade override → company default for the trade (exactly one)
 *
 * Pure and client-safe: the job page, the preview, the send route and tests all call this.
 */
import { TRADE_LABELS } from '@/lib/job-trades'

export const MATERIAL_SOURCES = ['supplier', 'installer', 'customer', 'stock'] as const
export type MaterialSource = (typeof MATERIAL_SOURCES)[number]

export const MATERIAL_SOURCE_LABELS: Record<MaterialSource, string> = {
  supplier: 'Buy from supplier',
  installer: 'Installer supplies',
  customer: 'Customer supplies',
  stock: 'From our stock',
}

export function isMaterialSource(value: unknown): value is MaterialSource {
  return typeof value === 'string' && (MATERIAL_SOURCES as readonly string[]).includes(value)
}

/** Display name for any trade string — known trades use their label, others are title-cased. */
export function tradeLabel(trade: string): string {
  const known = (TRADE_LABELS as Record<string, string>)[trade]
  if (known) return known
  const t = trade.replace(/[_-]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other'
}

export type OrderLineStatus = 'ready' | 'confirm' | 'manual'

export type OrderLine = {
  key: string
  trade: string
  label: string
  qty: string | null
  detail: string | null
  note: string | null
  status: OrderLineStatus
  excluded: boolean
  isEdited?: boolean
  computedQty?: string | null
  /** Per-line overrides (job_material_order_overrides.material_source / vendor_id). */
  sourceOverride?: MaterialSource | null
  vendorOverrideId?: string | null
}

export type SupplierRecord = {
  id: string
  name: string
  orderEmail: string | null
  ccEmails: string[]
  accountNumber: string | null
  defaultBranch: string | null
  defaultDeliveryNotes: string | null
  defaultForTrades: string[]
  active: boolean
  /** How orders reach this supplier; 'api' is reserved for a connector (lib/suppliers/send-order.ts). */
  connectionType: 'email' | 'api'
}

export type TradeInstaller = {
  subId: string
  name: string
  suppliesMaterials: boolean | null
}

export type TradeContext = {
  trade: string
  installer: TradeInstaller | null
  /** An active crew/work order for this trade has a date. */
  scheduled: boolean
}

export type TradeOverride = {
  trade: string
  source: MaterialSource | null
  vendorId: string | null
}

export type SourcingInput = {
  lines: OrderLine[]
  suppliers: SupplierRecord[]
  trades: TradeContext[]
  tradeOverrides: TradeOverride[]
  orgSourceDefaults: Record<string, unknown> | null
  /** Turns a canonical line string into the stored hash. Server passes sha256; default is identity. */
  hash?: (canonical: string) => string
}

export type ResolvedLine = OrderLine & {
  source: MaterialSource
  vendorId: string | null
  /** Why a supplier line cannot be ordered yet (no supplier, two defaults, inactive supplier). */
  problem: string | null
}

export type OrderSection = { trade: string; title: string; rows: ResolvedLine[] }

export type SupplierGroup = {
  supplier: SupplierRecord
  lines: ResolvedLine[]
  trades: string[]
  linesHash: string
  /** Reasons this supplier's PO cannot be sent right now. */
  blockers: string[]
}

export type NonPoGroup = {
  source: Exclude<MaterialSource, 'supplier'>
  trade: string
  installerName: string | null
  lines: ResolvedLine[]
}

export type SourcingResult = {
  lines: ResolvedLine[]
  supplierGroups: SupplierGroup[]
  /** installer / customer / stock, one entry per (source, trade). */
  nonPo: NonPoGroup[]
  /** Supplier-sourced lines with no usable supplier. Any of these blocks every send on the job. */
  unassigned: ResolvedLine[]
  /** Job-wide reasons nothing can be sent. */
  blockers: string[]
}

const STATUS_ORDER: OrderLineStatus[] = ['ready', 'confirm', 'manual']
const STATUS_TITLES: Record<OrderLineStatus, string> = {
  ready: 'Order',
  confirm: 'Confirm before ordering',
  manual: 'Manual — count in field',
}

function defaultSourceFor(trade: string, defaults: Record<string, unknown> | null): MaterialSource | null {
  if (!defaults || typeof defaults !== 'object') return null
  const v = (defaults as Record<string, unknown>)[trade]
  return isMaterialSource(v) ? v : null
}

function companyDefaultSuppliers(trade: string, suppliers: SupplierRecord[]): SupplierRecord[] {
  return suppliers.filter((s) => s.active && s.defaultForTrades.includes(trade))
}

export function resolveSourcing(input: SourcingInput): SourcingResult {
  const tradeCtx = new Map(input.trades.map((t) => [t.trade, t]))
  const tradeOv = new Map(input.tradeOverrides.map((t) => [t.trade, t]))
  const supplierById = new Map(input.suppliers.map((s) => [s.id, s]))

  const resolved: ResolvedLine[] = input.lines
    .filter((line) => !line.excluded)
    .map((line) => {
      const ov = tradeOv.get(line.trade)
      const ctx = tradeCtx.get(line.trade)
      const source: MaterialSource =
        line.sourceOverride ??
        ov?.source ??
        (ctx?.installer?.suppliesMaterials === true ? 'installer' : null) ??
        defaultSourceFor(line.trade, input.orgSourceDefaults) ??
        'supplier'

      if (source !== 'supplier') return { ...line, source, vendorId: null, problem: null }

      const explicitId = line.vendorOverrideId ?? ov?.vendorId ?? null
      if (explicitId) {
        const s = supplierById.get(explicitId)
        if (!s || !s.active) {
          return { ...line, source, vendorId: null, problem: 'The supplier picked for this line is no longer active' }
        }
        return { ...line, source, vendorId: s.id, problem: null }
      }
      const defaults = companyDefaultSuppliers(line.trade, input.suppliers)
      if (defaults.length === 1) return { ...line, source, vendorId: defaults[0].id, problem: null }
      if (defaults.length > 1) {
        return {
          ...line,
          source,
          vendorId: null,
          problem: `${defaults.map((d) => d.name).join(' and ')} are both set as the default for ${tradeLabel(line.trade)} — pick one in Settings → Suppliers`,
        }
      }
      return { ...line, source, vendorId: null, problem: `No supplier set for ${tradeLabel(line.trade)}` }
    })

  const unassigned = resolved.filter((l) => l.source === 'supplier' && !l.vendorId)

  const groupsById = new Map<string, ResolvedLine[]>()
  for (const line of resolved) {
    if (line.source !== 'supplier' || !line.vendorId) continue
    const list = groupsById.get(line.vendorId) ?? []
    list.push(line)
    groupsById.set(line.vendorId, list)
  }

  const blockers: string[] = []
  if (unassigned.length > 0) {
    blockers.push(
      `${unassigned.length} line${unassigned.length === 1 ? ' has' : 's have'} no supplier yet: ${unassigned
        .map((l) => l.label)
        .join(', ')}. Pick a supplier for ${unassigned.length === 1 ? 'it' : 'them'} before sending any order.`
    )
  }

  const supplierGroups: SupplierGroup[] = Array.from(groupsById.entries()).map(([id, lines]) => {
    const supplier = supplierById.get(id)!
    const groupBlockers: string[] = []
    if (supplier.connectionType === 'email' && !supplier.orderEmail) {
      groupBlockers.push(`${supplier.name} has no order email — add one in Settings → Suppliers`)
    }
    return {
      supplier,
      lines,
      trades: uniqueInOrder(lines.map((l) => l.trade)),
      linesHash: (input.hash ?? ((x: string) => x))(canonicalLines(lines)),
      blockers: groupBlockers,
    }
  })
  supplierGroups.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name))

  const nonPoMap = new Map<string, NonPoGroup>()
  for (const line of resolved) {
    if (line.source === 'supplier') continue
    const k = `${line.source}:${line.trade}`
    let g = nonPoMap.get(k)
    if (!g) {
      g = {
        source: line.source,
        trade: line.trade,
        installerName: line.source === 'installer' ? tradeCtx.get(line.trade)?.installer?.name ?? null : null,
        lines: [],
      }
      nonPoMap.set(k, g)
    }
    g.lines.push(line)
  }

  return { lines: resolved, supplierGroups, nonPo: Array.from(nonPoMap.values()), unassigned, blockers }
}

function uniqueInOrder<T>(values: T[]): T[] {
  const seen = new Set<T>()
  return values.filter((v) => (seen.has(v) ? false : (seen.add(v), true)))
}

/** Rows grouped by trade then status; trade prefix only when the PO spans more than one trade. */
export function sectionsForLines(lines: ResolvedLine[] | OrderLine[]): OrderSection[] {
  const trades = uniqueInOrder(lines.map((l) => l.trade))
  const multi = trades.length > 1
  const out: OrderSection[] = []
  for (const trade of trades) {
    for (const status of STATUS_ORDER) {
      const rows = (lines as ResolvedLine[]).filter((l) => l.trade === trade && l.status === status)
      if (rows.length === 0) continue
      out.push({ trade, title: multi ? `${tradeLabel(trade)} — ${STATUS_TITLES[status]}` : STATUS_TITLES[status], rows })
    }
  }
  return out
}

/** Plain-English label for a non-PO group, e.g. "Gutters — supplied by installer (Gutter Co)". */
export function nonPoLabel(g: NonPoGroup): string {
  const trade = tradeLabel(g.trade)
  if (g.source === 'installer') return `${trade} — supplied by installer${g.installerName ? ` (${g.installerName})` : ' (no crew assigned yet)'}`
  if (g.source === 'customer') return `${trade} — customer supplies`
  return `${trade} — from our stock`
}

// ---------------------------------------------------------------------------
// Snapshots, hashes, diffs
// ---------------------------------------------------------------------------

export type LineSnapshot = { key: string; trade: string; label: string; qty: string | null; note: string | null; status: OrderLineStatus }

export function snapshotLines(lines: OrderLine[]): LineSnapshot[] {
  return [...lines]
    .map((l) => ({ key: l.key, trade: l.trade, label: l.label, qty: l.qty ?? null, note: l.note ?? null, status: l.status }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** Stable string of what the supplier is asked for. Hash it server-side; equality is what matters. */
export function canonicalLines(lines: OrderLine[]): string {
  return JSON.stringify(snapshotLines(lines).map((l) => [l.key, l.trade, l.label, l.qty, l.note, l.status]))
}

export function canonicalContent(lines: OrderLine[], deliveryDate: string | null, deliveryAddress: string | null): string {
  return JSON.stringify([canonicalLines(lines), deliveryDate ?? null, (deliveryAddress ?? '').trim()])
}

/**
 * What changed since the last PO went out, in words a supplier reads.
 * `movedTo` maps a line key to where it went, e.g. "now ordered from ABC Supply".
 */
export function describeOrderChanges(args: {
  previous: LineSnapshot[] | null
  current: OrderLine[]
  previousDeliveryDate?: string | null
  deliveryDate?: string | null
  previousDeliveryAddress?: string | null
  deliveryAddress?: string | null
  movedTo?: Record<string, string>
}): string[] {
  const changes: string[] = []
  const prev = new Map((args.previous ?? []).map((l) => [l.key, l]))
  const cur = new Map(snapshotLines(args.current).map((l) => [l.key, l]))

  for (const [key, line] of Array.from(cur.entries())) {
    const before = prev.get(key)
    if (!before) {
      changes.push(`Added: ${line.label}${line.qty ? ` — ${line.qty}` : ''}`)
      continue
    }
    if ((before.qty ?? '') !== (line.qty ?? '')) {
      changes.push(`Changed: ${line.label} — was ${before.qty || 'no qty'}, now ${line.qty || 'no qty'}`)
    } else if ((before.note ?? '') !== (line.note ?? '') || before.label !== line.label || before.status !== line.status) {
      changes.push(`Updated: ${line.label}`)
    }
  }
  for (const [key, line] of Array.from(prev.entries())) {
    if (cur.has(key)) continue
    const moved = args.movedTo?.[key]
    changes.push(`Removed: ${line.label}${moved ? ` (${moved})` : ''}`)
  }
  if (args.previous && (args.previousDeliveryDate ?? null) !== (args.deliveryDate ?? null)) {
    changes.push(`Delivery date: was ${args.previousDeliveryDate || 'not set'}, now ${args.deliveryDate || 'not set'}`)
  }
  if (args.previous && (args.previousDeliveryAddress ?? '').trim() !== (args.deliveryAddress ?? '').trim()) {
    changes.push(`Delivery address changed to ${args.deliveryAddress || 'not set'}`)
  }
  return changes
}

// ---------------------------------------------------------------------------
// PO numbering + subjects
// ---------------------------------------------------------------------------

/** 0 → A, 25 → Z, 26 → AA. */
export function poLetter(index: number): string {
  let n = Math.max(0, Math.floor(index))
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** First letter not already used on this job. */
export function nextPoLetter(used: string[]): string {
  const taken = new Set(used)
  for (let i = 0; ; i++) {
    const l = poLetter(i)
    if (!taken.has(l)) return l
  }
}

export function poNumber(jobNumber: string, letter: string): string {
  return `${jobNumber}-${letter}`
}

export function poLabel(number: string, revision: number): string {
  return revision > 0 ? `${number}-R${revision}` : number
}

export type SendKind = 'order' | 'revision' | 'resend' | 'cancellation'

/** "2026-10-27" → "Tue Oct 27" without a timezone shift. */
export function formatDeliveryDate(date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'date TBD'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).replace(',', '')
}

export function orderSubject(args: { kind: SendKind; label: string; address: string | null; deliveryDate: string | null }): string {
  const address = (args.address || 'no address').trim()
  if (args.kind === 'cancellation') return `CANCEL PO ${args.label} – ${address}`
  const prefix = args.kind === 'revision' ? 'REVISED PO' : 'PO'
  return `${prefix} ${args.label} – ${address} – deliver ${formatDeliveryDate(args.deliveryDate)}`
}

// ---------------------------------------------------------------------------
// Supplier card state + "materials ordered" rollup
// ---------------------------------------------------------------------------

export type SupplierOrderRecord = {
  id: string
  vendorId: string
  poLetter: string
  poNumber: string
  revision: number
  status: 'draft' | 'sent' | 'cancelled'
  lastLinesHash: string | null
  lastContentHash: string | null
  lastLines: LineSnapshot[] | null
  lastDeliveryDate: string | null
  lastDeliveryAddress: string | null
  lastSentAt: string | null
  lastSentTo: string | null
}

export type SupplierCardState = 'not_sent' | 'sent' | 'changed' | 'needs_cancellation' | 'cancelled'

export function supplierCardState(group: SupplierGroup | null, order: SupplierOrderRecord | null): SupplierCardState {
  if (!order || order.status === 'draft') return group ? 'not_sent' : 'cancelled'
  if (order.status === 'cancelled') return group ? 'changed' : 'cancelled'
  // sent
  if (!group) return 'needs_cancellation'
  return order.lastLinesHash === group.linesHash ? 'sent' : 'changed'
}

export type RollupPart = { label: string; covered: boolean; detail: string }

export type MaterialsRollup = {
  parts: RollupPart[]
  covered: number
  total: number
  allCovered: boolean
  summary: string
}

/**
 * Is every material on this job taken care of? A supplier counts once its current PO is sent
 * unchanged; an installer-supplied trade counts once that trade's crew is scheduled; customer and
 * stock lines need no order. Unassigned lines and stray sent POs keep it from completing.
 */
export function materialsOrderRollup(args: {
  sourcing: SourcingResult
  orders: SupplierOrderRecord[]
  trades: TradeContext[]
}): MaterialsRollup {
  const parts: RollupPart[] = []
  const orderByVendor = new Map(args.orders.map((o) => [o.vendorId, o]))
  const tradeCtx = new Map(args.trades.map((t) => [t.trade, t]))

  for (const g of args.sourcing.supplierGroups) {
    const state = supplierCardState(g, orderByVendor.get(g.supplier.id) ?? null)
    parts.push({
      label: g.supplier.name,
      covered: state === 'sent',
      detail: state === 'sent' ? 'Ordered' : state === 'changed' ? 'Changed since sent' : 'Not sent yet',
    })
  }
  for (const g of args.sourcing.nonPo) {
    if (g.source !== 'installer') continue
    const scheduled = tradeCtx.get(g.trade)?.scheduled === true
    parts.push({
      label: g.installerName ?? `${tradeLabel(g.trade)} installer`,
      covered: scheduled,
      detail: scheduled ? 'Installer supplies — crew scheduled' : 'Installer supplies — crew not scheduled yet',
    })
  }
  const groupVendorIds = new Set(args.sourcing.supplierGroups.map((g) => g.supplier.id))
  for (const o of args.orders) {
    if (o.status === 'sent' && !groupVendorIds.has(o.vendorId)) {
      parts.push({ label: `PO ${o.poNumber}`, covered: false, detail: 'Nothing left on this order — email a cancellation' })
    }
  }
  if (args.sourcing.unassigned.length > 0) {
    parts.push({ label: 'No supplier', covered: false, detail: `${args.sourcing.unassigned.length} line(s) need a supplier` })
  }

  const total = parts.length
  const covered = parts.filter((p) => p.covered).length
  const allCovered = total > 0 && covered === total
  const summary = total === 0 ? 'Nothing to order' : `${covered} of ${total} supplier${total === 1 ? '' : 's'} ordered`
  return { parts, covered, total, allCovered, summary }
}

// ---------------------------------------------------------------------------
// Send decision — the double-send guard
// ---------------------------------------------------------------------------

export type LastSend = { status: 'sent' | 'unknown' | 'failed'; kind: SendKind; at: string; to: string } | null

export type SendDecision =
  | { ok: true; kind: SendKind; revision: number; confirmMessage: string | null }
  | { ok: false; message: string }

const DAY_MS = 24 * 60 * 60 * 1000

function fmtWhen(iso: string, now: Date, timeZone: string): string {
  const t = new Date(iso)
  const time = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
  if (now.getTime() - t.getTime() < DAY_MS) return time
  const day = t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
  return `${day} at ${time}`
}

/**
 * What a press of Send would do. `confirmMessage` set = the UI must ask again and resend with
 * `confirmResend: true`; the server refuses without it.
 */
export function decideSend(args: {
  requested: 'order' | 'cancellation'
  order: SupplierOrderRecord | null
  contentHash: string
  lastSend: LastSend
  now: Date
  timeZone: string
}): SendDecision {
  const { order, now } = args
  const when = (iso: string) => fmtWhen(iso, now, args.timeZone)

  if (args.lastSend?.status === 'unknown') {
    const unknownMsg = `A send at ${when(args.lastSend.at)} to ${args.lastSend.to} may not have finished. Check your sent mail before sending again. Send anyway?`
    if (args.requested === 'cancellation') {
      if (!order || order.status === 'draft') return { ok: true, kind: 'cancellation', revision: order?.revision ?? 0, confirmMessage: unknownMsg }
    } else {
      return { ok: true, kind: order && order.status !== 'draft' ? 'resend' : 'order', revision: order?.revision ?? 0, confirmMessage: unknownMsg }
    }
  }

  if (args.requested === 'cancellation') {
    if (!order || order.status === 'draft') return { ok: false, message: 'This order has not been sent, so there is nothing to cancel.' }
    if (order.status === 'cancelled') {
      return {
        ok: true,
        kind: 'cancellation',
        revision: order.revision,
        confirmMessage: `Cancellation already sent at ${when(order.lastSentAt ?? now.toISOString())} to ${order.lastSentTo ?? 'the supplier'}, send again?`,
      }
    }
    return { ok: true, kind: 'cancellation', revision: order.revision, confirmMessage: null }
  }

  if (!order || order.status === 'draft') return { ok: true, kind: 'order', revision: 0, confirmMessage: null }

  const sentAt = order.lastSentAt ?? now.toISOString()
  const to = order.lastSentTo ?? 'the supplier'
  if (order.status === 'cancelled') {
    const revision = order.revision + 1
    return {
      ok: true,
      kind: 'revision',
      revision,
      confirmMessage: `This order was cancelled at ${when(sentAt)}. Send it again as revised PO ${poLabel(order.poNumber, revision)}?`,
    }
  }
  if (order.lastContentHash === args.contentHash) {
    return { ok: true, kind: 'resend', revision: order.revision, confirmMessage: `Already sent at ${when(sentAt)} to ${to}, send again?` }
  }
  const revision = order.revision + 1
  return {
    ok: true,
    kind: 'revision',
    revision,
    confirmMessage: `This replaces PO ${poLabel(order.poNumber, order.revision)} sent at ${when(sentAt)} to ${to}. Send revised PO ${poLabel(order.poNumber, revision)}?`,
  }
}

// ---------------------------------------------------------------------------
// Installer change warning
// ---------------------------------------------------------------------------

export type SourcingSnapshot = Record<string, { source: MaterialSource; subId: string | null; subName: string | null; suppliesMaterials: boolean | null }>

export function sourcingSnapshot(sourcing: SourcingResult, trades: TradeContext[]): SourcingSnapshot {
  const ctx = new Map(trades.map((t) => [t.trade, t]))
  const out: SourcingSnapshot = {}
  for (const line of sourcing.lines) {
    if (out[line.trade]) continue
    const inst = ctx.get(line.trade)?.installer ?? null
    out[line.trade] = {
      source: line.source,
      subId: inst?.subId ?? null,
      subName: inst?.name ?? null,
      suppliesMaterials: inst?.suppliesMaterials ?? null,
    }
  }
  return out
}

/** Warnings only — a changed installer never triggers an email. */
export function installerChangeWarnings(previous: SourcingSnapshot | null, current: SourcingSnapshot): string[] {
  if (!previous) return []
  const warnings: string[] = []
  for (const [trade, before] of Object.entries(previous)) {
    const now = current[trade]
    if (!now) continue
    const wasInstaller = before.source === 'installer'
    const isInstaller = now.source === 'installer'
    if (!wasInstaller && !isInstaller) continue
    const subChanged = before.subId !== now.subId
    const suppliesChanged = (before.suppliesMaterials ?? null) !== (now.suppliesMaterials ?? null)
    if (wasInstaller !== isInstaller || subChanged || suppliesChanged) {
      const was = before.subName ?? 'no crew'
      const is = now.subName ?? 'no crew'
      warnings.push(
        `${tradeLabel(trade)}: the installer changed since the order was sent (was ${was}${wasInstaller ? ', supplying materials' : ''}; now ${is}${isInstaller ? ', supplying materials' : ''}). Check whether materials still need ordering — nothing was emailed.`
      )
    }
  }
  return warnings
}
