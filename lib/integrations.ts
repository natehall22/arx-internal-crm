import { loadOrgFeatures } from './org-features'
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

  if (provider === 'quickbooks') {
    // A company that has not switched QuickBooks on gets no rows at all (nothing will drain them, and a later switch-on must not
    // wake up a backlog of old events; the sweep finds what matters from the start date).
    if (!(await loadOrgFeatures(supabase, orgId)).quickbooks) return null
    // A line an owner closed with Skip stays closed when the same event is raised again (new facts use a new version, hence a new key).
    const { data: prior } = await supabase.from('integration_outbox').select('id, status, skipped_by').eq('idempotency_key', idempotencyKey).maybeSingle()
    const p = prior as { id: string; status: string; skipped_by: string | null } | null
    if (p && p.status === 'skipped' && p.skipped_by) return p.id
  }

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
        // A re-enqueued row (new facts, a data fix, an owner's re-send) starts clean. Clearing the lease is what makes a worker that
        // is mid-send on the OLD facts drop its result (its finish is a compare-and-swap on the lease) so the new facts go out next.
        last_error: null,
        error_code: null,
        error_kind: null,
        attempt_count: 0,
        next_attempt_at: null,
        locked_until: null,
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
 * Enqueue a payment event (money in by default; pass the refund / dispute type for money back out).
 * The job payment writer's SQL (record_job_payment) queues its own row in the same transaction; this is the TypeScript twin for
 * the paths without that transaction (the pre-migration fallback, payments on invoices without a job). The worker's sweep
 * (lib/quickbooks/sweep.ts) catches any that still slip through.
 */
export async function enqueuePaymentRecorded(
  supabase: SupabaseClient,
  orgId: string,
  paymentId: string,
  paymentData: {
    job_id?: string | null
    customer_id?: string
    amount_cents: number
    paid_at: string
    payment_type: string
    method: string
    payer: string
  },
  eventType: 'payment.recorded' | 'payment.refunded' | 'payment.disputed' = 'payment.recorded'
): Promise<void> {
  await enqueueIntegrationEvent(supabase, {
    orgId,
    provider: 'quickbooks',
    eventType,
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
 * Enqueue "this CRM record changed" for the worker: an invoice (the job's sale invoice, entity `production_jobs`, or a CRM invoice,
 * entity `job_invoices`) or a vendor bill (entity `purchase_order_bills`). The worker reads the record when it sends, so
 * `version` only decides when a NEW row is made: the same version twice is one row (re-queued), a new version is a new row.
 * Use the record's money in cents as the version so a changed total is always a fresh event. Never throws (the caller's own
 * work — signing, issuing, recording a bill — must not fail because of the accounting queue; the sweep catches a miss).
 */
export async function enqueueRecordEvent(
  supabase: SupabaseClient,
  orgId: string,
  e: { eventType: 'invoice.upserted' | 'invoice.voided' | 'bill.recorded' | 'bill.voided'; table: 'production_jobs' | 'job_invoices' | 'purchase_order_bills'; id: string; version?: number }
): Promise<void> {
  try {
    await enqueueIntegrationEvent(supabase, { orgId, provider: 'quickbooks', eventType: e.eventType, entityTable: e.table, entityId: e.id, payload: {}, version: e.version ?? 1 })
  } catch (err) {
    console.error('Failed to enqueue QuickBooks event:', e.eventType, err instanceof Error ? err.message : err)
  }
}
