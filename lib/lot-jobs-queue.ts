/**
 * Lot jobs on the "Jobs to schedule" list (Today screen, dashboard card, owner morning email). A builder's development can have
 * hundreds of lot jobs waiting for a crew date; listing them one by one would bury every other job, so they are summarized per
 * development ("Oak Ridge: 40 lots to schedule"). Server only; only called for companies with property tools on.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { developmentKey } from '@/lib/properties'
import { orgDb } from '@/lib/supabase/org-db'

const CHUNK = 100
const MAX_JOBS = 5000

export type LotJobsToSchedule = { jobIds: Set<string>; byDevelopment: Array<{ name: string; count: number }> }

/** Jobs waiting for a date (sold / materials, no date, not cancelled) whose property is in a development. A failed read = none (the list is then shown as before). */
export async function loadLotJobsToSchedule(admin: SupabaseClient, orgId: string): Promise<LotJobsToSchedule> {
  const none: LotJobsToSchedule = { jobIds: new Set(), byDevelopment: [] }
  const db = orgDb(admin, orgId)
  const { data, error } = await db
    .from('production_jobs')
    .select('id, property_id')
    .neq('status', 'cancelled')
    .in('status', ['sold', 'materials'])
    .is('scheduled_date', null)
    .is('cancelled_at', null)
    .not('property_id', 'is', null)
    .limit(MAX_JOBS)
  if (error) {
    console.error('[lot-jobs-queue] jobs read failed', error)
    return none
  }
  const jobs = (data ?? []) as Array<{ id: string; property_id: string }>
  if (jobs.length === 0) return none
  const community = new Map<string, string>()
  const ids = Array.from(new Set(jobs.map((j) => j.property_id)))
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: props, error: pe } = await db.from('properties').select('id, community').in('id', ids.slice(i, i + CHUNK)).not('community', 'is', null)
    if (pe) {
      console.error('[lot-jobs-queue] properties read failed', pe)
      return none
    }
    for (const p of (props ?? []) as Array<{ id: string; community: string }>) community.set(p.id, p.community)
  }
  const out: LotJobsToSchedule = { jobIds: new Set(), byDevelopment: [] }
  const byKey = new Map<string, { name: string; count: number }>()
  for (const j of jobs) {
    const name = community.get(j.property_id)
    if (!name) continue
    out.jobIds.add(j.id)
    const key = developmentKey(name)
    const e = byKey.get(key) ?? { name, count: 0 }
    e.count += 1
    byKey.set(key, e)
  }
  out.byDevelopment = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function lotSummaryText(name: string, count: number): string {
  return `${name}: ${count} lot${count === 1 ? '' : 's'} to schedule`
}
