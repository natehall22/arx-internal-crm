'use client'

import * as React from 'react'

import { Button, Card, Field, Input, Select, toast } from '@/components/ui'
import { formatCurrency } from '@/lib/job-payments'
import { hoursLabel } from '@/lib/hourly-billing'

type Setup = {
  mode: 'fixed' | 'time_materials'
  estimatedHours: number | null
  rateItemId: string | null
  rateChoices: Array<{ id: string; name: string; rateCents: number; isLabor: boolean }>
  fromQuote: { estimatedHours: number | null; rateItemId: string | null; lines: Array<{ name: string; hours: number }> } | null
  billedHours: number
  canEdit: boolean
  canBill: boolean
}

/**
 * Job page: how this job is billed. "As sold" (the contract — every job until now) or "By the hour" (time & materials):
 * crew and machine hours go to Hours to bill. Turning it on fills the estimate and labor rate from the job's quote when
 * the quote had hourly lines. Hidden from people who can neither edit jobs nor record money (the API answers 403).
 */
export default function JobHourlyCard({ jobId }: { jobId: string }) {
  const [s, setS] = React.useState<Setup | null>(null)
  const [est, setEst] = React.useState('')
  const [rate, setRate] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const apply = (d: Setup) => {
    setS(d)
    setEst(d.estimatedHours != null ? hoursLabel(d.estimatedHours) : '')
    setRate(d.rateItemId ?? '')
  }
  React.useEffect(() => {
    void fetch(`/api/ops/jobs/${jobId}/hourly`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Setup | null) => d && apply(d))
  }, [jobId])
  if (!s) return null

  async function save(mode: Setup['mode'], estimate: string, rateItemId: string) {
    setBusy(true)
    const res = await fetch(`/api/ops/jobs/${jobId}/hourly`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, estimatedHours: estimate.trim() === '' ? null : Number(estimate), rateItemId: rateItemId || null }),
    }).catch(() => null)
    const body = (res ? await res.json().catch(() => ({})) : {}) as Partial<Setup> & { error?: string }
    setBusy(false)
    if (!res || !res.ok) return void toast.error(body.error || 'Couldn’t save')
    if (body.mode) apply(body as Setup)
    toast.success(mode === 'time_materials' ? 'Billed by the hour' : 'Billed as sold')
  }

  // Turning it on: start from the quote's hourly lines when there are any (one tap).
  const turnOn = () => {
    const q = s.fromQuote
    const e = est || (q?.estimatedHours != null ? hoursLabel(q.estimatedHours) : '')
    const r = rate || q?.rateItemId || s.rateChoices.find((c) => c.isLabor)?.id || ''
    void save('time_materials', e, r)
  }

  const hourly = s.mode === 'time_materials'
  const seg = (active: boolean) => `min-h-tap flex-1 rounded-ui px-3 text-ui-sm font-semibold ${active ? 'bg-brand-700 text-white' : 'border border-surface-line bg-surface text-ink'}`
  const rateRow = s.rateChoices.find((c) => c.id === s.rateItemId)
  return (
    <Card className="flex flex-col gap-3 p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Billing</h2>
      <div className="flex gap-2" role="group" aria-label="How this job is billed">
        <button type="button" className={seg(!hourly)} aria-pressed={!hourly} disabled={!s.canEdit || busy} onClick={() => hourly && void save('fixed', est, rate)}>
          As sold
        </button>
        <button type="button" className={seg(hourly)} aria-pressed={hourly} disabled={!s.canEdit || busy} onClick={() => !hourly && turnOn()}>
          By the hour
        </button>
      </div>
      {hourly ? (
        <>
          <p className="text-base">
            Billed {hoursLabel(s.billedHours)} h{s.estimatedHours != null ? ` of ${hoursLabel(s.estimatedHours)} h estimated` : ''}
            {rateRow ? ` · ${rateRow.name} ${formatCurrency(rateRow.rateCents)}/hr` : ''}
          </p>
          {!s.rateItemId ? <p className="text-base font-semibold text-danger">Pick the labor rate so hours can be billed.</p> : null}
          {s.canEdit ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
              <Field label="Estimated hours">{(a) => <Input {...a} inputMode="decimal" className="text-base" value={est} onChange={(e) => setEst(e.target.value)} />}</Field>
              <Field label="Labor rate">
                {(a) => (
                  <Select {...a} className="text-base" value={rate} onChange={(e) => setRate(e.target.value)}>
                    <option value="">Pick from your price book…</option>
                    {s.rateChoices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {formatCurrency(c.rateCents)}/hr
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="secondary" loading={busy} onClick={() => void save('time_materials', est, rate)}>
                Save
              </Button>
            </div>
          ) : null}
          {s.rateChoices.length === 0 ? <p className="text-sm">Add a price-book item priced “per hour” (e.g. Grading labor) to use as the rate.</p> : null}
          {s.fromQuote?.lines.length ? <p className="text-sm">Quote: {s.fromQuote.lines.map((l) => `${l.name} ${hoursLabel(l.hours)} h`).join(' · ')}</p> : null}
          {s.canBill ? (
            <a className="inline-flex min-h-tap items-center self-start font-semibold text-brand-800 underline" href="/billing?view=hours">
              Open Hours to bill
            </a>
          ) : null}
        </>
      ) : (
        <p className="text-sm">The contract amount is what’s billed. Choose “By the hour” for grading, tractor or clean-up work billed on time.</p>
      )}
    </Card>
  )
}
