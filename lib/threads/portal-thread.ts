/**
 * What a customer sees of their conversation with the company: the portal's ONE reader of `activities`.
 *
 * A dedicated allow-list, never the staff visibility rules (`visibility.ts`): only rows of THIS customer in THIS company that
 * are either said TO them (audience 'customer') or written BY them from the portal or by text (origin 'customer_portal' / 'sms'), not removed.
 * Internal notes, sales/production/crew talk, system rows and logged calls never match either test. Named columns only — no
 * author, no priority, no pricing flag, nothing a staff member typed beyond the message itself.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'

export type PortalThreadMessage = { id: string; fromCustomer: boolean; body: string; date: string }

type Row = { id: string; body: string | null; created_at: string; origin: string | null; audience: string | null }
const COLS = 'id, body, created_at, origin, audience'

export async function loadPortalThread(admin: SupabaseClient, orgId: string, customerId: string, limit = 50): Promise<PortalThreadMessage[]> {
  const db = orgDb(admin, orgId)
  const base = () => db.from('activities').select(COLS).eq('customer_id', customerId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit)
  const [toCustomer, fromCustomer] = await Promise.all([base().eq('audience', 'customer'), base().in('origin', ['customer_portal', 'sms'])])
  const seen = new Set<string>()
  const out: PortalThreadMessage[] = []
  for (const r of [...((toCustomer.data ?? []) as Row[]), ...((fromCustomer.data ?? []) as Row[])]) {
    if (seen.has(r.id) || !r.body) continue
    // Belt and braces: the query already filtered, the row must still pass the same test here.
    const mine = r.origin === 'customer_portal' || r.origin === 'sms'
    if (!mine && r.audience !== 'customer') continue
    seen.add(r.id)
    out.push({ id: r.id, fromCustomer: mine, body: r.body, date: r.created_at })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
}
