// Accounting outbox (`integration_outbox`). QuickBooks is the only provider; nothing drains the outbox yet — see
// docs/quickbooks-sync.md. Only the events something actually enqueues are listed.
export type IntegrationProvider = 'quickbooks'

/** payment.refunded / payment.disputed: money back out (negative job payments), written by SQL record_job_payment. */
export type IntegrationEventType = 'customer.upserted' | 'payment.recorded' | 'payment.refunded' | 'payment.disputed'

export interface EnqueueEventParams {
  orgId: string
  provider: IntegrationProvider
  eventType: IntegrationEventType
  entityTable: string
  entityId: string
  payload: Record<string, any>
  version?: number
}
