'use client'

import * as React from 'react'

import { Button, Card, Field, Select } from '@/components/ui'
import { PAYMENT_TERMS, PAYMENT_TERMS_LABELS, type PaymentTerms } from '@/lib/payment-terms'

/** Owners: when invoices are due, unless a customer has their own terms (Settings → Payments & tax). */
export default function PaymentTermsCard() {
  const [terms, setTerms] = React.useState<PaymentTerms | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void fetch('/api/admin/payment-terms', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { defaultTerms?: PaymentTerms } | null) => d?.defaultTerms && setTerms(d.defaultTerms))
  }, [])
  if (!terms) return null

  async function save() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/admin/payment-terms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultTerms: terms }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setBusy(false)
    setMsg(res?.ok ? 'Saved' : out.error || 'Couldn’t save')
  }

  return (
    <Card className="flex flex-col gap-3 p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Payment terms</h2>
      <p className="text-base">When an invoice is due. A customer can have their own terms on their invoices card. It applies to invoices issued from now on; ones already issued keep their due day.</p>
      <Field label="Default terms">
        {(a) => (
          <Select {...a} className="text-base" value={terms} onChange={(e) => setTerms(e.target.value as PaymentTerms)}>
            {PAYMENT_TERMS.map((t) => (
              <option key={t} value={t}>{PAYMENT_TERMS_LABELS[t]}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        {msg ? <span role="status" className="text-base">{msg}</span> : null}
      </div>
    </Card>
  )
}
