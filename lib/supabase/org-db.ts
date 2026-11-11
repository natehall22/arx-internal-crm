import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Company-scoped table access. Every company shares ONE database, and the service-role client skips row-level
 * security, so a query on a company table must say which company it is for. `orgDb` says it once:
 *
 *   const db = orgDb(createServiceClient(), profile.org_id)
 *   await db.from('customers').select('id, name').eq('id', params.id).maybeSingle()   // + .eq('org_id', org)
 *   await db.from('leads').update({ status }).eq('id', leadId)                         // + .eq('org_id', org)
 *   await db.from('leads').delete().eq('id', leadId)                                   // + .eq('org_id', org)
 *   await db.from('activities').insert({ ... })                                         // org_id set for you
 *
 * - select / update / delete get `.eq('org_id', orgId)` added, so a URL id from another company finds nothing. An update may not move a row to another company
 *   (org_id in the values must equal orgId; it is not added, so no org_id column trigger fires).
 * - insert sets org_id on every row and refuses a row that names a different company.
 * - upsert is only allowed with an `onConflict` that includes org_id: a plain upsert on `id` would overwrite (and
 *   re-home) another company's row, because ON CONFLICT DO UPDATE cannot carry a WHERE.
 * - A blank orgId throws: "no company" must never mean "every company".
 *
 * `scripts/org-scope-check.mjs` (first gates after the hardcode ratchet) treats `orgDb(...).from(...)` as scoped by
 * construction. Use it for new code on company tables; raw `client.from(...)` needs its own `.eq('org_id', …)`.
 */
// The client is schema-less, so rows are untyped either way. The builder is kept loose on purpose: run through the
// client's generic select-string parser, every orgDb call site made `tsc` run out of memory.
type LooseBuilder = any
type CountOpt = { count?: 'exact' | 'planned' | 'estimated' }

export function orgDb(client: SupabaseClient, orgId: string) {
  if (typeof orgId !== 'string' || !orgId.trim()) throw new Error('orgDb: orgId is required')
  return {
    orgId,
    from(table: string) {
      const q = client.from(table) as LooseBuilder
      return {
        select(columns?: string, options?: CountOpt & { head?: boolean }): LooseBuilder {
          return q.select(columns, options).eq('org_id', orgId)
        },
        update(values: Record<string, unknown>, options?: CountOpt): LooseBuilder {
          return q.update(refuseOtherOrg(values, orgId, table), options).eq('org_id', orgId)
        },
        delete(options?: CountOpt): LooseBuilder {
          return q.delete(options).eq('org_id', orgId)
        },
        insert(values: Record<string, unknown> | Record<string, unknown>[], options?: CountOpt & { defaultToNull?: boolean }): LooseBuilder {
          const rows = Array.isArray(values) ? values.map((v) => stampOrg(v, orgId, table)) : stampOrg(values, orgId, table)
          return q.insert(rows, options)
        },
        upsert(
          values: Record<string, unknown> | Record<string, unknown>[],
          options: CountOpt & { onConflict: string; ignoreDuplicates?: boolean; defaultToNull?: boolean }
        ): LooseBuilder {
          const cols = (options?.onConflict ?? '').split(',').map((c) => c.trim())
          if (!cols.includes('org_id')) throw new Error(`orgDb(${table}).upsert: onConflict must include org_id`)
          const rows = Array.isArray(values) ? values.map((v) => stampOrg(v, orgId, table)) : stampOrg(values, orgId, table)
          return q.upsert(rows, options)
        },
      }
    },
  }
}

export type OrgDb = ReturnType<typeof orgDb>

function refuseOtherOrg(values: Record<string, unknown>, orgId: string, table: string): Record<string, unknown> {
  if (values && 'org_id' in values && values.org_id !== orgId) {
    throw new Error(`orgDb(${table}): row names a different company`)
  }
  return values
}

function stampOrg(values: Record<string, unknown>, orgId: string, table: string): Record<string, unknown> {
  return { ...refuseOtherOrg(values, orgId, table), org_id: orgId }
}

/**
 * Ids from a request that a write will STORE as references (owner, foreman, parent role, opportunity, …) must be this
 * company's: a foreign id would hang the row off another company's record (it can squat their unique keys, show up in
 * their lists, or carry their user's name into this company). Returns the field name of the first reference that is not
 * a row of `orgId` in its table, or null when all are (blank ids are skipped — "no reference" is fine).
 *
 *   const bad = await firstForeignRef(admin, profile.org_id, { foreman_user_id: ['users', body.foreman_user_id] })
 *   if (bad) return NextResponse.json({ error: `${bad} not found` }, { status: 400 })
 */
export async function firstForeignRef(
  client: SupabaseClient,
  orgId: string,
  refs: Record<string, [table: string, id: unknown]>
): Promise<string | null> {
  const db = orgDb(client, orgId)
  for (const [field, [table, id]] of Object.entries(refs)) {
    if (id === null || id === undefined || id === '') continue
    if (typeof id !== 'string') return field
    const { data, error } = await db.from(table).select('id').eq('id', id).maybeSingle()
    if (error || !data) return field
  }
  return null
}
