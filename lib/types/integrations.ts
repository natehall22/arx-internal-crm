// Accounting outbox (`integration_outbox`). QuickBooks is the only provider; ONE worker drains it (lib/quickbooks/worker.ts,
// docs/quickbooks-sync.md). A row only says "this CRM record changed": the worker reads the record when it sends.
export type IntegrationProvider = 'quickbooks'

/**
 * customer.upserted      a customer (contract signing)
 * invoice.upserted/voided  the job's sale invoice (entity production_jobs) or a CRM invoice (entity job_invoices)
 * payment.recorded       money in; payment.refunded / payment.disputed: money back out (negative job payments, SQL record_job_payment)
 * payment.voided         "Undo payment": the office took back a payment entered by mistake (negative job payment keyed undo:<id>); QuickBooks voids the ORIGINAL Payment
 * bill.recorded/voided   an approved vendor bill on a purchase order (entity purchase_order_bills)
 */
export type IntegrationEventType =
  | 'customer.upserted'
  | 'invoice.upserted'
  | 'invoice.voided'
  | 'payment.recorded'
  | 'payment.refunded'
  | 'payment.disputed'
  | 'payment.voided'
  | 'bill.recorded'
  | 'bill.voided'

export interface EnqueueEventParams {
  orgId: string
  provider: IntegrationProvider
  eventType: IntegrationEventType
  entityTable: string
  entityId: string
  payload: Record<string, any>
  version?: number
}
