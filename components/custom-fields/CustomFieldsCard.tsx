'use client'

import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, toast } from '@/components/ui'
import {
  displayFieldValue,
  fieldsToShow,
  isBlankValue,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from '@/lib/custom-fields'

/** Form values while editing: everything is a string (Yes/No = 'yes' | 'no' | ''), converted by the server validator. */
export type DraftValues = Record<string, string>

export function draftFrom(defs: CustomFieldDefinition[], values: Record<string, unknown>): DraftValues {
  const out: DraftValues = {}
  for (const d of defs) {
    const v = values[d.id]
    out[d.id] = isBlankValue(v) ? '' : d.field_type === 'yes_no' ? (v === true ? 'yes' : v === false ? 'no' : '') : String(v)
  }
  return out
}

/** The patch the API takes: every ACTIVE field shown, blank = clear (null). Turned-off fields are read-only, never sent. */
export function patchFrom(defs: CustomFieldDefinition[], draft: DraftValues): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const d of defs) {
    if (!d.active) continue
    const v = (draft[d.id] ?? '').trim()
    out[d.id] = v === '' ? null : v
  }
  return out
}

/** The inputs for a set of fields (also used inside the property dialog). Inputs are 16px (no iOS zoom), ≥44px tall. */
export function CustomFieldInputs({
  defs,
  draft,
  onChange,
  errorFieldId,
}: {
  defs: CustomFieldDefinition[]
  draft: DraftValues
  onChange: (id: string, value: string) => void
  errorFieldId?: string | null
}) {
  return (
    <div className="flex flex-col gap-3">
      {defs.map((d) => {
        const label = `${d.label}${d.required && d.active ? ' *' : ''}`
        const value = draft[d.id] ?? ''
        const error = errorFieldId === d.id ? 'Check this field' : null
        if (!d.active) {
          return (
            <div key={d.id} className="flex flex-col gap-1">
              <span className="text-ui-sm font-semibold text-ink">{d.label} (turned off)</span>
              <span className="text-ui-base text-ink">{value || '—'}</span>
            </div>
          )
        }
        return (
          <Field key={d.id} label={label} error={error}>
            {(p) =>
              d.field_type === 'dropdown' || d.field_type === 'yes_no' ? (
                <Select {...p} value={value} onChange={(e) => onChange(d.id, e.target.value)} className="text-base">
                  <option value="">—</option>
                  {d.field_type === 'yes_no' ? (
                    <>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </>
                  ) : (
                    <>
                      {/* A stored choice that was later removed from the list still shows, so saving doesn't silently drop it. */}
                      {value && !d.options.some((o) => o === value) ? <option value={value}>{value} (old choice)</option> : null}
                      {d.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </>
                  )}
                </Select>
              ) : (
                <Input
                  {...p}
                  type={d.field_type === 'date' ? 'date' : 'text'}
                  inputMode={d.field_type === 'number' ? 'decimal' : undefined}
                  value={value}
                  maxLength={d.field_type === 'text' ? 2000 : 40}
                  onChange={(e) => onChange(d.id, e.target.value)}
                  className="text-base"
                />
              )
            }
          </Field>
        )
      })}
    </div>
  )
}

/** Save values for one record through the one writer. Returns the merged values, or null after showing the error. */
export async function saveCustomFieldValues(
  entity: CustomFieldEntity,
  id: string,
  values: Record<string, string | null>
): Promise<{ values: Record<string, unknown> } | { error: string; fieldId?: string }> {
  const res = await fetch('/api/custom-fields/values', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity, id, values }),
  }).catch(() => null)
  const data = (res ? await res.json().catch(() => ({})) : {}) as { values?: Record<string, unknown>; error?: string; fieldId?: string }
  if (!res || !res.ok || !data.values) return { error: data.error || 'Could not save', fieldId: data.fieldId }
  return { values: data.values }
}

/**
 * "Details" card: the company's own fields for one customer or job. Renders NOTHING when the company has no fields for
 * this record type (so a company that never adds any sees no change). Edit opens the form in place.
 */
export default function CustomFieldsCard({
  entity,
  recordId,
  definitions,
  initialValues,
  canEdit,
  title = 'Details',
}: {
  entity: CustomFieldEntity
  recordId: string
  definitions: CustomFieldDefinition[]
  initialValues: Record<string, unknown>
  canEdit: boolean
  title?: string
}) {
  const [values, setValues] = React.useState(initialValues)
  const [draft, setDraft] = React.useState<DraftValues | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [errorField, setErrorField] = React.useState<string | null>(null)
  const shown = fieldsToShow(definitions, entity, values)
  if (shown.length === 0) return null
  const editable = canEdit && shown.some((d) => d.active)

  async function save() {
    if (!draft) return
    setSaving(true)
    const r = await saveCustomFieldValues(entity, recordId, patchFrom(shown, draft))
    setSaving(false)
    if ('error' in r) {
      setErrorField(r.fieldId ?? null)
      toast.error(r.error)
      return
    }
    setValues(r.values)
    setDraft(null)
    setErrorField(null)
    toast.success('Saved')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {editable && !draft ? (
          <Button size="sm" variant="secondary" onClick={() => setDraft(draftFrom(shown, values))}>
            Edit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {draft ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="flex flex-col gap-3"
          >
            <CustomFieldInputs defs={shown} draft={draft} errorFieldId={errorField} onChange={(id, v) => setDraft((d) => ({ ...(d ?? {}), [id]: v }))} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => { setDraft(null); setErrorField(null) }}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-ui-base text-ink sm:grid-cols-[12rem_1fr]">
            {shown.map((d) => (
              <React.Fragment key={d.id}>
                <dt className="font-semibold text-ink">{d.label}</dt>
                <dd className="whitespace-pre-wrap break-words">{displayFieldValue(d, values[d.id])}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
