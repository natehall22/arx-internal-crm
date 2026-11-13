'use client'

import * as React from 'react'

import CategoryPicker from '@/components/categories/CategoryPicker'
import { toast } from '@/components/ui'
import { useOrgCategories } from '@/hooks/useOrgCategories'
import { categoryLabel, type Category } from '@/lib/categories'

/**
 * "Category: [Not set] [Residential] [Commercial] [New build]" — saves on the tap. `url` is the one PATCH endpoint that owns
 * the value (customer: /api/customers/[id]; job: /api/ops/jobs/[id]/category). Hidden for a company whose list is empty
 * (everything turned off and nothing set) — a company that does not use categories sees nothing.
 *
 * `inheritFrom`: on a job, the customer's category — the first chip reads "Same as customer (Residential)".
 * `readOnly`: people who can see but not edit get the plain word.
 */
export default function CategoryField({
  url,
  value: initial,
  inheritFrom,
  readOnly = false,
  initialCategories,
  label = 'Category',
  onSaved,
}: {
  url: string
  value: string | null
  inheritFrom?: string | null | undefined
  readOnly?: boolean
  initialCategories?: Category[] | null
  label?: string
  onSaved?: (slug: string | null) => void
}) {
  const list = useOrgCategories(initialCategories)
  const [value, setValue] = React.useState<string | null>(initial)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => setValue(initial), [initial])
  if (!list) return null
  const anyOn = list.some((c) => c.active)
  if (!anyOn && !value && !inheritFrom) return null

  const isJob = inheritFrom !== undefined
  const blankLabel = isJob ? (inheritFrom ? `Same as customer (${categoryLabel(inheritFrom, list)})` : 'Same as customer') : 'Not set'

  async function pick(slug: string | null) {
    const before = value
    setValue(slug)
    setSaving(true)
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: slug }) }).catch(() => null)
    setSaving(false)
    if (!res || !res.ok) {
      setValue(before)
      const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
      toast.error(out.error || 'Could not save the category')
      return
    }
    onSaved?.(slug)
  }

  if (readOnly) {
    const shownSlug = value ?? inheritFrom ?? null
    return (
      <p className="text-ui-base text-ink">
        <span className="font-semibold">{label}:</span> {shownSlug ? categoryLabel(shownSlug, list) : 'Not set'}
        {isJob && !value && inheritFrom ? ' (same as customer)' : ''}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm font-semibold text-ink">{label}</span>
      <CategoryPicker options={list} value={value} onChange={pick} blankLabel={blankLabel} disabled={saving} label={label} />
    </div>
  )
}
