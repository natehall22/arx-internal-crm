/** `qb_links` — THE one CRM <-> QuickBooks map (company-scoped by construction). Nothing else stores a QuickBooks id. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'

export type QbLinkRow = { crm_table: string; crm_id: string; qb_type: string; qb_id: string; sync_token: string | null; fingerprint: string | null; sent_total_cents: number | null }

const COLS = 'crm_table, crm_id, qb_type, qb_id, sync_token, fingerprint, sent_total_cents'

export type QbLinks = {
  get(crmTable: string, crmId: string, qbType: string): Promise<QbLinkRow | null>
  /** Another CRM record already holds this QuickBooks record. */
  holder(qbType: string, qbId: string): Promise<QbLinkRow | null>
  put(row: { crmTable: string; crmId: string; qbType: string; qbId: string; syncToken: string | null; fingerprint?: string | null; sentTotalCents?: number | null }): Promise<{ ok: true } | { ok: false; reason: 'qb_record_taken' | 'error' }>
  count(): Promise<number>
}

export function createQbLinks(admin: SupabaseClient, orgId: string): QbLinks {
  const db = orgDb(admin, orgId)
  return {
    async get(crmTable, crmId, qbType) {
      const { data, error } = await db.from('qb_links').select(COLS).eq('crm_table', crmTable).eq('crm_id', crmId).eq('qb_type', qbType).maybeSingle()
      if (error) throw new Error(`qb_links read failed: ${error.message}`)
      return (data as QbLinkRow | null) ?? null
    },
    async holder(qbType, qbId) {
      const { data, error } = await db.from('qb_links').select(COLS).eq('qb_type', qbType).eq('qb_id', qbId).maybeSingle()
      if (error) throw new Error(`qb_links read failed: ${error.message}`)
      return (data as QbLinkRow | null) ?? null
    },
    async put(r) {
      const { error } = await db.from('qb_links').upsert(
        {
          crm_table: r.crmTable,
          crm_id: r.crmId,
          qb_type: r.qbType,
          qb_id: r.qbId,
          sync_token: r.syncToken,
          ...(r.fingerprint !== undefined ? { fingerprint: r.fingerprint } : {}),
          ...(r.sentTotalCents !== undefined ? { sent_total_cents: r.sentTotalCents } : {}),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,crm_table,crm_id,qb_type' }
      )
      if (!error) return { ok: true }
      // unique (org_id, qb_type, qb_id): that QuickBooks record is already someone else's link.
      return (error as { code?: string }).code === '23505' ? { ok: false, reason: 'qb_record_taken' } : { ok: false, reason: 'error' }
    },
    async count() {
      const { count, error } = await db.from('qb_links').select('id', { count: 'exact', head: true })
      if (error) throw new Error(`qb_links count failed: ${error.message}`)
      return count ?? 0
    },
  }
}
