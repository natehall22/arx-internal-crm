'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button, Card, CardContent, toast } from '@/components/ui'
import { DEFAULT_STUCK_DAYS, MAX_STUCK_DAYS, MIN_STUCK_DAYS } from '@/lib/job-catch-up-settings'

type Settings = { enabled: boolean; stuckDays: number; canEdit: boolean }

/** Admin → Settings → Job catch-up: the on/off switch and "stuck after N days". */
export default function JobCatchUpSettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [days, setDays] = useState(String(DEFAULT_STUCK_DAYS))
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/job-catch-up', { cache: 'no-store' })
    if (!res.ok) return toast.error('Could not load')
    const data = (await res.json()) as Settings
    setSettings(data)
    setDays(String(data.stuckDays))
  }, [])
  useEffect(() => { void load() }, [load])

  async function save(patch: { enabled?: boolean; stuckDays?: number }) {
    setSaving(true)
    const res = await fetch('/api/admin/job-catch-up', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    setSaving(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error || 'Could not save')
    setSettings(data as Settings)
    setDays(String((data as Settings).stuckDays))
    toast.success('Saved')
  }

  if (!settings) return <p className="text-ui-base text-ink">Loading…</p>
  const parsed = Number(days)
  const daysValid = Number.isInteger(parsed) && parsed >= MIN_STUCK_DAYS && parsed <= MAX_STUCK_DAYS

  return (
    <Card>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-ui-lg font-semibold text-ink">{settings.enabled ? 'On for everyone with the job board' : 'Off'}</p>
              <p className="text-ui-sm text-ink">Field roles never see it. No dollar amounts are shown.</p>
            </div>
            {settings.canEdit && (
              <Button
                variant={settings.enabled ? 'secondary' : 'primary'}
                className="min-h-tap"
                loading={saving}
                aria-pressed={settings.enabled}
                onClick={() => void save({ enabled: !settings.enabled })}
              >
                {settings.enabled ? 'Turn off' : 'Turn on'}
              </Button>
            )}
          </div>

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (daysValid) void save({ stuckDays: parsed })
            }}
          >
            <label htmlFor="catch-up-days" className="text-ui-sm font-semibold text-ink">
              Flag a job as stuck when nothing has moved for
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="catch-up-days"
                name="catch-up-days"
                type="number"
                inputMode="numeric"
                min={MIN_STUCK_DAYS}
                max={MAX_STUCK_DAYS}
                step={1}
                value={days}
                disabled={!settings.canEdit || saving}
                onChange={(e) => setDays(e.target.value)}
                className="min-h-tap w-24 rounded-ui border border-surface-line bg-surface px-3 text-base text-ink"
              />
              <span className="text-ui-base text-ink">days</span>
              {settings.canEdit && (
                <Button type="submit" variant="secondary" className="min-h-tap" disabled={!daysValid || parsed === settings.stuckDays} loading={saving}>
                  Save
                </Button>
              )}
            </div>
            {!daysValid && <p className="text-ui-sm text-danger">A whole number from {MIN_STUCK_DAYS} to {MAX_STUCK_DAYS}.</p>}
            <p className="text-ui-sm text-ink">
              A job is also flagged when it is past a scheduled date (a crew not marked done, materials or permit not ready
              before the crew starts) — the same checks as “Needs you”.
            </p>
          </form>

          {!settings.canEdit && <p className="text-ui-sm text-ink">Only an admin can change these.</p>}
        </div>
      </CardContent>
    </Card>
  )
}
