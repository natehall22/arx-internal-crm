import type { SupabaseClient } from '@supabase/supabase-js'

import { dealRefsFor } from '@/lib/threads/get-thread'
import { resolveThreadViewer, type ViewerProfile } from '@/lib/threads/viewer'
import { canReadRowOnDeal, type Audience } from '@/lib/threads/visibility'

type FeedRow = {
  opportunity_id?: string | null
  audience?: Audience | null
  restricted_pricing?: boolean | null
  deleted_at?: string | null
}

/**
 * The old Activity cards (lead, opportunity, project pages, inside-sales queue) read `activities` with the service
 * client, which skips RLS. Every one of them passes its rows through here so removed messages, Production/Crew messages
 * and pricing-flagged messages obey the same audience rules as the thread. Rows with no audience (calls, status
 * changes, legacy notes) behave exactly as before.
 */
export async function visibleActivities<T extends FeedRow>(admin: SupabaseClient, profile: ViewerProfile, rows: T[] | null | undefined): Promise<T[]> {
  const list = (rows ?? []).filter((r) => !r.deleted_at)
  if (!list.some((r) => r.audience)) return list
  const viewer = await resolveThreadViewer(admin, profile)
  const refs = await dealRefsFor(admin, viewer.orgId, list.map((r) => r.opportunity_id).filter((x): x is string => !!x))
  return list.filter((r) => {
    if (!r.audience) return true
    const ref = r.opportunity_id ? refs.get(r.opportunity_id) ?? 'none' : 'none'
    return canReadRowOnDeal(viewer, ref, { audience: r.audience, restricted_pricing: r.restricted_pricing })
  })
}
