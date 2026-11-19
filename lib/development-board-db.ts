/** Database side of the Development board (server only; rules in lib/development-board.ts). Everything company-scoped through orgDb. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { listDevelopments } from '@/lib/developments-db'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { buildBoard, jobIsCancelled, type BoardCrew, type BoardData, type BoardProperty } from '@/lib/development-board'
import { activeTrades, loadOrgTrades } from '@/lib/org-trades'
import { ymdInZone } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

const CHUNK = 100
/** One screen's worth: a company with more lots than this narrows by builder / development first (the page says so). */
export const BOARD_MAX_LOTS = 1500

async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK))
    if (error) throw error
    out.push(...((data ?? []) as T[]))
  }
  return out
}

/** `%` and `_` in a name must match themselves in ILIKE. */
const likeExact = (name: string) => name.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * The board for a builder and/or development (filtered IN the query, so a big company narrows before the cap, not after).
 * Over the cap the first lots are shown and `total` says how many match.
 */
export async function loadDevelopmentBoard(admin: SupabaseClient, orgId: string, filter: { customerId?: string; development?: string } = {}): Promise<BoardData> {
  const db = orgDb(admin, orgId)
  let q = db.from('properties').select('id, customer_id, community, lot, address_text', { count: 'exact' }).eq('active', true).not('community', 'is', null)
  if (filter.customerId) q = q.eq('customer_id', filter.customerId)
  if (filter.development) q = q.ilike('community', likeExact(filter.development.replace(/\s+/g, ' ').trim()))
  const { data: props, error, count } = await q.order('community', { ascending: true }).order('id', { ascending: true }).limit(BOARD_MAX_LOTS)
  if (error) throw error
  const properties = (props ?? []) as BoardProperty[]
  const total = count ?? properties.length
  const truncated = total > properties.length

  const [orgTrades, tz] = await Promise.all([loadOrgTrades(admin, orgId), loadOrgTimeZone(admin, orgId)])
  const trades = activeTrades(orgTrades).map((t) => ({ slug: t.slug, label: t.label }))
  const propertyIds = properties.map((p) => p.id)
  const crews = await inChunks<BoardCrew>(propertyIds, (ids) =>
    db.from('work_orders').select('id, job_id, property_id, trade, status, scheduled_date, completed_at').in('property_id', ids).eq('work_order_type', 'install').not('trade', 'is', null).neq('status', 'cancelled')
  )
  const jobIds = Array.from(new Set(crews.map((c) => c.job_id).filter((j): j is string => !!j)))
  const jobs = await inChunks<{ id: string; status: string | null; cancelled_at: string | null }>(jobIds, (ids) => db.from('production_jobs').select('id, status, cancelled_at').in('id', ids))
  const jobsOpen = new Set(jobs.filter((j) => !jobIsCancelled(j)).map((j) => j.id))
  const customerIds = Array.from(new Set(properties.map((p) => p.customer_id)))
  const customers = await inChunks<{ id: string; name: string | null }>(customerIds, (ids) => db.from('customers').select('id, name').in('id', ids))
  const names = new Map(customers.map((c) => [c.id, c.name ?? 'Customer']))
  // What the two filters offer: every builder with lots, and the developments of the chosen builder (or all).
  const [everyone, mine] = await Promise.all([listDevelopments(admin, orgId), filter.customerId ? listDevelopments(admin, orgId, filter.customerId) : null])
  const builderIds = Array.from(new Set(everyone.flatMap((d) => d.builders.map((b) => b.customerId))))
  const builderNames = await inChunks<{ id: string; name: string | null }>(builderIds, (ids) => db.from('customers').select('id, name').in('id', ids))
  const options = {
    builders: builderNames.map((c) => ({ id: c.id, name: c.name ?? 'Customer' })).sort((a, b) => a.name.localeCompare(b.name)),
    developments: (mine ?? everyone).map((d) => d.name),
  }
  return { trades, lots: buildBoard(properties, crews, jobsOpen, names, trades, (at) => ymdInZone(new Date(at), tz)), total, truncated, options }
}
