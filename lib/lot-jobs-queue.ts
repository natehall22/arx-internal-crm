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
  const lots = await loadLotsByProperty(db, jobs.map((j) => j.property_id))
  if (!lots) return none
  const community = new Map<string, string>(Array.from(lots, ([id, l]) => [id, l.community]))
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

/** Development name + lot number per property id, for properties in a development. null = the read failed (callers fall back). */
export async function loadLotsByProperty(db: ReturnType<typeof orgDb>, propertyIds: readonly string[]): Promise<Map<string, { community: string; lot: string | null; customerId: string | null }> | null> {
  const out = new Map<string, { community: string; lot: string | null; customerId: string | null }>()
  const ids = Array.from(new Set(propertyIds.filter(Boolean)))
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('properties').select('id, community, lot, customer_id').in('id', ids.slice(i, i + CHUNK)).not('community', 'is', null)
    if (error) {
      console.error('[lot-jobs] properties read failed', error)
      return null
    }
    for (const p of (data ?? []) as Array<{ id: string; community: string; lot: string | null; customer_id: string | null }>) {
      if (p.community?.trim()) out.set(p.id, { community: p.community.trim(), lot: p.lot?.trim() || null, customerId: p.customer_id ?? null })
    }
  }
  return out
}

/**
 * Job Board: marks each job whose property is a lot in a development (`job.development`), so the board can show a builder's
 * development as one card instead of a card per lot. Jobs not on a lot (every roofing job today) get nothing; a failed read
 * marks nothing (the board then shows one card per job, as before).
 */
export async function enrichJobsWithDevelopment(admin: SupabaseClient, orgId: string, jobs: Array<Record<string, unknown>>): Promise<void> {
  const ids = jobs.map((j) => j.property_id).filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (ids.length === 0) return
  const lots = await loadLotsByProperty(orgDb(admin, orgId), ids)
  if (!lots) return
  for (const j of jobs) {
    const l = typeof j.property_id === 'string' ? lots.get(j.property_id) : undefined
    if (l) j.development = { name: l.community, key: developmentKey(l.community), lot: l.lot, customerId: l.customerId }
  }
}

export function lotSummaryText(name: string, count: number): string {
  return `${name}: ${count} lot${count === 1 ? '' : 's'} to schedule`
}
