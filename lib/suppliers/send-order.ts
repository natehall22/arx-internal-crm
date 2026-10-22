/**
 * The one door a purchase order leaves the CRM through.
 *
 * Today every supplier is `connection_type = 'email'`: the composed email + PDF go out over the
 * CRM's SMTP. A supplier API connector (e.g. ABC Supply's ordering API) is a separate piece of
 * work; it plugs in here by calling {@link registerSupplierOrderConnector} — nothing else in the
 * ordering flow (preview, double-send guard, PO numbers, send log, "materials ordered") changes.
 *
 * Only POST /api/ops/jobs/[id]/supplier-orders/send reaches this (enforced by a test), so no
 * status change, cron or background job can ever place an order.
 */
import type { LineSnapshot, SendKind, SupplierRecord } from '@/lib/material-sourcing'
import { deliverSupplierOrderEmail, type ComposedSupplierEmail } from '@/lib/supplier-order-email'

export type SupplierOrderTransmission = {
  kind: SendKind
  supplier: SupplierRecord
  jobNumber: string
  poLabel: string
  deliveryDate: string | null
  deliveryAddress: string | null
  deliveryNotes: string | null
  note: string | null
  lines: LineSnapshot[]
  /** Always composed (the preview shows it); the email path sends it as-is. */
  email: ComposedSupplierEmail
  pdf: Buffer | null
}

export type SupplierOrderTransmitResult = {
  channel: 'email' | 'api'
  /** SMTP Message-ID, or the supplier system's order reference. */
  reference: string | null
}

/** What an API connector implements. Throw on any failure — the caller logs it and marks nothing. */
export type SupplierOrderConnector = {
  /** Shown in the preview instead of an email address, e.g. "ABC Supply ordering API". */
  label: string
  canHandle: (supplier: SupplierRecord) => boolean
  transmit: (order: SupplierOrderTransmission) => Promise<{ reference: string | null }>
}

const connectors: SupplierOrderConnector[] = []

export function registerSupplierOrderConnector(connector: SupplierOrderConnector): void {
  connectors.push(connector)
}

/** Test hook. */
export function clearSupplierOrderConnectors(): void {
  connectors.length = 0
}

export function connectorFor(supplier: SupplierRecord): SupplierOrderConnector | null {
  if (supplier.connectionType !== 'api') return null
  return connectors.find((c) => c.canHandle(supplier)) ?? null
}

/** Why this supplier can't be sent to right now, or null. Used by the preview to block the button. */
export function supplierChannelProblem(supplier: SupplierRecord): string | null {
  if (supplier.connectionType === 'api') {
    return connectorFor(supplier)
      ? null
      : `${supplier.name} is set to order by API, but no API connection is installed yet. Ask an owner to switch it to email in Settings → Suppliers.`
  }
  if (!supplier.orderEmail) return `${supplier.name} has no order email — ask an owner to add one in Settings → Suppliers (or use "I sent this myself")`
  return null
}

export async function sendOrderToSupplier(order: SupplierOrderTransmission): Promise<SupplierOrderTransmitResult> {
  const problem = supplierChannelProblem(order.supplier)
  if (problem) throw new Error(problem)
  const connector = connectorFor(order.supplier)
  if (connector) {
    const { reference } = await connector.transmit(order)
    return { channel: 'api', reference }
  }
  const { messageId } = await deliverSupplierOrderEmail(order.email, order.pdf)
  return { channel: 'email', reference: messageId }
}
