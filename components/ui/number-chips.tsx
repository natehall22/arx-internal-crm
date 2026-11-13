'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { addChipNumber, removeChipNumber, unitLabel, type ChipRules } from '@/lib/chip-numbers'

/**
 * A short list of whole numbers as chips ("6 months ×") with a "+ Add" picker (presets or a typed number).
 * Used by the Customer checkups and Signing cards. The caller passes the limits its settings module enforces.
 */
export function NumberChips({
  values,
  onChange,
  rules,
  presets,
  addLabel,
  pickTitle,
  listLabel,
  disabled,
  readOnly,
  minCount = 1,
}: {
  values: number[]
  onChange: (next: number[]) => void
  rules: ChipRules
  presets: readonly number[]
  addLabel: string
  pickTitle: string
  listLabel: string
  disabled?: boolean
  readOnly?: boolean
  /** The last chips can't be removed below this many. */
  minCount?: number
}) {
  const [picking, setPicking] = useState(false)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState('')
  const full = values.length >= rules.maxCount

  function add(raw: unknown) {
    const r = addChipNumber(values, raw, rules)
    if ('error' in r) return setError(r.error)
    onChange(r.values)
    setError('')
    setCustom('')
    setPicking(false)
  }

  return (
    <div className="flex flex-col gap-2 text-[#2c2c2a]">
      <ul className="flex flex-wrap gap-2" aria-label={listLabel}>
        {values.map((n) => (
          <li key={n} className={`flex min-h-tap items-center gap-1 rounded-full border border-surface-line bg-surface pl-4 text-ui-base font-semibold ${readOnly ? 'pr-4' : 'pr-1'}`}>
            {unitLabel(n, rules.unit)}
            {!readOnly && (
              <button type="button" aria-label={`Remove ${unitLabel(n, rules.unit)}`} disabled={disabled || values.length <= minCount} onClick={() => onChange(removeChipNumber(values, n))} className="flex h-11 w-11 items-center justify-center rounded-full text-xl disabled:opacity-40">
                ×
              </button>
            )}
          </li>
        ))}
        {!readOnly && !full && (
          <li>
            <button type="button" aria-expanded={picking} disabled={disabled} onClick={() => { setPicking((v) => !v); setError('') }} className="min-h-tap rounded-full border border-dashed border-[#2c2c2a] px-4 text-ui-base font-semibold">
              {addLabel}
            </button>
          </li>
        )}
      </ul>
      {picking && !readOnly && !full && (
        <div className="flex flex-col gap-2 rounded-ui border border-surface-line bg-surface p-3">
          <p className="text-ui-sm font-semibold">{pickTitle}</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((n) => (
              <button key={n} type="button" disabled={values.includes(n)} onClick={() => add(n)} className="min-h-tap min-w-[5.5rem] rounded-ui border border-surface-line px-3 text-ui-base font-semibold disabled:opacity-40">
                {unitLabel(n, rules.unit)}
              </button>
            ))}
          </div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(custom) }}>
            <input aria-label={`Other number of ${rules.unit}s`} value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" placeholder="Other number" className="min-h-tap w-36 rounded-ui border border-surface-line bg-surface px-3 text-base text-[#2c2c2a]" />
            <Button type="submit" variant="secondary" className="min-h-tap" disabled={custom.trim() === ''}>Add</Button>
          </form>
          {error && <p role="alert" className="text-ui-sm font-semibold text-danger">{error}</p>}
        </div>
      )}
    </div>
  )
}
