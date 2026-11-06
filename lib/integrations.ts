import { SupabaseClient } from '@supabase/supabase-js'
import { EnqueueEventParams } from './types/integrations'

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
        last_error: null, // a re-enqueued row (e.g. one skipped by a data fix) must not keep its old reason
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
 * Enqueue customer upsert event. Called ONLY from contract signing (`enrichCustomerFromContract`).
 * Nothing drains the outbox yet — see docs/quickbooks-sync.md.
 */
export async function enqueueCustomerUpserted(
  supabase: SupabaseClient,
  orgId: string,
  customerId: string,
  customerData: Record<string, any>
): Promise<void> {
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
