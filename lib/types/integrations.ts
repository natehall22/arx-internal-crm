export type SyncStatus = 'pending' | 'synced' | 'failed' | 'skipped'
export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

export type IntegrationProvider = 'quickbooks' | 'xero' | 'sage' | 'freshbooks'

export type IntegrationEventType =
  | 'customer.upserted'
  | 'customer.deleted'
  | 'invoice.finalized'
  | 'invoice.voided'
  | 'invoice.paid'
  | 'payment.recorded'
  | 'payment.deleted'

export interface IntegrationOutboxEvent {
  id: string
  org_id: string
  provider: IntegrationProvider
  event_type: IntegrationEventType
  entity_table: string
  entity_id: string
  idempotency_key: string
  payload: Record<string, any>
  status: OutboxStatus
  attempt_count: number
  last_error: string | null
  created_at: string
  updated_at: string
  processed_at: string | null
}

export interface CustomerSyncFields {
  qb_customer_id: string | null
  sync_status: SyncStatus
  synced_to_qb_at: string | null
}

export interface InvoiceSyncFields {
  qb_invoice_id: string | null
  sync_status: SyncStatus
  synced_to_qb_at: string | null
}

export interface PaymentSyncFields {
  qb_payment_id: string | null
  sync_status: SyncStatus
  synced_to_qb_at: string | null
}

export interface EnqueueEventParams {
  orgId: string
  provider: IntegrationProvider
  eventType: IntegrationEventType
  entityTable: string
  entityId: string
  payload: Record<string, any>
  version?: number
}
