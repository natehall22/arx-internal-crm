'use client'

import * as React from 'react'

import { useOrgFeatures } from '@/hooks/useOrgFeatures'

import { Button, Input, Select } from '@/components/ui'
import {
  BILLING_BASIS_LABELS,
  billingBasisChoices,
  CONDITION_OPS,
  CONDITION_OP_LABELS,
  DEFAULT_STEP_RESULTS,
  RESULT_TONES,
  RESULT_TONE_CLASS,
  SERVICE_FREQUENCIES,
  SERVICE_FREQUENCY_LABELS,
  type BillingBasis,
  type ConditionOp,
  type PlanPricing,
  type PlanStep,
  type ResultTone,
  type Season,
  type ServiceFrequency,
} from '@/lib/service-plans'

/**
 * The editors a plan template and a plan share (one copy): seasons, price rules, follow-on steps. Each is controlled
 * (value + onChange) and validated on the server by lib/service-plans.ts (cleanSeasons / cleanPricing / cleanSteps).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TONE_WORDS: Record<ResultTone, string> = { good: 'Good (green)', watch: 'Watch (yellow)', bad: 'Needs work (red)', neutral: 'Plain' }
const box = 'flex flex-col gap-3 rounded-ui border border-surface-line p-3'
const legend = 'px-1 text-ui-sm font-semibold text-ink'

/** A key from a name: "Roof inspection" → roof_inspection (unique among `taken`). */
export function keyFrom(label: string, taken: string[]): string {
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'item').slice(0, 30)
  let k = base === 'service' ? 'service_step' : base
  for (let i = 2; taken.includes(k); i++) k = `${base}_${i}`
  return k
}

function MonthDay({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [m, d] = value.split('-').map(Number)
  const days = new Date(2024, m, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm font-semibold text-ink">{label}</span>
      <div className="flex gap-2">
        <Select aria-label={`${label} month`} value={m} className="text-base" onChange={(e) => onChange(`${pad(Number(e.target.value))}-${pad(Math.min(d, new Date(2024, Number(e.target.value), 0).getDate()))}`)}>
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </Select>
        <Select aria-label={`${label} day`} value={d} className="w-24 text-base" onChange={(e) => onChange(`${pad(m)}-${pad(Number(e.target.value))}`)}>
          {Array.from({ length: days }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Select>
      </div>
    </div>
  )
}

export function SeasonsEditor({ value, onChange }: { value: Season[]; onChange: (v: Season[]) => void }) {
  const set = (i: number, patch: Partial<Season>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <fieldset className={box}>
      <legend className={legend}>How often, by season</legend>
      {value.map((s, i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-surface-line pb-3 last:border-0 last:pb-0">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MonthDay label="From" value={s.from} onChange={(v) => set(i, { from: v })} />
            <MonthDay label="To" value={s.to} onChange={(v) => set(i, { to: v })} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="How often" className="max-w-xs text-base" value={s.frequency} onChange={(e) => set(i, { frequency: e.target.value as ServiceFrequency })}>
              {SERVICE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>{SERVICE_FREQUENCY_LABELS[f]}</option>
              ))}
            </Select>
            {value.length > 1 ? (
              <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                Remove season
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" className="self-start" disabled={value.length >= 12} onClick={() => onChange([...value, { from: '01-01', to: '01-31', frequency: 'monthly' }])}>
        + Add season
      </Button>
    </fieldset>
  )
}

/** Price rules (template editor): the questions asked about a home, the tiers and their rules, custom price on/off. */
export function PricingEditor({ value, onChange }: { value: PlanPricing; onChange: (v: PlanPricing) => void }) {
  const hourlyOn = useOrgFeatures().hourlyBilling
  const fieldKeys = value.fields.map((f) => f.key)
  type TierDraft = PlanPricing['tiers'][number] & { price: number | string }
  const setTier = (i: number, patch: Partial<TierDraft>) => onChange({ ...value, tiers: value.tiers.map((t, j) => (j === i ? ({ ...t, ...patch } as PlanPricing['tiers'][number]) : t)) })
  return (
    <fieldset className={box}>
      <legend className={legend}>Price</legend>
      <div className="flex flex-col gap-2">
        <p className="text-ui-sm font-semibold text-ink">Questions about the home (numbers)</p>
        {value.fields.map((f, i) => (
          <div key={f.key} className="flex flex-wrap items-center gap-2">
            <Input aria-label="Question" className="max-w-xs text-base" maxLength={60} value={f.label} onChange={(e) => onChange({ ...value, fields: value.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => onChange({ fields: value.fields.filter((_, j) => j !== i), tiers: value.tiers.map((t) => ({ ...t, conditions: t.conditions.filter((c) => c.field !== f.key) })), allowCustom: value.allowCustom })}>
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" className="self-start" disabled={value.fields.length >= 8} onClick={() => onChange({ ...value, fields: [...value.fields, { key: keyFrom('question', fieldKeys), label: '' }] })}>
          + Add question
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-ui-sm font-semibold text-ink">Price tiers (a home gets a tier when every rule holds)</p>
        {value.tiers.map((t, i) => (
          <div key={t.key} className="flex flex-col gap-2 rounded-ui bg-surface-subtle p-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_9rem]">
              <Input aria-label="Tier name" className="text-base" maxLength={60} value={t.label} onChange={(e) => setTier(i, { label: e.target.value })} />
              <Input aria-label="Tier price ($)" inputMode="decimal" className="text-base" placeholder="$" value={String(t.price ?? '')} onChange={(e) => setTier(i, { price: e.target.value as unknown as number })} />
              <Select aria-label="Tier billed" className="text-base" value={t.billingBasis} onChange={(e) => setTier(i, { billingBasis: e.target.value as BillingBasis })}>
                {billingBasisChoices(hourlyOn, t.billingBasis).map((b) => (
                  <option key={b} value={b}>{BILLING_BASIS_LABELS[b]}</option>
                ))}
              </Select>
            </div>
            {t.conditions.map((c, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <Select aria-label="Rule question" className="max-w-[12rem] text-base" value={c.field} onChange={(e) => setTier(i, { conditions: t.conditions.map((x, j) => (j === k ? { ...x, field: e.target.value } : x)) })}>
                  {value.fields.map((f) => (
                    <option key={f.key} value={f.key}>{f.label || 'Question'}</option>
                  ))}
                </Select>
                <Select aria-label="Rule" className="max-w-[9rem] text-base" value={c.op} onChange={(e) => setTier(i, { conditions: t.conditions.map((x, j) => (j === k ? { ...x, op: e.target.value as ConditionOp } : x)) })}>
                  {CONDITION_OPS.map((o) => (
                    <option key={o} value={o}>{CONDITION_OP_LABELS[o]}</option>
                  ))}
                </Select>
                <Input aria-label="Rule value" inputMode="decimal" className="w-24 text-base" value={String(c.value)} onChange={(e) => setTier(i, { conditions: t.conditions.map((x, j) => (j === k ? { ...x, value: e.target.value as unknown as number } : x)) })} />
                <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => setTier(i, { conditions: t.conditions.filter((_, j) => j !== k) })}>Remove</Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={!value.fields.length || t.conditions.length >= 8} onClick={() => setTier(i, { conditions: [...t.conditions, { field: value.fields[0].key, op: 'lte', value: 0 }] })}>+ Add rule</Button>
              <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => onChange({ ...value, tiers: value.tiers.filter((_, j) => j !== i) })}>Remove tier</Button>
            </div>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" className="self-start" disabled={value.tiers.length >= 10} onClick={() => onChange({ ...value, tiers: [...value.tiers, { key: keyFrom('tier', value.tiers.map((t) => t.key)), label: '', price: '' as unknown as number, billingBasis: 'per_visit', conditions: [] }] })}>
          + Add price tier
        </Button>
      </div>
      <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
        <input type="checkbox" className="h-5 w-5" checked={value.allowCustom} onChange={(e) => onChange({ ...value, allowCustom: e.target.checked })} />
        Allow a custom price (homes outside the tiers)
      </label>
    </fieldset>
  )
}

/** Follow-on steps after each visit (cleaning → inspection), who does them, and their result options. */
export function StepsEditor({ value, onChange, crews, people }: { value: PlanStep[]; onChange: (v: PlanStep[]) => void; crews: Array<{ id: string; name: string }>; people: Array<{ id: string; name: string }> }) {
  const set = (i: number, patch: Partial<PlanStep>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <fieldset className={box}>
      <legend className={legend}>After each visit</legend>
      {value.length === 0 ? <p className="text-ui-base text-ink">No follow-on steps.</p> : null}
      {value.map((s, i) => (
        <div key={s.key} className="flex flex-col gap-2 rounded-ui bg-surface-subtle p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem]">
            <Input aria-label="Step name" className="text-base" maxLength={60} placeholder="Roof inspection" value={s.label} onChange={(e) => set(i, { label: e.target.value })} />
            <Input aria-label="Days after" type="number" inputMode="numeric" min={0} max={60} className="text-base" value={s.daysAfter} onChange={(e) => set(i, { daysAfter: Number(e.target.value) })} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr]">
            <Select aria-label="Done by" className="text-base" value={s.assignTo} onChange={(e) => set(i, { assignTo: e.target.value as PlanStep['assignTo'], userId: null, subId: null })}>
              <option value="person">A person</option>
              <option value="crew">A crew</option>
            </Select>
            <Select
              aria-label="Who"
              className="text-base"
              value={(s.assignTo === 'person' ? s.userId : s.subId) ?? ''}
              onChange={(e) => set(i, s.assignTo === 'person' ? { userId: e.target.value || null } : { subId: e.target.value || null })}
            >
              <option value="">Pick on each visit</option>
              {(s.assignTo === 'person' ? people : crews).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
          <p className="text-ui-sm font-semibold text-ink">Results to pick when it’s done {s.results.length ? '' : '(none — just “done”)'}</p>
          {s.results.map((r, k) => (
            <div key={r.key} className="flex flex-wrap items-center gap-2">
              <span className={`h-6 w-6 rounded-full ${RESULT_TONE_CLASS[r.tone]}`} aria-hidden />
              <Input aria-label="Result name" className="max-w-xs text-base" maxLength={60} value={r.label} onChange={(e) => set(i, { results: s.results.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
              <Select aria-label="Result color" className="max-w-[11rem] text-base" value={r.tone} onChange={(e) => set(i, { results: s.results.map((x, j) => (j === k ? { ...x, tone: e.target.value as ResultTone } : x)) })}>
                {RESULT_TONES.map((t) => (
                  <option key={t} value={t}>{TONE_WORDS[t]}</option>
                ))}
              </Select>
              <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => set(i, { results: s.results.filter((_, j) => j !== k) })}>Remove</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={s.results.length >= 8} onClick={() => set(i, { results: [...s.results, { key: keyFrom('result', s.results.map((x) => x.key)), label: '', tone: 'neutral' }] })}>+ Add result</Button>
            <Button type="button" size="sm" variant="ghost" className="underline" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove step</Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={value.length >= 5}
        onClick={() => onChange([...value, { key: keyFrom('inspection', value.map((x) => x.key)), label: 'Inspection', daysAfter: 1, assignTo: 'person', userId: null, subId: null, results: DEFAULT_STEP_RESULTS.map((r) => ({ ...r })) }])}
      >
        + Add follow-on step
      </Button>
    </fieldset>
  )
}
