'use client'

import * as React from 'react'

export type MachineOption = { id: string; name: string }

/**
 * Machines for a plan's visits or one visit: the company's machines (price-book items billed by the hour, the same list the time
 * clock offers) as big tick rows. A machine already on the plan but no longer offered stays listed ("no longer offered") so it can
 * be unticked. Pure UI: the caller saves.
 */
export default function MachinePicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: MachineOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const known = new Set(options.map((o) => o.id))
  const rows = [...options, ...value.filter((id) => !known.has(id)).map((id) => ({ id, name: 'Machine (no longer offered)' }))]
  if (rows.length === 0) return <p className="text-ui-base text-ink">No machines yet. Add them to the price book with the unit “hour”.</p>
  return (
    <ul className="flex flex-col">
      {rows.map((o) => (
        <li key={o.id}>
          <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
            <input
              type="checkbox"
              className="h-6 w-6"
              disabled={disabled}
              checked={value.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
            />
            <span className="min-w-0 break-words">{o.name}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
