import { SupabaseClient } from '@supabase/supabase-js'
import {
  IntegrationProvider,
  IntegrationEventType,
  EnqueueEventParams,
} from './types/integrations'

/**
 * Generate a deterministic idempotency key for an event.
 * Format: org_id:entity_table:entity_id:event_type:vN
 */
export function generateIdempotencyKey(
  orgId: string,
  entityTable: string,
  entityId: string,
  eventType: string,
  version: number = 1
): string {
  return `${orgId}:${entityTable}:${entityId}:${eventType}:v${version}`
}

/**
 * Enqueue an integration event to the outbox.
 * Uses upsert with idempotency key to prevent duplicates.
 * Failed events can be retried by re-enqueueing.
 */
export async function enqueueIntegrationEvent(
  supabase: SupabaseClient,
  params: EnqueueEventParams
): Promise<string | null> {
  const {
    orgId,
    provider,
    eventType,
    entityTable,
    entityId,
    payload,
    version = 1,
  } = params

  const idempotencyKey = generateIdempotencyKey(
    orgId,
    entityTable,
    entityId,
    eventType,
    version
  )

  // Add metadata to payload
  const enrichedPayload = {
    ...payload,
    _meta: {
      idempotency_key: idempotencyKey,
      event_type: eventType,
      entity_table: entityTable,
      entity_id: entityId,
      version,
      enqueued_at: new Date().toISOString(),
    },
  }

  const { data, error } = await supabase
    .from('integration_outbox')
    .upsert(
      {
        org_id: orgId,
        provider,
        event_type: eventType,
        entity_table: entityTable,
        entity_id: entityId,
        idempotency_key: idempotencyKey,
        payload: enrichedPayload,
        status: 'pending',
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'idempotency_key',
        ignoreDuplicates: false,
      }
    )
    .select('id')
    .single()

  if (error) {
    console.error('Failed to enqueue integration event:', error)
    return null
  }

  return data?.id || null
}

/**
 * Enqueue customer upsert event for all configured providers.
 */
export async function enqueueCustomerUpserted(
  supabase: SupabaseClient,
  orgId: string,
  customerId: string,
  customerData: Record<string, any>
): Promise<void> {
  // For now, only enqueue for QuickBooks
  // In future, check org settings for enabled integrations
  await enqueueIntegrationEvent(supabase, {
    orgId,
    provider: 'quickbooks',
    eventType: 'customer.upserted',
    entityTable: 'customers',
    entityId: customerId,
    payload: {
      customer: {
        id: customerId,
        name: customerData.name,
        email: customerData.email,
        phone: customerData.phone,
        address: customerData.address_text,
      },
    },
  })
}

/**
 * Enqueue invoice finalized event.
 */
export async function enqueueInvoiceFinalized(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  invoiceData: {
    invoice_number: string
    customer_id?: string
    total_cents: number
    issued_at: string
    due_at?: string
    line_items: Array<{
      description: string
      qty: number
      unit_price_cents: number
      line_total_cents: number
    }>
  }
): Promise<void> {
  await enqueueIntegrationEvent(supabase, {
    orgId,
    provider: 'quickbooks',
    eventType: 'invoice.finalized',
    entityTable: 'job_invoices',
    entityId: invoiceId,
    payload: {
      invoice: {
        id: invoiceId,
        invoice_number: invoiceData.invoice_number,
        customer_id: invoiceData.customer_id,
        total_cents: invoiceData.total_cents,
        issued_at: invoiceData.issued_at,
        due_at: invoiceData.due_at,
        line_items: invoiceData.line_items,
      },
    },
  })
}

/**
 * Enqueue invoice voided event.
 */
export async function enqueueInvoiceVoided(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  invoiceNumber: string,
  voidReason: string
): Promise<void> {
  await enqueueIntegrationEvent(supabase, {
    orgId,
    provider: 'quickbooks',
    eventType: 'invoice.voided',
    entityTable: 'job_invoices',
    entityId: invoiceId,
    payload: {
      invoice: {
        id: invoiceId,
        invoice_number: invoiceNumber,
        void_reason: voidReason,
        voided_at: new Date().toISOString(),
      },
    },
  })
}

/**
 * Enqueue payment recorded event.
 */
export async function enqueuePaymentRecorded(
  supabase: SupabaseClient,
  orgId: string,
  paymentId: string,
  paymentData: {
    job_id: string
    customer_id?: string
    amount_cents: number
    paid_at: string
    payment_type: string
    method: string
    payer: string
  }
): Promise<void> {
  await enqueueIntegrationEvent(supabase, {
    orgId,
    provider: 'quickbooks',
    eventType: 'payment.recorded',
    entityTable: 'job_payments',
    entityId: paymentId,
    payload: {
      payment: {
        id: paymentId,
        job_id: paymentData.job_id,
        customer_id: paymentData.customer_id,
        amount_cents: paymentData.amount_cents,
        paid_at: paymentData.paid_at,
        payment_type: paymentData.payment_type,
        method: paymentData.method,
        payer: paymentData.payer,
      },
    },
  })
}

/**
 * Check if integrations are enabled for an org.
 * For now, returns false. In future, check org settings.
 */
export async function isIntegrationEnabled(
  supabase: SupabaseClient,
  orgId: string,
  provider: IntegrationProvider
): Promise<boolean> {
  // TODO: Check org_settings for enabled integrations
  // For now, always return false (integrations not active)
  return false
}

/**
 * Get pending outbox events for processing.
 * Used by integration worker/cron job.
 */
export async function getPendingOutboxEvents(
  supabase: SupabaseClient,
  provider: IntegrationProvider,
  limit: number = 100
): Promise<any[]> {
  const { data, error } = await supabase
    .from('integration_outbox')
    .select('*')
    .eq('provider', provider)
    .in('status', ['pending', 'failed'])
    .lt('attempt_count', 5) // Max 5 retries
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Failed to fetch pending outbox events:', error)
    return []
  }

  return data || []
}

/**
 * Mark an outbox event as completed.
 */
export async function markEventCompleted(
  supabase: SupabaseClient,
  eventId: string,
  externalId?: string
): Promise<void> {
  await supabase
    .from('integration_outbox')
    .update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)

  // If external ID provided, update the source entity
  // This would be done by the integration processor
}

/**
 * Mark an outbox event as failed.
 */
export async function markEventFailed(
  supabase: SupabaseClient,
  eventId: string,
  error: string
): Promise<void> {
  await supabase
    .from('integration_outbox')
    .update({
      status: 'failed',
      last_error: error,
      attempt_count: supabase.rpc('increment_attempt_count', { event_id: eventId }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
}
