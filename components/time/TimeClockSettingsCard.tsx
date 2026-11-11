'use client'

import { useEffect, useState } from 'react'

import { Button, Card } from '@/components/ui'
import type { TimeTrackingSettings } from '@/lib/time-tracking'

const inputCls = 'min-h-[48px] w-28 rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base text-[#2c2c2a]'

/** Owners: how the crew time clock behaves. Wage-law items are warnings only — nothing here deducts time. */
export default function TimeClockSettingsCard() {
  const [s, setS] = useState<TimeTrackingSettings | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void fetch('/api/admin/time/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setS((d as { settings: TimeTrackingSettings }).settings)
        setRoles((d as { roles?: string[] }).roles ?? [])
      })
  }, [])
  if (!s) return null
  const num = (k: keyof TimeTrackingSettings, label: string, hint: string) => (
    <label className="flex flex-wrap items-center justify-between gap-2 text-base">
      <span className="flex flex-col">
        <span className="font-semibold">{label}</span>
        <span className="text-sm">{hint}</span>
      </span>
      <input type="number" inputMode="decimal" className={inputCls} value={String(s[k])} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
    </label>
  )
  return (
    <Card className="flex flex-col gap-3 p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Time clock settings</h2>
      {num('autoCloseHours', 'Stop a forgotten clock after (hours)', 'Stopped at the last tap and flagged; the crew lead is asked the real finish time.')}
      {num('overtimeAfterHours', 'Overtime after (hours a week)', '0 = never split into overtime.')}
      {num('breakWarningAfterHours', 'Warn about no lunch after (hours)', 'A warning only — no time is ever taken off.')}
      <label className="flex min-h-[48px] items-center gap-3 text-base">
        <input type="checkbox" className="h-6 w-6" checked={s.captureLocation} onChange={(e) => setS({ ...s, captureLocation: e.target.checked })} />
        <span>
          <span className="font-semibold">Save the phone’s location at each tap</span>
          <span className="block text-sm">Only at the tap, never in between. Check your state’s rules and tell your crew first.</span>
        </span>
      </label>
      {roles.length ? (
        <fieldset className="flex flex-col gap-1 text-base">
          <legend className="font-semibold">Who else may clock themselves in on a job page</legend>
          <span className="text-sm">Crew members always can. Setters and other field sales roles never can.</span>
          {roles.map((r) => (
            <label key={r} className="flex min-h-[44px] items-center gap-3">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={s.selfClockRoles.includes(r)}
                onChange={(e) => setS({ ...s, selfClockRoles: e.target.checked ? [...s.selfClockRoles, r] : s.selfClockRoles.filter((x) => x !== r) })}
              />
              <span>{r.replace(/_/g, ' ')}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {msg ? <p className="text-base font-semibold">{msg}</p> : null}
      <Button
        className="self-start"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          setMsg(null)
          const res = await fetch('/api/admin/time/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeTracking: s }) }).catch(() => null)
          const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; settings?: TimeTrackingSettings }
          setBusy(false)
          if (!res || !res.ok) return setMsg(out.error || 'Couldn’t save')
          if (out.settings) setS(out.settings)
          setMsg('Saved')
        }}
      >
        Save
      </Button>
    </Card>
  )
}
