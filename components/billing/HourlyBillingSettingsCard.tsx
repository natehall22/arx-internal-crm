'use client'

import * as React from 'react'

import { Button, Card, Field, Input, Select } from '@/components/ui'
import { formatCurrency } from '@/lib/job-payments'
import {
  BILL_BASES,
  BILL_BASIS_LABELS,
  ROUNDINGS,
  ROUNDING_LABELS,
  TRAVEL_LABELS,
  TRAVEL_RULES,
  type BillBasis,
  type HourlyBillingSettings,
  type Rounding,
  type TravelRule,
} from '@/lib/hourly-billing'

type Load = { settings: HourlyBillingSettings; tripChoices: Array<{ id: string; name: string; rateCents: number }> }

/**
 * Owners: how hours become invoice lines (Settings → Hourly billing). Pay is never affected — payroll keeps the exact
 * minutes the crew clocked.
 */
export default function HourlyBillingSettingsCard() {
  const [data, setData] = React.useState<Load | null>(null)
  const [s, setS] = React.useState<HourlyBillingSettings | null>(null)
  const [minimum, setMinimum] = React.useState('')
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void fetch('/api/admin/hourly-billing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Load | null) => {
        if (!d) return
        setData(d)
        setS(d.settings)
        setMinimum(String(d.settings.minimumHours))
      })
  }, [])
  if (!data || !s) return null

  async function save() {
    if (!s) return
    setBusy(true)
    setMsg(null)
    const body = { hourlyBilling: { ...s, minimumHours: minimum.trim() === '' ? 0 : Number(minimum), tripChargeItemId: s.travel === 'trip_charge' ? s.tripChargeItemId : s.tripChargeItemId ?? null } }
    const res = await fetch('/api/admin/hourly-billing', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as Partial<Load> & { error?: string }
    setBusy(false)
    if (!res || !res.ok) return setMsg(out.error || 'Couldn’t save')
    if (out.settings) {
      setS(out.settings)
      setMinimum(String(out.settings.minimumHours))
    }
    setMsg('Saved')
  }

  const needsTrip = s.travel === 'trip_charge' && !s.tripChargeItemId
  return (
    <Card id="hourly-billing" className="flex flex-col gap-3 p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Hourly billing</h2>
      <p className="text-base">How crew and machine hours turn into invoice lines. Pay is never changed — payroll keeps the exact minutes.</p>
      <Field label="Rounding">
        {(a) => (
          <Select {...a} className="text-base" value={s.rounding} onChange={(e) => setS({ ...s, rounding: e.target.value as Rounding })}>
            {ROUNDINGS.map((r) => (
              <option key={r} value={r}>{ROUNDING_LABELS[r]}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Minimum hours per visit (0 = none)">
        {(a) => <Input {...a} inputMode="decimal" className="w-28 text-base" value={minimum} onChange={(e) => setMinimum(e.target.value)} />}
      </Field>
      <p className="-mt-2 text-sm">Each visit bills at least this many hours of labor, and of each machine used.</p>
      <Field label="Bill labor">
        {(a) => (
          <Select {...a} className="text-base" value={s.basis} onChange={(e) => setS({ ...s, basis: e.target.value as BillBasis })}>
            {BILL_BASES.map((b) => (
              <option key={b} value={b}>{BILL_BASIS_LABELS[b]}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Drive time">
        {(a) => (
          <Select {...a} className="text-base" value={s.travel} onChange={(e) => setS({ ...s, travel: e.target.value as TravelRule })}>
            {TRAVEL_RULES.map((t) => (
              <option key={t} value={t}>{TRAVEL_LABELS[t]}</option>
            ))}
          </Select>
        )}
      </Field>
      {s.travel === 'trip_charge' ? (
        <Field label="Trip charge (from your price book)">
          {(a) => (
            <Select {...a} className="text-base" value={s.tripChargeItemId ?? ''} onChange={(e) => setS({ ...s, tripChargeItemId: e.target.value || null })}>
              <option value="">Pick an item…</option>
              {data.tripChoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — {formatCurrency(i.rateCents)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <label className="flex min-h-[48px] items-center gap-3 text-base">
        <input type="checkbox" className="h-6 w-6" checked={s.equipmentFromOperator} onChange={(e) => setS({ ...s, equipmentFromOperator: e.target.checked })} />
        <span>
          <span className="font-semibold">Machine hours = the operator’s hours</span>
          <span className="block text-sm">Bill a machine for the time the person who started it worked at that stop (crews forget to stop machines). Off = the machine’s own on/off time.</span>
        </span>
      </label>
      {msg ? <p className="text-base font-semibold">{msg}</p> : null}
      <Button className="self-start" loading={busy} disabled={needsTrip} onClick={() => void save()}>
        {needsTrip ? 'Pick the trip charge' : 'Save'}
      </Button>
    </Card>
  )
}
