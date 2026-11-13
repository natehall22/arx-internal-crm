/**
 * Work categories (Residential / Commercial / New build, plus whatever the owner adds): how a company groups its work.
 *
 * ONE list per company, stored at `orgs.settings.categories.items` and written only by lib/categories-db.ts
 * (mergeOrgSettings, path ['categories']). {@link DEFAULT_CATEGORIES} is what a company reads until its owner first saves;
 * it is not a second list to edit.
 *
 * The category lives ON THE CUSTOMER (`customers.category`); a job may override it (`production_jobs.category`, e.g. a
 * residential customer's one-off new-build). {@link effectiveCategory} is the ONE answer to "which category is this job"
 * — the reporting views (rpt_jobs / rpt_invoices / rpt_revenue) compute the same `coalesce(job, customer)` in SQL.
 * Service plans, visits and invoices carry no category of their own: they follow the customer.
 *
 * Slugs are made from the label once and never change (rows keep pointing at them); a category is turned off, never
 * deleted, so every row that holds a slug stays valid. Blank = not set (not a category of its own, and not "Residential").
 *
 * Pure and client-safe. Server reads/writes: lib/categories-db.ts.
 */
import { slugForNewTrade } from '@/lib/org-trades'

export type Category = { slug: string; label: string; sort: number; active: boolean }

export const CATEGORY_LABEL_MAX = 40
export const MAX_CATEGORIES = 20
export const CATEGORY_SLUG_RE = /^[a-z][a-z0-9_]{0,39}$/

/** What every company starts with (the SQL label fallback in migration 202611240020 knows these three too). */
export const DEFAULT_CATEGORIES: readonly Category[] = Object.freeze([
  { slug: 'residential', label: 'Residential', sort: 10, active: true },
  { slug: 'commercial', label: 'Commercial', sort: 20, active: true },
  { slug: 'new_build', label: 'New build', sort: 30, active: true },
])

export function orderedCategories<T extends Pick<Category, 'sort' | 'label'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
}

export function activeCategories<T extends Pick<Category, 'sort' | 'label' | 'active'>>(list: readonly T[]): T[] {
  return orderedCategories(list).filter((c) => c.active)
}

/** Display name for any slug: the company's label, else the slug title-cased ("lawn_care" → "Lawn care"). Blank → ''. */
export function categoryLabel(slug: string | null | undefined, list: readonly Pick<Category, 'slug' | 'label'>[] = DEFAULT_CATEGORIES): string {
  const s = String(slug ?? '').trim()
  if (!s) return ''
  const known = list.find((c) => c.slug === s)?.label
  if (known) return known
  const t = s.replace(/[_-]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function cleanCategoryLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.replace(/\s+/g, ' ').trim()
  return label && label.length <= CATEGORY_LABEL_MAX ? label : null
}

/** What `orgs.settings` holds → a clean list. Anything unreadable (or absent) reads as the default list. */
export function readCategories(settings: unknown): { list: Category[]; saved: boolean } {
  const raw = (settings as { categories?: { items?: unknown } } | null | undefined)?.categories?.items
  if (!Array.isArray(raw)) return { list: DEFAULT_CATEGORIES.map((c) => ({ ...c })), saved: false }
  const seen = new Set<string>()
  const list: Category[] = []
  for (const r of raw) {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const slug = typeof o.slug === 'string' ? o.slug : ''
    const label = cleanCategoryLabel(o.label)
    if (!CATEGORY_SLUG_RE.test(slug) || !label || seen.has(slug)) continue
    seen.add(slug)
    list.push({ slug, label, sort: Number.isFinite(Number(o.sort)) ? Number(o.sort) : 0, active: o.active !== false })
  }
  return { list: orderedCategories(list), saved: true }
}

/** The ONE answer to "which category is this job": the job's own override, else its customer's. Blank on both = not set. */
export function effectiveCategory(
  jobCategory: string | null | undefined,
  customerCategory: string | null | undefined
): { slug: string | null; source: 'job' | 'customer' | null } {
  const job = String(jobCategory ?? '').trim()
  if (job) return { slug: job, source: 'job' }
  const customer = String(customerCategory ?? '').trim()
  if (customer) return { slug: customer, source: 'customer' }
  return { slug: null, source: null }
}

/**
 * Validate a category a person picked. '' / null clears it. A slug must be on the company's list and turned on — except
 * the one the row already has (a turned-off category stays valid where it is already used; it just can't be given out again).
 */
export function resolveCategoryChoice(
  list: readonly Pick<Category, 'slug' | 'active'>[],
  requested: unknown,
  current?: string | null
): { ok: true; slug: string | null } | { ok: false; error: string } {
  if (requested === null || requested === undefined || requested === '') return { ok: true, slug: null }
  if (typeof requested !== 'string') return { ok: false, error: 'Pick a category from the list' }
  if (requested === (current ?? null)) return { ok: true, slug: requested }
  const hit = list.find((c) => c.slug === requested)
  if (!hit) return { ok: false, error: 'That category is not on your list' }
  if (!hit.active) return { ok: false, error: 'That category is turned off' }
  return { ok: true, slug: hit.slug }
}

/* ------------------------------------------------------------------------ *
 * Editing the list (Settings → Job setup → Categories). Pure: returns the new list or why not.
 * ------------------------------------------------------------------------ */

export type CategoryChange =
  | { action: 'add'; label: unknown }
  | { action: 'rename'; slug: unknown; label: unknown }
  | { action: 'setActive'; slug: unknown; active: unknown }
  | { action: 'reorder'; order: unknown }

export type CategoryEdit = { ok: true; list: Category[] } | { ok: false; status: number; error: string }

const fail = (status: number, error: string): CategoryEdit => ({ ok: false, status, error })

export function applyCategoryChange(current: readonly Category[], change: CategoryChange): CategoryEdit {
  const list = orderedCategories(current).map((c) => ({ ...c }))
  const find = (slug: unknown) => (typeof slug === 'string' ? list.find((c) => c.slug === slug) ?? null : null)
  switch (change.action) {
    case 'add': {
      const label = cleanCategoryLabel(change.label)
      if (!label) return fail(400, `Enter a name up to ${CATEGORY_LABEL_MAX} characters`)
      if (list.length >= MAX_CATEGORIES) return fail(400, `Up to ${MAX_CATEGORIES} categories`)
      if (list.some((c) => c.label.toLowerCase() === label.toLowerCase())) return fail(409, `${label} is already on the list`)
      const slug = slugForNewTrade(label, list.map((c) => c.slug))
      if (!slug) return fail(400, 'Use letters or numbers in the name')
      list.push({ slug, label, sort: Math.max(0, ...list.map((c) => c.sort)) + 10, active: true })
      return { ok: true, list: orderedCategories(list) }
    }
    case 'rename': {
      const c = find(change.slug)
      if (!c) return fail(404, 'Category not found')
      const label = cleanCategoryLabel(change.label)
      if (!label) return fail(400, `Enter a name up to ${CATEGORY_LABEL_MAX} characters`)
      if (list.some((o) => o.slug !== c.slug && o.label.toLowerCase() === label.toLowerCase())) return fail(409, `${label} is already on the list`)
      c.label = label // the slug never changes, so every customer and job keeps its category
      return { ok: true, list: orderedCategories(list) }
    }
    case 'setActive': {
      const c = find(change.slug)
      if (!c) return fail(404, 'Category not found')
      if (typeof change.active !== 'boolean') return fail(400, 'active must be true or false')
      c.active = change.active // never a delete: rows that hold the slug stay valid
      return { ok: true, list: orderedCategories(list) }
    }
    case 'reorder': {
      const order = Array.isArray(change.order) ? (change.order as unknown[]) : null
      if (!order || order.length !== list.length || new Set(order).size !== order.length || !order.every((s) => typeof s === 'string' && list.some((c) => c.slug === s))) {
        return fail(400, 'Order must list every category once')
      }
      const rank = new Map(order.map((s, i) => [s as string, (i + 1) * 10]))
      return { ok: true, list: list.map((c) => ({ ...c, sort: rank.get(c.slug)! })).sort((a, b) => a.sort - b.sort) }
    }
    default:
      return fail(400, 'Unknown change')
  }
}
