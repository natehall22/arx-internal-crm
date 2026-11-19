'use client'

import * as React from 'react'

import { CustomFieldInputs, draftFrom, patchFrom, saveCustomFieldValues, type DraftValues } from '@/components/custom-fields/CustomFieldsCard'
import AddLotsSheet from '@/components/customer-file/AddLotsSheet'
import DevelopmentPicker from '@/components/customer-file/DevelopmentPicker'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogFooter, Field, Input, Textarea, toast } from '@/components/ui'
import { displayFieldValue, fieldsToShow, type CustomFieldDefinition } from '@/lib/custom-fields'
import type { CustomerExtras } from '@/lib/customer-file/customer-extras'
import { PROPERTY_LIMITS, developmentKey, lotLabel, propertiesDisplayMode, propertyMapHref, type Property } from '@/lib/properties'

type Form = {
  label: string
  community: string
  lot: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
  notes: string
  access_notes: string
}

const EMPTY: Form = { label: '', community: '', lot: '', address_line1: '', address_line2: '', city: '', state: '', zip: '', notes: '', access_notes: '' }

function formFrom(p: Property): Form {
  // A backfilled property has only the one-line address: it starts in line 1 so the edit keeps it whole.
  const hasParts = !!(p.address_line1 || p.city || p.state || p.zip)
  return {
    label: p.label ?? '',
    community: p.community ?? '',
    lot: p.lot ?? '',
    address_line1: hasParts ? p.address_line1 ?? '' : p.address_text,
    address_line2: hasParts ? p.address_line2 ?? '' : '',
    city: hasParts ? p.city ?? '' : '',
    state: hasParts ? p.state ?? '' : '',
    zip: hasParts ? p.zip ?? '' : '',
    notes: p.notes ?? '',
    access_notes: p.access_notes ?? '',
  }
}

/**
 * Customer File → Properties: the places this customer owns or manages (commercial accounts have many). List, add, edit,
 * turn off / on (never delete — deals, jobs and crew visits keep pointing at it). Gate / access notes only reach people
 * allowed to see them (the server blanks them otherwise). Saves through /api/customers/[id]/properties and
 * /api/properties/[id]; property custom fields through /api/custom-fields/values.
 */
export default function PropertiesCard({
  customerId,
  initial,
  ready,
  canEdit,
  accessNotes,
  propertyFields,
  lots = null,
}: {
  customerId: string
  initial: Property[]
  ready: boolean
  canEdit: boolean
  accessNotes: boolean
  propertyFields: CustomFieldDefinition[]
  /** Developments + lots tools (property tools on): the development pick-list, trades, and whether the viewer may make jobs. Null = off. */
  lots?: CustomerExtras['lots']
}) {
  const [properties, setProperties] = React.useState(initial)
  const [editing, setEditing] = React.useState<{ id: string | null; form: Form; fields: DraftValues } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [showOff, setShowOff] = React.useState(false)
  const [errorField, setErrorField] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [addingLots, setAddingLots] = React.useState(false)
  const [openDevs, setOpenDevs] = React.useState<string[]>([])
  const [devNames, setDevNames] = React.useState(lots?.developments ?? [])

  const activeFields = propertyFields.filter((d) => d.active)
  const mode = propertiesDisplayMode({ ready, properties, hasPropertyFields: activeFields.length > 0, canEdit })
  if (mode === 'none') return null

  const visible = properties.filter((p) => p.active || showOff)
  const offCount = properties.filter((p) => !p.active).length

  function openNew() {
    setErrorField(null)
    setEditing({ id: null, form: { ...EMPTY }, fields: draftFrom(activeFields, {}) })
  }
  function openEdit(p: Property) {
    setErrorField(null)
    setEditing({ id: p.id, form: formFrom(p), fields: draftFrom(fieldsToShow(propertyFields, 'property', p.custom_fields), p.custom_fields) })
  }

  async function send(url: string, method: string, body: unknown): Promise<Property | null> {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = (res ? await res.json().catch(() => ({})) : {}) as { property?: Property; error?: string }
    if (!res || !res.ok || !data.property) {
      toast.error(data.error || 'Could not save')
      return null
    }
    return data.property
  }

  async function save() {
    if (!editing) return
    const f = editing.form
    const body: Record<string, unknown> = {
      label: f.label, ...(lots ? { community: f.community, lot: f.lot } : {}), address_line1: f.address_line1, address_line2: f.address_line2, city: f.city, state: f.state, zip: f.zip, notes: f.notes,
    }
    if (accessNotes) body.access_notes = f.access_notes
    setSaving(true)
    let saved = editing.id
      ? await send(`/api/properties/${editing.id}`, 'PATCH', body)
      : await send(`/api/customers/${customerId}/properties`, 'POST', body)
    if (saved) {
      const existing = properties.find((p) => p.id === saved!.id)
      const defs = fieldsToShow(propertyFields, 'property', existing?.custom_fields ?? {})
      // A new property sends every field (so required ones are checked); an edit sends only what changed (an untouched
      // value — e.g. a dropdown choice removed since — stays as stored).
      const patch = existing ? patchFrom(defs, editing.fields, draftFrom(defs, existing.custom_fields)) : patchFrom(defs, editing.fields)
      const needed = existing ? Object.keys(patch).length > 0 : defs.some((d) => d.active && (d.required || (patch[d.id] ?? null) !== null))
      if (needed) {
        const r = await saveCustomFieldValues('property', saved.id, patch)
        if ('error' in r) {
          setErrorField(r.fieldId ?? null)
          toast.error(`Address saved. ${r.error}`)
          // Keep the dialog open on the now-existing property so the fields can be fixed.
          const keep = saved
          setProperties((ps) => upsert(ps, keep))
          setEditing((e) => (e ? { ...e, id: keep.id } : e))
          setSaving(false)
          return
        }
        saved = { ...saved, custom_fields: r.values }
      }
      const done = saved
      setProperties((ps) => upsert(ps, done))
      setEditing(null)
      setExpanded(true)
      toast.success(editing.id ? 'Property saved' : 'Property added')
    }
    setSaving(false)
  }

  async function setActive(p: Property, active: boolean) {
    const saved = await send(`/api/properties/${p.id}`, 'PATCH', { active })
    if (saved) {
      setProperties((ps) => upsert(ps, saved))
      toast.success(active ? 'Property turned back on' : 'Property turned off')
    }
  }

  async function reloadAfterLots() {
    const res = await fetch(`/api/customers/${customerId}/properties?all=1`, { cache: 'no-store' }).catch(() => null)
    const data = (res ? await res.json().catch(() => ({})) : {}) as { properties?: Property[] }
    if (data.properties) {
      setProperties(data.properties)
      setDevNames(Array.from(new Map(data.properties.filter((p) => p.community).map((p) => [developmentKey(p.community), p.community as string])).values()).sort())
      setExpanded(true)
    }
  }

  const lotsSheet = addingLots && lots ? <AddLotsSheet customerId={customerId} developments={devNames} trades={lots.trades} canCreateJobs={lots.canCreateJobs} onClose={() => setAddingLots(false)} onDone={() => void reloadAfterLots()} /> : null

  const dialog = editing ? (
    <Dialog open onOpenChange={(open) => !open && !saving && setEditing(null)}>
      <DialogContent title={editing.id ? 'Edit property' : 'Add a property'} description="The address crews and invoices use.">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {lots ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
              <DevelopmentPicker value={editing.form.community} developments={devNames} onChange={(v) => setEditing((e) => (e ? { ...e, form: { ...e.form, community: v } } : e))} />
              <TextField label="Lot" value={editing.form.lot} max={PROPERTY_LIMITS.lot} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, lot: v } })} />
            </div>
          ) : null}
          <TextField label="Name (optional)" hint="Main office, Lot 14, Rental on Oak…" value={editing.form.label} max={PROPERTY_LIMITS.label} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, label: v } })} />
          <TextField label="Street address *" value={editing.form.address_line1} max={PROPERTY_LIMITS.line} autoComplete="address-line1" onChange={(v) => setEditing({ ...editing, form: { ...editing.form, address_line1: v } })} />
          <TextField label="Address line 2" value={editing.form.address_line2} max={PROPERTY_LIMITS.line} autoComplete="address-line2" onChange={(v) => setEditing({ ...editing, form: { ...editing.form, address_line2: v } })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem_8rem]">
            <TextField label="City" value={editing.form.city} max={PROPERTY_LIMITS.city} autoComplete="address-level2" onChange={(v) => setEditing({ ...editing, form: { ...editing.form, city: v } })} />
            <TextField label="State" value={editing.form.state} max={PROPERTY_LIMITS.state} autoComplete="address-level1" onChange={(v) => setEditing({ ...editing, form: { ...editing.form, state: v } })} />
            <TextField label="ZIP" value={editing.form.zip} max={PROPERTY_LIMITS.zip} autoComplete="postal-code" inputMode="numeric" onChange={(v) => setEditing({ ...editing, form: { ...editing.form, zip: v } })} />
          </div>
          {accessNotes ? (
            <TextField multiline label="Gate / access notes" hint="Gate code, dogs, where to park. Office and crews see this; door-knocking and call-center roles don’t." value={editing.form.access_notes} max={PROPERTY_LIMITS.access} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, access_notes: v } })} />
          ) : null}
          <TextField multiline label="Notes" value={editing.form.notes} max={PROPERTY_LIMITS.notes} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, notes: v } })} />
          {(() => {
            const existing = editing.id ? properties.find((p) => p.id === editing.id) : null
            const defs = fieldsToShow(propertyFields, 'property', existing?.custom_fields ?? {})
            return defs.length > 0 ? (
              <CustomFieldInputs defs={defs} draft={editing.fields} errorFieldId={errorField} onChange={(id, v) => setEditing({ ...editing, fields: { ...editing.fields, [id]: v } })} />
            ) : null
          })()}
          <DialogFooter className="sticky bottom-0 bg-surface pt-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!editing.form.address_line1.trim()}>
              {editing.id ? 'Save property' : 'Add property'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  ) : null

  const plain = visible.filter((p) => !p.community)
  const groups = Array.from(
    visible
      .filter((p) => p.community)
      .reduce((m, p) => {
        const key = developmentKey(p.community)
        const g = m.get(key) ?? { key, name: p.community as string, items: [] as Property[] }
        g.items.push(p)
        return m.set(key, g)
      }, new Map<string, { key: string; name: string; items: Property[] }>())
      .values()
  ).sort((x, y) => x.name.localeCompare(y.name))

  const renderRow = (p: Property) => {
              const shown = fieldsToShow(propertyFields, 'property', p.custom_fields).filter((d) => p.custom_fields[d.id] !== undefined)
              return (
                <li key={p.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {lotLabel(p) ? <p className="text-ui-sm font-semibold text-ink">{lotLabel(p)}</p> : null}
                      <p className="break-words text-ui-base font-semibold text-ink">
                        {p.label || p.address_text} {!p.active ? <Badge>Off</Badge> : null}
                      </p>
                      {p.label ? <p className="break-words text-ui-base text-ink">{p.address_text}</p> : null}
                    </div>
                    <a href={propertyMapHref(p)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">
                      Map
                    </a>
                  </div>
                  {p.access_notes ? (
                    <p className="whitespace-pre-wrap break-words rounded-ui bg-brand-50 px-3 py-2 text-ui-base text-brand-900">
                      <span className="font-semibold">Access: </span>
                      {p.access_notes}
                    </p>
                  ) : null}
                  {p.notes ? <p className="whitespace-pre-wrap break-words text-ui-base text-ink">{p.notes}</p> : null}
                  {shown.length > 0 ? (
                    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-ui-sm text-ink sm:grid-cols-[10rem_1fr]">
                      {shown.map((d) => (
                        <React.Fragment key={d.id}>
                          <dt className="font-semibold">{d.label}</dt>
                          <dd className="break-words">{displayFieldValue(d, p.custom_fields[d.id])}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  ) : null}
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void setActive(p, !p.active)}>
                        {p.active ? 'Turn off' : 'Turn back on'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
}

  if (mode === 'link' && !expanded) {
    return (
      <div>
        <div className="flex flex-wrap gap-x-4">
          <Button type="button" variant="ghost" className="px-0 text-brand-800 underline" onClick={openNew}>
            + Add another property
          </Button>
          {lots ? (
            <Button type="button" variant="ghost" className="px-0 text-brand-800 underline" onClick={() => setAddingLots(true)}>
              Add lots
            </Button>
          ) : null}
        </div>
        {dialog}
        {lotsSheet}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Properties</CardTitle>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {lots ? (
              <Button size="sm" variant="secondary" onClick={() => setAddingLots(true)}>
                Add lots
              </Button>
            ) : null}
            <Button size="sm" onClick={openNew}>
              + Add property
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-ui-base text-ink">No properties yet.</p>
        ) : (
          <>
            {plain.length > 0 ? <ul className="divide-y divide-surface-line">{plain.map(renderRow)}</ul> : null}
            {groups.map((g) => {
              const open = openDevs.includes(g.key)
              return (
                <div key={g.key} className="border-t border-surface-line py-3 first:border-t-0" data-testid="development-group">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-ui-base font-semibold text-ink">
                      {g.name} · {g.items.length} lot{g.items.length === 1 ? '' : 's'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {lots ? (
                        <a href={`/ops/developments?customer=${customerId}&development=${encodeURIComponent(g.name)}`} className="inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">
                          Board
                        </a>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => setOpenDevs((c) => (open ? c.filter((k) => k !== g.key) : [...c, g.key]))}>
                        {open ? 'Hide lots' : 'Show lots'}
                      </Button>
                    </div>
                  </div>
                  {open ? <ul className="mt-2 divide-y divide-surface-line">{g.items.map(renderRow)}</ul> : null}
                </div>
              )
            })}
          </>
        )}
        {offCount > 0 ? (
          <Button type="button" variant="ghost" className="mt-2 px-0 underline" onClick={() => setShowOff((v) => !v)}>
            {showOff ? 'Hide turned-off properties' : `Show turned-off properties (${offCount})`}
          </Button>
        ) : null}
      </CardContent>
      {dialog}
      {lotsSheet}
    </Card>
  )
}

function upsert(list: Property[], p: Property): Property[] {
  return list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]
}

function TextField({
  label,
  hint,
  value,
  max,
  onChange,
  multiline,
  autoComplete,
  inputMode,
}: {
  label: string
  hint?: string
  value: string
  max: number
  onChange: (v: string) => void
  multiline?: boolean
  autoComplete?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  return (
    <Field label={label} hint={hint}>
      {(p) =>
        multiline ? (
          <Textarea {...p} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} className="text-base" />
        ) : (
          <Input {...p} value={value} maxLength={max} autoComplete={autoComplete} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} className="text-base" />
        )
      }
    </Field>
  )
}
