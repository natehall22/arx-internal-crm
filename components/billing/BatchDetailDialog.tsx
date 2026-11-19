'use client'

import * as React from 'react'

import { Badge, Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, toast } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { batchLineWhere, type BatchDocument } from '@/lib/invoice-batch'
import { CUSTOMER_PAYMENT_METHOD_LABELS, CUSTOMER_PAYMENT_METHODS, type CustomerPaymentMethod } from '@/lib/invoice-lines'
import { formatCurrency } from '@/lib/job-payments'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One master invoice: every house with its job number, lot / address, PO and amount, one total. Send emails ONE document and issues
 * each house's invoice; Record payment takes ONE payment and splits it over the houses (oldest first). Each house keeps its own
 * invoice and payments underneath (see lib/invoice-batch-db.ts).
 */
export default function BatchDetailDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [doc, setDoc] = React.useState<BatchDocument | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pay, setPay] = React.useState<{ amount: string; paidAt: string; method: CustomerPaymentMethod; note: string; key: string } | null>(null)

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/invoice-batches/${batchId}`, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return toast.error('Could not load the master invoice')
    setDoc(((await res.json()) as { batch: BatchDocument }).batch)
  }, [batchId])
  React.useEffect(() => {
    void load()
  }, [load])

  async function patch(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(`/api/invoice-batches/${batchId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'That did not work')
        return false
      }
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (!doc) return
    if (!(await confirmDialog({ title: `${doc.batch.sentAt ? 'Email again:' : 'Email'} ${doc.batch.number} to ${doc.billTo.email ?? 'the customer'}?` }))) return
    if (await patch({ action: 'send', resend: !!doc.batch.sentAt })) toast.success(`Emailed ${doc.batch.number}`)
  }

  async function savePayment() {
    if (!pay) return
    const cents = Math.round(parseFloat(pay.amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) return toast.error('Enter the amount paid')
    if (await patch({ action: 'record_payment', amount_cents: cents, paid_at: pay.paidAt, method: pay.method, note: pay.note, client_key: pay.key })) {
      toast.success('Payment saved and split over the houses')
      setPay(null)
    }
  }

  const showCommunity = !doc?.development
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={doc ? `Master invoice ${doc.batch.number}` : 'Master invoice'} description={doc ? `${doc.billTo.name}${doc.development ? ` · ${doc.development}` : ''}` : undefined}>
        {!doc ? (
          <p className="text-ui-base text-ink">Loading…</p>
        ) : pay ? (
          <div className="flex flex-col gap-3">
            <p className="text-ui-base text-ink">Balance {formatCurrency(doc.balanceCents)}. The payment is split over the houses, oldest first.</p>
            <Field label="Amount paid">{(p) => <Input {...p} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />}</Field>
            <Field label="How">
              {(p) => (
                <Select {...p} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as CustomerPaymentMethod })}>
                  {CUSTOMER_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{CUSTOMER_PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Day paid">{(p) => <Input {...p} type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} />}</Field>
            <Field label="Note (check number…)">{(p) => <Input {...p} value={pay.note} maxLength={400} onChange={(e) => setPay({ ...pay, note: e.target.value })} />}</Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPay(null)}>Back</Button>
              <Button loading={busy} onClick={() => void savePayment()}>Save payment</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex max-h-[65dvh] flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={doc.balanceCents <= 0 ? 'success' : doc.issued ? 'info' : 'neutral'}>{doc.balanceCents <= 0 ? 'Paid' : doc.issued ? 'Sent' : 'Draft'}</Badge>
              {doc.batch.sentToEmail ? <span className="text-ui-sm text-ink">Sent to {doc.batch.sentToEmail}</span> : null}
            </div>
            <ul className="divide-y divide-surface-line rounded-ui border border-surface-line">
              {doc.lines.map((l) => (
                <li key={l.invoiceId} className="flex items-start justify-between gap-3 px-3 py-2 text-ui-base text-ink">
                  <span className="min-w-0">
                    <span className="block break-words font-semibold">{batchLineWhere(l, showCommunity) || `Job ${l.jobNumber}`}</span>
                    <span className="block text-ui-sm">Job {l.jobNumber}{l.customerPo ? ` · PO ${l.customerPo}` : ''} · {l.invoiceNumber}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatCurrency(l.amountCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 text-ui-base text-ink">
              <div className="flex justify-between font-bold"><dt>Total</dt><dd className="tabular-nums">{formatCurrency(doc.totalCents)}</dd></div>
              {doc.paidCents > 0 ? <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">{formatCurrency(doc.paidCents)}</dd></div> : null}
              <div className="flex justify-between font-bold"><dt>Balance due</dt><dd className="tabular-nums">{formatCurrency(Math.max(0, doc.balanceCents))}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy} onClick={() => void send()}>{doc.batch.sentAt ? 'Email again' : 'Email invoice'}</Button>
              {doc.issued && doc.balanceCents > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setPay({ amount: (doc.balanceCents / 100).toFixed(2), paidAt: localToday(), method: 'check', note: '', key: crypto.randomUUID() })}>Record payment</Button>
              ) : null}
              <Button size="sm" variant="secondary" asChild>
                <a href={`/invoice-batches/${batchId}/print`} target="_blank" rel="noreferrer">Print</a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
