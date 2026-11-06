'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { MAX_STUCK_DAYS, MIN_STUCK_DAYS } from '@/lib/job-catch-up-settings'

type Settings = { enabled: boolean; stuckDays: number; canEdit: boolean }

/**
 * Settings → Job catch-up card (on the Settings page itself): the on/off switch and "stuck after N working days".
 * Everyone who opens Settings sees it; only admins / owners can change it (PATCH /api/admin/settings `job_catch_up`).
 */
export default function JobCatchUpSettingsCard({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial)
  const [days, setDays] = useState(String(initial.stuckDays))
  const [saving, setSaving] = useState(false)

  async function save(patch: { enabled?: boolean; stuckDays?: number }) {
    setSaving(true)
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'job_catch_up', ...patch }) })
    setSaving(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error || 'Could not save')
    const next = { ...settings, ...patch }
    setSettings(next)
    setDays(String(next.stuckDays))
    toast.success('Saved')
  }

  const parsed = Number(days)
  const daysValid = Number.isInteger(parsed) && parsed >= MIN_STUCK_DAYS && parsed <= MAX_STUCK_DAYS

  return (
    <Card id="job-catch-up" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Job catch-up</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-ui-lg font-semibold text-ink">{settings.enabled ? 'On for everyone with the job board' : 'Off'}</p>
              <p className="text-ui-sm text-ink">One line per job on the Production Board and a “Where this stands” box on each job, built from what already happened. Field roles never see it. No dollar amounts are shown.</p>
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
              <span className="text-ui-base text-ink">working days (Mon–Fri)</span>
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
