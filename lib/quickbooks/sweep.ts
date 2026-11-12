/**
 * The safety net: finds CRM records dated on/after the start date that QuickBooks never heard about and queues them. It exists
 * because enqueueing happens in many CRM code paths (signing, invoicing, payments, bills); one forgotten or failed enqueue must
 * never mean a missing invoice in the books. A record is "unheard" when it has NO qb_link and NO outbox row of any kind
 * (a skipped / failed / waiting row means someone already decided something about it — the sweep never re-queues those).
 * Company-scoped (orgDb) and bounded per run; a huge backlog drains over a few runs. `dryRun` only counts (the mapping screen's
 * "these would be sent" preview).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { enqueueIntegrationEvent } from '@/lib/integrations'
import { orgDb } from '@/lib/supabase/org-db'

import { centsOf } from './builders'
import type { QbSettings } from './mapping'

const LIMIT = 100
const PAGE = 300
const MAX_PAGES = 20

/** Walk a table in id order (keyset, never "the oldest 300") until `LIMIT` unheard records are found or the table runs out. */
async function unheardRows<T extends { id: string }>(
  admin: SupabaseClient,
  orgId: string,
  table: string,
  qbType: string[],
  read: (after: string | null) => PromiseLike<{ data: unknown }>
): Promise<T[]> {
  const found: T[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES && found.length < LIMIT; page++) {
    const { data } = await read(after)
    const rows = (data ?? []) as T[]
    if (rows.length === 0) break
    const missing = await unheard(admin, orgId, table, rows.map((r) => r.id), qbType)
    found.push(...rows.filter((r) => missing.has(r.id)))
    after = rows[rows.length - 1].id
    if (rows.length < PAGE) break
  }
  return found.slice(0, LIMIT)
}

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

export async function sweepUnheard(admin: SupabaseClient, orgId: string, settings: QbSettings, opts: { dryRun?: boolean } = {}): Promise<SweepResult> {
  const out: SweepResult = { invoices: 0, payments: 0, bills: 0 }
  const start = settings.startDate
  if (!start) return out
  const db = orgDb(admin, orgId)

  const gt = <Q extends { gt: (c: string, v: string) => Q }>(q: Q, after: string | null): Q => (after ? q.gt('id', after) : q)

  // Job sale invoices (one per job)
  if (settings.invoiceMode === 'per_job') {
    const jobs = await unheardRows<{ id: string; sale_amount: number }>(admin, orgId, 'production_jobs', ['Invoice'], (after) =>
      gt(db.from('production_jobs').select('id, sale_amount').gt('sale_amount', 0).gte('sale_date', start).neq('status', 'cancelled'), after).order('id', { ascending: true }).limit(PAGE)
    )
    for (const j of jobs) {
      if (!opts.dryRun) await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: 'invoice.upserted', entityTable: 'production_jobs', entityId: j.id, payload: {}, version: centsOf(j.sale_amount) })
      out.invoices++
    }
  }
  // CRM invoices (every-invoice mode, time & materials jobs, no-job service invoices): issued, not draft, not void.
  {
    const rows = await unheardRows<{ id: string }>(admin, orgId, 'job_invoices', ['Invoice'], (after) =>
      gt(db.from('job_invoices').select('id').in('status', ['sent', 'partially_paid', 'paid']).gte('issued_at', start), after).order('id', { ascending: true }).limit(PAGE)
    )
    for (const r of rows) {
      if (!opts.dryRun) await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: 'invoice.upserted', entityTable: 'job_invoices', entityId: r.id, payload: {}, version: 1 })
      out.invoices++
    }
  }
  // Payments with no job (customer invoices). Job payments queue themselves in the same SQL transaction as the payment.
  {
    const rows = await unheardRows<{ id: string; amount_cents: number }>(admin, orgId, 'job_payments', ['Payment', 'RefundReceipt'], (after) =>
      gt(db.from('job_payments').select('id, amount_cents').is('job_id', null).gte('paid_at', start), after).order('id', { ascending: true }).limit(PAGE)
    )
    for (const r of rows) {
      if (!opts.dryRun) await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: Number(r.amount_cents) < 0 ? 'payment.refunded' : 'payment.recorded', entityTable: 'job_payments', entityId: r.id, payload: {}, version: 1 })
      out.payments++
    }
  }
  // Approved vendor bills
  if (settings.bills.enabled) {
    const rows = await unheardRows<{ id: string }>(admin, orgId, 'purchase_order_bills', ['Bill', 'VendorCredit'], (after) =>
      gt(db.from('purchase_order_bills').select('id').eq('status', 'active').gte('bill_date', start), after).order('id', { ascending: true }).limit(PAGE)
    )
    for (const r of rows) {
      if (!opts.dryRun) await enqueueIntegrationEvent(admin, { orgId, provider: 'quickbooks', eventType: 'bill.recorded', entityTable: 'purchase_order_bills', entityId: r.id, payload: {}, version: 1 })
      out.bills++
    }
  }
  return out
}
