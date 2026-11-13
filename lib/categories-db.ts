/**
 * Work categories, server side: the company's list (read from `orgs.settings.categories`), its ONE writer, and the ONE
 * writer of the category on a customer or a job. Rules and the "effective category" live in lib/categories.ts.
 * Called with the service client; every query is scoped to the caller's company.
 *
 * Everything here degrades quietly while migration 202611240020 (customers.category / production_jobs.category) is not
 * applied: reads return "not set", writes answer 503 with a plain message. Nothing that already works can break on it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  applyCategoryChange,
  effectiveCategory,
  readCategories,
  resolveCategoryChoice,
  type Category,
  type CategoryChange,
} from '@/lib/categories'
import { mergeOrgSettings } from '@/lib/org-settings'
import { isMissingColumn } from '@/lib/supabase/errors'

export const CATEGORIES_NOT_READY = 'Categories turn on once the database update for them is applied.'

/** The company's list (on and off), in order. A company that never saved reads the default list. */
export async function loadOrgCategories(admin: SupabaseClient, orgId: string): Promise<Category[]> {
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  return readCategories((data as { settings?: unknown } | null)?.settings).list
}

export type CategorySave = { ok: true; categories: Category[] } | { ok: false; status: number; error: string }

/** THE writer of the list (owners only — the route checks). One change, saved with a per-key settings merge. */
export async function saveCategoryChange(admin: SupabaseClient, orgId: string, change: CategoryChange): Promise<CategorySave> {
  const current = await loadOrgCategories(admin, orgId)
  const next = applyCategoryChange(current, change)
  if (!next.ok) return next
  const { error } = await mergeOrgSettings(admin, orgId, { items: next.list }, { path: ['categories'] })
  if (error) {
    console.error('[categories] save failed', error)
    return { ok: false, status: 500, error: 'Could not save' }
  }
  return { ok: true, categories: next.list }
}

type Write = { ok: true; category: string | null } | { ok: false; status: number; error: string }

/**
 * THE writer of `customers.category`. `onlyIfBlank`: fill it in, never overwrite what a person already chose.
 * `keepTurnedOff`: a slug already stored elsewhere (the lead's) is copied even when the category was turned off since —
 * off only hides it from pickers, it never erases it. It must still be on the company's list.
 */
export async function setCustomerCategory(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
  requested: unknown,
  opts: { onlyIfBlank?: boolean; keepTurnedOff?: boolean } = {}
): Promise<Write> {
  const { data: row, error: readError } = await admin.from('customers').select('category').eq('id', customerId).eq('org_id', orgId).maybeSingle()
  if (readError) return isMissingColumn(readError, 'category') ? { ok: false, status: 503, error: CATEGORIES_NOT_READY } : { ok: false, status: 500, error: 'Could not save' }
  if (!row) return { ok: false, status: 404, error: 'Customer not found' }
  const current = ((row as { category?: string | null }).category ?? null) || null
  if (opts.onlyIfBlank && current) return { ok: true, category: current }
  const list = await loadOrgCategories(admin, orgId)
  const choice = resolveCategoryChoice(opts.keepTurnedOff ? list.map((c) => ({ ...c, active: true })) : list, requested, current)
  if (!choice.ok) return { ok: false, status: 400, error: choice.error }
  if (choice.slug === current) return { ok: true, category: current }
  const { error } = await admin.from('customers').update({ category: choice.slug, updated_at: new Date().toISOString() }).eq('id', customerId).eq('org_id', orgId)
  if (error) return { ok: false, status: 500, error: 'Could not save' }
  return { ok: true, category: choice.slug }
}

/** THE writer of `production_jobs.category` (the override). null / '' = back to "same as the customer". */
export async function setJobCategory(admin: SupabaseClient, orgId: string, jobId: string, requested: unknown): Promise<Write> {
  const { data: row, error: readError } = await admin.from('production_jobs').select('category').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (readError) return isMissingColumn(readError, 'category') ? { ok: false, status: 503, error: CATEGORIES_NOT_READY } : { ok: false, status: 500, error: 'Could not save' }
  if (!row) return { ok: false, status: 404, error: 'Job not found' }
  const current = ((row as { category?: string | null }).category ?? null) || null
  const choice = resolveCategoryChoice(await loadOrgCategories(admin, orgId), requested, current)
  if (!choice.ok) return { ok: false, status: 400, error: choice.error }
  if (choice.slug === current) return { ok: true, category: current }
  const { error } = await admin.from('production_jobs').update({ category: choice.slug }).eq('id', jobId).eq('org_id', orgId)
  if (error) return { ok: false, status: 500, error: 'Could not save' }
  return { ok: true, category: choice.slug }
}

/**
 * The category a lead is created with (typed in by hand, from the website form, or a source's default): the slug when it is one
 * of the company's turned-on categories, else null. A website form may send the slug or the label; anything else (free text a
 * bot posted) is dropped, never stored. Pure given the list; `list` comes from loadOrgCategories.
 */
export function matchLeadCategory(list: readonly Category[], requested: unknown): string | null {
  if (typeof requested !== 'string' || !requested.trim()) return null
  const key = requested.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const hit = list.find((c) => c.active && (c.slug === key || c.label.trim().toLowerCase().replace(/[\s-]+/g, '_') === key))
  return hit ? hit.slug : null
}

/** THE writer of `leads.category` on an existing lead (the lead page's picker). '' / null clears it. */
export async function setLeadCategory(admin: SupabaseClient, orgId: string, leadId: string, requested: unknown): Promise<Write> {
  const { data: row, error: readError } = await admin.from('leads').select('category').eq('id', leadId).eq('org_id', orgId).maybeSingle()
  if (readError) return isMissingColumn(readError, 'category') ? { ok: false, status: 503, error: CATEGORIES_NOT_READY } : { ok: false, status: 500, error: 'Could not save' }
  if (!row) return { ok: false, status: 404, error: 'Lead not found' }
  const current = ((row as { category?: string | null }).category ?? null) || null
  const choice = resolveCategoryChoice(await loadOrgCategories(admin, orgId), requested, current)
  if (!choice.ok) return { ok: false, status: 400, error: choice.error }
  if (choice.slug === current) return { ok: true, category: current }
  const { error } = await admin.from('leads').update({ category: choice.slug }).eq('id', leadId).eq('org_id', orgId)
  if (error) return { ok: false, status: 500, error: 'Could not save' }
  return { ok: true, category: choice.slug }
}

const CHUNK = 400

/** `customers.category` for these customers. Empty (never an error) when the column is not there yet. */
export async function loadCustomerCategories(admin: SupabaseClient, orgId: string, customerIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(customerIds.filter(Boolean)))
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin.from('customers').select('id, category').eq('org_id', orgId).in('id', ids.slice(i, i + CHUNK))
    if (error) {
      if (!isMissingColumn(error, 'category')) console.error('[categories] customer read failed', error)
      return out
    }
    for (const r of (data ?? []) as { id: string; category: string | null }[]) if (r.category) out.set(r.id, r.category)
  }
  return out
}

/**
 * Put `effective_category` (job override, else customer's; null = not set) on each job row, for the Job Board.
 * A separate read on purpose: the board's own select must never fail because a column is missing.
 */
export async function enrichJobsWithCategory(admin: SupabaseClient, orgId: string, rows: Array<{ id: string; customer_id?: string | null } & Record<string, unknown>>): Promise<void> {
  const own = new Map<string, string>()
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await admin.from('production_jobs').select('id, category').eq('org_id', orgId).in('id', rows.slice(i, i + CHUNK).map((r) => r.id))
    if (error) {
      if (!isMissingColumn(error, 'category')) console.error('[categories] job read failed', error)
      return
    }
    for (const r of (data ?? []) as { id: string; category: string | null }[]) if (r.category) own.set(r.id, r.category)
  }
  const byCustomer = await loadCustomerCategories(admin, orgId, rows.map((r) => r.customer_id ?? ''))
  for (const r of rows) r.effective_category = effectiveCategory(own.get(r.id), r.customer_id ? byCustomer.get(r.customer_id) : null).slug
}
