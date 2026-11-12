/**
 * What the office sees about online payments on an invoice (invoice modal): can a pay link be made, and every online
 * attempt — "Paid by card Visa •••• 4242", "Bank payment processing", "Automatic payment failed: card declined", "Needs a
 * look". The money itself shows in the invoice's payments as usual.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { cardLabel } from '@/lib/online-payments/cards'
import { commissionInApprovedWeek } from '@/lib/online-payments/record'
import type { Queue } from '@/lib/today'

export type InvoiceOnlineSummary = {
  featureOn: boolean
  ready: boolean
  attempts: Array<{ id: string; kind: string; status: string; label: string; amountCents: number; refundedCents: number; at: string; note: string | null }>
}

/** Pure: one line for the office. */
export function attemptLabel(r: { kind: string; status: string; method: string | null; card_brand: string | null; card_last4: string | null }): string {
  const how = r.method === 'ach' ? `bank${r.card_last4 ? ` •••• ${r.card_last4}` : ''}` : r.card_last4 ? cardLabel({ brand: r.card_brand, last4: r.card_last4 }) : 'card'
  const auto = r.kind === 'autopay' ? ' (automatic)' : ''
  if (r.status === 'succeeded') return `Paid by ${how}${auto}`
  if (r.status === 'processing') return `Bank payment processing (${how})`
  if (r.status === 'needs_review') return `Paid by ${how}${auto} — needs a look`
  return `${r.kind === 'autopay' ? 'Automatic payment' : 'Payment'} didn’t go through (${how})`
}

export async function loadInvoiceOnlineSummary(admin: SupabaseClient, orgId: string, invoiceId: string): Promise<InvoiceOnlineSummary | null> {
  const op = await loadOnlinePayments(admin, orgId)
  if (!op.featureOn) return null
  const { data } = await orgDb(admin, orgId)
    .from('online_payments')
    .select('id, kind, status, method, card_brand, card_last4, amount_cents, refunded_cents, failure_message, review_reason, created_at, succeeded_at')
    .eq('invoice_id', invoiceId)
    .in('status', ['succeeded', 'processing', 'failed', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(20)
  const rows = (data ?? []) as Array<{
    id: string; kind: string; status: string; method: string | null; card_brand: string | null; card_last4: string | null
    amount_cents: number; refunded_cents: number; failure_message: string | null; review_reason: string | null; created_at: string; succeeded_at: string | null
  }>
  return {
    featureOn: true,
    ready: op.ready,
    attempts: rows.map((r) => {
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        label: attemptLabel(r),
        amountCents: r.amount_cents,
        refundedCents: r.refunded_cents,
        at: r.succeeded_at ?? r.created_at,
        note: r.status === 'failed' ? r.failure_message : r.status === 'needs_review' ? r.review_reason : null,
      }
    }),
  }
}

/**
 * Today + morning email (owners / payroll office): lost disputes in the last 14 days on jobs whose money was already
 * counted for pay (collected, or in an approved payroll week) — commission was paid on money that is gone. Email-safe:
 * job number + facts, no customer. Clears itself after 14 days; the fix itself is a payroll "Fix a mistake" line.
 * Follow-up (not built): turn this into automatic negative commission lines once the pay-plan rule for a reversal is decided.
 */
export async function loadPaymentReversalsQueue(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<Queue> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const { data, error } = await orgDb(admin, orgId)
    .from('online_payments')
    .select('id, invoice_id, reversal_flag, reversed_at')
    .not('reversal_flag', 'is', null)
    .gte('reversed_at', since)
    .order('reversed_at', { ascending: false })
    .limit(20)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; invoice_id: string; reversal_flag: string; reversed_at: string }>
  const invoiceIds = Array.from(new Set(rows.map((r) => r.invoice_id)))
  const { data: invs } = invoiceIds.length
    ? await orgDb(admin, orgId).from('job_invoices').select('id, job_id, invoice_number').in('id', invoiceIds)
    : { data: [] }
  const byId = new Map(((invs ?? []) as Array<{ id: string; job_id: string | null; invoice_number: string }>).map((i) => [i.id, i]))
  const jobIds = Array.from(new Set(Array.from(byId.values()).map((i) => i.job_id).filter((x): x is string => !!x)))
  const { data: jobs } = jobIds.length ? await orgDb(admin, orgId).from('production_jobs').select('id, job_number').in('id', jobIds) : { data: [] }
  const jobNo = new Map(((jobs ?? []) as Array<{ id: string; job_number: string | null }>).map((j) => [j.id, j.job_number]))
  const undone = await undoneAfterPayoutItems(admin, orgId, since)
  return {
    id: 'payment-reversals',
    title: 'Payment reversed — review',
    count: rows.length + undone.length,
    empty: 'No reversed payments.',
    items: [...undone, ...rows.map((r) => {
      const inv = byId.get(r.invoice_id)
      const num = inv?.job_id ? jobNo.get(inv.job_id) : null
      return {
        id: r.id,
        title: num ? `Job ${num}` : `Invoice ${inv?.invoice_number ?? ''}`.trim(),
        detail: r.reversal_flag,
        href: inv?.job_id ? `/ops/jobs/${inv.job_id}` : '/today',
        ref: num ? `Job ${num}` : `Invoice ${inv?.invoice_number ?? ''}`.trim(),
        note: r.reversal_flag,
      }
    })],
  }
}

/**
 * "Undo payment" on a job whose commission was already paid (an approved pay week): the same review line a lost dispute raises.
 * Fixed-price jobs only — a job billed by the hour takes the commission back automatically (payroll commission changes).
 * Read from the reversal rows (key `undo:<id>`) so nothing extra is stored.
 */
async function undoneAfterPayoutItems(admin: SupabaseClient, orgId: string, since: string): Promise<Queue['items']> {
  // org-scope-ok: the company filter is .eq('production_jobs.org_id', orgId) on the !inner parent-job join
  const { data } = await admin
    .from('job_payments')
    .select('id, job_id, amount_cents, created_at, idempotency_key, production_jobs!inner(org_id, job_number, billing_mode)')
    .like('idempotency_key', 'undo:%')
    .eq('production_jobs.org_id', orgId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)
  const out: Queue['items'] = []
  for (const r of (data ?? []) as unknown as Array<{ id: string; job_id: string; amount_cents: number; production_jobs: { org_id: string; job_number: string | null; billing_mode: string | null } | Array<{ org_id: string; job_number: string | null; billing_mode: string | null }> }>) {
    const job = Array.isArray(r.production_jobs) ? r.production_jobs[0] : r.production_jobs
    if (!job || job.org_id !== orgId || job.billing_mode === 'time_materials') continue
    if (!(await commissionInApprovedWeek(admin, orgId, r.job_id))) continue
    const note = `Payment undone ${(Math.abs(r.amount_cents) / 100).toFixed(2)} — already in an approved payroll week: check commission (Payroll → Fix a mistake)`
    const num = job.job_number ? `Job ${job.job_number}` : 'Job'
    out.push({ id: r.id, title: num, detail: note, href: `/ops/jobs/${r.job_id}`, ref: num, note })
  }
  return out
}
