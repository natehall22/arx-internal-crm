/** Database side of the Development board (server only; rules in lib/development-board.ts). Everything company-scoped through orgDb. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { buildBoard, type BoardCrew, type BoardData, type BoardProperty } from '@/lib/development-board'
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

export async function loadDevelopmentBoard(admin: SupabaseClient, orgId: string): Promise<BoardData> {
  const db = orgDb(admin, orgId)
  const { data: props, error } = await db
    .from('properties')
    .select('id, customer_id, community, lot, address_text')
    .eq('active', true)
    .not('community', 'is', null)
    .order('community', { ascending: true })
    .order('id', { ascending: true })
    .limit(BOARD_MAX_LOTS + 1)
  if (error) throw error
  const all = (props ?? []) as BoardProperty[]
  const truncated = all.length > BOARD_MAX_LOTS
  const properties = truncated ? all.slice(0, BOARD_MAX_LOTS) : all

  const [orgTrades, tz] = await Promise.all([loadOrgTrades(admin, orgId), loadOrgTimeZone(admin, orgId)])
  const trades = activeTrades(orgTrades).map((t) => ({ slug: t.slug, label: t.label }))
  const propertyIds = properties.map((p) => p.id)
  const crews = await inChunks<BoardCrew>(propertyIds, (ids) =>
    db.from('work_orders').select('id, job_id, property_id, trade, status, scheduled_date, completed_at').in('property_id', ids).eq('work_order_type', 'install').not('trade', 'is', null).neq('status', 'cancelled')
  )
  const jobIds = Array.from(new Set(crews.map((c) => c.job_id).filter((j): j is string => !!j)))
  const jobs = await inChunks<{ id: string; status: string | null; cancelled_at: string | null }>(jobIds, (ids) => db.from('production_jobs').select('id, status, cancelled_at').in('id', ids))
  const jobsOpen = new Set(jobs.filter((j) => !j.cancelled_at && j.status !== 'cancelled').map((j) => j.id))
  const customerIds = Array.from(new Set(properties.map((p) => p.customer_id)))
  const customers = await inChunks<{ id: string; name: string | null }>(customerIds, (ids) => db.from('customers').select('id, name').in('id', ids))
  const names = new Map(customers.map((c) => [c.id, c.name ?? 'Customer']))
  return { trades, lots: buildBoard(properties, crews, jobsOpen, names, trades, (at) => ymdInZone(new Date(at), tz)), truncated }
}
