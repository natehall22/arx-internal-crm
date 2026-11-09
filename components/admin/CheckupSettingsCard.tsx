'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { parseInspectionMonths, parseTouchEveryMonths } from '@/lib/checkups-settings'

type Settings = { enabled: boolean; inspectionMonths: number[]; touchEveryMonths: number; assigneeUserId: string | null; canEdit: boolean }

/**
 * Settings → Customer checkups card: on/off, when inspections fall due, how often to call after that, and who gets them.
 * Only admins / owners can change it (PATCH /api/admin/settings `checkups`).
 */
export default function CheckupSettingsCard({ initial, users }: { initial: Settings; users: Array<{ id: string; name: string }> }) {
  const [settings, setSettings] = useState<Settings>(initial)
  const [months, setMonths] = useState(initial.inspectionMonths.join(', '))
  const [every, setEvery] = useState(String(initial.touchEveryMonths))
  const [assignee, setAssignee] = useState(initial.assigneeUserId ?? '')
  const [saving, setSaving] = useState(false)

  async function save(patch: Partial<Omit<Settings, 'canEdit'>>) {
    setSaving(true)
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'checkups', ...patch }) })
    setSaving(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error || 'Could not save')
    setSettings((s) => ({ ...s, ...patch }))
    toast.success('Saved')
  }

  const parsedMonths = parseInspectionMonths(months.split(',').map((x) => x.trim()).filter(Boolean))
  const parsedEvery = parseTouchEveryMonths(every)
  const valid = !!parsedMonths && parsedMonths.length > 0 && parsedEvery != null && assignee !== ''

  return (
    <Card id="checkups" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Customer checkups</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-ui-lg font-semibold text-ink">{settings.enabled ? 'On' : 'Off'}</p>
              <p className="text-ui-sm text-ink">After every install: roof inspections at set months, then a check-in call or text on a schedule. They show on Jobs → Checkups and in the morning email.</p>
            </div>
            {settings.canEdit && (
              <Button variant={settings.enabled ? 'secondary' : 'primary'} className="min-h-tap" loading={saving} aria-pressed={settings.enabled} onClick={() => void save({ enabled: !settings.enabled })}>
                {settings.enabled ? 'Turn off' : 'Turn on'}
              </Button>
            )}
          </div>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid && parsedMonths && parsedEvery != null) void save({ inspectionMonths: parsedMonths, touchEveryMonths: parsedEvery, assigneeUserId: assignee })
            }}
          >
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              Inspections, months after install
              <input value={months} onChange={(e) => setMonths(e.target.value)} disabled={!settings.canEdit || saving} inputMode="numeric" placeholder="6, 12" className="min-h-tap w-40 rounded-ui border border-surface-line bg-surface px-3 text-base text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              After that, a call or text every (months, 0 = never)
              <input value={every} onChange={(e) => setEvery(e.target.value)} disabled={!settings.canEdit || saving} type="number" inputMode="numeric" min={0} max={60} className="min-h-tap w-24 rounded-ui border border-surface-line bg-surface px-3 text-base text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              Assign checkups to
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!settings.canEdit || saving} className="min-h-tap max-w-xs rounded-ui border border-surface-line bg-surface px-3 text-base text-ink">
                <option value="">Pick a person</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            {!valid && settings.canEdit && <p className="text-ui-sm text-danger">Months like “6, 12”, a number from 0 to 60, and a person.</p>}
            {settings.canEdit && (
              <Button type="submit" variant="secondary" className="min-h-tap self-start" disabled={!valid} loading={saving}>Save</Button>
            )}
            <p className="text-ui-sm text-ink">Changes apply to checkups created from now on; ones already on the list keep their dates and person.</p>
          </form>
          {!settings.canEdit && <p className="text-ui-sm text-ink">Only an admin can change these.</p>}
        </div>
      </CardContent>
    </Card>
  )
}
