'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import CategoryPicker from '@/components/categories/CategoryPicker'
import { useOrgCategories } from '@/hooks/useOrgCategories'
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { useOrgFeatures, useOrgProfile } from '@/hooks/useOrgFeatures'
import { manualLeadSourcesFor } from '@/lib/lead-sources'
import { PlanFields, bodyFrom, formFromTemplate, planFormReady, type PlanEditorOptions, type PlanFormValues } from '@/components/service-plans/PlanForm'

type Who = { name: string; phone: string; email: string; address_line1: string; city: string; state: string; zip: string; access_notes: string }
const EMPTY: Who = { name: '', phone: '', email: '', address_line1: '', city: '', state: '', zip: '', access_notes: '' }

/**
 * A company whose work is not priced from a roof (lawn, cleaning: `squaresPricing` off) gets "+ New customer" instead: ONE
 * sheet for when a customer calls — who and where — then three ways to finish: Save as lead (POST /api/leads), Start a quote
 * (the same lead, its opportunity via /api/leads/[id]/opportunity, then the quote builder) or Start a plan (the plan form below,
 * POST /api/service-plans). No new writers. Roofing never sees it.
 *
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
  const [category, setCategory] = React.useState<string | null>(null)
  const categories = useOrgCategories()
  const startAll = !useOrgFeatures().squaresPricing
  const leadSources = manualLeadSourcesFor(useOrgProfile().hiddenLeadSources)
  const [phase, setPhase] = React.useState<'who' | 'plan'>('who')
  const [source, setSource] = React.useState('')
  const [busy, setBusy] = React.useState<'lead' | 'quote' | null>(null)

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
  // No plan access: roofing shows nothing (as before); a start-everything sheet still offers lead and quote.
  if (!options && !startAll) return null
  const d = options

  const start = () => {
    setWho(EMPTY)
    setCategory(null)
    setSource('')
    setPhase('who')
    setForm(d ? formFromTemplate(d.templates[0] ?? null, d) : null)
    setOpen(true)
  }

  /** The lead writer (POST /api/leads, same body as the New Lead form). Returns the lead id, or null after telling the person why. */
  async function createLead(): Promise<{ id: string; address: string } | null> {
    const address = [who.address_line1.trim(), [who.city.trim(), [who.state.trim(), who.zip.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeowner_name: who.name.trim() || null, phone: who.phone.trim() || null, email: who.email.trim() || null, address_text: address || null, category, source: source || null }),
    }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; lead_id?: string }
    if (!res || !res.ok || !out.lead_id) {
      toast.error(out.error || 'Could not save')
      return null
    }
    return { id: out.lead_id, address }
  }

  async function saveAsLead() {
    setBusy('lead')
    const lead = await createLead()
    setBusy(null)
    if (!lead) return
    toast.success(`${who.name.trim()} saved as a lead`)
    setOpen(false)
    router.push(`/leads/${lead.id}`)
  }

  async function startQuote() {
    setBusy('quote')
    const lead = await createLead()
    if (!lead) return setBusy(null)
    // The same call the lead page's "create opportunity" makes: it makes the customer (customerIdForLead) and the deal the quote hangs on.
    const res = await fetch(`/api/leads/${lead.id}/opportunity`, { method: 'POST', credentials: 'same-origin' }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; opportunity_id?: string }
    setBusy(null)
    setOpen(false)
    if (!res || !res.ok || !out.opportunity_id) {
      toast.error(out.error || 'Saved as a lead, but the quote could not start. Open the lead to try again.')
      router.push(`/leads/${lead.id}`)
      return
    }
    router.push(`/proposals/builder?opportunity_id=${out.opportunity_id}&customer_name=${encodeURIComponent(who.name.trim())}&customer_address=${encodeURIComponent(lead.address)}`)
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
      body: JSON.stringify({ customer: { name, phone, email, category }, property, plan: bodyFrom(form, true) }),
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
        {startAll ? '+ New customer' : '+ New customer + plan'}
      </Button>
      {open && (form || startAll) ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setOpen(false)}>
          <DialogContent className="scroll-pb-40" title={startAll ? 'New customer' : 'New customer + plan'} description={startAll ? 'Who and where. Then save a lead, start a quote or start a plan.' : 'Who, where, and which plan. Visits go on the calendar right away.'}>
            <form
              className="flex flex-col gap-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault()
                // Enter in a field must not start a plan while the person is still choosing how to finish.
                if (startAll && phase === 'who') return
                void save()
              }}
            >
              <Field label="Customer name *">{(a) => <Input {...a} className="text-base" autoComplete="name" maxLength={120} value={who.name} onChange={(e) => w({ name: e.target.value })} />}</Field>
              <Field label="Phone">{(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" className="text-base" maxLength={40} value={who.phone} onChange={(e) => w({ phone: e.target.value })} />}</Field>
              {startAll ? <Field label="Email (optional)">{(a) => <Input {...a} type="email" inputMode="email" autoComplete="email" className="text-base" maxLength={200} value={who.email} onChange={(e) => w({ email: e.target.value })} />}</Field> : null}
              <Field label="Street address *">{(a) => <Input {...a} autoComplete="address-line1" className="text-base" maxLength={200} value={who.address_line1} onChange={(e) => w({ address_line1: e.target.value })} />}</Field>
              <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
                <Field label="City">{(a) => <Input {...a} autoComplete="address-level2" className="text-base" value={who.city} onChange={(e) => w({ city: e.target.value })} />}</Field>
                <Field label="State">{(a) => <Input {...a} autoComplete="address-level1" className="text-base" maxLength={20} value={who.state} onChange={(e) => w({ state: e.target.value })} />}</Field>
                <Field label="ZIP">{(a) => <Input {...a} inputMode="numeric" autoComplete="postal-code" className="text-base" maxLength={10} value={who.zip} onChange={(e) => w({ zip: e.target.value })} />}</Field>
              </div>
              {categories && categories.some((c) => c.active) ? (
                <div className="flex flex-col gap-1">
                  <span className="text-ui-sm font-semibold text-ink">Category (optional)</span>
                  <CategoryPicker options={categories} value={category} onChange={setCategory} />
                </div>
              ) : null}
              {startAll ? (
                <Field label="Where did they hear about us? (optional)">
                  {(a) => (
                    <Select {...a} className="text-base" value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="">Select source</option>
                      {leadSources.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {!startAll || phase === 'plan' ? <Field label="Gate code / access (optional)">{(a) => <Textarea {...a} className="text-base" rows={2} maxLength={1000} value={who.access_notes} onChange={(e) => w({ access_notes: e.target.value })} />}</Field> : null}
              {startAll && phase === 'who' ? (
                <DialogFooter className="sticky bottom-0 flex-col bg-surface pt-2 sm:flex-row">
                  <Button type="button" variant="secondary" className="min-h-tap" disabled={busy !== null} onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" variant="secondary" className="min-h-tap" loading={busy === 'lead'} disabled={busy !== null || !who.name.trim()} onClick={() => void saveAsLead()}>
                    Save as lead
                  </Button>
                  <Button type="button" variant="secondary" className="min-h-tap" loading={busy === 'quote'} disabled={busy !== null || !who.name.trim() || !who.address_line1.trim()} onClick={() => void startQuote()}>
                    Start a quote
                  </Button>
                  {d && form ? (
                    <Button type="button" className="min-h-tap" disabled={busy !== null || !who.name.trim() || !who.address_line1.trim()} onClick={() => setPhase('plan')}>
                      Start a plan
                    </Button>
                  ) : null}
                </DialogFooter>
              ) : d && form ? (
                <>
                  <PlanFields
                    key={form.template_id}
                    d={d}
                    f={form}
                    set={set}
                    plan={null}
                    onTemplate={(t) => setForm({ ...formFromTemplate(t, d), start_date: form.start_date, default_sub_id: form.default_sub_id })}
                  />
                  <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => (startAll ? setPhase('who') : setOpen(false))}>
                      {startAll ? 'Back' : 'Cancel'}
                    </Button>
                    <Button type="submit" loading={saving} disabled={!who.name.trim() || !who.address_line1.trim() || !planFormReady(form, false)}>
                      Start plan
                    </Button>
                  </DialogFooter>
                </>
              ) : null}
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
