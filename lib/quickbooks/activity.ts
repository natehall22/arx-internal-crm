/**
 * What owners see: every event the worker handled or is holding — what was sent, when, a link to the QuickBooks record, and
 * (when something needs a person) the reason in plain words. Read-only except Retry / Skip, which only reset or close a row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'
import type { Queue as TodayQueue } from '@/lib/today'

import { OUTBOX_COLS, type OutboxRow } from './outbox'
import type { QbEnvironment } from './config'

export type ActivityState = 'sent' | 'waiting' | 'needs_you' | 'skipped' | 'working'
export type ActivityItem = {
  id: string
  state: ActivityState
  title: string
  when: string
  message: string | null
  code: string | null
  attempts: number
  nextAttemptAt: string | null
  qbType: string | null
  qbId: string | null
  qbUrl: string | null
  /** Who closed it with Skip, when, and why (kept visible in the log). */
  skippedBy: string | null
  skippedAt: string | null
  skipReason: string | null
  /** Retry / Skip are offered only here. */
  canAct: boolean
}

/** Where to open a record in QuickBooks Online. (Intuit's app URLs; not an API contract — a wrong link only opens the QuickBooks home page.) */
export function qbRecordUrl(environment: QbEnvironment | null, qbType: string | null, qbId: string | null): string | null {
  if (!qbType || !qbId) return null
  const host = environment === 'sandbox' ? 'https://app.sandbox.qbo.intuit.com/app' : 'https://app.qbo.intuit.com/app'
  const path: Record<string, string> = { Invoice: 'invoice?txnId=', Payment: 'recvpayment?txnId=', RefundReceipt: 'refundreceipt?txnId=', Bill: 'bill?txnId=', VendorCredit: 'vendorcredit?txnId=', Customer: 'customerdetail?nameId=', Vendor: 'vendordetail?nameId=' }
  return path[qbType] ? `${host}/${path[qbType]}${encodeURIComponent(qbId)}` : null
}

export function stateOf(r: Pick<OutboxRow, 'status' | 'error_kind'>): ActivityState {
  if (r.error_kind === 'needs_you') return 'needs_you'
  if (r.status === 'completed') return 'sent'
  if (r.status === 'skipped') return 'skipped'
  if (r.status === 'processing') return 'working'
  return 'waiting'
}

const money = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function labels(admin: SupabaseClient, orgId: string, rows: OutboxRow[]): Promise<Map<string, string>> {
  const db = orgDb(admin, orgId)
  const ids = (table: string) => Array.from(new Set(rows.filter((r) => r.entity_table === table).map((r) => r.entity_id)))
  const out = new Map<string, string>()
  const [customers, jobs, invoices, bills, payments] = await Promise.all([
    ids('customers').length ? db.from('customers').select('id, name').in('id', ids('customers')) : { data: [] },
    ids('production_jobs').length ? db.from('production_jobs').select('id, job_number').in('id', ids('production_jobs')) : { data: [] },
    ids('job_invoices').length ? db.from('job_invoices').select('id, invoice_number').in('id', ids('job_invoices')) : { data: [] },
    ids('purchase_order_bills').length ? db.from('purchase_order_bills').select('id, bill_number, amount').in('id', ids('purchase_order_bills')) : { data: [] },
    // job_payments has no org_id for job payments; only ids that came from THIS company's outbox rows are asked for.
    // org-scope-ok: ids come from this company's own outbox rows; read-only labels
    ids('job_payments').length ? admin.from('job_payments').select('id, amount_cents').in('id', ids('job_payments')) : { data: [] },
  ])
  for (const c of (customers.data ?? []) as Array<{ id: string; name: string | null }>) out.set(`customers:${c.id}`, c.name || 'Customer')
  for (const j of (jobs.data ?? []) as Array<{ id: string; job_number: string }>) out.set(`production_jobs:${j.id}`, `Job ${j.job_number}`)
  for (const i of (invoices.data ?? []) as Array<{ id: string; invoice_number: string }>) out.set(`job_invoices:${i.id}`, `Invoice ${i.invoice_number}`)
  for (const b of (bills.data ?? []) as Array<{ id: string; bill_number: string | null; amount: number }>) out.set(`purchase_order_bills:${b.id}`, `Bill ${b.bill_number ?? ''} ${money(Math.round(Number(b.amount) * 100))}`.replace('  ', ' ').trim())
  for (const p of (payments.data ?? []) as Array<{ id: string; amount_cents: number }>) out.set(`job_payments:${p.id}`, money(p.amount_cents))
  return out
}

const VERB: Record<string, string> = {
  'customer.upserted': 'Customer',
  'invoice.upserted': 'Invoice for',
  'invoice.voided': 'Void invoice for',
  'payment.recorded': 'Payment',
  'payment.refunded': 'Refund',
  'payment.disputed': 'Lost dispute',
  'bill.recorded': 'Vendor bill',
  'bill.voided': 'Vendor bill voided',
}

export async function loadActivity(
  admin: SupabaseClient,
  orgId: string,
  opts: { environment: QbEnvironment | null; filter?: ActivityState | 'all'; limit?: number }
): Promise<{ items: ActivityItem[]; counts: Record<ActivityState, number> }> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db.from('integration_outbox').select(OUTBOX_COLS).eq('provider', 'quickbooks').order('updated_at', { ascending: false }).limit(500)
  if (error) throw new Error(`activity read failed: ${error.message}`)
  const rows = (data ?? []) as OutboxRow[]
  const counts: Record<ActivityState, number> = { sent: 0, waiting: 0, needs_you: 0, skipped: 0, working: 0 }
  for (const r of rows) counts[stateOf(r)]++
  const shown = rows.filter((r) => !opts.filter || opts.filter === 'all' || stateOf(r) === opts.filter).slice(0, opts.limit ?? 100)
  const names = await labels(admin, orgId, shown)
  const whoIds = Array.from(new Set(shown.map((r) => r.skipped_by).filter((x): x is string => !!x)))
  const who = new Map<string, string>()
  if (whoIds.length) {
    const { data: us } = await orgDb(admin, orgId).from('users').select('id, full_name').in('id', whoIds)
    for (const u of (us ?? []) as Array<{ id: string; full_name: string | null }>) who.set(u.id, u.full_name || 'An owner')
  }
  const items = shown.map<ActivityItem>((r) => {
    const state = stateOf(r)
    return {
      id: r.id,
      state,
      title: `${VERB[r.event_type] ?? r.event_type} ${names.get(`${r.entity_table}:${r.entity_id}`) ?? ''}`.trim(),
      when: r.sent_at ?? r.processed_at ?? r.updated_at,
      message: state === 'needs_you' || state === 'waiting' || (state === 'skipped' && !r.skipped_by) ? r.last_error : null,
      code: r.error_code,
      attempts: r.attempt_count,
      nextAttemptAt: r.next_attempt_at,
      qbType: r.qb_type,
      qbId: r.qb_id,
      qbUrl: qbRecordUrl(opts.environment, r.qb_type, r.qb_id),
      skippedBy: r.skipped_by ? who.get(r.skipped_by) ?? 'An owner' : null,
      skippedAt: r.skipped_at ?? null,
      skipReason: r.skip_reason ?? null,
      canAct: state === 'needs_you',
    }
  })
  return { items, counts }
}

/** Owners' Today card: lines stuck on a person. Null when there are none. (Reconnect has its own card.) */
export async function loadQuickBooksStuckQueue(admin: SupabaseClient, orgId: string): Promise<TodayQueue | null> {
  const { data, error } = await orgDb(admin, orgId)
    .from('integration_outbox')
    .select('id, event_type, entity_table, entity_id, last_error, error_code')
    .eq('provider', 'quickbooks')
    .eq('error_kind', 'needs_you')
    .order('created_at', { ascending: true })
    .limit(25)
  if (error) throw new Error(`quickbooks needs-you read failed: ${error.message}`)
  const rows = (data ?? []) as OutboxRow[]
  if (rows.length === 0) return null
  return {
    id: 'quickbooks-stuck',
    title: 'Not in QuickBooks yet',
    count: rows.length,
    empty: 'Everything has reached QuickBooks.',
    items: rows.slice(0, 5).map((r) => ({ id: r.id, title: VERB[r.event_type] ?? 'QuickBooks', detail: r.last_error ?? 'Needs a look', href: '/admin#quickbooks', ref: 'QuickBooks', note: 'Open QuickBooks activity' })),
  }
}
