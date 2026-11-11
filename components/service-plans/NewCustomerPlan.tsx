'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Textarea, toast } from '@/components/ui'
import { PlanFields, bodyFrom, formFromTemplate, planFormReady, type PlanEditorOptions, type PlanFormValues } from '@/components/service-plans/PlanForm'

type Who = { name: string; phone: string; email: string; address_line1: string; city: string; state: string; zip: string; access_notes: string }
const EMPTY: Who = { name: '', phone: '', email: '', address_line1: '', city: '', state: '', zip: '', access_notes: '' }

/**
 * "+ New customer + plan": the office's common job for a service company — a new customer signing up for mowing — in one
 * sheet: who, where, which plan. Uses the same plan form as the Customer File (PlanForm). Shows nothing when the company
 * doesn't use service plans or this person can't start one (GET /api/service-plans answers 403 / 404).
 */
export default function NewCustomerPlan({ onCreated, size = 'sm' }: { onCreated?: (customerId: string) => void; size?: 'sm' | 'md' }) {
  const router = useRouter()
  const done = (id: string) => (onCreated ? onCreated(id) : router.push(`/c/${id}`))
  const [options, setOptions] = React.useState<PlanEditorOptions | null>(null)
  const [open, setOpen] = React.useState(false)
  const [who, setWho] = React.useState<Who>(EMPTY)
  const [form, setForm] = React.useState<PlanFormValues | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let live = true
    void fetch('/api/service-plans', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<PlanEditorOptions>) : null))
      .catch(() => null)
      .then((o) => live && setOptions(o))
    return () => {
      live = false
    }
  }, [])
  if (!options) return null
  const d = options

  const start = () => {
    setWho(EMPTY)
    setForm(formFromTemplate(d.templates[0] ?? null, d))
    setOpen(true)
  }
  const set = (patch: Partial<PlanFormValues>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const w = (patch: Partial<Who>) => setWho((x) => ({ ...x, ...patch }))

  async function save() {
    if (!form) return
    setSaving(true)
    const { name, phone, email, ...property } = who
    const res = await fetch('/api/service-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: { name, phone, email }, property, plan: bodyFrom(form, true) }),
    }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; customerId?: string | null; matchedExisting?: boolean }
    setSaving(false)
    if (!res || !res.ok) {
      toast.error(out.error || 'Could not save')
      if (out.customerId) done(out.customerId)
      return
    }
    toast.success(out.matchedExisting ? `Plan started — added to ${name}, who was already a customer` : `${name} added — visits are on the calendar`)
    setOpen(false)
    if (out.customerId) done(out.customerId)
  }

  return (
    <>
      <Button size={size} onClick={start}>
        + New customer + plan
      </Button>
      {open && form ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setOpen(false)}>
          <DialogContent className="scroll-pb-40" title="New customer + plan" description="Who, where, and which plan. Visits go on the calendar right away.">
            <form
              className="flex flex-col gap-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <Field label="Customer name *">{(a) => <Input {...a} className="text-base" autoComplete="name" maxLength={120} value={who.name} onChange={(e) => w({ name: e.target.value })} />}</Field>
              <Field label="Phone">{(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" className="text-base" maxLength={40} value={who.phone} onChange={(e) => w({ phone: e.target.value })} />}</Field>
              <Field label="Street address *">{(a) => <Input {...a} autoComplete="address-line1" className="text-base" maxLength={200} value={who.address_line1} onChange={(e) => w({ address_line1: e.target.value })} />}</Field>
              <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
                <Field label="City">{(a) => <Input {...a} autoComplete="address-level2" className="text-base" value={who.city} onChange={(e) => w({ city: e.target.value })} />}</Field>
                <Field label="State">{(a) => <Input {...a} autoComplete="address-level1" className="text-base" maxLength={20} value={who.state} onChange={(e) => w({ state: e.target.value })} />}</Field>
                <Field label="ZIP">{(a) => <Input {...a} inputMode="numeric" autoComplete="postal-code" className="text-base" maxLength={10} value={who.zip} onChange={(e) => w({ zip: e.target.value })} />}</Field>
              </div>
              <Field label="Gate code / access (optional)">{(a) => <Textarea {...a} className="text-base" rows={2} maxLength={1000} value={who.access_notes} onChange={(e) => w({ access_notes: e.target.value })} />}</Field>
              <PlanFields
                key={form.template_id}
                d={d}
                f={form}
                set={set}
                plan={null}
                onTemplate={(t) => setForm({ ...formFromTemplate(t, d), start_date: form.start_date, default_sub_id: form.default_sub_id })}
              />
              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving} disabled={!who.name.trim() || !who.address_line1.trim() || !planFormReady(form, false)}>
                  Start plan
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
