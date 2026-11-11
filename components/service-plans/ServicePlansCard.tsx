'use client'

import * as React from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { formatDateShort, formatMoney } from '@/lib/format'
import {
  BILLING_BASIS_LABELS,
  DEFAULT_LAWN_SEASONS,
  SERVICE_FREQUENCIES,
  SERVICE_FREQUENCY_LABELS,
  WEEKDAY_LABELS,
  planWeekday,
  seasonLabel,
  standardTierCheck,
  type BillingBasis,
  type Season,
  type ServiceFrequency,
  type ServicePlan,
  type StandardTierRule,
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
  standardTier: (Omit<StandardTierRule, 'price'> & { price: number | null }) | null
}

type Form = {
  name: string
  description: string
  property_id: string
  trade: string
  start_date: string
  end_date: string
  preferred_weekday: string
  seasons: Season[]
  price_tier: 'standard' | 'custom'
  price: string
  billing_basis: BillingBasis
  taxable: boolean
  stories: string
  pitch_rise: string
  default_sub_id: string
  route_position: string
  follow_up: boolean
  follow_up_days: string
  follow_up_user_id: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STATUS_TONE = { active: 'success', paused: 'warning', ended: 'neutral' } as const

function formFrom(p: PlanRow | null, d: Load, today: string): Form {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    property_id: p?.property_id ?? d.properties[0]?.id ?? '',
    trade: p?.trade ?? d.trades[0]?.slug ?? '',
    start_date: p?.start_date ?? today,
    end_date: p?.end_date ?? '',
    preferred_weekday: p ? String(planWeekday(p)) : '',
    seasons: p?.seasons?.length ? p.seasons.map((s) => ({ ...s })) : [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
    price_tier: p?.price_tier ?? 'custom',
    price: p?.price != null ? String(p.price) : '',
    billing_basis: p?.billing_basis ?? 'per_visit',
    taxable: p?.taxable ?? false,
    stories: p?.stories != null ? String(p.stories) : '',
    pitch_rise: p?.pitch_rise != null ? String(p.pitch_rise) : '',
    default_sub_id: p?.default_sub_id ?? '',
    route_position: p?.route_position != null ? String(p.route_position) : '',
    follow_up: p?.follow_up === 'inspection',
    follow_up_days: p?.follow_up_days != null ? String(p.follow_up_days) : '1',
    follow_up_user_id: p?.follow_up_user_id ?? '',
  }
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "MM-DD" ↔ month + day pickers. */
function MonthDay({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [m, d] = value.split('-').map(Number)
  const days = new Date(2024, m, 0).getDate()
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm font-semibold text-ink">{label}</span>
      <div className="flex gap-2">
        <Select aria-label={`${label} month`} value={m} onChange={(e) => onChange(`${String(e.target.value).padStart(2, '0')}-${String(Math.min(d, new Date(2024, Number(e.target.value), 0).getDate())).padStart(2, '0')}`)} className="text-base">
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </Select>
        <Select aria-label={`${label} day`} value={d} onChange={(e) => onChange(`${String(m).padStart(2, '0')}-${String(e.target.value).padStart(2, '0')}`)} className="w-24 text-base">
          {Array.from({ length: days }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Select>
      </div>
    </div>
  )
}

/**
 * Customer File → Service plans: recurring work at one of the customer's properties (weekly mowing, roof &
 * gutter cleaning). Visits go on the calendar by themselves (Jobs → Schedule → Visits). Only shown when the company has
 * service plans switched on; reads and saves through /api/customers/[id]/service-plans and /api/service-plans/[id].
 */
export default function ServicePlansCard({ customerId }: { customerId: string }) {
  const [data, setData] = React.useState<Load | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ plan: PlanRow | null; form: Form } | null>(null)
  const [pausing, setPausing] = React.useState<{ plan: PlanRow; until: string } | null>(null)
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

  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setSaving(true)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setSaving(false)
    if (!res || !res.ok) {
      toast.error(out.error || 'Could not save')
      return false
    }
    await load()
    return true
  }

  async function save() {
    if (!editing) return
    const f = editing.form
    const body: Record<string, unknown> = {
      name: f.name,
      description: f.description,
      property_id: f.property_id,
      start_date: f.start_date,
      end_date: f.end_date || null,
      preferred_weekday: f.preferred_weekday === '' ? null : Number(f.preferred_weekday),
      seasons: f.seasons,
      price_tier: f.price_tier,
      price: f.price_tier === 'custom' ? f.price : null,
      billing_basis: f.billing_basis,
      taxable: f.taxable,
      stories: f.stories,
      pitch_rise: f.pitch_rise,
      default_sub_id: f.default_sub_id || null,
      route_position: f.route_position,
      follow_up: f.follow_up ? 'inspection' : null,
      follow_up_days: f.follow_up_days,
      follow_up_user_id: f.follow_up_user_id || null,
    }
    if (!editing.plan) body.trade = f.trade
    else body.expectedUpdatedAt = editing.plan.updated_at
    const ok = editing.plan ? await send(`/api/service-plans/${editing.plan.id}`, 'PATCH', body) : await send(`/api/customers/${customerId}/service-plans`, 'POST', body)
    if (ok) {
      toast.success(editing.plan ? 'Plan saved — upcoming visits updated' : 'Plan started — visits are on the calendar')
      setEditing(null)
    }
  }

  const set = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))
  const tierCheck = editing ? standardTierCheck(d.standardTier ? { ...d.standardTier, price: d.standardTier.price ?? 0 } : null, { stories: editing.form.stories === '' ? null : Number(editing.form.stories), pitch_rise: editing.form.pitch_rise === '' ? null : Number(editing.form.pitch_rise) }) : null
  const nameOf = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.name ?? null
  const tradeName = (slug: string) => d.trades.find((t) => t.slug === slug)?.label ?? slug

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service plans</CardTitle>
        {d.canEdit && d.properties.length > 0 ? (
          <Button size="sm" onClick={() => setEditing({ plan: null, form: formFrom(null, d, todayLocal()) })}>
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
                <p className="text-ui-base text-ink">
                  {[tradeName(p.trade), nameOf(d.properties, p.property_id), `${WEEKDAY_LABELS[planWeekday(p)]}s`].filter(Boolean).join(' · ')}
                </p>
                <ul className="text-ui-sm text-ink">
                  {p.seasons.map((s, i) => (
                    <li key={i}>{seasonLabel(s)}</li>
                  ))}
                </ul>
                <p className="text-ui-sm text-ink">
                  {p.priceHidden ? null : p.price != null ? `${formatMoney(p.price)} ${BILLING_BASIS_LABELS[p.billing_basis]}${p.price_tier === 'standard' ? ' (standard)' : ''}${p.taxable ? ' + tax' : ''} · ` : 'No price · '}
                  {nameOf(d.crews, p.default_sub_id) ?? 'No crew yet'}
                  {p.follow_up === 'inspection' ? ` · inspection ${p.follow_up_days ?? 0} day${p.follow_up_days === 1 ? '' : 's'} after${nameOf(d.people, p.follow_up_user_id) ? ` by ${nameOf(d.people, p.follow_up_user_id)}` : ''}` : ''}
                  {p.end_date && p.status !== 'ended' ? ` · ends ${formatDateShort(p.end_date)}` : ''}
                </p>
                {d.canEdit && p.status !== 'ended' ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ plan: p, form: formFrom(p, d, todayLocal()) })}>
                      Edit
                    </Button>
                    {p.status === 'paused' ? (
                      <Button size="sm" variant="secondary" loading={saving} onClick={() => void send(`/api/service-plans/${p.id}`, 'PATCH', { action: 'resume' }).then((ok) => ok && toast.success('Plan resumed'))}>
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
                        const ok = await confirmDialog({ title: `End “${p.name}”?`, description: 'Visits after today come off the calendar. Past visits stay.', confirmLabel: 'End plan', destructive: true })
                        if (ok && (await send(`/api/service-plans/${p.id}`, 'PATCH', { action: 'end' }))) toast.success('Plan ended')
                      }}
                    >
                      End plan
                    </Button>
                  </div>
                ) : null}
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
              <Button variant="secondary" disabled={saving} onClick={() => setPausing(null)}>Cancel</Button>
              <Button loading={saving} onClick={() => void send(`/api/service-plans/${pausing.plan.id}`, 'PATCH', { action: 'pause', until: pausing.until || null }).then((ok) => ok && (setPausing(null), toast.success('Plan paused')))}>
                Pause plan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {editing ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setEditing(null)}>
          <DialogContent title={editing.plan ? 'Edit service plan' : 'New service plan'} description={editing.plan ? 'Upcoming visits that haven’t happened follow your changes. Done and skipped visits never change.' : 'Visits go on the calendar for the next 6 weeks, and keep coming.'}>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <Field label="Plan name *">{(a) => <Input {...a} className="text-base" maxLength={120} placeholder="Weekly mowing" value={editing.form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label="Property *">
                {(a) => (
                  <Select {...a} className="text-base" value={editing.form.property_id} onChange={(e) => set({ property_id: e.target.value })}>
                    {d.properties.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
              {!editing.plan ? (
                <Field label="Service type *">
                  {(a) => (
                    <Select {...a} className="text-base" value={editing.form.trade} onChange={(e) => set({ trade: e.target.value })}>
                      {d.trades.map((t) => (
                        <option key={t.slug} value={t.slug}>{t.label}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Starts *">{(a) => <Input {...a} type="date" className="text-base" value={editing.form.start_date} onChange={(e) => set({ start_date: e.target.value })} />}</Field>
                <Field label="Ends (optional)">{(a) => <Input {...a} type="date" className="text-base" value={editing.form.end_date} onChange={(e) => set({ end_date: e.target.value })} />}</Field>
              </div>
              <Field label="Visit day" hint="Empty = the weekday the plan starts on.">
                {(a) => (
                  <Select {...a} className="text-base" value={editing.form.preferred_weekday} onChange={(e) => set({ preferred_weekday: e.target.value })}>
                    <option value="">Same as start date</option>
                    {WEEKDAY_LABELS.map((w, i) => (
                      <option key={w} value={i}>{w}</option>
                    ))}
                  </Select>
                )}
              </Field>

              <fieldset className="flex flex-col gap-3 rounded-ui border border-surface-line p-3">
                <legend className="px-1 text-ui-sm font-semibold text-ink">How often, by season</legend>
                {editing.form.seasons.map((s, i) => (
                  <div key={i} className="flex flex-col gap-2 border-b border-surface-line pb-3 last:border-0 last:pb-0">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <MonthDay label="From" value={s.from} onChange={(v) => set({ seasons: editing.form.seasons.map((x, j) => (j === i ? { ...x, from: v } : x)) })} />
                      <MonthDay label="To" value={s.to} onChange={(v) => set({ seasons: editing.form.seasons.map((x, j) => (j === i ? { ...x, to: v } : x)) })} />
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Select aria-label="How often" className="max-w-xs text-base" value={s.frequency} onChange={(e) => set({ seasons: editing.form.seasons.map((x, j) => (j === i ? { ...x, frequency: e.target.value as ServiceFrequency } : x)) })}>
                        {SERVICE_FREQUENCIES.map((f) => (
                          <option key={f} value={f}>{SERVICE_FREQUENCY_LABELS[f]}</option>
                        ))}
                      </Select>
                      {editing.form.seasons.length > 1 ? (
                        <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => set({ seasons: editing.form.seasons.filter((_, j) => j !== i) })}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={editing.form.seasons.length >= 12} onClick={() => set({ seasons: [...editing.form.seasons, { from: '01-01', to: '01-31', frequency: 'monthly' }] })}>
                    + Add season
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => set({ seasons: DEFAULT_LAWN_SEASONS.map((x) => ({ ...x })) })}>
                    Use lawn seasons
                  </Button>
                </div>
              </fieldset>

              {d.prices ? (
                <fieldset className="flex flex-col gap-3 rounded-ui border border-surface-line p-3">
                  <legend className="px-1 text-ui-sm font-semibold text-ink">Price</legend>
                  {d.standardTier ? (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Stories">{(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={10} className="text-base" value={editing.form.stories} onChange={(e) => set({ stories: e.target.value })} />}</Field>
                        <Field label="Roof pitch (/12)">{(a) => <Input {...a} type="number" inputMode="decimal" min={0} max={24} step="0.5" className="text-base" value={editing.form.pitch_rise} onChange={(e) => set({ pitch_rise: e.target.value })} />}</Field>
                      </div>
                      <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                        <input type="radio" className="h-5 w-5" name="tier" checked={editing.form.price_tier === 'standard'} disabled={!tierCheck?.ok} onChange={() => set({ price_tier: 'standard' })} />
                        Standard: {d.standardTier.price != null ? `${formatMoney(d.standardTier.price)} ${BILLING_BASIS_LABELS[d.standardTier.billingBasis]}` : 'company price'}
                      </label>
                      {tierCheck && !tierCheck.ok ? <p className="text-ui-sm text-ink">{tierCheck.reason}</p> : null}
                      <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                        <input type="radio" className="h-5 w-5" name="tier" checked={editing.form.price_tier === 'custom'} onChange={() => set({ price_tier: 'custom' })} />
                        Custom price
                      </label>
                    </div>
                  ) : null}
                  {editing.form.price_tier === 'custom' || !d.standardTier ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Field label="Price ($)">{(a) => <Input {...a} inputMode="decimal" className="text-base" placeholder="45.00" value={editing.form.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
                      <Field label="Billed">
                        {(a) => (
                          <Select {...a} className="text-base" value={editing.form.billing_basis} onChange={(e) => set({ billing_basis: e.target.value as BillingBasis })}>
                            {(Object.keys(BILLING_BASIS_LABELS) as BillingBasis[]).map((b) => (
                              <option key={b} value={b}>{BILLING_BASIS_LABELS[b]}</option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                  ) : null}
                  <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                    <input type="checkbox" className="h-5 w-5" checked={editing.form.taxable} onChange={(e) => set({ taxable: e.target.checked })} />
                    Charge sales tax on this plan
                  </label>
                </fieldset>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
                <Field label="Crew">
                  {(a) => (
                    <Select {...a} className="text-base" value={editing.form.default_sub_id} onChange={(e) => set({ default_sub_id: e.target.value })}>
                      <option value="">No crew yet</option>
                      {d.crews.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Stop #" hint="Order on the crew’s day">{(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={999} className="text-base" value={editing.form.route_position} onChange={(e) => set({ route_position: e.target.value })} />}</Field>
              </div>

              <fieldset className="flex flex-col gap-2 rounded-ui border border-surface-line p-3">
                <legend className="px-1 text-ui-sm font-semibold text-ink">After each visit</legend>
                <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                  <input type="checkbox" className="h-5 w-5" checked={editing.form.follow_up} onChange={(e) => set({ follow_up: e.target.checked })} />
                  Send someone to inspect (green / yellow / red)
                </label>
                {editing.form.follow_up ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
                    <Field label="Days after">{(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={30} className="text-base" value={editing.form.follow_up_days} onChange={(e) => set({ follow_up_days: e.target.value })} />}</Field>
                    <Field label="Inspector">
                      {(a) => (
                        <Select {...a} className="text-base" value={editing.form.follow_up_user_id} onChange={(e) => set({ follow_up_user_id: e.target.value })}>
                          <option value="">Pick later</option>
                          {d.people.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                ) : null}
              </fieldset>

              <Field label="Notes for the crew (optional)">{(a) => <Textarea {...a} className="text-base" maxLength={2000} value={editing.form.description} onChange={(e) => set({ description: e.target.value })} />}</Field>

              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" loading={saving} disabled={!editing.form.name.trim() || !editing.form.property_id || !editing.form.start_date}>
                  {editing.plan ? 'Save plan' : 'Start plan'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}
