'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { NumberChips } from '@/components/ui/number-chips'
import { INSPECTION_CHIP_RULES, INSPECTION_PRESET_MONTHS, checkupExample, touchOptions } from '@/lib/checkups-settings-ui'
import { parseTouchEveryMonths } from '@/lib/checkups-settings'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import { ymdInZone } from '@/lib/service-plans'

type Settings = { enabled: boolean; inspectionMonths: number[]; touchEveryMonths: number; assigneeUserId: string | null; canEdit: boolean }
type Draft = { enabled: boolean; inspectionMonths: number[]; touchEveryMonths: number; assignee: string }

const field = 'min-h-tap rounded-ui border border-surface-line bg-surface px-3 text-base text-[#2c2c2a]'

function toDraft(s: Settings): Draft {
  return { enabled: s.enabled, inspectionMonths: [...s.inspectionMonths], touchEveryMonths: s.touchEveryMonths, assignee: s.assigneeUserId ?? '' }
}

/**
 * Settings → Customer checkups card: on/off, when inspections fall due, how often to check in after that, and who handles them.
 * Only admins / owners can change it (PATCH /api/admin/settings `checkups`, sending only the keys that changed).
 */
export default function CheckupSettingsCard({ initial, users, timeZone = DEFAULT_TIMEZONE, terms = { job: 'Job', jobs: 'Jobs' } }: { initial: Settings; users: Array<{ id: string; name: string }>; timeZone?: string; terms?: { job: string; jobs: string } }) {
  const jobWord = terms.job.toLowerCase()
  const canEdit = initial.canEdit
  const [saved, setSaved] = useState<Draft>(toDraft(initial))
  const [draft, setDraft] = useState<Draft>(toDraft(initial))
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  function change(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }))
    setJustSaved(false)
  }

  const monthsChanged = draft.inspectionMonths.join(',') !== saved.inspectionMonths.join(',')
  const dirty = draft.enabled !== saved.enabled || monthsChanged || draft.touchEveryMonths !== saved.touchEveryMonths || draft.assignee !== saved.assignee
  // Turned on, it needs a person and at least one inspection (same as before); turned off, nothing else matters.
  const complete = draft.inspectionMonths.length > 0 && draft.assignee !== ''
  const canSave = canEdit && dirty && (!draft.enabled || complete)

  async function save() {
    const patch: Record<string, unknown> = {}
    if (draft.enabled !== saved.enabled) patch.enabled = draft.enabled
    if (monthsChanged && draft.inspectionMonths.length > 0) patch.inspectionMonths = draft.inspectionMonths
    if (draft.touchEveryMonths !== saved.touchEveryMonths && parseTouchEveryMonths(draft.touchEveryMonths) != null) patch.touchEveryMonths = draft.touchEveryMonths
    if (draft.assignee !== saved.assignee && draft.assignee !== '') patch.assigneeUserId = draft.assignee
    if (Object.keys(patch).length === 0) return
    setSaving(true)
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'checkups', ...patch }) })
    setSaving(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error || 'Could not save')
    // Only the keys sent were stored; anything held back (e.g. a blank person while turning off) keeps its stored value.
    setSaved((prev) => ({
      enabled: 'enabled' in patch ? draft.enabled : prev.enabled,
      inspectionMonths: 'inspectionMonths' in patch ? [...draft.inspectionMonths] : prev.inspectionMonths,
      touchEveryMonths: 'touchEveryMonths' in patch ? draft.touchEveryMonths : prev.touchEveryMonths,
      assignee: 'assigneeUserId' in patch ? draft.assignee : prev.assignee,
    }))
    setJustSaved(true)
  }

  const example = checkupExample(draft, ymdInZone(new Date(), timeZone), terms.job)

  return (
    <Card id="checkups" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Customer checkups</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 text-[#2c2c2a]">
          <label className="flex min-h-tap items-center justify-between gap-3">
            <span className="text-ui-lg font-bold">Customer checkups</span>
            <span className="flex items-center gap-2 text-ui-base font-semibold">
              {draft.enabled ? 'On' : 'Off'}
              <input type="checkbox" role="switch" aria-label="Customer checkups" className="h-7 w-7" checked={draft.enabled} disabled={!canEdit || saving} onChange={(e) => change({ enabled: e.target.checked })} />
            </span>
          </label>

          {!draft.enabled ? (
            <p className="text-ui-base">When on, every finished {jobWord} gets inspections at set months, then a call or text check-in. They show on {terms.jobs} → Checkups and in the morning email.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-ui-sm font-semibold">Inspections, after the {jobWord} is finished</p>
                <NumberChips
                  values={draft.inspectionMonths}
                  onChange={(inspectionMonths) => change({ inspectionMonths })}
                  rules={INSPECTION_CHIP_RULES}
                  presets={INSPECTION_PRESET_MONTHS}
                  addLabel="+ Add inspection"
                  pickTitle="How many months after the install?"
                  listLabel="Inspections"
                  disabled={saving}
                  readOnly={!canEdit}
                />
              </div>

              <label className="flex flex-col gap-1 text-ui-sm font-semibold">
                Then check in by call or text
                <select value={draft.touchEveryMonths} onChange={(e) => change({ touchEveryMonths: Number(e.target.value) })} disabled={!canEdit || saving} className={`${field} max-w-xs`}>
                  {touchOptions(draft.touchEveryMonths).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-ui-sm font-semibold">
                Who handles them
                <select value={draft.assignee} onChange={(e) => change({ assignee: e.target.value })} disabled={!canEdit || saving} className={`${field} max-w-xs`}>
                  <option value="">Pick a person</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>

              <p className="rounded-ui bg-surface-subtle p-3 text-ui-base" data-testid="checkup-example">{example}</p>
              {canEdit && !complete && <p className="text-ui-sm font-semibold text-danger">Pick a person and keep at least one inspection.</p>}
            </>
          )}

          {canEdit ? (
            <div className="flex items-center gap-3">
              <Button type="button" variant="primary" className="min-h-tap" disabled={!canSave} loading={saving} onClick={() => void save()}>Save changes</Button>
              {dirty ? <span role="status" className="text-ui-base font-semibold">Not saved yet</span> : justSaved ? <span role="status" className="text-ui-base font-semibold">Saved</span> : null}
            </div>
          ) : (
            <p className="text-ui-sm">Only an admin can change these.</p>
          )}
          <p className="text-ui-sm">Changes apply to new checkups. Ones already on the list stay as they are.</p>
        </div>
      </CardContent>
    </Card>
  )
}
