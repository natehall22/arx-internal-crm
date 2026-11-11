'use client'

import * as React from 'react'

import { useOrgFeatures } from '@/hooks/useOrgFeatures'

import { Button, Field, Input, Select, Textarea } from '@/components/ui'
import { SeasonsEditor, StepsEditor } from '@/components/service-plans/PlanSpecEditors'
import { formatMoney } from '@/lib/format'
import {
  BILLING_BASIS_LABELS,
  billingBasisChoices,
  WEEKDAY_LABELS,
  eligibleTiers,
  planWeekday,
  scheduleSummary,
  tierCheck,
  type BillingBasis,
  type PlanPricing,
  type PlanStep,
  type Season,
  type ServicePlan,
  type ServicePlanTemplate,
} from '@/lib/service-plans'

/**
 * The ONE plan form (Customer File → Service plans, and "New customer + plan" on the Visits board / customers list).
 * A new plan from a plan type shows ~4 fields and one summary line; "Change" opens everything (seasons, steps, price
 * rules, stop #, notes). Editing a plan shows everything, plus "New price starts on". Key it on the plan type
 * (`key={f.template_id}`) so a new plan type starts tidy again.
 */

export type PlanRow = ServicePlan & { priceHidden?: boolean }
export type Option = { id: string; name: string }
export type PlanEditorOptions = {
  prices: boolean
  properties: Option[]
  trades: Array<{ slug: string; label: string }>
  crews: Option[]
  people: Option[]
  templates: ServicePlanTemplate[]
}

export type PlanFormValues = {
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
  /** Editing only: the day a changed price starts (empty = from the next visit). */
  price_starts_on: string
  billing_basis: BillingBasis
  taxable: boolean
  default_sub_id: string
  route_position: string
  steps: PlanStep[]
}

export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function formFromTemplate(t: ServicePlanTemplate | null, d: PlanEditorOptions): PlanFormValues {
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
    price_starts_on: '',
    billing_basis: t?.billing_basis ?? 'per_visit',
    taxable: t?.taxable ?? false,
    default_sub_id: '',
    route_position: '',
    steps: t ? clone(t.steps) : [],
  }
}

export function formFromPlan(p: PlanRow): PlanFormValues {
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
    price_starts_on: '',
    billing_basis: p.billing_basis,
    taxable: p.taxable,
    default_sub_id: p.default_sub_id ?? '',
    route_position: p.route_position != null ? String(p.route_position) : '',
    steps: clone(p.steps),
  }
}

export function bodyFrom(f: PlanFormValues, isNew: boolean): Record<string, unknown> {
  const inputs = Object.fromEntries(Object.entries(f.pricing_inputs).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]))
  return {
    ...(isNew ? { template_id: f.template_id || undefined, trade: f.trade } : {}),
    ...(!isNew && f.price_starts_on ? { price_starts_on: f.price_starts_on } : {}),
    name: f.name,
    description: f.description,
    ...(f.property_id ? { property_id: f.property_id } : {}),
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

/** Can the form be sent (the server checks everything again)? */
export function planFormReady(f: PlanFormValues, needsProperty: boolean): boolean {
  return !!f.name.trim() && !!f.start_date && (!needsProperty || !!f.property_id)
}

function numericInputs(f: PlanFormValues): Record<string, number> {
  return Object.fromEntries(Object.entries(f.pricing_inputs).filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]))
}

/** "Every week Apr–Oct · Tuesdays · $45.00 per visit · then Inspection" — what a new plan from a plan type will do. */
function summaryLine(f: PlanFormValues, d: PlanEditorOptions): string {
  const weekday = planWeekday({ preferred_weekday: f.preferred_weekday === '' ? null : Number(f.preferred_weekday), start_date: f.start_date || todayLocal() })
  const tier = f.pricing.tiers.find((t) => t.key === f.tier_key)
  const price = !d.prices
    ? null
    : tier
      ? `${tier.label} ${formatMoney(tier.price)} ${BILLING_BASIS_LABELS[tier.billingBasis]}`
      : f.price.trim()
        ? `${formatMoney(Number(f.price))} ${BILLING_BASIS_LABELS[f.billing_basis]}`
        : null
  return [scheduleSummary(f.seasons), `${WEEKDAY_LABELS[weekday]}s`, price, f.steps.length ? `then ${f.steps.map((s) => s.label).join(', ')}` : null].filter(Boolean).join(' · ')
}

export function PlanFields({
  d,
  f,
  set,
  onTemplate,
  plan,
}: {
  d: PlanEditorOptions
  f: PlanFormValues
  set: (patch: Partial<PlanFormValues>) => void
  /** New plans: the plan type changed (the caller rebuilds the form from it). */
  onTemplate?: (t: ServicePlanTemplate | null) => void
  /** The plan being edited (null = new). */
  plan: PlanRow | null
}) {
  const hourlyOn = useOrgFeatures().hourlyBilling
  const isNew = !plan
  const [details, setDetails] = React.useState(!isNew || !f.template_id)
  const inputs = numericInputs(f)
  const fits = eligibleTiers(f.pricing, inputs)
  const priceChanged = !!plan && (f.tier_key !== (plan.tier_key ?? '') || (!f.tier_key && f.price !== (plan.price != null ? String(plan.price) : '')))
  // A plan type whose price still needs an answer (a tier to pick or a price to type) shows the price box even when tidy.
  // Decided once per plan type (the caller keys this component on it) so the box doesn't vanish while someone types.
  const [priceNeeded] = React.useState(() => d.prices && !f.tier_key && !f.price.trim())
  const priceOpen = details || priceNeeded

  const priceBox = d.prices ? (
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
        const check = tierCheck(f.pricing, t, inputs)
        return (
          <label key={t.key} className="flex min-h-tap flex-wrap items-center gap-2 text-ui-base text-ink">
            <input type="radio" className="h-5 w-5" name="tier" checked={f.tier_key === t.key} disabled={!check.ok} onChange={() => set({ tier_key: t.key })} />
            {t.label}: {formatMoney(t.price)} {BILLING_BASIS_LABELS[t.billingBasis]}
            {!check.ok ? <span className="text-ui-sm">— {check.reason}</span> : null}
          </label>
        )
      })}
      {f.pricing.allowCustom && f.pricing.tiers.length ? (
        <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
          <input type="radio" className="h-5 w-5" name="tier" checked={!f.tier_key} onChange={() => set({ tier_key: '' })} />
          Custom price
        </label>
      ) : null}
      {f.tier_key && !fits.some((t) => t.key === f.tier_key) ? <p className="text-ui-sm text-danger">This home doesn’t fit that tier any more.</p> : null}
      {!f.tier_key ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={f.billing_basis === 'per_hour' ? 'Labor rate per hour ($)' : 'Price ($)'}>{(a) => <Input {...a} inputMode="decimal" className="text-base" placeholder="45.00" value={f.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
          {details ? (
            <Field label="Billed">
              {(a) => (
                <Select {...a} className="text-base" value={f.billing_basis} onChange={(e) => set({ billing_basis: e.target.value as BillingBasis })}>
                  {billingBasisChoices(hourlyOn, f.billing_basis).map((b) => (
                    <option key={b} value={b}>{BILLING_BASIS_LABELS[b]}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
      {plan ? (
        <Field label="New price starts on" hint={priceChanged ? 'Visits before this day keep the old price. Leave empty to change it from the next visit.' : 'Only used when you change the price.'}>
          {(a) => <Input {...a} type="date" className="text-base" min={todayLocal()} value={f.price_starts_on} onChange={(e) => set({ price_starts_on: e.target.value })} />}
        </Field>
      ) : null}
      {details ? (
        <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
          <input type="checkbox" className="h-5 w-5" checked={f.taxable} onChange={(e) => set({ taxable: e.target.checked })} />
          Charge sales tax on this plan
        </label>
      ) : null}
    </fieldset>
  ) : null

  return (
    <>
      {isNew ? (
        <Field label="Plan type">
          {(a) => (
            <Select {...a} className="text-base" value={f.template_id} onChange={(e) => onTemplate?.(d.templates.find((x) => x.id === e.target.value) ?? null)}>
              {d.templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              <option value="">Something else (set it up here)</option>
            </Select>
          )}
        </Field>
      ) : null}
      {details ? <Field label="Plan name *">{(a) => <Input {...a} className="text-base" maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field> : null}
      {d.properties.length > 1 || (!isNew && d.properties.length) ? (
          <Field label="Property *">
            {(a) => (
              <Select {...a} className="text-base" value={f.property_id} onChange={(e) => set({ property_id: e.target.value })}>
                {d.properties.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      {isNew && !f.template_id ? (
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
      </div>
      {priceOpen ? priceBox : null}

      {!details ? (
        <div className="flex flex-wrap items-center gap-2 rounded-ui bg-surface-subtle px-3 py-2">
          <p className="min-w-0 flex-1 break-words text-ui-base text-ink">{summaryLine(f, d)}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => setDetails(true)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ends (optional)">{(a) => <Input {...a} type="date" className="text-base" value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} />}</Field>
            <Field label="Visit day">
              {(a) => (
                <Select {...a} className="text-base" value={f.preferred_weekday} onChange={(e) => set({ preferred_weekday: e.target.value })}>
                  <option value="">Same as start date</option>
                  {WEEKDAY_LABELS.map((w, i) => (
                    <option key={w} value={i}>{w}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <SeasonsEditor value={f.seasons} onChange={(seasons) => set({ seasons })} />
          <Field label="Stop #" hint="Order on the crew’s day">{(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={999} className="text-base" value={f.route_position} onChange={(e) => set({ route_position: e.target.value })} />}</Field>
          <StepsEditor value={f.steps} onChange={(steps) => set({ steps })} crews={d.crews} people={d.people} />
          <Field label="Notes for the crew (optional)">{(a) => <Textarea {...a} className="text-base" maxLength={2000} value={f.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
        </>
      )}
    </>
  )
}
