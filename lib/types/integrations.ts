// Accounting outbox (`integration_outbox`). QuickBooks is the only provider; nothing drains the outbox yet — see
// docs/quickbooks-sync.md. Only the events something actually enqueues are listed.
export type IntegrationProvider = 'quickbooks'

export type IntegrationEventType = 'customer.upserted' | 'payment.recorded'

export interface EnqueueEventParams {
  orgId: string
  provider: IntegrationProvider
  eventType: IntegrationEventType
  entityTable: string
  entityId: string
  payload: Record<string, any>
  version?: number
}
