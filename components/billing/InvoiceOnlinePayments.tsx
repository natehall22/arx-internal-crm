'use client'

import { useState } from 'react'

import { Button, toast } from '@/components/ui'
import { formatCurrency } from '@/lib/job-payments'
import { formatDate } from '@/lib/format'
import type { InvoiceOnlineSummary } from '@/lib/online-payments/summary'

/**
 * Invoice modal → Online payment: one tap to copy or email the customer's pay link (deposit, job or service invoice),
 * and every online attempt in plain words ("Paid by Visa •••• 4242", "Bank payment processing", "Automatic payment
 * didn’t go through"). Shown only when the company uses online payments.
 */
export default function InvoiceOnlinePayments({
  invoiceId,
  online,
  owed,
  onChanged,
}: {
  invoiceId: string
  online: InvoiceOnlineSummary | null
  owed: boolean
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState<'copy' | 'email' | 'text' | null>(null)
  const [shownUrl, setShownUrl] = useState<string | null>(null)
  if (!online) return null

  async function make(email: boolean) {
    setBusy(email ? 'email' : 'copy')
    const res = await fetch(`/api/invoices/${invoiceId}/pay-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { url?: string; error?: string; emailedTo?: string }) : {}
    setBusy(null)
    if (!res || !res.ok) {
      toast.error(data.error || 'Could not make the link')
      if (data.url) setShownUrl(data.url)
      return
    }
    onChanged?.()
    if (email) return toast.success(`Pay link emailed to ${data.emailedTo}`)
    if (data.url) {
      setShownUrl(data.url)
      const copied = await navigator.clipboard?.writeText(data.url).then(() => true).catch(() => false)
      toast.success(copied ? 'Pay link copied — paste it in a text or email' : 'Pay link ready below')
    }
  }

  /** Text the customer the link from the server (the same helper the crew page uses); staff never see the number. */
  async function text() {
    setBusy('text')
    const res = await fetch(`/api/invoices/${invoiceId}/pay-link/text`, { method: 'POST' }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { message?: string; error?: string }) : {}
    setBusy(null)
    if (res?.ok) {
      onChanged?.()
      return toast.success(data.message || 'Pay link texted')
    }
    toast.error(`${data.message || data.error || 'Could not text the link'}${res ? ' Use Copy or Email instead.' : ''}`)
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 p-4">
      <div className="mb-2 text-sm font-semibold text-gray-900">Online payment</div>
      {owed ? (
        online.ready ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-tap" loading={busy === 'copy'} onClick={() => void make(false)}>
              Copy pay link
            </Button>
            <Button size="sm" variant="secondary" className="min-h-tap" loading={busy === 'email'} onClick={() => void make(true)}>
              Email pay link
            </Button>
            <Button size="sm" variant="secondary" className="min-h-tap" loading={busy === 'text'} onClick={() => void text()}>
              Text pay link
            </Button>
          </div>
        ) : (
          <p className="text-sm text-gray-900">Connect Stripe in Settings → Online payments to send pay links.</p>
        )
      ) : null}
      {shownUrl ? (
        <input readOnly value={shownUrl} onFocus={(e) => e.currentTarget.select()} className="mt-2 min-h-[44px] w-full rounded border border-gray-300 px-2 text-base text-gray-900" aria-label="Pay link" />
      ) : null}
      {online.attempts.length > 0 ? (
        <ul className="mt-3 divide-y divide-gray-200">
          {online.attempts.map((a) => (
            <li key={a.id} className="py-2 text-sm text-gray-900">
              <div className="flex justify-between gap-2">
                <span className={a.status === 'failed' || a.status === 'needs_review' ? 'font-semibold text-red-800' : 'font-semibold'}>{a.label}</span>
                <span className="tabular-nums">{formatCurrency(a.amountCents)}</span>
              </div>
              <div className="text-sm text-gray-700">
                {formatDate(a.at)}
                {a.refundedCents > 0 ? ` · ${formatCurrency(a.refundedCents)} refunded` : ''}
                {a.note ? ` · ${a.note}` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
