/**
 * The safety net: finds CRM records dated on/after the start date that QuickBooks never heard about and queues them. It exists
 * because enqueueing happens in many CRM code paths (signing, invoicing, payments, bills); one forgotten or failed enqueue must
 * never mean a missing invoice in the books. A record is "unheard" when it has NO qb_link and NO outbox row of any kind
 * (a skipped / failed / waiting row means someone already decided something about it — the sweep never re-queues those).
 * Company-scoped (orgDb) and bounded per run; a huge backlog drains over a few runs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { enqueueIntegrationEvent } from '@/lib/integrations'
import { orgDb } from '@/lib/supabase/org-db'

import { centsOf } from './builders'
import type { QbSettings } from './mapping'

const LIMIT = 100

async function unheard(admin: SupabaseClient, orgId: string, table: string, ids: string[], qbType: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const db = orgDb(admin, orgId)
  const [{ data: links }, { data: rows }] = await Promise.all([
    db.from('qb_links').select('crm_id').eq('crm_table', table).in('qb_type', qbType).in('crm_id', ids),
    db.from('integration_outbox').select('entity_id').eq('provider', 'quickbooks').eq('entity_table', table).in('entity_id', ids),
  ])
  const heard = new Set<string>([...((links ?? []) as Array<{ crm_id: string }>).map((l) => l.crm_id), ...((rows ?? []) as Array<{ entity_id: string }>).map((r) => r.entity_id)])
  return new Set(ids.filter((i) => !heard.has(i)))
}

export type SweepResult = { invoices: number; payments: number; bills: number }

export async function sweepUnheard(admin: SupabaseClient, orgId: string, settings: QbSettings): Promise<SweepResult> {
  const out: SweepResult = { invoices: 0, payments: 0, bills: 0 }
  const start = settings.startDate
  if (!start) return out
  const db = orgDb(admin, orgId)

  // Job sale invoices (one per job)
  if (settings.invoiceMode === 'per_job') {
    const { data } = await db.from('production_jobs').select('id, sale_amount').gt('sale_amount', 0).gte('sale_date', start).neq('status', 'cancelled').order('sale_date', { ascending: true }).limit(LIMIT * 3)
    const jobs = (data ?? []) as Array<{ id: string; sale_amount: number }>
    const missing = await unheard(admin, orgId, 'production_jobs', jobs.map((j) => j.id), ['Invoice'])
    for (const j of jobs.filter((x) => missing.has(x.id)).slice(0, LIMIT)) {
      await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: 'invoice.upserted', entityTable: 'production_jobs', entityId: j.id, payload: {}, version: centsOf(j.sale_amount) })
      out.invoices++
    }
  }
  // CRM invoices (every-invoice mode, time & materials jobs, no-job service invoices): issued, not draft, not void.
  {
    const { data } = await db.from('job_invoices').select('id, status, issued_at').in('status', ['sent', 'partially_paid', 'paid']).gte('issued_at', start).order('issued_at', { ascending: true }).limit(LIMIT * 3)
    const rows = (data ?? []) as Array<{ id: string }>
    const missing = await unheard(admin, orgId, 'job_invoices', rows.map((r) => r.id), ['Invoice'])
    for (const r of rows.filter((x) => missing.has(x.id)).slice(0, LIMIT)) {
      await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: 'invoice.upserted', entityTable: 'job_invoices', entityId: r.id, payload: {}, version: 1 })
      out.invoices++
    }
  }
  // Payments with no job (customer invoices). Job payments queue themselves in the same SQL transaction as the payment.
  {
    const { data } = await db.from('job_payments').select('id, amount_cents').is('job_id', null).gte('paid_at', start).order('paid_at', { ascending: true }).limit(LIMIT * 3)
    const rows = (data ?? []) as Array<{ id: string; amount_cents: number }>
    const missing = await unheard(admin, orgId, 'job_payments', rows.map((r) => r.id), ['Payment', 'RefundReceipt'])
    for (const r of rows.filter((x) => missing.has(x.id)).slice(0, LIMIT)) {
      await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: Number(r.amount_cents) < 0 ? 'payment.refunded' : 'payment.recorded', entityTable: 'job_payments', entityId: r.id, payload: {}, version: 1 })
      out.payments++
    }
  }
  // Approved vendor bills
  if (settings.bills.enabled) {
    const { data } = await db.from('purchase_order_bills').select('id').eq('status', 'active').gte('bill_date', start).order('bill_date', { ascending: true }).limit(LIMIT * 3)
    const rows = (data ?? []) as Array<{ id: string }>
    const missing = await unheard(admin, orgId, 'purchase_order_bills', rows.map((r) => r.id), ['Bill', 'VendorCredit'])
    for (const r of rows.filter((x) => missing.has(x.id)).slice(0, LIMIT)) {
      await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: 'bill.recorded', entityTable: 'purchase_order_bills', entityId: r.id, payload: {}, version: 1 })
      out.bills++
    }
  }
  return out
}
