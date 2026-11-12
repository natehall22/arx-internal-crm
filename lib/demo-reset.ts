/**
 * Wipe ONE demo company so the seed can rebuild it (`seed:company --demo --reset`).
 *
 * The only thing that decides what may be wiped is the database flag `orgs.is_demo`, checked here (`assertDemoOrg`, uncached)
 * AND again inside the SQL function `demo_reset_org` (migration 202611180010), which refuses any other company by itself.
 * Nothing here takes a list of tables or an id from anywhere but the caller's `orgId`, and every read is scoped to it.
 * After the SQL wipe the company's login accounts (read BEFORE the wipe) are removed from Supabase Auth.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { assertDemoOrg } from '@/lib/demo-org'
import { orgDb } from '@/lib/supabase/org-db'

export type DemoResetResult = { tables: number; rows: number; logins: number; blocked: Record<string, string> }

export async function resetDemoOrg(admin: SupabaseClient, orgId: string): Promise<DemoResetResult> {
  await assertDemoOrg(admin, orgId)
  const { data: people, error: readErr } = await orgDb(admin, orgId).from('users').select('id')
  if (readErr) throw new Error(`reset: could not read the demo company's people: ${readErr.message ?? readErr.code}`)
  const loginIds = ((people ?? []) as Array<{ id: string }>).map((p) => p.id)

  const { data, error } = await admin.rpc('demo_reset_org', { p_org: orgId })
  if (error) throw new Error(`reset: demo_reset_org failed: ${error.message}`)
  const out = (data ?? {}) as { deleted?: Record<string, number>; blocked?: Record<string, string> }
  const blocked = out.blocked ?? {}
  if (Object.keys(blocked).length) {
    throw new Error(`reset stopped: these tables could not be emptied (${Object.entries(blocked).map(([t, why]) => `${t}: ${why}`).join('; ')}). Nothing was rebuilt.`)
  }
  let logins = 0
  for (const id of loginIds) {
    const r = await admin.auth.admin.deleteUser(id)
    if (!r.error) logins += 1
    else if (!/not found/i.test(r.error.message)) throw new Error(`reset: could not remove login ${id}: ${r.error.message}`)
  }
  const deleted = out.deleted ?? {}
  return { tables: Object.keys(deleted).length, rows: Object.values(deleted).reduce((s, n) => s + Number(n || 0), 0), logins, blocked }
}
