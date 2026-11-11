'use client'

import * as React from 'react'

import ConfigListEditor from '@/components/admin/ConfigListEditor'
import { Button, Card, CardContent, Dialog, DialogContent, DialogFooter, Field, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast } from '@/components/ui'
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@/lib/custom-fields'

type Resp = { ready?: boolean; definitions?: CustomFieldDefinition[]; error?: string }

/** One choice per line (a dropdown's choices). */
const linesOf = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

/** Saved through /api/admin/custom-fields (the one writer). Never deletes: "Turn off" hides a field and keeps its values. */
export default function CustomFieldsClient() {
  const [defs, setDefs] = React.useState<CustomFieldDefinition[] | null>(null)
  const [ready, setReady] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch('/api/admin/custom-fields', { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as Resp
        if (cancelled) return
        if (!res.ok || !Array.isArray(data.definitions)) return setLoadError(data.error || 'Could not load custom fields')
        setDefs(data.definitions)
        setReady(data.ready !== false)
      })
      .catch(() => !cancelled && setLoadError('Could not load custom fields'))
    return () => {
      cancelled = true
    }
  }, [])

  async function save(body: Record<string, unknown>, done: string): Promise<boolean> {
    const res = await fetch('/api/admin/custom-fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = (res ? await res.json().catch(() => ({})) : {}) as Resp
    if (!res || !res.ok || !Array.isArray(data.definitions)) {
      toast.error(data.error || 'Could not save')
      return false
    }
    setDefs(data.definitions)
    toast.success(done)
    return true
  }

  if (loadError) return <p className="text-ui-base text-danger">{loadError}</p>
  if (!defs) return <p className="text-ui-base text-ink">Loading…</p>

  return (
    <Card>
      <CardContent>
        {!ready ? (
          <p role="status" className="mb-3 rounded-ui border border-surface-line bg-surface-subtle px-3 py-2 text-ui-base text-ink">
            Custom fields turn on once the database update for them is applied.
          </p>
        ) : null}
        <Tabs defaultValue="customer">
          <TabsList aria-label="Fields for">
            {CUSTOM_FIELD_ENTITIES.map((e) => (
              <TabsTrigger key={e} value={e}>
                {CUSTOM_FIELD_ENTITY_LABELS[e]}
              </TabsTrigger>
            ))}
          </TabsList>
          {CUSTOM_FIELD_ENTITIES.map((e) => (
            <TabsContent key={e} value={e} className="pt-4">
              <EntityFields entity={e} defs={defs.filter((d) => d.entity === e)} readOnly={!ready} save={save} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function EntityFields({
  entity,
  defs,
  readOnly,
  save,
}: {
  entity: CustomFieldEntity
  defs: CustomFieldDefinition[]
  readOnly: boolean
  save: (body: Record<string, unknown>, done: string) => Promise<boolean>
}) {
  const [settingsFor, setSettingsFor] = React.useState<CustomFieldDefinition | null>(null)
  const byId = (id: string) => defs.find((d) => d.id === id)
  const where = entity === 'customer' ? 'each customer' : entity === 'property' ? 'each property' : 'each job'

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui-base text-ink">Fields shown on {where}. Turning one off hides it; what was saved stays.</p>
      <ConfigListEditor
        noun="field"
        readOnly={readOnly}
        minActive={0}
        maxLabelLength={CUSTOM_FIELD_LIMITS.label}
        items={defs.map((d) => ({ key: d.id, label: d.label, active: d.active }))}
        renderDetail={(id) => {
          const d = byId(id)
          if (!d) return null
          const parts: string[] = [CUSTOM_FIELD_TYPE_LABELS[d.field_type]]
          if (d.required) parts.push('Required')
          if (d.visible_to_field) parts.push('Door-knocking roles see it')
          if (d.field_type === 'dropdown') parts.push(d.options.join(', '))
          return parts.join(' · ')
        }}
        renderActions={(id, busy) => {
          const d = byId(id)
          return d ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setSettingsFor(d)}>
              {d.field_type === 'dropdown' ? 'Choices & settings' : 'Settings'}
            </Button>
          ) : null
        }}
        onAdd={async () => false}
        onRename={(id, label) => save({ action: 'update', id, label }, `Renamed to ${label}`)}
        onReorder={(order) => save({ action: 'reorder', entity, order }, 'Order saved')}
        onSetActive={(id, active) => save({ action: 'setActive', id, active }, `${byId(id)?.label ?? 'Field'} turned ${active ? 'on' : 'off'}`)}
        addForm={<AddFieldForm entity={entity} save={save} />}
      />
      {settingsFor ? <FieldSettingsSheet def={settingsFor} onClose={() => setSettingsFor(null)} save={save} /> : null}
    </div>
  )
}

function AddFieldForm({ entity, save }: { entity: CustomFieldEntity; save: (body: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [label, setLabel] = React.useState('')
  const [type, setType] = React.useState<CustomFieldType>('text')
  const [choices, setChoices] = React.useState('')
  const [required, setRequired] = React.useState(false)
  const [fieldVisible, setFieldVisible] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const reqId = React.useId()
  const visId = React.useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    const ok = await save(
      { action: 'add', entity, label: label.trim(), field_type: type, required, visible_to_field: entity !== 'job' && fieldVisible, ...(type === 'dropdown' ? { options: linesOf(choices) } : {}) },
      `${label.trim()} added`
    )
    setBusy(false)
    if (ok) {
      setLabel('')
      setChoices('')
      setRequired(false)
      setFieldVisible(false)
      setType('text')
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-ui border border-surface-line p-3">
      <p className="text-ui-base font-semibold text-ink">Add a field</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Name">{(p) => <Input {...p} value={label} maxLength={CUSTOM_FIELD_LIMITS.label} placeholder="Gate code, Mowing day…" onChange={(e) => setLabel(e.target.value)} className="text-base" />}</Field>
        <Field label="Field type">
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className="text-base">
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CUSTOM_FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {type === 'dropdown' ? (
        <Field label="Choices" hint="One per line.">
          {(p) => <Textarea {...p} value={choices} onChange={(e) => setChoices(e.target.value)} className="text-base" />}
        </Field>
      ) : null}
      <label htmlFor={reqId} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
        <input id={reqId} type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-5 w-5" />
        Required (must be filled in before the record’s fields can be saved)
      </label>
      {entity !== 'job' ? (
        <label htmlFor={visId} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
          <input id={visId} type="checkbox" checked={fieldVisible} onChange={(e) => setFieldVisible(e.target.checked)} className="h-5 w-5" />
          Setters, canvassers and inside sales can see it (off: office and crews only)
        </label>
      ) : null}
      <p className="text-ui-sm text-ink">The type can’t be changed later — turn the field off and add a new one instead.</p>
      <Button type="submit" loading={busy} disabled={!label.trim() || (type === 'dropdown' && linesOf(choices).length === 0)} className="sm:self-start">
        + Add field
      </Button>
    </form>
  )
}

function FieldSettingsSheet({ def, onClose, save }: { def: CustomFieldDefinition; onClose: () => void; save: (body: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [required, setRequired] = React.useState(def.required)
  const [fieldVisible, setFieldVisible] = React.useState(def.visible_to_field)
  const [choices, setChoices] = React.useState(def.options.join('\n'))
  const [busy, setBusy] = React.useState(false)
  const reqId = React.useId()
  const visId = React.useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await save(
      { action: 'update', id: def.id, required, ...(def.entity !== 'job' ? { visible_to_field: fieldVisible } : {}), ...(def.field_type === 'dropdown' ? { options: linesOf(choices) } : {}) },
      `${def.label} saved`
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent title={def.label} description={`${CUSTOM_FIELD_TYPE_LABELS[def.field_type]} field`}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {def.field_type === 'dropdown' ? (
            <Field label="Choices" hint="One per line. Records that already hold a removed choice keep it until someone changes it.">
              {(p) => <Textarea {...p} value={choices} onChange={(e) => setChoices(e.target.value)} className="text-base" />}
            </Field>
          ) : null}
          <label htmlFor={reqId} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
            <input id={reqId} type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-5 w-5" />
            Required
          </label>
          {def.entity !== 'job' ? (
            <label htmlFor={visId} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
              <input id={visId} type="checkbox" checked={fieldVisible} onChange={(e) => setFieldVisible(e.target.checked)} className="h-5 w-5" />
              Setters, canvassers and inside sales can see it
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={def.field_type === 'dropdown' && linesOf(choices).length === 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
