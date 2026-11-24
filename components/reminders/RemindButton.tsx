'use client'

import * as React from 'react'

import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, toast } from '@/components/ui'
import { useOrgFeatures } from '@/hooks/useOrgFeatures'
import OneOffVisit from '@/components/service-plans/OneOffVisit'
import { addDaysYmd, reminderCanBecomeVisit, visitDateForReminder, weekdayOfYmd } from '@/lib/service-plans'
import { formatDateWeekday } from '@/lib/format'

type Target = { jobId?: string; customerId?: string; partnerId?: string }
type Item = { id: string; body: string; dueOn: string; assigneeId: string; assigneeName: string | null; createdById: string | null; createdByName: string | null; jobId?: string | null; customerId?: string | null; partnerId?: string | null; propertyId?: string | null }
type Load = { reminders: Item[]; today: string; seesAll: boolean; meId: string; canMakeVisit?: boolean }

/** Next Monday after `today` (the "Next week" chip). */
export function nextWeekYmd(today: string): string {
  const dow = weekdayOfYmd(today)
  return addDaysYmd(today, ((8 - dow) % 7) || 7)
}

/**
 * "Remind…" on a job, customer or partner: pick anyone in the company, a day (Today / Tomorrow / Next week / Pick) and what to
 * remember. Also lists the open reminders on this record (mine, or everyone's for owner / office) with a Done button.
 * Shows only when the company has turned reminders on. Saves through POST /api/reminders (lib/reminders.ts).
 */
export default function RemindButton({ target, className }: { target: Target; className?: string }) {
  const features = useOrgFeatures()
  const [open, setOpen] = React.useState(false)
  const [data, setData] = React.useState<Load | null>(null)
  const [people, setPeople] = React.useState<Array<{ id: string; full_name: string | null }>>([])
  const [assignee, setAssignee] = React.useState('')
  const [due, setDue] = React.useState('')
  const [pick, setPick] = React.useState(false)
  const [body, setBody] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const qs = new URLSearchParams(target as Record<string, string>).toString()

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/reminders?${qs}`, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return
    const next = (await res.json()) as Load
    setData(next)
    setAssignee((a) => a || next.meId)
    setDue((d) => d || next.today)
  }, [qs])

  React.useEffect(() => {
    if (features.reminders) void load()
  }, [features.reminders, load])

  if (!features.reminders) return null
  const today = data?.today ?? ''
  const open_ = data?.reminders ?? []

  async function openSheet() {
    setOpen(true)
    setBody('')
    setPick(false)
    if (data) setDue(data.today)
    if (people.length === 0) {
      const res = await fetch('/api/users', { cache: 'no-store' }).catch(() => null)
      const out = (res && res.ok ? await res.json().catch(() => ({})) : {}) as { users?: Array<{ id: string; full_name: string | null }> }
      setPeople(out.users ?? [])
    }
  }

  async function save() {
    if (!body.trim()) return toast.error('Say what to be reminded about')
    if (!assignee || !due) return toast.error('Pick who and when')
    setSaving(true)
    const res = await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, assigneeId: assignee, dueOn: due, body }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setSaving(false)
    if (!res || !res.ok) return toast.error(out.error || 'Could not save the reminder')
    toast.success('Reminder set')
    setBody('')
    await load()
  }

  async function done(id: string) {
    const res = await fetch(`/api/reminders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) }).catch(() => null)
    if (!res || !res.ok) return toast.error('Could not save')
    await load()
  }

  const chips: Array<{ key: string; label: string; day: string }> = today
    ? [
        { key: 'today', label: 'Today', day: today },
        { key: 'tomorrow', label: 'Tomorrow', day: addDaysYmd(today, 1) },
        { key: 'next', label: 'Next week', day: nextWeekYmd(today) },
      ]
    : []
  const chipHit = chips.find((c) => c.day === due && !pick)

  return (
    <>
      <Button variant="secondary" size="sm" className={className} onClick={() => void openSheet()}>
        Remind…{open_.length > 0 ? ` (${open_.length})` : ''}
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setOpen(false)}>
          <DialogContent title="Remind" description="Pick who, when, and what to remember. They get a bell now and another that morning.">
            <div className="flex flex-col gap-3">
              {open_.length > 0 ? (
                <ul className="flex flex-col gap-1" aria-label="Open reminders on this record">
                  {open_.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-2 rounded-ui border border-surface-line p-2">
                      <p className="min-w-0 break-words text-ui-base text-ink">
                        <span className="font-semibold">{formatDateWeekday(r.dueOn)}</span> · {r.assigneeName ?? 'Someone'} — {r.body}
                      </p>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {r.customerId && reminderCanBecomeVisit({ jobId: r.jobId ?? null, partnerId: r.partnerId ?? null, customerId: r.customerId, propertyId: r.propertyId ?? null }, data?.canMakeVisit === true) ? (
                          <OneOffVisit prefill={{ reminderId: r.id, customerId: r.customerId, propertyId: r.propertyId ?? null, date: visitDateForReminder(r.dueOn, today), today, text: r.body }} label="Make a visit" className="min-h-tap" onCreated={() => void load()} />
                        ) : null}
                        {r.assigneeId === data?.meId || r.createdById === data?.meId || data?.seesAll ? <Button size="sm" variant="secondary" onClick={() => void done(r.id)}>Done</Button> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Field label="Remind">
                {(a) => (
                  <Select {...a} className="min-h-tap text-base" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    {people.length === 0 && data ? <option value={data.meId}>Me</option> : null}
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.id === data?.meId ? 'Me' : p.full_name ?? 'Unnamed'}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <div role="group" aria-label="Day" className="flex flex-wrap gap-2">
                {chips.map((c) => (
                  <Button key={c.key} size="sm" variant={chipHit?.key === c.key ? 'primary' : 'secondary'} aria-pressed={chipHit?.key === c.key} onClick={() => { setDue(c.day); setPick(false) }}>{c.label}</Button>
                ))}
                <Button size="sm" variant={pick || (!chipHit && due) ? 'primary' : 'secondary'} aria-pressed={pick || !chipHit} onClick={() => setPick(true)}>Pick</Button>
              </div>
              {pick || !chipHit ? <Field label="Day">{(a) => <Input {...a} type="date" className="text-base" min={today} value={due} onChange={(e) => setDue(e.target.value)} />}</Field> : null}
              <Field label="About">{(a) => <Input {...a} className="text-base" maxLength={500} placeholder="Call back about the sprinkler quote" value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
            </div>
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Close</Button>
              <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Set reminder'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
