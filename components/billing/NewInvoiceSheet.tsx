'use client'

import * as React from 'react'

import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, toast } from '@/components/ui'
import { lineTotalCents } from '@/lib/invoice-lines'
import { formatCurrency } from '@/lib/job-payments'
import type { CatalogItem } from '@/lib/one-off-invoice'

type Line = { key: number; itemId: string; optionKey: string; description: string; qty: string; price: string; taxable: boolean }
type Offer = { items: CatalogItem[]; properties: Array<{ id: string; address: string }>; salesTaxOn: boolean }

const blank = (key: number): Line => ({ key, itemId: '', optionKey: '', description: '', qty: '1', price: '', taxable: false })

/** Pure: what one line costs before tax, in cents (a price-book line with no typed price uses the item's / chosen size's price). */
export function sheetLineCents(l: Line, items: readonly CatalogItem[]): number {
  const item = items.find((i) => i.id === l.itemId)
  const typed = l.price.trim() === '' ? null : Math.round(parseFloat(l.price) * 100)
  const unit = typed != null && Number.isFinite(typed) ? typed : item ? (item.options.find((o) => o.key === l.optionKey)?.priceCents ?? item.unitPriceCents) : 0
  return lineTotalCents(parseFloat(l.qty), unit)
}

/**
 * Customer File → Invoices → New invoice: a one-off invoice from price-book lines and typed lines. It makes a DRAFT through
 * POST /api/customers/[id]/invoices (the one invoice writer) and hands back its id so the card can open it. A bottom sheet on a phone.
 */
export default function NewInvoiceSheet({ customerId, onClose, onCreated }: { customerId: string; onClose: () => void; onCreated: (invoiceId: string) => void }) {
  const [offer, setOffer] = React.useState<Offer | null>(null)
  const [lines, setLines] = React.useState<Line[]>([blank(1)])
  const [propertyId, setPropertyId] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const next = React.useRef(2)

  React.useEffect(() => {
    void fetch(`/api/customers/${customerId}/invoices/new`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Offer | null) => (d ? setOffer(d) : toast.error('Could not load the price book')))
      .catch(() => toast.error('Could not load the price book'))
  }, [customerId])

  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const items = offer?.items ?? []
  const subtotal = lines.reduce((s, l) => s + (Number.isFinite(sheetLineCents(l, items)) ? sheetLineCents(l, items) : 0), 0)

  async function save() {
    const out: Array<Record<string, unknown>> = []
    for (const l of lines) {
      const qty = parseFloat(l.qty)
      if (!(qty > 0)) return toast.error('Every line needs a quantity')
      const priceCents = l.price.trim() === '' ? null : Math.round(parseFloat(l.price) * 100)
      if (priceCents != null && (!Number.isFinite(priceCents) || priceCents < 0)) return toast.error('A price is not valid')
      if (l.itemId) out.push({ itemId: l.itemId, optionKey: l.optionKey || undefined, qty, priceCents })
      else {
        if (!l.description.trim()) return toast.error('Every line needs a description')
        if (priceCents == null) return toast.error('Every typed line needs a price')
        out.push({ description: l.description.trim(), qty, priceCents, taxable: l.taxable })
      }
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/customers/${customerId}/invoices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: out, propertyId: propertyId || undefined, publicNote: note.trim() || undefined }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(body.error || 'Could not make the invoice')
      toast.success('Invoice made — review it, then email it or mark it paid')
      onCreated(String(body.invoiceId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New invoice" description="Pick from your price book or type a line. It starts as a draft you can review.">
        <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto">
          {lines.map((l, i) => {
            const item = items.find((x) => x.id === l.itemId)
            return (
              <fieldset key={l.key} className="flex flex-col gap-2 rounded-ui border border-surface-line p-3">
                <legend className="px-1 text-ui-sm font-semibold text-ink">Line {i + 1}</legend>
                <Field label="Item">
                  {(a) => (
                    <Select {...a} value={l.itemId} onChange={(e) => patch(l.key, { itemId: e.target.value, optionKey: '', price: '' })}>
                      <option value="">Something else (type it)</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.name}{it.options.length ? '' : ` — ${formatCurrency(it.unitPriceCents)}`}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                {item && item.options.length > 0 ? (
                  <Field label="Size">
                    {(a) => (
                      <Select {...a} value={l.optionKey} onChange={(e) => patch(l.key, { optionKey: e.target.value })}>
                        <option value="">Pick a size</option>
                        {item.options.map((o) => (
                          <option key={o.key} value={o.key}>{o.label} — {formatCurrency(o.priceCents)}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {!item ? <Field label="Description">{(a) => <Input {...a} value={l.description} maxLength={200} onChange={(e) => patch(l.key, { description: e.target.value })} />}</Field> : null}
                <div className="flex gap-2">
                  <Field label="Qty">{(a) => <Input {...a} inputMode="decimal" className="w-24" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} />}</Field>
                  <Field label={item ? 'Price (leave blank for the price book)' : 'Price each'}>
                    {(a) => <Input {...a} inputMode="decimal" value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} />}
                  </Field>
                </div>
                {!item && offer?.salesTaxOn ? (
                  <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                    <input type="checkbox" className="h-5 w-5" checked={l.taxable} onChange={(e) => patch(l.key, { taxable: e.target.checked })} /> Charge sales tax
                  </label>
                ) : null}
                {lines.length > 1 ? <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove line</Button> : null}
              </fieldset>
            )
          })}
          <Button variant="secondary" onClick={() => setLines((ls) => [...ls, blank(next.current++)])}>Add a line</Button>
          {offer && offer.properties.length > 1 ? (
            <Field label="Property">
              {(a) => (
                <Select {...a} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="">Not tied to a property</option>
                  {offer.properties.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Note for the customer (optional)">{(a) => <Input {...a} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        <p className="text-ui-base font-semibold text-ink">Subtotal {formatCurrency(subtotal)}{offer?.salesTaxOn ? ' · sales tax is added when saved' : ''}</p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!offer} onClick={() => void save()}>Make invoice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
