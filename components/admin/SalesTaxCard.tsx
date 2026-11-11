'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from '@/components/ui'
import { MAX_SALES_TAX_RATES, combinedTaxPercent, type SalesTaxRate, type SalesTaxSettings } from '@/lib/sales-tax'

type Draft = { id: string; name: string; percent: string; active: boolean; isDefault: boolean }

function newRateId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'rate'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

function toDrafts(s: SalesTaxSettings | null): Draft[] {
  return (s?.rates ?? []).map((r: SalesTaxRate) => ({
    id: r.id,
    name: r.name,
    percent: String(r.percent),
    active: r.active,
    isDefault: s?.defaultRateIds.includes(r.id) ?? false,
  }))
}

/**
 * Settings → Sales tax (owners only; the save is refused for anyone else). Rates stack: a quote or invoice gets one
 * line per rate. Saved whole through PATCH /api/admin/settings `type: 'salesTax'` (lib/sales-tax.ts).
 * `initial === null` = not set up yet: quotes still use one rate typed on each quote, invoices add no tax.
 */
export default function SalesTaxCard({ initial }: { initial: SalesTaxSettings | null }) {
  const [setUp, setSetUp] = useState(initial !== null)
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [rates, setRates] = useState<Draft[]>(toDrafts(initial))
  const [newName, setNewName] = useState('')
  const [newPercent, setNewPercent] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (id: string, patch: Partial<Draft>) => setRates((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  function addRate() {
    const name = newName.trim()
    if (!name) return toast.error('Give the rate a name, e.g. “State” or “Leon County”')
    if (newPercent.trim() === '' || !Number.isFinite(Number(newPercent))) return toast.error('Enter the percent, e.g. 7 or 1.5')
    const id = newRateId(name, new Set(rates.map((r) => r.id)))
    setRates((rs) => [...rs, { id, name, percent: newPercent.trim(), active: true, isDefault: rs.length === 0 }])
    setNewName('')
    setNewPercent('')
  }

  async function save() {
    setSaving(true)
    const salesTax = {
      enabled,
      rates: rates.map((r) => ({ id: r.id, name: r.name, percent: Number(r.percent), active: r.active })),
      defaultRateIds: rates.filter((r) => r.active && r.isDefault).map((r) => r.id),
    }
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'salesTax', salesTax }),
    }).catch(() => null)
    setSaving(false)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return toast.error((data as { error?: string }).error || 'Could not save')
    setSetUp(true)
    toast.success('Sales tax saved')
  }

  const defaults = rates.filter((r) => r.active && r.isDefault)
  const defaultTotal = combinedTaxPercent(defaults.map((r) => ({ percent: Number(r.percent) || 0 })))

  return (
    <Card id="sales-tax" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Sales tax</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">
          Add each rate you charge (for example state and county). Rates stack: a quote or invoice shows one line per rate.
          Price-book items say whether they are taxable, and you can change it on any line. Tax-exempt customers are never charged.
        </p>
        {!setUp && (
          <p className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-sm text-ink">
            Not set up yet: each quote uses the one rate typed on it, and invoices add no tax. Saving here switches new quotes and invoices to these rates; quotes already written keep their numbers.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ui-base font-semibold text-ink">
            Charge sales tax <span className={enabled ? 'text-brand-700' : 'text-danger'}>· {enabled ? 'On' : 'Off'}</span>
          </p>
          <Button variant={enabled ? 'secondary' : 'primary'} className="min-h-tap min-w-[7rem]" aria-pressed={enabled} onClick={() => setEnabled((v) => !v)}>
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>

        {enabled && (
          <>
            {rates.length === 0 ? (
              <p className="text-ui-sm text-ink">No rates yet — nothing is charged until you add one.</p>
            ) : (
              <ul className="divide-y divide-surface-line">
                {rates.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <Input aria-label="Rate name" value={r.name} maxLength={60} onChange={(e) => update(r.id, { name: e.target.value })} className="sm:flex-1" />
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`${r.name} percent`}
                        inputMode="decimal"
                        value={r.percent}
                        onChange={(e) => update(r.id, { percent: e.target.value })}
                        className="w-24 text-right"
                      />
                      <span className="text-ui-base text-ink">%</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex min-h-tap items-center gap-2 text-ui-sm text-ink">
                        <input type="checkbox" className="h-5 w-5" checked={r.isDefault && r.active} disabled={!r.active} onChange={(e) => update(r.id, { isDefault: e.target.checked })} />
                        On new quotes
                      </label>
                      <Button variant="secondary" className="min-h-tap" onClick={() => update(r.id, { active: !r.active, isDefault: r.active ? false : r.isDefault })}>
                        {r.active ? 'Retire' : 'Use again'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {defaults.length > 0 && (
              <p className="text-ui-sm text-ink">New quotes and invoices start with {defaults.map((r) => r.name).join(' + ')} = {defaultTotal}%.</p>
            )}
            {rates.length < MAX_SALES_TAX_RATES && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input aria-label="New rate name" placeholder="Rate name, e.g. State" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} className="sm:flex-1" />
                <div className="flex items-center gap-2">
                  <Input aria-label="New rate percent" placeholder="0.00" inputMode="decimal" value={newPercent} onChange={(e) => setNewPercent(e.target.value)} className="w-24 text-right" />
                  <span className="text-ui-base text-ink">%</span>
                </div>
                <Button variant="secondary" className="min-h-tap" onClick={addRate}>Add rate</Button>
              </div>
            )}
          </>
        )}

        <Button className="min-h-tap self-start" loading={saving} onClick={() => void save()}>Save sales tax</Button>
      </CardContent>
    </Card>
  )
}
