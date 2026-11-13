'use client'

import * as React from 'react'

import { Button, Card, Field, Input, Select } from '@/components/ui'
import { DEFAULT_CREW_INCENTIVE_SETTINGS, SPLIT_LABELS, SPLIT_MODES, type CrewIncentiveSettings, type SplitMode } from '@/lib/crew-incentives'

type Form = Record<string, string | boolean>

const toForm = (s: CrewIncentiveSettings): Form => ({
  enabled: s.enabled,
  drOn: s.doneRight.on, drAmount: String(s.doneRight.amount || ''), drSplit: s.doneRight.split, drHold: String(s.doneRight.holdDays), drPhotos: String(s.doneRight.minPhotos),
  btOn: s.beatTime.on, btMode: s.beatTime.mode, btAmount: String(s.beatTime.amount || ''), btPercent: String(s.beatTime.percent || ''), btRate: String(s.beatTime.ratePerHour || ''), btSplit: s.beatTime.split,
  rvOn: s.review.on, rvAmount: String(s.review.amount || ''), rvSplit: s.review.split,
  wtOn: s.weeklyTarget.on, wtBasis: s.weeklyTarget.basis, wtTarget: String(s.weeklyTarget.target || ''), wtAmount: String(s.weeklyTarget.amount || ''), wtSplit: s.weeklyTarget.split,
  ddOn: s.deduction.on, ddAmount: String(s.deduction.amount || ''), ddSplit: s.deduction.split,
})
const num = (v: unknown) => (String(v ?? '').trim() === '' ? 0 : Number(v))

/**
 * Owners of a lawn & landscape company: automatic crew bonus rules (Settings → Crew incentives). Every proposed bonus
 * lands on the Bonus approval screen as pending; nothing is paid until an owner approves it.
 */
export default function CrewIncentivesSettingsCard() {
  const [f, setF] = React.useState<Form | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void fetch('/api/admin/crew-incentives', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings: CrewIncentiveSettings } | null) => setF(toForm(d?.settings ?? DEFAULT_CREW_INCENTIVE_SETTINGS)))
  }, [])
  if (!f) return null
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v })

  async function save() {
    if (!f) return
    setBusy(true)
    setMsg(null)
    const body = {
      crewIncentives: {
        enabled: f.enabled,
        doneRight: { on: f.drOn, amount: num(f.drAmount), split: f.drSplit, holdDays: num(f.drHold), minPhotos: num(f.drPhotos) },
        beatTime: { on: f.btOn, mode: f.btMode, amount: num(f.btAmount), percent: num(f.btPercent), ratePerHour: num(f.btRate), split: f.btSplit },
        review: { on: f.rvOn, amount: num(f.rvAmount), split: f.rvSplit },
        weeklyTarget: { on: f.wtOn, basis: f.wtBasis, target: num(f.wtTarget), amount: num(f.wtAmount), split: f.wtSplit },
        deduction: { on: f.ddOn, amount: num(f.ddAmount), split: f.ddSplit },
      },
    }
    const res = await fetch('/api/admin/crew-incentives', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; settings?: CrewIncentiveSettings }
    setBusy(false)
    if (!res || !res.ok) return setMsg(out.error || 'Couldn’t save')
    if (out.settings) setF(toForm(out.settings))
    setMsg('Saved')
  }

  const splitSelect = (key: string, label = 'Split') => (
    <Field label={label}>
      {(a) => (
        <Select {...a} className="text-base" value={String(f[key])} onChange={(e) => set(key, e.target.value as SplitMode)}>
          {SPLIT_MODES.map((m) => (
            <option key={m} value={m}>{SPLIT_LABELS[m]}</option>
          ))}
        </Select>
      )}
    </Field>
  )
  const money = (key: string, label: string) => (
    <Field label={label}>{(a) => <Input {...a} inputMode="decimal" className="w-32 text-base" placeholder="0.00" value={String(f[key])} onChange={(e) => set(key, e.target.value)} />}</Field>
  )
  const toggle = (key: string, title: string, help: string) => (
    <label className="flex min-h-[48px] items-start gap-3 text-base">
      <input type="checkbox" className="mt-1 h-6 w-6" checked={f[key] === true} onChange={(e) => set(key, e.target.checked)} />
      <span>
        <span className="font-semibold">{title}</span>
        <span className="block text-sm">{help}</span>
      </span>
    </label>
  )
  const box = 'flex flex-col gap-2 rounded-ui border border-surface-line p-3'

  return (
    <Card id="crew-incentives" className="flex flex-col gap-3 p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Crew incentives</h2>
      <p className="text-base">Bonus rules for your crews. Each one proposes bonuses on its own; every line waits on Bonus approval and nothing is paid until an owner approves it. A rule only pays for work finished after it was turned on; nothing is paid back for earlier work.</p>
      {toggle('enabled', 'Crew incentives are on', 'Off = no bonuses are proposed and crews see no scoreboard.')}

      <div className={box}>
        {toggle('drOn', 'Visit done right', 'A bonus for each finished visit or work order with its done photos and no callback.')}
        {f.drOn ? (
          <>
            {money('drAmount', 'Bonus per visit ($)')}
            <Field label="Days to wait for a callback">{(a) => <Input {...a} inputMode="numeric" className="w-24 text-base" value={String(f.drHold)} onChange={(e) => set('drHold', e.target.value)} />}</Field>
            <Field label="Photos a visit needs">{(a) => <Input {...a} inputMode="numeric" className="w-24 text-base" value={String(f.drPhotos)} onChange={(e) => set('drPhotos', e.target.value)} />}</Field>
            <p className="text-sm">A job’s work order needs its four walk-around photos instead.</p>
            {splitSelect('drSplit')}
          </>
        ) : null}
      </div>

      <div className={box}>
        {toggle('btOn', 'Beat the time', 'When the time on site (first clock-in to last clock-out) comes in under the hours on the work order (or the job, when it has one work order).')}
        {f.btOn ? (
          <>
            <Field label="Bonus is">
              {(a) => (
                <Select {...a} className="text-base" value={String(f.btMode)} onChange={(e) => set('btMode', e.target.value)}>
                  <option value="flat">A flat amount</option>
                  <option value="percent">A percent of the hours saved × an hourly value</option>
                </Select>
              )}
            </Field>
            {f.btMode === 'flat' ? (
              money('btAmount', 'Flat bonus ($)')
            ) : (
              <>
                <Field label="Percent of the value of the hours saved">{(a) => <Input {...a} inputMode="decimal" className="w-24 text-base" value={String(f.btPercent)} onChange={(e) => set('btPercent', e.target.value)} />}</Field>
                {money('btRate', 'Value of one hour ($)')}
              </>
            )}
            <p className="text-sm">Time on site is wall-clock time from the first clock-in to the last clock-out on the visit, not man-hours.</p>
            {splitSelect('btSplit')}
          </>
        ) : null}
      </div>

      <div className={box}>
        {toggle('rvOn', 'Customer review names the crew', 'You tap “Review mentioned crew” on the finished visit. Reviews are never scraped.')}
        {f.rvOn ? (
          <>
            {money('rvAmount', 'Bonus ($)')}
            {splitSelect('rvSplit')}
          </>
        ) : null}
      </div>

      <div className={box}>
        {toggle('wtOn', 'Weekly crew target', 'If the crew hits the target in the pay week, the crew gets a bonus.')}
        {f.wtOn ? (
          <>
            <Field label="Target is">
              {(a) => (
                <Select {...a} className="text-base" value={String(f.wtBasis)} onChange={(e) => set('wtBasis', e.target.value)}>
                  <option value="visits">A number of finished visits</option>
                  <option value="dollars">Dollars of finished visit work</option>
                </Select>
              )}
            </Field>
            <Field label={f.wtBasis === 'visits' ? 'Visits in the week' : 'Dollars of work in the week'}>{(a) => <Input {...a} inputMode="numeric" className="w-32 text-base" value={String(f.wtTarget)} onChange={(e) => set('wtTarget', e.target.value)} />}</Field>
            {money('wtAmount', 'Bonus for the crew ($)')}
            {splitSelect('wtSplit')}
          </>
        ) : null}
      </div>

      <div className={box}>
        {toggle('ddOn', 'Callback or redo takes a bonus back', 'You tap “Callback / redo” on the finished visit; a negative line goes through the same approval. It only takes back bonus money: never base pay or the weekly minimum, and never more than the person’s crew bonuses that week (the rest is dropped).')}
        {f.ddOn ? (
          <>
            {money('ddAmount', 'Amount taken back ($)')}
            {splitSelect('ddSplit')}
          </>
        ) : null}
      </div>

      {msg ? <p className="text-base font-semibold">{msg}</p> : null}
      <Button className="self-start" loading={busy} onClick={() => void save()}>Save</Button>
    </Card>
  )
}
