'use client'

import * as React from 'react'

import { Button, Card, Field, Select } from '@/components/ui'
import type { NightlySettings } from '@/lib/schedule-nightly'

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`

/** Owners (Settings → Jobs): carry unfinished work to the next working day each night, and the end-of-day "close out" reminder. Both start OFF. */
export default function NightlyScheduleCard() {
  const [s, setS] = React.useState<NightlySettings | null>(null)
  const [tz, setTz] = React.useState('')
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void fetch('/api/admin/scheduling-nightly', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings: NightlySettings; timeZone: string } | null) => {
        if (!d) return
        setS(d.settings)
        setTz(d.timeZone)
      })
  }, [])
  if (!s) return null

  async function save() {
    if (!s) return
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/admin/scheduling-nightly', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduling: s }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; settings?: NightlySettings }
    setBusy(false)
    if (!res || !res.ok) return setMsg(out.error || 'Couldn’t save')
    if (out.settings) setS(out.settings)
    setMsg('Saved')
  }

  const hours = Array.from({ length: 24 }, (_, h) => h)
  const row = (key: 'autoRoll' | 'endOfDay', title: string, help: string, hourLabelText: string) => (
    <div className="space-y-2">
      <label className="flex min-h-[48px] items-start gap-3 text-base">
        <input type="checkbox" className="mt-1 h-6 w-6" checked={s[key].enabled} onChange={(e) => setS({ ...s, [key]: { ...s[key], enabled: e.target.checked } })} />
        <span>
          <span className="font-semibold">{title}</span>
          <span className="block text-sm">{help}</span>
        </span>
      </label>
      {s[key].enabled ? (
        <Field label={hourLabelText}>
          {(a) => (
            <Select {...a} className="text-base" value={String(s[key].hour)} onChange={(e) => setS({ ...s, [key]: { ...s[key], hour: Number(e.target.value) } })}>
              {hours.map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
    </div>
  )

  return (
    <Card className="space-y-4 p-4" id="nightly-schedule">
      <div>
        <h3 className="text-lg font-semibold">Nightly schedule</h3>
        <p className="text-sm">Times are {tz || 'your company time zone'}.</p>
      </div>
      {row('autoRoll', 'Roll unfinished work to the next working day', 'Service visits still scheduled on a day that has passed move to the next working day (Mon–Fri). Visits with clock time and anything someone moved today stay put. Crew jobs on a job (installs) are never moved automatically. These moves are not counted as “Rolled N×”.', 'Roll at or after')}
      {row('endOfDay', 'End-of-day reminder to close out', 'Crew leads and the office get a notification listing visits still open and anyone still clocked in.', 'Remind at')}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        {msg ? <span className="text-sm">{msg}</span> : null}
      </div>
    </Card>
  )
}
