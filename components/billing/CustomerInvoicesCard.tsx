'use client'

import * as React from 'react'

import InvoiceDetailModal from '@/components/ops/InvoiceDetailModal'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogFooter, Field, Input, Select, toast } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { CUSTOMER_PAYMENT_METHOD_LABELS, CUSTOMER_PAYMENT_METHODS, type CustomerPaymentMethod } from '@/lib/invoice-lines'
import { formatCurrency } from '@/lib/job-payments'
import { formatDate } from '@/lib/format'
import { INVOICE_STATUS_LABELS, type InvoiceStatus, type JobInvoice } from '@/lib/types/invoices'

type Row = JobInvoice & { applied_cents: number; balance_cents: number }
type PaySheet = { invoice: Row; amount: string; paidAt: string; method: CustomerPaymentMethod; note: string }

const STATUS_TONE: Record<InvoiceStatus, 'neutral' | 'success' | 'warning' | 'info' | 'danger'> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'neutral',
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Customer File → Invoices: the customer's service invoices (no job — recurring visits). Each row: Email, Mark paid,
 * Print, and Open (lines, notes, void). Renders nothing for people who don't record money or when the company has no
 * service plans (the API answers 403 / 404). Data: /api/customers/[id]/invoices.
 */
export default function CustomerInvoicesCard({ customerId }: { customerId: string }) {
  const [rows, setRows] = React.useState<Row[] | null>(null)
  const [hidden, setHidden] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [pay, setPay] = React.useState<PaySheet | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [showAll, setShowAll] = React.useState(false)

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}/invoices`, { cache: 'no-store' }).catch(() => null)
    if (!res || res.status === 403 || res.status === 404) {
      setHidden(true)
      return
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.ready === false) {
      setHidden(true)
      return
    }
    setRows(body.invoices as Row[])
  }, [customerId])

  React.useEffect(() => {
    void load()
  }, [load])

  if (hidden || !rows || rows.length === 0) return null

  async function email(inv: Row) {
    const again = inv.status !== 'draft'
    if (!(await confirmDialog({ title: again ? `Email ${inv.invoice_number} again?` : `Email ${inv.invoice_number} to the customer?` }))) return
    setBusy(inv.id)
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(body.error || 'Could not email the invoice')
      else toast.success(`Emailed ${inv.invoice_number}`)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function savePayment() {
    if (!pay) return
    const cents = Math.round(parseFloat(pay.amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error('Enter the amount paid')
      return
    }
    setBusy(pay.invoice.id)
    try {
      const res = await fetch(`/api/invoices/${pay.invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_payment', amount_cents: cents, paid_at: pay.paidAt, method: pay.method, note: pay.note }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not save the payment')
        return
      }
      toast.success(body.invoice?.balance_cents <= 0 ? `${pay.invoice.invoice_number} is paid` : 'Payment saved')
      setPay(null)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const unpaid = rows.filter((r) => r.status !== 'void' && r.status !== 'paid' && r.balance_cents > 0)
  const owed = unpaid.reduce((s, r) => s + r.balance_cents, 0)
  const list = showAll ? rows : rows.slice(0, 6)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        {owed > 0 ? <Badge tone="warning">{formatCurrency(owed)} owed</Badge> : null}
      </CardHeader>
      <CardContent className="p-0">
        <ul>
          {list.map((inv) => {
            const canPay = inv.status !== 'void' && inv.status !== 'paid' && inv.balance_cents > 0
            const canEmail = inv.status !== 'void' && inv.total_cents > 0
            return (
              <li key={inv.id} className="border-b border-surface-line px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className="min-h-tap text-left" onClick={() => setOpenId(inv.id)}>
                    <span className="block text-ui-base font-semibold text-ink underline">{inv.invoice_number}</span>
                    <span className="block text-ui-sm text-ink">{formatDate(inv.issued_at ?? inv.created_at)}</span>
                  </button>
                  <span className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                    <span className="text-ui-base font-semibold tabular-nums text-ink">{formatCurrency(canPay ? inv.balance_cents : inv.total_cents)}</span>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {canPay ? (
                    <Button size="sm" disabled={busy === inv.id} onClick={() => setPay({ invoice: inv, amount: (inv.balance_cents / 100).toFixed(2), paidAt: localToday(), method: 'check', note: '' })}>
                      Mark paid
                    </Button>
                  ) : null}
                  {canEmail ? (
                    <Button size="sm" variant="secondary" disabled={busy === inv.id} onClick={() => void email(inv)}>
                      {inv.status === 'draft' ? 'Email' : 'Email again'}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" asChild>
                    <a href={`/invoices/${inv.id}/print`} target="_blank" rel="noreferrer">
                      Print
                    </a>
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        {rows.length > list.length ? (
          <button type="button" className="min-h-tap px-4 text-ui-sm font-semibold text-brand-800 underline" onClick={() => setShowAll(true)}>
            Show all {rows.length}
          </button>
        ) : null}
      </CardContent>

      {openId ? (
        <InvoiceDetailModal
          invoiceId={openId}
          onClose={() => {
            setOpenId(null)
            void load()
          }}
        />
      ) : null}

      {pay ? (
        <Dialog open onOpenChange={(o) => !o && setPay(null)}>
          <DialogContent title={`Mark ${pay.invoice.invoice_number} paid`} description={`Balance ${formatCurrency(pay.invoice.balance_cents)}`}>
            <Field label="Amount paid">
              {(p) => <Input {...p} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />}
            </Field>
            <Field label="How">
              {(p) => (
                <Select {...p} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as CustomerPaymentMethod })}>
                  {CUSTOMER_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {CUSTOMER_PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Day paid">{(p) => <Input {...p} type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} />}</Field>
            <Field label="Note (check number…)">{(p) => <Input {...p} value={pay.note} maxLength={500} onChange={(e) => setPay({ ...pay, note: e.target.value })} />}</Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPay(null)}>
                Cancel
              </Button>
              <Button loading={busy === pay.invoice.id} onClick={() => void savePayment()}>
                Save payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}
