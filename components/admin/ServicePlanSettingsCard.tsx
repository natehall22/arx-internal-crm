'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, toast } from '@/components/ui'
import { BILLING_BASIS_LABELS, type BillingBasis, type StandardTierRule } from '@/lib/service-plans'

/**
 * Settings → Service plan pricing (owners): the company's standard plan price and which homes qualify for it (e.g. ARX
 * Care: up to 3 stories, pitch up to 10/12). Plans outside it are priced by hand. PATCH /api/admin/settings
 * `service_plans` → orgs.settings.servicePlans.standardTier.
 */
export default function ServicePlanSettingsCard({ initial }: { initial: StandardTierRule | null }) {
  const [rule, setRule] = useState(initial)
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [basis, setBasis] = useState<BillingBasis>(initial?.billingBasis ?? 'per_month')
  const [stories, setStories] = useState(initial?.maxStories != null ? String(initial.maxStories) : '')
  const [pitch, setPitch] = useState(initial?.maxPitchRise != null ? String(initial.maxPitchRise) : '')
  const [saving, setSaving] = useState(false)

  async function save(standardTier: Record<string, unknown> | null) {
    setSaving(true)
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'service_plans', standardTier }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setSaving(false)
    if (!res || !res.ok) return toast.error(out.error || 'Could not save')
    setRule(standardTier ? { price: Number(price), billingBasis: basis, maxStories: stories ? Number(stories) : null, maxPitchRise: pitch ? Number(pitch) : null } : null)
    toast.success(standardTier ? 'Standard price saved' : 'Standard price removed')
  }

  return (
    <Card id="service-plans" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Service plan pricing</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ price, billingBasis: basis, maxStories: stories || null, maxPitchRise: pitch || null })
          }}
        >
          <p className="text-ui-base text-ink">
            {rule ? 'Homes inside these limits get the standard price; anything bigger or steeper gets a custom price.' : 'No standard price yet — every plan is priced by hand.'} Changing it only affects plans saved afterwards.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Standard price ($)">{(a) => <Input {...a} inputMode="decimal" className="text-base" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
            <Field label="Billed">
              {(a) => (
                <Select {...a} className="text-base" value={basis} onChange={(e) => setBasis(e.target.value as BillingBasis)}>
                  {(Object.keys(BILLING_BASIS_LABELS) as BillingBasis[]).map((b) => (
                    <option key={b} value={b}>{BILLING_BASIS_LABELS[b]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Most stories" hint="Empty = any">{(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={10} className="text-base" value={stories} onChange={(e) => setStories(e.target.value)} />}</Field>
            <Field label="Steepest pitch (/12)" hint="Empty = any">{(a) => <Input {...a} type="number" inputMode="decimal" min={0} max={24} step="0.5" className="text-base" value={pitch} onChange={(e) => setPitch(e.target.value)} />}</Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving} disabled={!price.trim()}>Save</Button>
            {rule ? (
              <Button type="button" variant="secondary" loading={saving} onClick={() => void save(null)}>Remove standard price</Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
