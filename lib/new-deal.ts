import type { SupabaseClient } from '@supabase/supabase-js'

import { getOrgBrandResult } from '@/lib/org-brand'
import { loadOrgProfileStrict, newDealProjectType } from '@/lib/org-profile'

/**
 * The ONE place a new opportunity row is inserted with its `project_type` (the five creators call it: leads/[id]/opportunity,
 * inspections/status, canvass/lead ×2, customers/[id]/add-on-opportunity — Known Redundancy 15/29).
 *
 * Type: roofing company → 'roofing'; any other profile → 'other' (needs migration 202611300060 on the enum). If the profile
 * cannot be read, the original company stays 'roofing' and everyone else gets 'other' (never silently "roofing" for another
 * company when that can be told). If the database does not know 'other' yet (deploy-order slip, Postgres 22P02), the insert is
 * retried once as 'roofing' and logged, so deal creation never fails on the type.
 */
export async function dealProjectTypeFor(client: SupabaseClient, orgId: string): Promise<'roofing' | 'other'> {
  const { profile, ok } = await loadOrgProfileStrict(client, orgId)
  if (ok) return newDealProjectType(profile)
  const brand = await getOrgBrandResult(client, orgId).catch(() => null)
  return brand?.ok && !brand.brand.original ? 'other' : 'roofing'
}

export async function insertOpportunityRow(
  client: SupabaseClient,
  orgId: string,
  row: Record<string, unknown>,
  columns?: string
) {
  const preferred = await dealProjectTypeFor(client, orgId)
  const run = (projectType: string) => {
    const q = client.from('opportunities').insert({ ...row, project_type: projectType })
    return columns ? q.select(columns).single() : q.select().single()
  }
  let res = await run(preferred)
  if (res.error && preferred !== 'roofing' && (res.error as { code?: string }).code === '22P02') {
    console.error("[new-deal] project_type 'other' is not in the database enum yet (apply migration 202611300060); retrying as 'roofing'")
    res = await run('roofing')
  }
  return res
}
