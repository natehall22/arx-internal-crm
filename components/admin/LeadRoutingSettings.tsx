'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button, Card, CardContent, Input, Select, toast } from '@/components/ui'
import type { LeadRouting, RoutingMode } from '@/lib/lead-intake'

export type LeadRoutingView = {
  routing: LeadRouting
  reminder: { enabled: boolean; hours: number }
  leadOwnerId: string | null
  people: Array<{ id: string; name: string }>
  sources: Array<{ id: string; name: string; routing: LeadRouting | null; autoAssignUserId: string | null; services: string[] }>
  services: string[]
}

const MODES: Array<{ mode: RoutingMode; title: string; hint: string }> = [
  { mode: 'person', title: 'One person', hint: 'Every lead goes to the same person.' },
  { mode: 'rotate', title: 'Take turns', hint: 'Leads go to each person in turn.' },
  { mode: 'service', title: 'By service', hint: 'Each service goes to a person or a group that takes turns.' },
]

const empty = (mode: RoutingMode): LeadRouting => ({ mode, userIds: [], rules: [] })

function People({ people, value, onChange, label }: { people: LeadRoutingView['people']; value: string[]; onChange: (ids: string[]) => void; label: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-ui-sm font-semibold text-ink">{label}</legend>
      {people.map((p) => (
        <label key={p.id} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={value.includes(p.id)}
            onChange={(e) => onChange(people.map((x) => x.id).filter((id) => (id === p.id ? e.target.checked : value.includes(id))))}
          />
          {p.name}
        </label>
      ))}
    </fieldset>
  )
}

/** One routing choice. `personId` is the single person for "One person" (company: the lead owner; a source: its own person). */
function RoutingEditor({ value, onChange, people, services, personId, onPerson, personBlank, idPrefix }: {
  value: LeadRouting
  onChange: (r: LeadRouting) => void
  people: LeadRoutingView['people']
  services: string[]
  personId: string | null
  onPerson: (id: string | null) => void
  personBlank: string
  idPrefix: string
}) {
  const listId = `${idPrefix}-services`
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="How leads are handed out" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {MODES.map((m) => {
          const on = value.mode === m.mode
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, mode: m.mode })}
              className={`min-h-tap rounded-ui border-2 p-3 text-left text-ui-base text-ink ${on ? 'border-ink bg-surface-subtle' : 'border-surface-line bg-surface'}`}
            >
              <span className="block font-bold">{m.title}</span>
              <span className="block text-ui-sm">{m.hint}</span>
            </button>
          )
        })}
      </div>

      {value.mode === 'person' ? (
        <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
          Who gets them
          <Select value={personId ?? ''} onChange={(e) => onPerson(e.target.value || null)}>
            <option value="">{personBlank}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </label>
      ) : null}

      {value.mode === 'rotate' ? <People label="Who takes turns" people={people} value={value.userIds} onChange={(ids) => onChange({ ...value, userIds: ids })} /> : null}

      {value.mode === 'service' ? (
        <div className="flex flex-col gap-3">
          <datalist id={listId}>
            {services.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {value.rules.map((r, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-ui border border-surface-line p-3">
              <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                Service
                <Input
                  list={listId}
                  maxLength={60}
                  value={r.service}
                  placeholder="Weekly lawn care"
                  onChange={(e) => onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? { ...x, service: e.target.value } : x)) })}
                />
              </label>
              <People
                label={r.userIds.length > 1 ? 'Who takes turns on it' : 'Who gets it (pick more than one to take turns)'}
                people={people}
                value={r.userIds}
                onChange={(ids) => onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? { ...x, userIds: ids } : x)) })}
              />
              <Button variant="secondary" className="min-h-tap self-start" onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}>
                Remove this service
              </Button>
            </div>
          ))}
          <Button variant="secondary" className="min-h-tap self-start" onClick={() => onChange({ ...value, rules: [...value.rules, { service: '', userIds: [] }] })}>
            Add a service
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Settings → Lead routing: who new website leads go to (one person / take turns / by service, with an optional choice per
 * lead source) and when a lead nobody has called counts as waiting. One Save bar at the bottom.
 */
export default function LeadRoutingSettings({ initial = null }: { initial?: LeadRoutingView | null }) {
  const [saved, setSaved] = useState<LeadRoutingView | null>(initial)
  const [draft, setDraft] = useState<LeadRoutingView | null>(initial)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (initial) return
    void fetch('/api/admin/lead-routing')
      .then((r) => r.json())
      .then((v: LeadRoutingView) => {
        setSaved(v)
        setDraft(v)
      })
      .catch(() => toast.error('Could not load'))
  }, [initial])

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])
  if (!draft || !saved) return <p className="text-ui-base text-ink">Loading…</p>
  const set = (patch: Partial<LeadRoutingView>) => setDraft({ ...draft, ...patch })
  const setSource = (id: string, patch: Partial<LeadRoutingView['sources'][number]>) => set({ sources: draft.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  const services = Array.from(new Set([...draft.services, ...draft.routing.rules.map((r) => r.service).filter(Boolean)]))

  async function save() {
    if (!draft) return
    setBusy(true)
    const res = await fetch('/api/admin/lead-routing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing: { mode: draft.routing.mode, userIds: draft.routing.userIds, rules: draft.routing.rules },
        leadOwnerId: draft.leadOwnerId,
        reminder: draft.reminder,
        sources: draft.sources.map((s) => ({ id: s.id, routing: s.routing, autoAssignUserId: s.autoAssignUserId })),
      }),
    }).catch(() => null)
    setBusy(false)
    const data = (res ? await res.json().catch(() => ({})) : {}) as LeadRoutingView & { error?: string }
    if (!res || !res.ok) return toast.error(data.error || 'Could not save')
    setSaved(data)
    setDraft(data)
    toast.success('Saved')
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-ui-lg font-bold text-ink">Who gets new leads</p>
          <RoutingEditor
            idPrefix="company"
            value={draft.routing}
            onChange={(routing) => set({ routing })}
            people={draft.people}
            services={services}
            personId={draft.leadOwnerId}
            onPerson={(leadOwnerId) => set({ leadOwnerId })}
            personBlank="Your longest-standing admin"
          />
          {draft.routing.mode !== 'person' ? (
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              If nobody matches, the lead goes to
              <Select value={draft.leadOwnerId ?? ''} onChange={(e) => set({ leadOwnerId: e.target.value || null })}>
                <option value="">Your longest-standing admin</option>
                {draft.people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </label>
          ) : null}
          <p className="text-ui-sm text-ink">Whoever gets a lead is told right away. A lead is never left without an owner.</p>
        </CardContent>
      </Card>

      {draft.sources.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <p className="text-ui-lg font-bold text-ink">Different for one lead source</p>
            {draft.sources.map((s) => (
              <div key={s.id} className="flex flex-col gap-2 border-t border-surface-line pt-3 first:border-t-0 first:pt-0">
                <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                  {s.name}
                  <Select value={s.routing?.mode ?? ''} onChange={(e) => setSource(s.id, { routing: e.target.value ? empty(e.target.value as RoutingMode) : null })}>
                    <option value="">{s.autoAssignUserId && draft.routing.mode === 'person' ? 'Same as above (this source has its own person)' : 'Same as above'}</option>
                    {MODES.map((m) => (
                      <option key={m.mode} value={m.mode}>{m.title}</option>
                    ))}
                  </Select>
                </label>
                {s.routing ? (
                  <RoutingEditor
                    idPrefix={`source-${s.id}`}
                    value={s.routing}
                    onChange={(routing) => setSource(s.id, { routing })}
                    people={draft.people}
                    services={Array.from(new Set([...s.services, ...services]))}
                    personId={s.autoAssignUserId}
                    onPerson={(autoAssignUserId) => setSource(s.id, { autoAssignUserId })}
                    personBlank="The company’s choice above"
                  />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <label className="flex min-h-tap cursor-pointer items-center justify-between gap-3">
            <span className="text-ui-lg font-bold text-ink">Remind us about leads nobody has contacted</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={`Lead reminder ${draft.reminder.enabled ? 'on' : 'off'}`}
              className="h-7 w-7"
              checked={draft.reminder.enabled}
              onChange={(e) => set({ reminder: { ...draft.reminder, enabled: e.target.checked } })}
            />
          </label>
          <p className="text-ui-base text-ink">
            A website lead is waiting when no call, text or email is logged on it and it is still “new” after the hours below. It shows on Today and in the morning email, and its owner gets one notification.
          </p>
          {draft.reminder.enabled ? (
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              Hours before it counts as waiting
              <Input
                inputMode="numeric"
                value={String(draft.reminder.hours)}
                onChange={(e) => set({ reminder: { ...draft.reminder, hours: Number(e.target.value.replace(/\D/g, '')) || 0 } })}
              />
            </label>
          ) : null}
        </CardContent>
      </Card>

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl gap-3">
            <Button variant="secondary" className="min-h-tap flex-1" onClick={() => setDraft(saved)}>
              Undo changes
            </Button>
            <Button className="min-h-tap flex-1" loading={busy} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
