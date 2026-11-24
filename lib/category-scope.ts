/**
 * Limit a person to certain work categories (owner decision, Nathan 2026-11-24: "hide other categories everywhere").
 *
 * `users.category_limit text[]` — NULL = no limit (sees everything; every person today). Otherwise a list of category slugs from the
 * company's list (lib/categories.ts), plus the special value {@link NO_CATEGORY} (`__none`) = records with no category ("Not set").
 * An owner / admin / super admin is NEVER limited: their column is ignored. Written only by an owner / admin through
 * PUT /api/admin/users (never by the person; a DB trigger refuses a browser write).
 *
 * ONE rule module. Everything that hides a record from a limited person asks here:
 *   - {@link categoryScopeOf} (pure, from the profile that `requireAuthApi()` already loaded with `select('*')`: no extra query) or
 *     {@link loadCategoryScope} (reads the user row when only an id is known);
 *   - {@link categoryAllowed} the one predicate; {@link applyCategoryScope} the same rule as a filter on a table that HAS a
 *     `category` column (customers, leads);
 *   - the async record checks {@link customerInScope}, {@link dealInScope}, {@link jobInScope}, {@link jobHiddenFrom}; the list filters
 *     {@link filterJobsToScope}, {@link filterByCustomerScope}.
 *
 * What a record's category is (the same answers lib/categories.ts and the reporting views give):
 *   - customer: `customers.category`; blank = Not set.
 *   - job: `effectiveCategory(job.category, customer.category)` (job override, else its customer's).
 *   - deal (opportunity): its customer's category; a deal with no customer yet follows its lead; blank = Not set.
 *   - lead: its own `leads.category` (copied to the customer when the deal is made); blank = Not set.
 *   - visit / service plan / service invoice: follow the customer. A job invoice follows its job.
 * An out-of-scope record is answered EXACTLY like one that does not exist (404 / not in the list) — never a different message.
 *
 * Fail closed: a person with a limit whose category read fails sees nothing (the readers throw or drop the rows), never everything.
 * Until migration 202612010050 is applied there is no column: nobody is limited (the profile has no `category_limit` key).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { CATEGORY_SLUG_RE, effectiveCategory, type Category } from '@/lib/categories'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import { isSuperAdmin } from '@/lib/super-admin'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'

/** The special value in `users.category_limit` for records that have no category. */
export const NO_CATEGORY = '__none'

export type CategoryScope = { limited: false } | { limited: true; allowed: ReadonlySet<string> }

export const UNLIMITED_SCOPE: CategoryScope = Object.freeze({ limited: false }) as CategoryScope

type ScopeProfile = {
  role?: string | null
  is_super_admin?: boolean | null
  active?: boolean | null
  category_limit?: unknown
} | null | undefined

const isLimitValue = (v: unknown): v is string => typeof v === 'string' && (v === NO_CATEGORY || CATEGORY_SLUG_RE.test(v))

/** A person who is never limited: owner / admin role, or a super admin. */
export function isNeverLimited(profile: ScopeProfile): boolean {
  return !!profile && (isOrgSuperuserRoleSlug(profile.role) || isSuperAdmin(profile))
}

/**
 * The scope of a person, from the user row they were loaded with. Pure.
 * No `category_limit` (null / undefined / column not there) = no limit. An array = limited to its valid entries (an empty list
 * sees nothing). Anything else (a malformed value) is a limit that allows nothing — never "everything".
 */
export function categoryScopeOf(profile: ScopeProfile): CategoryScope {
  if (!profile || isNeverLimited(profile)) return UNLIMITED_SCOPE
  const raw = profile.category_limit
  if (raw === null || raw === undefined) return UNLIMITED_SCOPE
  if (!Array.isArray(raw)) return { limited: true, allowed: new Set() }
  return { limited: true, allowed: new Set(raw.filter(isLimitValue)) }
}

/** The ONE predicate: may a person with this scope see a record whose category is `slug` (blank / null = Not set)? */
export function categoryAllowed(scope: CategoryScope, slug: string | null | undefined): boolean {
  if (!scope.limited) return true
  const s = String(slug ?? '').trim()
  return scope.allowed.has(s || NO_CATEGORY)
}

/** A job's category for scope purposes: its own override, else its customer's (the same rule as the reports). */
export function jobAllowed(scope: CategoryScope, jobCategory: string | null | undefined, customerCategory: string | null | undefined): boolean {
  if (!scope.limited) return true
  return categoryAllowed(scope, effectiveCategory(jobCategory, customerCategory).slug)
}

/**
 * The scope as a PostgREST `or(...)` expression on a column of the table being read (`category` on customers / leads), or null
 * when the person is not limited. Slugs are checked against the slug pattern, so nothing else can reach the filter string.
 */
export function categoryOrFilter(scope: CategoryScope, column = 'category'): string | null {
  if (!scope.limited) return null
  const slugs = Array.from(scope.allowed).filter((s) => s !== NO_CATEGORY && CATEGORY_SLUG_RE.test(s))
  const parts: string[] = []
  if (slugs.length) parts.push(`${column}.in.(${slugs.join(',')})`)
  if (scope.allowed.has(NO_CATEGORY)) parts.push(`${column}.is.null`)
  // Nothing allowed: a value no row can hold (slugs start with a letter), so the filter matches nothing.
  return parts.length ? parts.join(',') : `${column}.eq.__nothing`
}

/** Add the scope to a query on a table with a `category` column. Unlimited: the query is returned untouched. */
export function applyCategoryScope<Q extends { or: (filters: string) => Q }>(query: Q, scope: CategoryScope, column = 'category'): Q {
  const f = categoryOrFilter(scope, column)
  return f ? query.or(f) : query
}

/* ------------------------------------------------------------------------ *
 * Writing the limit (owners / admins only — PUT /api/admin/users)
 * ------------------------------------------------------------------------ */

export type CategoryLimitInput = { ok: true; value: string[] | null } | { ok: false; error: string }

/**
 * Validate a limit an owner / admin sent. null / undefined = "All" (no limit). Otherwise a non-empty list of slugs that are on
 * THIS company's list (a slug from another company, or one that is not a category, is refused) and/or `__none`.
 */
export function resolveCategoryLimitInput(list: readonly Pick<Category, 'slug'>[], raw: unknown): CategoryLimitInput {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Pick at least one category, or choose All' }
  const known = new Set(list.map((c) => c.slug))
  const out: string[] = []
  for (const v of raw) {
    if (v !== NO_CATEGORY && !(typeof v === 'string' && known.has(v))) return { ok: false, error: 'That category is not on your list' }
    if (!out.includes(v as string)) out.push(v as string)
  }
  return { ok: true, value: out }
}

/* ------------------------------------------------------------------------ *
 * Server side. Called with the service client; every query is scoped to the company.
 * ------------------------------------------------------------------------ */

const CHUNK = 400
let limitColumnMissing = false

/** Test hook: forget that the column was once seen missing. */
export function resetCategoryLimitColumnCache() {
  limitColumnMissing = false
}

/**
 * The scope of a person known only by id (reads their own row, company-scoped). The column not being there yet = no limit.
 * Any other read failure is a limit that allows nothing (fail closed).
 */
export async function loadCategoryScope(
  admin: SupabaseClient,
  orgId: string,
  viewer: { id?: string; userId?: string }
): Promise<CategoryScope> {
  const id = viewer.id ?? viewer.userId
  if (!id || limitColumnMissing) return UNLIMITED_SCOPE
  const { data, error } = await orgDb(admin, orgId).from('users').select('role, is_super_admin, active, category_limit').eq('id', id).maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'category_limit')) {
      limitColumnMissing = true
      return UNLIMITED_SCOPE
    }
    console.error('[category-scope] limit read failed', error)
    return { limited: true, allowed: new Set() }
  }
  // No such person in this company: not a limit to apply (the caller has no profile to serve anyway).
  return categoryScopeOf((data as ScopeProfile) ?? null)
}

/**
 * Scope for a profile. A full user row (`requireAuthApi` selects `*`) already carries `category_limit`, so this costs nothing; a
 * partial profile (no such key) is read once so a shortcut object can never mean "no limit".
 */
export async function resolveCategoryScope(
  admin: SupabaseClient,
  profile: { id: string; org_id: string } & NonNullable<ScopeProfile>
): Promise<CategoryScope> {
  if ('category_limit' in profile) return categoryScopeOf(profile)
  if (isNeverLimited(profile)) return UNLIMITED_SCOPE
  return loadCategoryScope(admin, profile.org_id, { id: profile.id })
}

/** `customers.category` for these customers (blank = null). Column not there yet: everyone reads as Not set. Other errors throw. */
export async function customerCategoryMap(admin: SupabaseClient, orgId: string, customerIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const ids = Array.from(new Set(customerIds.filter((x): x is string => typeof x === 'string' && !!x)))
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await orgDb(admin, orgId).from('customers').select('id, category').in('id', ids.slice(i, i + CHUNK))
    if (error) {
      if (isMissingColumn(error, 'category')) {
        for (const id of ids) out.set(id, null)
        return out
      }
      throw new Error(`category-scope: customer read: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ id: string; category: string | null }>) out.set(r.id, r.category || null)
  }
  return out
}

/** A customer in scope? Unlimited: true without a query. A customer that does not exist is not in scope. */
export async function customerInScope(admin: SupabaseClient, orgId: string, scope: CategoryScope, customerId: string | null | undefined): Promise<boolean> {
  if (!scope.limited) return true
  if (!customerId) return false
  const map = await customerCategoryMap(admin, orgId, [customerId])
  return map.has(customerId) && categoryAllowed(scope, map.get(customerId))
}

/** A lead in scope (its own `leads.category`; a lead that does not exist is not in scope)? */
export async function leadInScope(admin: SupabaseClient, orgId: string, scope: CategoryScope, leadId: string | null | undefined): Promise<boolean> {
  if (!scope.limited) return true
  if (!leadId) return false
  const { data, error } = await orgDb(admin, orgId).from('leads').select('id, category').eq('id', leadId).maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'category')) return categoryAllowed(scope, null)
    throw new Error(`category-scope: lead read: ${error.message}`)
  }
  return !!data && categoryAllowed(scope, (data as { category: string | null }).category)
}

/** A deal in scope: its customer's category; with no customer yet, its lead's. */
export async function dealInScope(
  admin: SupabaseClient,
  orgId: string,
  scope: CategoryScope,
  deal: { customer_id?: string | null; lead_id?: string | null }
): Promise<boolean> {
  if (!scope.limited) return true
  if (deal.customer_id) return customerInScope(admin, orgId, scope, deal.customer_id)
  if (deal.lead_id) return leadInScope(admin, orgId, scope, deal.lead_id)
  return categoryAllowed(scope, null)
}

type JobRow = { id: string; customer_id?: string | null }

/**
 * Which of these jobs are in scope: job override, else customer (effective category). Returns the ids that are. Unlimited: all of
 * them, no query. A job's own category column missing (migration not applied) = every job follows its customer.
 */
export async function inScopeJobIds(admin: SupabaseClient, orgId: string, scope: CategoryScope, rows: readonly JobRow[]): Promise<Set<string>> {
  if (!scope.limited) return new Set(rows.map((r) => r.id))
  const own = new Map<string, string | null>()
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await orgDb(admin, orgId).from('production_jobs').select('id, category').in('id', ids.slice(i, i + CHUNK))
    if (error) {
      if (isMissingColumn(error, 'category')) break
      throw new Error(`category-scope: job read: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ id: string; category: string | null }>) own.set(r.id, r.category || null)
  }
  const byCustomer = await customerCategoryMap(admin, orgId, rows.map((r) => r.customer_id ?? ''))
  const ok = new Set<string>()
  for (const r of rows) if (jobAllowed(scope, own.get(r.id), r.customer_id ? byCustomer.get(r.customer_id) : null)) ok.add(r.id)
  return ok
}

/** Keep only the job rows in scope (rows need `id` and `customer_id`). Unlimited: the same array, no query. */
export async function filterJobsToScope<T extends JobRow>(admin: SupabaseClient, orgId: string, scope: CategoryScope, rows: readonly T[]): Promise<T[]> {
  if (!scope.limited) return rows as T[]
  if (rows.length === 0) return []
  const ok = await inScopeJobIds(admin, orgId, scope, rows)
  return rows.filter((r) => ok.has(r.id))
}

/**
 * Keep only rows whose CUSTOMER is in scope (visits, plans, invoices without a job, deals…). `customerIdOf` returns the row's
 * customer id; a row with none counts as Not set. Unlimited: the same array, no query.
 */
export async function filterByCustomerScope<T>(
  admin: SupabaseClient,
  orgId: string,
  scope: CategoryScope,
  rows: readonly T[],
  customerIdOf: (row: T) => string | null | undefined
): Promise<T[]> {
  if (!scope.limited) return rows as T[]
  if (rows.length === 0) return []
  const map = await customerCategoryMap(admin, orgId, rows.map((r) => customerIdOf(r) ?? ''))
  return rows.filter((r) => {
    const cid = customerIdOf(r)
    return categoryAllowed(scope, cid ? map.get(cid) : null) && (!cid || map.has(cid))
  })
}

/**
 * One job in scope? A job that does not exist is not in scope (callers already answer 404 for it). Unlimited: true, no query.
 */
export async function jobInScope(admin: SupabaseClient, orgId: string, scope: CategoryScope, jobId: string): Promise<boolean> {
  if (!scope.limited) return true
  const { data, error } = await orgDb(admin, orgId).from('production_jobs').select('id, customer_id').eq('id', jobId).maybeSingle()
  if (error) throw new Error(`category-scope: job read: ${error.message}`)
  if (!data) return false
  return (await inScopeJobIds(admin, orgId, scope, [data as JobRow])).has(jobId)
}

/**
 * The one-line job route gate: true = answer "Job not found". A person with no limit (everyone today, and every owner / admin)
 * costs nothing — no query. A limited person's read failing hides the job (fail closed).
 */
export async function jobHiddenFrom(
  admin: SupabaseClient,
  profile: { org_id: string; id?: string } & NonNullable<ScopeProfile>,
  jobId: string
): Promise<boolean> {
  const scope = categoryScopeOf(profile)
  if (!scope.limited) return false
  try {
    return !(await jobInScope(admin, profile.org_id, scope, jobId))
  } catch (e) {
    console.error('[category-scope] job gate failed closed', e)
    return true
  }
}

/**
 * Keep only the rows of mixed job / customer things (invoices, billing targets) that are in scope: a row with a `jobId` follows its
 * JOB (override, else customer); a row without one follows its customer. Unlimited: the same array, no query.
 */
export async function filterJobOrCustomerRows<T>(
  admin: SupabaseClient,
  orgId: string,
  scope: CategoryScope,
  rows: readonly T[],
  keys: (row: T) => { jobId?: string | null; customerId?: string | null }
): Promise<T[]> {
  if (!scope.limited) return rows as T[]
  if (rows.length === 0) return []
  const withJob = rows.filter((r) => !!keys(r).jobId)
  const jobOk = await inScopeJobIds(
    admin,
    orgId,
    scope,
    withJob.map((r) => ({ id: keys(r).jobId as string, customer_id: keys(r).customerId ?? null }))
  )
  const noJob = rows.filter((r) => !keys(r).jobId)
  const customerOk = new Set(await filterByCustomerScope(admin, orgId, scope, noJob, (r) => keys(r).customerId ?? null))
  return rows.filter((r) => {
    const k = keys(r)
    return k.jobId ? jobOk.has(k.jobId) : customerOk.has(r)
  })
}

/**
 * Keep only rows whose LEAD is in scope (sales appointments…). A row with no lead counts as Not set. Unlimited: the same array,
 * no query. A read error throws (callers hide the rows).
 */
export async function filterByLeadScope<T>(
  admin: SupabaseClient,
  orgId: string,
  scope: CategoryScope,
  rows: readonly T[],
  leadIdOf: (row: T) => string | null | undefined
): Promise<T[]> {
  if (!scope.limited) return rows as T[]
  const ids = Array.from(new Set(rows.map((r) => leadIdOf(r)).filter((x): x is string => !!x)))
  const cat = new Map<string, string | null>()
  let columnMissing = false
  for (let i = 0; i < ids.length && !columnMissing; i += CHUNK) {
    const { data, error } = await orgDb(admin, orgId).from('leads').select('id, category').in('id', ids.slice(i, i + CHUNK))
    if (error) {
      if (isMissingColumn(error, 'category')) {
        columnMissing = true
        break
      }
      throw new Error(`category-scope: lead read: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ id: string; category: string | null }>) cat.set(r.id, r.category || null)
  }
  return rows.filter((r) => {
    const id = leadIdOf(r)
    if (!id || columnMissing) return categoryAllowed(scope, null)
    return cat.has(id) ? categoryAllowed(scope, cat.get(id)) : false
  })
}

/**
 * One service visit (a `work_orders` row of type service_visit) in scope? It follows its customer. A visit that does not exist is
 * not in scope (callers already answer "not found" for it). Unlimited: true, no query. A read error throws.
 */
export async function visitInScope(admin: SupabaseClient, orgId: string, scope: CategoryScope, visitId: string): Promise<boolean> {
  if (!scope.limited) return true
  const { data, error } = await orgDb(admin, orgId).from('work_orders').select('id, customer_id').eq('id', visitId).maybeSingle()
  if (error) throw new Error(`category-scope: visit read: ${error.message}`)
  if (!data) return false
  const cid = (data as { customer_id: string | null }).customer_id
  return cid ? customerInScope(admin, orgId, scope, cid) : categoryAllowed(scope, null)
}

/**
 * Keep only deals (opportunities) in scope — the same rule as {@link dealInScope}: the deal's customer, else its lead, else Not set.
 * Rows need `customer_id` / `lead_id`. Unlimited: the same array, no query. A read error throws.
 */
export async function filterDealsToScope<T extends { customer_id?: string | null; lead_id?: string | null }>(
  admin: SupabaseClient,
  orgId: string,
  scope: CategoryScope,
  rows: readonly T[]
): Promise<T[]> {
  if (!scope.limited) return rows as T[]
  const withCustomer = rows.filter((r) => !!r.customer_id)
  const leadOnly = rows.filter((r) => !r.customer_id && !!r.lead_id)
  const keepC = new Set(await filterByCustomerScope(admin, orgId, scope, withCustomer, (r) => r.customer_id))
  const keepL = new Set(await filterByLeadScope(admin, orgId, scope, leadOnly, (r) => r.lead_id))
  return rows.filter((r) => (r.customer_id ? keepC.has(r) : r.lead_id ? keepL.has(r) : categoryAllowed(scope, null)))
}

/**
 * The one-line deal route gate: true = answer "not found". No limit = no query. A limited person's read failing hides the deal
 * (fail closed). A deal that does not exist is hidden too (callers already answer 404 for it).
 */
export async function dealHiddenFrom(
  admin: SupabaseClient,
  profile: { org_id: string; id?: string } & NonNullable<ScopeProfile>,
  dealId: string
): Promise<boolean> {
  const scope = categoryScopeOf(profile)
  if (!scope.limited) return false
  try {
    const { data, error } = await orgDb(admin, profile.org_id).from('opportunities').select('id, customer_id, lead_id').eq('id', dealId).maybeSingle()
    if (error || !data) return true
    return !(await dealInScope(admin, profile.org_id, scope, data as { customer_id: string | null; lead_id: string | null }))
  } catch (e) {
    console.error('[category-scope] deal gate failed closed', e)
    return true
  }
}

/**
 * Proposal route gate: true = answer "not found". A proposal follows its deal (customer, else lead); one with no deal is Not set.
 * No limit = no query; a read error hides it (fail closed).
 */
export async function proposalHiddenFrom(
  admin: SupabaseClient,
  profile: { org_id: string; id?: string } & NonNullable<ScopeProfile>,
  proposalId: string
): Promise<boolean> {
  const scope = categoryScopeOf(profile)
  if (!scope.limited) return false
  try {
    const { data, error } = await orgDb(admin, profile.org_id).from('proposals').select('id, opportunity_id').eq('id', proposalId).maybeSingle()
    if (error || !data) return true
    const oppId = (data as { opportunity_id: string | null }).opportunity_id
    if (!oppId) return !categoryAllowed(scope, null)
    return await dealHiddenFrom(admin, profile, oppId)
  } catch (e) {
    console.error('[category-scope] proposal gate failed closed', e)
    return true
  }
}

/** Keep only proposals in scope (rows need `opportunity_id`): the deal's rule; no deal = Not set. Unlimited: same array, no query. */
export async function filterProposalsToScope<T extends { opportunity_id?: string | null }>(
  admin: SupabaseClient,
  orgId: string,
  scope: CategoryScope,
  rows: readonly T[]
): Promise<T[]> {
  if (!scope.limited) return rows as T[]
  const oppIds = Array.from(new Set(rows.map((r) => r.opportunity_id).filter((x): x is string => !!x)))
  const deals: Array<{ id: string; customer_id: string | null; lead_id: string | null }> = []
  for (let i = 0; i < oppIds.length; i += CHUNK) {
    const { data, error } = await orgDb(admin, orgId).from('opportunities').select('id, customer_id, lead_id').in('id', oppIds.slice(i, i + CHUNK))
    if (error) throw new Error(`category-scope: deal read: ${error.message}`)
    deals.push(...((data ?? []) as typeof deals))
  }
  const ok = new Set((await filterDealsToScope(admin, orgId, scope, deals)).map((d) => d.id))
  return rows.filter((r) => (r.opportunity_id ? ok.has(r.opportunity_id) : categoryAllowed(scope, null)))
}

/**
 * ", category_limit" for a hand-rolled profile select, or "" until migration 202612010050 is applied, so those routes
 * keep working before it (a select naming a missing column fails the whole profile read). The probe runs once per
 * server instance once the column is there (re-checked each minute while it is not): no per-request query.
 */
let limitColumnKnown: { present: boolean; at: number } | null = null
export async function limitCol(): Promise<string> {
  if (limitColumnKnown && (limitColumnKnown.present || Date.now() - limitColumnKnown.at < 60_000)) {
    return limitColumnKnown.present ? ', category_limit' : ''
  }
  const { error } = await createServiceClient().from('users').select('category_limit').limit(0)
  limitColumnKnown = { present: !isMissingColumn(error, 'category_limit'), at: Date.now() }
  return limitColumnKnown.present ? ', category_limit' : ''
}
