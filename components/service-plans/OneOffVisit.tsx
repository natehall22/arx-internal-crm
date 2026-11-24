'use client'

import * as React from 'react'

import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { todayLocal, type PlanEditorOptions } from '@/components/service-plans/PlanForm'
import { addDaysYmd, VISIT_HORIZON_DAYS } from '@/lib/service-plans'

type Found = { id: string; name: string | null; phone?: string | null }

/**
 * "+ One-off visit": a single visit for a customer's property — one mow, one grading touch-up — without starting a plan.
 * Used on the Visits board (the person searches for the customer) and on the Customer File (customer already known).
 * Saves through POST /api/ops/visits; the visit is an ordinary service visit (visit code, crew-day stop, billed like a plan visit).
 */
export type OneOffPrefill = { customerId: string; propertyId?: string | null; date: string; today: string; text: string; reminderId: string }

/**
 * `prefill` = "Make a visit" from a reminder: the customer (and property, when the reminder has one), the day; the reminder text is shown above the form for the office person and is never copied into the crew note.
 * The save also sends the reminder id so the server marks the reminder done. A reminder that names a property keeps the visit at it.
 */
export default function OneOffVisit({ customerId, onCreated, size = 'sm', variant = 'secondary', prefill, label = '+ One-off visit', className }: { customerId?: string; onCreated?: () => void; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary'; prefill?: OneOffPrefill; label?: string; className?: string }) {
  customerId = prefill?.customerId ?? customerId
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [customer, setCustomer] = React.useState<Found | null>(customerId ? { id: customerId, name: null } : null)
  const [query, setQuery] = React.useState('')
  const [found, setFound] = React.useState<Found[]>([])
  const [options, setOptions] = React.useState<(PlanEditorOptions & { canEdit?: boolean }) | null>(null)
  const [optionsFailed, setOptionsFailed] = React.useState(false)
  // One key per opening of the sheet: a double tap or a retried request returns the same visit (the server checks it).
  const keyRef = React.useRef('')
  const [f, setF] = React.useState({ property_id: '', trade: '', name: '', date: '', sub_id: '', price: '', taxable: false, notes: '' })
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  // The company's day (sent by the server for a reminder visit), never the phone's.
  const today = prefill?.today ?? todayLocal()

  function start() {
    setCustomer(customerId ? { id: customerId, name: null } : null)
    setQuery('')
    setFound([])
    setOptions(null)
    setOptionsFailed(false)
    setF({ property_id: '', trade: '', name: '', date: prefill?.date ?? todayLocal(), sub_id: '', price: '', taxable: false, notes: '' })
    keyRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`
    setOpen(true)
  }

  // Search the company's customers (same search the rest of the app uses).
  React.useEffect(() => {
    if (!open || customer || query.trim().length < 2) return setFound([])
    const t = setTimeout(() => {
      void fetch(`/api/customers/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : { customers: [] }))
        .then((o: { customers?: Found[] }) => setFound((o.customers ?? []).slice(0, 8)))
        .catch(() => setFound([]))
    }, 250)
    return () => clearTimeout(t)
  }, [open, customer, query])

  // Their properties, the company's service types and crews: the same answer the plan form uses.
  const cid = customer?.id
  React.useEffect(() => {
    if (!open || !cid) return
    let live = true
    setOptions(null)
    setOptionsFailed(false)
    void fetch(`/api/customers/${cid}/service-plans`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<PlanEditorOptions>) : Promise.reject(new Error('x'))))
      .then((o) => {
        if (!live) return
        setOptions(o)
        setF((x) => ({ ...x, property_id: (prefill?.propertyId && o.properties.some((p) => p.id === prefill.propertyId) ? prefill.propertyId : o.properties[0]?.id) ?? '', trade: o.trades[0]?.slug ?? '' }))
      })
      .catch(() => live && setOptionsFailed(true))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the prefill is read once, when the sheet opens
  }, [open, cid])

  const ready = !!customer && !!options && !!f.property_id && !!f.trade && !!f.date && f.date >= today

  async function save() {
    if (!customer) return
    setSaving(true)
    const res = await fetch('/api/ops/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotency_key: keyRef.current, customer_id: customer.id, property_id: f.property_id, trade: f.trade, name: f.name, date: f.date, sub_id: f.sub_id || null, price: f.price, taxable: f.taxable, notes: f.notes, ...(prefill ? { reminder_id: prefill.reminderId } : {}) }),
    }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; workOrderNumber?: string | null; reminderDone?: boolean }
    setSaving(false)
    if (!res || !res.ok) return toast.error(out.error || 'Could not save')
    toast.success(out.workOrderNumber ? `Visit ${out.workOrderNumber} added` : 'Visit added')
    if (prefill && out.reminderDone === false) toast.error('Visit added, but the reminder is still open. Tap Done on it.')
    setOpen(false)
    onCreated?.()
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={start}>{label}</Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setOpen(false)}>
          <DialogContent className="scroll-pb-40" title="One-off visit" description="One visit, not a plan. It goes on the crew’s day and is billed like any visit.">
            {prefill?.text ? <p className="rounded-ui border border-surface-line bg-surface-subtle p-2 text-ui-base text-ink"><span className="font-semibold">Reminder:</span> {prefill.text}</p> : null}
            <form
              className="flex flex-col gap-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready) void save()
              }}
            >
              {!customer ? (
                <>
                  <Field label="Customer *">{(a) => <Input {...a} className="text-base" autoComplete="off" placeholder="Name, phone or email" value={query} onChange={(e) => setQuery(e.target.value)} />}</Field>
                  {query.trim().length >= 2 && found.length === 0 ? <p className="text-ui-base text-ink">No customer found. Add them with “+ New customer” first.</p> : null}
                  <ul className="flex flex-col gap-2">
                    {found.map((c) => (
                      <li key={c.id}>
                        <Button type="button" variant="secondary" className="min-h-tap w-full justify-start text-left" onClick={() => setCustomer(c)}>
                          {c.name || 'Customer'}{c.phone ? ` · ${c.phone}` : ''}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  {!customerId ? (
                    <p className="flex flex-wrap items-center gap-2 text-ui-base font-semibold text-ink">
                      {customer.name || 'Customer'}
                      <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => { setCustomer(null); setOptions(null) }}>Change</Button>
                    </p>
                  ) : null}
                  {optionsFailed ? <p className="text-ui-base text-ink">Couldn’t load this customer’s properties. Close and try again.</p> : null}
                  {!options && !optionsFailed ? <p className="text-ui-base text-ink">Loading…</p> : null}
                  {options && options.properties.length === 0 ? <p className="text-ui-base text-ink">Add a property for this customer first — a visit is for one property.</p> : null}
                  {options && options.properties.length > 0 ? (
                    <>
                      {options.properties.length > 1 ? (
                        <Field label="Property *">{(a) => <Select {...a} className="text-base" disabled={!!prefill?.propertyId} value={f.property_id} onChange={(e) => set({ property_id: e.target.value })}>{options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
                      ) : null}
                      <Field label="Service *">{(a) => <Select {...a} className="text-base" value={f.trade} onChange={(e) => set({ trade: e.target.value })}>{options.trades.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}</Select>}</Field>
                      <Field label="What are we doing? (optional)">{(a) => <Input {...a} className="text-base" maxLength={120} placeholder="One-time visit" value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
                      <Field label="Day *" hint="Today or up to 6 weeks ahead.">{(a) => <Input {...a} type="date" className="text-base" min={today} max={addDaysYmd(today, VISIT_HORIZON_DAYS - 1)} value={f.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
                      <Field label="Crew">{(a) => <Select {...a} className="text-base" value={f.sub_id} onChange={(e) => set({ sub_id: e.target.value })}><option value="">No crew yet</option>{options.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
                      {options.prices ? (
                        <>
                          <Field label="Price (optional)">{(a) => <Input {...a} inputMode="decimal" className="text-base" placeholder="0.00" value={f.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
                          <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
                            <input type="checkbox" className="h-5 w-5" checked={f.taxable} onChange={(e) => set({ taxable: e.target.checked })} />
                            Add sales tax
                          </label>
                        </>
                      ) : null}
                      <Field label="Notes for the crew (optional)">{(a) => <Textarea {...a} className="text-base" rows={2} maxLength={2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
                    </>
                  ) : null}
                </>
              )}
              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" className="min-h-tap" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="min-h-tap" loading={saving} disabled={!ready}>Add visit</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
