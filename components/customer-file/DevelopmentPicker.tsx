'use client'

import * as React from 'react'

import { Field, Input, Select } from '@/components/ui'
import { developmentKey } from '@/lib/properties'

const NEW = '__new__'

/**
 * Pick the development from the company's existing names, or "+ New development". Never free text beside the list: a typed
 * name that matches an existing one (case and spacing ignored) snaps to the existing spelling, so there are no two "Oak Ridge"s.
 * `value` is the name ('' = none yet).
 */
export default function DevelopmentPicker({ value, onChange, developments, label = 'Development', required = false }: { value: string; onChange: (v: string) => void; developments: string[]; label?: string; required?: boolean }) {
  const match = developments.find((d) => developmentKey(d) === developmentKey(value))
  const [adding, setAdding] = React.useState(developments.length === 0 || (!!value && !match))
  const selectValue = adding ? NEW : match ?? ''
  const typedMatch = adding ? developments.find((d) => developmentKey(d) === developmentKey(value)) : undefined
  return (
    <div className="flex flex-col gap-3">
      {developments.length > 0 ? (
        <Field label={required ? `${label} *` : label}>
          {(p) => (
            <Select
              {...p}
              value={selectValue}
              className="text-base"
              onChange={(e) => {
                if (e.target.value === NEW) {
                  setAdding(true)
                  onChange('')
                } else {
                  setAdding(false)
                  onChange(e.target.value)
                }
              }}
            >
              <option value="">{required ? 'Choose a development…' : 'None'}</option>
              {developments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value={NEW}>+ New development</option>
            </Select>
          )}
        </Field>
      ) : null}
      {adding ? (
        <Field label={developments.length > 0 ? 'New development name' : required ? `${label} *` : label} hint={typedMatch ? `That is already “${typedMatch}” — it will be used.` : undefined}>
          {(p) => (
            <Input
              {...p}
              value={value}
              maxLength={120}
              className="text-base"
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => {
                if (typedMatch) {
                  onChange(typedMatch)
                  setAdding(developments.length === 0)
                }
              }}
            />
          )}
        </Field>
      ) : null}
    </div>
  )
}
