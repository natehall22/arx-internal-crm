'use client'

import * as React from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { SeasonsEditor, StepsEditor } from '@/components/service-plans/PlanSpecEditors'
import { formatDateShort, formatDateTime, formatMoney } from '@/lib/format'
import {
  BILLING_BASIS_LABELS,
  WEEKDAY_LABELS,
  eligibleTiers,
  planWeekday,
  seasonLabel,
  tierCheck,
  type BillingBasis,
  type PlanPricing,
  type PlanStep,
  type Season,
  type ServicePlan,
  type ServicePlanTemplate,
} from '@/lib/service-plans'

type PlanRow = ServicePlan & { priceHidden?: boolean }
type Option = { id: string; name: string }
type Load = {
  ready: boolean
  plans: PlanRow[]
  canEdit: boolean
  prices: boolean
  properties: Option[]
  trades: Array<{ slug: string; label: string }>
  crews: Option[]
  people: Option[]
  templates: ServicePlanTemplate[]
}

type Form = {
  template_id: string
  name: string
  description: string
  property_id: string
  trade: string
  start_date: string
  end_date: string
  preferred_weekday: string
  seasons: Season[]
  pricing: PlanPricing
  pricing_inputs: Record<string, string>
  tier_key: string
  price: string
  billing_basis: BillingBasis
  taxable: boolean
  default_sub_id: string
  route_position: string
  steps: PlanStep[]
}

type Preview = { body: Record<string, unknown>; plan: PlanRow; summary: string; lines: string[] }
type HistoryEntry = { id: string; action: string; at: string; by: string | null; lines: string[]; effect: { removed: number; added: number; updated: number } | null }
type History = { plan: PlanRow; entries: HistoryEntry[] | null }

const STATUS_TONE = { active: 'success', paused: 'warning', ended: 'neutral' } as const
const ACTION_WORDS: Record<string, string> = {
  created: 'Started',
  updated: 'Changed',
  paused: 'Paused',
  resumed: 'Resumed',
  ended: 'Ended',
  template_applied: 'Template update applied',
  auto_resumed: 'Resumed on its date',
  auto_ended: 'Ended on its end date',
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function formFromTemplate(t: ServicePlanTemplate | null, d: Load): Form {
  return {
    template_id: t?.id ?? '',
    name: t?.name ?? '',
    description: t?.description ?? '',
    property_id: d.properties[0]?.id ?? '',
    trade: t?.trade ?? d.trades[0]?.slug ?? '',
    start_date: todayLocal(),
    end_date: '',
    preferred_weekday: '',
    seasons: t?.seasons?.length ? clone(t.seasons) : [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
    pricing: t ? clone(t.pricing) : { fields: [], tiers: [], allowCustom: true },
    pricing_inputs: {},
    tier_key: '',
    price: '',
    billing_basis: t?.billing_basis ?? 'per_visit',
    taxable: t?.taxable ?? false,
    default_sub_id: '',
    route_position: '',
    steps: t ? clone(t.steps) : [],
  }
}

function formFromPlan(p: PlanRow): Form {
  return {
    template_id: p.template_id ?? '',
    name: p.name,
    description: p.description ?? '',
    property_id: p.property_id,
    trade: p.trade,
    start_date: p.start_date,
    end_date: p.end_date ?? '',
    preferred_weekday: String(planWeekday(p)),
    seasons: clone(p.seasons),
    pricing: clone(p.pricing),
    pricing_inputs: Object.fromEntries(Object.entries(p.pricing_inputs).map(([k, v]) => [k, String(v)])),
    tier_key: p.tier_key ?? '',
    price: p.price != null ? String(p.price) : '',
    billing_basis: p.billing_basis,
    taxable: p.taxable,
    default_sub_id: p.default_sub_id ?? '',
    route_position: p.route_position != null ? String(p.route_position) : '',
    steps: clone(p.steps),
  }
}

function bodyFrom(f: Form, isNew: boolean): Record<string, unknown> {
  const inputs = Object.fromEntries(Object.entries(f.pricing_inputs).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]))
  return {
    ...(isNew ? { template_id: f.template_id || undefined, trade: f.trade } : {}),
    name: f.name,
    description: f.description,
    property_id: f.property_id,
    start_date: f.start_date,
    end_date: f.end_date || null,
    preferred_weekday: f.preferred_weekday === '' ? null : Number(f.preferred_weekday),
    seasons: f.seasons,
    pricing: f.pricing,
    pricing_inputs: inputs,
    tier_key: f.tier_key || null,
    price: f.tier_key ? null : f.price,
    billing_basis: f.billing_basis,
    taxable: f.taxable,
    default_sub_id: f.default_sub_id || null,
    route_position: f.route_position,
    steps: f.steps,
  }
}

/**
 * Customer File → Service plans: recurring work at one of the customer's properties. A new plan starts from one of the
 * company's plan templates (Settings → Plan templates) and copies it; everything stays editable on the plan — schedule,
 * seasons, price, crew, property, follow-on steps, billing. Saving an edit first shows what will change on the calendar
 * (visits removed / added / updated); done, skipped and today's visits never change. Every change is in the plan's
 * history. Reads and saves through /api/customers/[id]/service-plans and /api/service-plans/[id].
 */
export default function ServicePlansCard({ customerId }: { customerId: string }) {
  const [data, setData] = React.useState<Load | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ plan: PlanRow | null; form: Form } | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [pausing, setPausing] = React.useState<{ plan: PlanRow; until: string } | null>(null)
  const [history, setHistory] = React.useState<History | null>(null)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}/service-plans`, { cache: 'no-store' }).catch(() => null)
    if (res && (res.status === 403 || res.status === 404)) return setData(null)
    if (!res || !res.ok) return setFailed(true)
    setFailed(false)
    setData((await res.json()) as Load)
  }, [customerId])
  React.useEffect(() => {
    void load()
  }, [load])

  if (failed) return <p className="text-ui-base text-ink">Service plans couldn’t load. Refresh to try again.</p>
  if (!data || !data.ready) return null
  if (data.plans.length === 0 && !data.canEdit) return null
  const d = data

  async function send(url: string, method: string, body: unknown): Promise<Record<string, unknown> | null> {
    setSaving(true)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>
    setSaving(false)
    if (!res || !res.ok) {
      toast.error(typeof out.error === 'string' ? out.error : 'Could not save')
      return null
    }
    return out
  }

  /** Every change to an existing plan: preview first, then save with the same body. */
  async function previewThenSave(plan: PlanRow, body: Record<string, unknown>) {
    const out = await send(`/api/service-plans/${plan.id}`, 'PATCH', { ...body, preview: true })
    if (!out) return
    const lines = ((out.changes ?? []) as Array<{ label: string }>).map((c) => c.label)
    setPreview({ body, plan, summary: String(out.summary ?? ''), lines })
  }

  async function confirmSave() {
    if (!preview) return
    const out = await send(`/api/service-plans/${preview.plan.id}`, 'PATCH', { ...preview.body, expectedUpdatedAt: preview.plan.updated_at })
    if (!out) return
    toast.success('Plan saved')
    setPreview(null)
    setEditing(null)
    setPausing(null)
    await load()
  }

  async function createPlan() {
    if (!editing) return
    const out = await send(`/api/customers/${customerId}/service-plans`, 'POST', bodyFrom(editing.form, true))
    if (!out) return
    toast.success('Plan started — visits are on the calendar')
    setEditing(null)
    await load()
  }

  async function openHistory(plan: PlanRow) {
    setHistory({ plan, entries: null })
    const res = await fetch(`/api/service-plans/${plan.id}/history`, { cache: 'no-store' }).catch(() => null)
    const out = (res && res.ok ? await res.json().catch(() => ({})) : {}) as { history?: HistoryEntry[] }
    setHistory((h) => (h && h.plan.id === plan.id ? { ...h, entries: out.history ?? [] } : h))
  }

  const set = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))
  const nameOf = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.name ?? null
  const tradeName = (slug: string) => d.trades.find((t) => t.slug === slug)?.label ?? slug
  const tierLabel = (p: PlanRow) => p.pricing.tiers.find((t) => t.key === p.tier_key)?.label ?? null

  const f = editing?.form
  const numericInputs: Record<string, number> = f
    ? Object.fromEntries(Object.entries(f.pricing_inputs).filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]))
    : {}
  const fits = f ? eligibleTiers(f.pricing, numericInputs) : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service plans</CardTitle>
        {d.canEdit && d.properties.length > 0 ? (
          <Button size="sm" onClick={() => setEditing({ plan: null, form: formFromTemplate(d.templates[0] ?? null, d) })}>
            + Add plan
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {d.canEdit && d.properties.length === 0 ? <p className="text-ui-base text-ink">Add a property first — a plan is for one property.</p> : null}
        {d.plans.length === 0 ? (
          d.properties.length > 0 ? <p className="text-ui-base text-ink">No service plans yet.</p> : null
        ) : (
          <ul className="divide-y divide-surface-line">
            {d.plans.map((p) => (
              <li key={p.id} className="flex flex-col gap-1.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-ui-base font-semibold text-ink">{p.name}</p>
                  <Badge tone={STATUS_TONE[p.status]}>
                    {p.status === 'paused' ? (p.paused_until ? `Paused until ${formatDateShort(p.paused_until)}` : 'Paused') : p.status === 'ended' ? 'Ended' : 'Active'}
                  </Badge>
                </div>
                <p className="text-ui-base text-ink">{[tradeName(p.trade), nameOf(d.properties, p.property_id), `${WEEKDAY_LABELS[planWeekday(p)]}s`].filter(Boolean).join(' · ')}</p>
                <ul className="text-ui-sm text-ink">
                  {p.seasons.map((s, i) => (
                    <li key={i}>{seasonLabel(s)}</li>
                  ))}
                </ul>
                <p className="text-ui-sm text-ink">
                  {p.priceHidden
                    ? null
                    : p.price != null
                      ? `${formatMoney(p.price)} ${BILLING_BASIS_LABELS[p.billing_basis]}${tierLabel(p) ? ` (${tierLabel(p)})` : ' (custom)'}${p.taxable ? ' + tax' : ''} · `
                      : 'No price · '}
                  {nameOf(d.crews, p.default_sub_id) ?? 'No crew yet'}
                  {p.steps.length ? ` · then ${p.steps.map((s) => `${s.label} (+${s.daysAfter}d)`).join(', ')}` : ''}
                  {p.end_date && p.status !== 'ended' ? ` · ends ${formatDateShort(p.end_date)}` : ''}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {d.canEdit && p.status !== 'ended' ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing({ plan: p, form: formFromPlan(p) })}>
                        Edit
                      </Button>
                      {p.status === 'paused' ? (
                        <Button size="sm" variant="secondary" loading={saving} onClick={() => void previewThenSave(p, { action: 'resume' })}>
                          Resume
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setPausing({ plan: p, until: '' })}>
                          Pause
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={saving}
                        onClick={async () => {
                          if (await confirmDialog({ title: `End “${p.name}”?`, description: 'You’ll see what comes off the calendar before it saves.', confirmLabel: 'Continue', destructive: true })) {
                            await previewThenSave(p, { action: 'end' })
                          }
                        }}
                      >
                        End plan
                      </Button>
                    </>
                  ) : null}
                  <Button size="sm" variant="ghost" className="underline" onClick={() => void openHistory(p)}>
                    History
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {pausing ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setPausing(null)}>
          <DialogContent title={`Pause ${pausing.plan.name}`} description="Visits after today come off the calendar until it resumes. Leave the date empty to pause until someone resumes it.">
            <Field label="Resume on (optional)">{(a) => <Input {...a} type="date" className="text-base" value={pausing.until} min={todayLocal()} onChange={(e) => setPausing({ ...pausing, until: e.target.value })} />}</Field>
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setPausing(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={() => void previewThenSave(pausing.plan, { action: 'pause', until: pausing.until || null })}>
                Next
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {preview ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setPreview(null)}>
          <DialogContent title="What will change" description={preview.plan.name}>
            {preview.lines.length ? <p className="text-ui-base text-ink">Changing: {preview.lines.join(', ')}.</p> : null}
            <p className="rounded-ui border border-amber-600 bg-amber-50 p-3 text-ui-base text-ink">{preview.summary}</p>
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button loading={saving} onClick={() => void confirmSave()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {history ? (
        <Dialog open onOpenChange={(o) => !o && setHistory(null)}>
          <DialogContent title={`History — ${history.plan.name}`}>
            {history.entries === null ? (
              <p className="text-ui-base text-ink">Loading…</p>
            ) : history.entries.length === 0 ? (
              <p className="text-ui-base text-ink">No changes recorded.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {history.entries.map((h) => (
                  <li key={h.id} className="text-ui-sm text-ink">
                    <p>
                      <span className="font-semibold">{ACTION_WORDS[h.action] ?? h.action}</span> · {formatDateTime(h.at)} · {h.by ?? 'Automatic'}
                    </p>
                    {h.lines.length ? (
                      <ul className="ml-4 list-disc">
                        {h.lines.map((l, i) => (
                          <li key={i} className="break-words">{l}</li>
                        ))}
                      </ul>
                    ) : null}
                    {h.effect && (h.effect.removed || h.effect.added || h.effect.updated) ? (
                      <p>Visits: {h.effect.removed} removed, {h.effect.added} added, {h.effect.updated} updated</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setHistory(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {editing && f ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setEditing(null)}>
          <DialogContent
            title={editing.plan ? 'Edit service plan' : 'New service plan'}
            description={editing.plan ? 'You’ll see what changes on the calendar before it saves. Done, skipped and today’s visits never change.' : 'Visits go on the calendar for the next 6 weeks, and keep coming.'}
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (editing.plan) void previewThenSave(editing.plan, bodyFrom(f, false))
                else void createPlan()
              }}
            >
              {!editing.plan ? (
                <Field label="Start from" hint="Your plan templates (Settings → Plan templates). Everything below can be changed for this customer.">
                  {(a) => (
                    <Select
                      {...a}
                      className="text-base"
                      value={f.template_id}
                      onChange={(e) => {
                        const t = d.templates.find((x) => x.id === e.target.value) ?? null
                        setEditing({ plan: null, form: { ...formFromTemplate(t, d), property_id: f.property_id, start_date: f.start_date } })
                      }}
                    >
                      {d.templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                      <option value="">No template (set it all here)</option>
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field label="Plan name *">{(a) => <Input {...a} className="text-base" maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label="Property *">
                {(a) => (
                  <Select {...a} className="text-base" value={f.property_id} onChange={(e) => set({ property_id: e.target.value })}>
                    {d.properties.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
              {!editing.plan && !f.template_id ? (
                <Field label="Service type *">
                  {(a) => (
                    <Select {...a} className="text-base" value={f.trade} onChange={(e) => set({ trade: e.target.value })}>
                      {d.trades.map((t) => (
                        <option key={t.slug} value={t.slug}>{t.label}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Starts *">{(a) => <Input {...a} type="date" className="text-base" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} />}</Field>
                <Field label="Ends (optional)">{(a) => <Input {...a} type="date" className="text-base" value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} />}</Field>
              </div>
              <Field label="Visit day" hint="Empty = the weekday the plan starts on.">
                {(a) => (
                  <Select {...a} className="text-base" value={f.preferred_weekday} onChange={(e) => set({ preferred_weekday: e.target.value })}>
                    <option value="">Same as start date</option>
                    {WEEKDAY_LABELS.map((w, i) => (
                      <option key={w} value={i}>{w}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <SeasonsEditor value={f.seasons} onChange={(seasons) => set({ seasons })} />

              {d.prices ? (
                <fieldset className="flex flex-col gap-3 rounded-ui border border-surface-line p-3">
                  <legend className="px-1 text-ui-sm font-semibold text-ink">Price</legend>
                  {f.pricing.fields.length ? (
                    <div className="grid grid-cols-2 gap-2">
                      {f.pricing.fields.map((q) => (
                        <Field key={q.key} label={q.label}>
                          {(a) => <Input {...a} inputMode="decimal" className="text-base" value={f.pricing_inputs[q.key] ?? ''} onChange={(e) => set({ pricing_inputs: { ...f.pricing_inputs, [q.key]: e.target.value } })} />}
                        </Field>
                      ))}
                    </div>
                  ) : null}
                  {f.pricing.tiers.map((t) => {
                    const check = tierCheck(f.pricing, t, numericInputs)
                    return (
                      <label key={t.key} className="flex min-h-tap flex-wrap items-center gap-2 text-ui-base text-ink">
                        <input type="radio" className="h-5 w-5" name="tier" checked={f.tier_key === t.key} disabled={!check.ok} onChange={() => set({ tier_key: t.key })} />
                        {t.label}: {formatMoney(t.price)} {BILLING_BASIS_LABELS[t.billingBasis]}
                        {!check.ok ? <span className="text-ui-sm">— {check.reason}</span> : null}
                      </label>
                    )
                  })}
                  {f.pricing.allowCustom ? (
                    <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                      <input type="radio" className="h-5 w-5" name="tier" checked={!f.tier_key} onChange={() => set({ tier_key: '' })} />
                      Custom price
                    </label>
                  ) : null}
                  {f.tier_key && !fits.some((t) => t.key === f.tier_key) ? <p className="text-ui-sm text-danger">This home doesn’t fit that tier any more.</p> : null}
                  {!f.tier_key ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Field label="Price ($)">{(a) => <Input {...a} inputMode="decimal" className="text-base" placeholder="45.00" value={f.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
                      <Field label="Billed">
                        {(a) => (
                          <Select {...a} className="text-base" value={f.billing_basis} onChange={(e) => set({ billing_basis: e.target.value as BillingBasis })}>
                            {(Object.keys(BILLING_BASIS_LABELS) as BillingBasis[]).map((b) => (
                              <option key={b} value={b}>{BILLING_BASIS_LABELS[b]}</option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                  ) : null}
                  <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                    <input type="checkbox" className="h-5 w-5" checked={f.taxable} onChange={(e) => set({ taxable: e.target.checked })} />
                    Charge sales tax on this plan
                  </label>
                </fieldset>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
                <Field label="Crew">
                  {(a) => (
                    <Select {...a} className="text-base" value={f.default_sub_id} onChange={(e) => set({ default_sub_id: e.target.value })}>
                      <option value="">No crew yet</option>
                      {d.crews.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Stop #" hint="Order on the crew’s day">{(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={999} className="text-base" value={f.route_position} onChange={(e) => set({ route_position: e.target.value })} />}</Field>
              </div>
              <StepsEditor value={f.steps} onChange={(steps) => set({ steps })} crews={d.crews} people={d.people} />
              <Field label="Notes for the crew (optional)">{(a) => <Textarea {...a} className="text-base" maxLength={2000} value={f.description} onChange={(e) => set({ description: e.target.value })} />}</Field>

              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving} disabled={!f.name.trim() || !f.property_id || !f.start_date}>
                  {editing.plan ? 'Next: see what changes' : 'Start plan'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}
