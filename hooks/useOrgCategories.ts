'use client'

import * as React from 'react'

import type { Category } from '@/lib/categories'

let cached: Promise<Category[]> | null = null

/** The company's categories, fetched once per page load from GET /api/categories (any signed-in person). null while loading. */
export function useOrgCategories(initial?: Category[] | null): Category[] | null {
  const [list, setList] = React.useState<Category[] | null>(initial ?? null)
  React.useEffect(() => {
    if (initial) return
    let live = true
    if (!cached) {
      cached = fetch('/api/categories', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { categories: [] }))
        .then((d: { categories?: Category[] }) => (Array.isArray(d.categories) ? d.categories : []))
        .catch(() => {
          cached = null
          return [] as Category[]
        })
    }
    void cached.then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [initial])
  return list
}

/** After the owner edits the list, the next reader fetches the new one. */
export function forgetOrgCategories(): void {
  cached = null
}
