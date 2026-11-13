'use client'

import * as React from 'react'

import { activeCategories, categoryLabel, type Category } from '@/lib/categories'

/**
 * One-tap category choice: every category is a button, the first one is "not set" (or, on a job, "Same as customer (Residential)").
 * Plain chips, not a dropdown: the common change is one tap. A category that is turned off still shows while the row holds it.
 * Controlled; CategoryField below saves it.
 */
export default function CategoryPicker({
  options,
  value,
  onChange,
  blankLabel = 'Not set',
  disabled = false,
  label = 'Category',
}: {
  options: readonly Category[]
  value: string | null
  onChange: (slug: string | null) => void
  /** The first chip, meaning "no choice": "Not set" for a customer, "Same as customer (Residential)" on a job. */
  blankLabel?: string
  disabled?: boolean
  label?: string
}) {
  const shown = activeCategories(options)
  // The row may hold a category that was turned off since: keep it visible so the choice is not silently hidden.
  const held = value && !shown.some((c) => c.slug === value) ? { slug: value, label: categoryLabel(value, options), sort: 0, active: false } : null
  const chips: Array<{ slug: string | null; label: string }> = [{ slug: null, label: blankLabel }, ...(held ? [{ slug: held.slug, label: `${held.label} (off)` }] : []), ...shown.map((c) => ({ slug: c.slug, label: c.label }))]
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const on = (value ?? null) === c.slug
        return (
          <button
            key={c.slug ?? '__blank'}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(c.slug)}
            className={`inline-flex min-h-tap items-center rounded-full border px-4 text-ui-base text-ink disabled:opacity-60 ${on ? 'border-brand-700 bg-brand-100 font-semibold' : 'border-surface-line bg-surface'}`}
          >
            {on ? '✓ ' : ''}
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
