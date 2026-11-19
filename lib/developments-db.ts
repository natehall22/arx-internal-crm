/**
 * Developments — the names a company's lots are grouped under (`properties.community`). Per PROPERTY, never per customer:
 * one builder can run several developments at once and one development can have several builders. There is no table; the
 * list is the distinct names on the company's active properties, compared case- and space-insensitively
 * (lib/properties.ts developmentKey) so "Oak Ridge" and "oak ridge " are one development. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import * as React from 'react'

import { developmentKey } from '@/lib/properties'
import { orgDb } from '@/lib/supabase/org-db'

export type Development = {
  /** The spelling on file (the first one used; every later save is matched to it). */
  name: string
  key: string
  lots: number
  /** Builders (customers) with lots in it, with how many each. */
  builders: Array<{ customerId: string; lots: number }>
}

/** React's per-request memo where it exists (the Next server runtime); a plain call elsewhere (jest). */
const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  typeof (React as { cache?: unknown }).cache === 'function' ? (React as unknown as { cache: <F>(fn: F) => F }).cache : (fn) => fn
/** One map per server render: the same company's list is read once however many places ask (page, property save, Add lots). */
const renderCache = perRequest(() => new Map<string, Promise<Development[]>>())

const PAGE = 1000
const MAX_ROWS = 20_000

/**
 * The company's developments (optionally only those a given builder has lots in). Built for the pick-lists and for billing
 * per development: `lots` and `builders` are counts of ACTIVE properties. A failed or not-yet-migrated read gives [].
 */
export function listDevelopments(admin: SupabaseClient, orgId: string, customerId?: string | null): Promise<Development[]> {
  const cache = renderCache()
  const key = `${orgId}|${customerId ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const read = readDevelopments(admin, orgId, customerId)
  cache.set(key, read)
  return read
}

async function readDevelopments(admin: SupabaseClient, orgId: string, customerId?: string | null): Promise<Development[]> {
  const byKey = new Map<string, Development>()
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = orgDb(admin, orgId).from('properties').select('community, customer_id, created_at').eq('active', true).not('community', 'is', null)
    if (customerId) q = q.eq('customer_id', customerId)
    const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) {
      console.error('[developments] list failed', error)
      return []
    }
    const rows = (data ?? []) as Array<{ community: string; customer_id: string }>
    for (const r of rows) {
      const key = developmentKey(r.community)
      if (!key) continue
      const d = byKey.get(key) ?? { name: r.community.replace(/\s+/g, ' ').trim(), key, lots: 0, builders: [] }
      d.lots += 1
      const b = d.builders.find((x) => x.customerId === r.customer_id)
      if (b) b.lots += 1
      else d.builders.push({ customerId: r.customer_id, lots: 1 })
      byKey.set(key, d)
    }
    if (rows.length < PAGE) break
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Matches a typed development to the company's existing spelling ("oak ridge " → "Oak Ridge"); a new name is just tidied. null = none. */
export function canonicalDevelopment(typed: string | null | undefined, known: readonly Pick<Development, 'name' | 'key'>[]): string | null {
  const key = developmentKey(typed)
  if (!key) return null
  return known.find((d) => d.key === key)?.name ?? (typed as string).replace(/\s+/g, ' ').trim()
}
