/**
 * JS mirrors of the payment SQL in migration 202611120020 for jest's in-memory database (lib/test-helpers/fake-db.ts):
 * `record_job_payment` (payment + outbox in one transaction, idempotent by key) and `apply_job_invoice_payment` (locked
 * apply / take back). Same rules, same error codes. The real SQL runs in supabase/tests/online_payments.test.sql — a
 * rule changed there must change here too (Known Redundancy, like the payroll and service-plan mirrors).
 */
type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

const fail = (message: string, code: string) => Object.assign(new Error(message), { code })
let n = 0

export const FAKE_PAYMENT_RPC = {
  record_job_payment: (a: Row, t: Tables) => {
    const job = (t.production_jobs ?? []).find((j) => j.id === a.p_job && j.org_id === a.p_org)
    if (!job) throw fail('record_job_payment: job not found', 'P0002')
    if (!['payment.recorded', 'payment.refunded', 'payment.disputed'].includes(String(a.p_event_type ?? 'payment.recorded'))) throw fail('unknown event', '22023')
    if (!a.p_amount_cents) throw fail('Enter an amount', '22023')
    const pays = (t.job_payments ??= [])
    let pay = a.p_idempotency_key ? pays.find((p) => p.job_id === a.p_job && p.idempotency_key === a.p_idempotency_key) : undefined
    const duplicate = !!pay
    if (!pay) {
      pay = { id: `jp-${++n}`, job_id: a.p_job, paid_at: a.p_paid_at, amount_cents: a.p_amount_cents, payment_type: a.p_payment_type, method: a.p_method, payer: a.p_payer, note: a.p_note ?? null, created_by: a.p_created_by ?? null, idempotency_key: a.p_idempotency_key ?? null }
      pays.push(pay)
    }
    const event = String(a.p_event_type ?? 'payment.recorded')
    const key = `${a.p_org}:job_payments:${pay.id}:${event}:v1`
    const outbox = (t.integration_outbox ??= [])
    if (!outbox.some((o) => o.idempotency_key === key)) outbox.push({ id: `ob-${++n}`, org_id: a.p_org, provider: 'quickbooks', event_type: event, entity_table: 'job_payments', entity_id: pay.id, idempotency_key: key, status: 'pending' })
    return { payment: { ...pay }, duplicate }
  },
  apply_job_invoice_payment: (a: Row, t: Tables) => {
    const inv = (t.job_invoices ?? []).find((i) => i.id === a.p_invoice && (t.production_jobs ?? []).some((j) => j.id === i.job_id && j.org_id === a.p_org))
    if (!inv) throw fail('Invoice not found', 'P0002')
    const pay = (t.job_payments ?? []).find((p) => p.id === a.p_payment && p.job_id === inv.job_id)
    if (!pay) throw fail('Payment not found', 'P0002')
    const apps = (t.invoice_payments ??= [])
    if (apps.some((x) => x.invoice_id === inv.id && x.job_payment_id === pay.id)) return { applied_cents: 0, status: inv.status, duplicate: true }
    const cents = Number(a.p_applied_cents)
    if (!cents) throw fail('Applied amount must not be zero', '22023')
    const net = apps.filter((x) => x.invoice_id === inv.id).reduce((s, x) => s + Number(x.applied_cents), 0)
    if (cents > 0) {
      if (inv.status === 'void') throw fail('Cannot apply payment to voided invoice', '22023')
      if (inv.status === 'draft') throw fail('Cannot apply payment to draft invoice. Send it first.', '22023')
      const used = apps.filter((x) => x.job_payment_id === pay.id).reduce((s, x) => s + Number(x.applied_cents), 0)
      if (Number(pay.amount_cents) <= 0 || cents > Number(pay.amount_cents) - used) throw fail(`Cannot apply ${cents} cents. Only ${Math.max(Number(pay.amount_cents) - used, 0)} cents remaining from this payment.`, '22023')
      if (cents > Number(inv.total_cents) - net) throw fail('That is more than the invoice balance', '22023')
    } else {
      if (Number(pay.amount_cents) >= 0 || -cents > -Number(pay.amount_cents)) throw fail('Only a refund can be taken back off an invoice, and only up to its amount', '22023')
      if (-cents > net) throw fail('That is more than was paid on this invoice', '22023')
    }
    apps.push({ id: `ip-${++n}`, invoice_id: inv.id, job_payment_id: pay.id, applied_cents: cents, created_by: a.p_created_by ?? null })
    const after = net + cents
    if (inv.status !== 'void') inv.status = after >= Number(inv.total_cents) ? 'paid' : after > 0 ? 'partially_paid' : 'sent'
    return { applied_cents: cents, status: inv.status, duplicate: false }
  },
}
