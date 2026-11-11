import type { SupabaseClient } from '@supabase/supabase-js'
import { firstForeignRef } from '@/lib/supabase/org-db'

/** The estimate-line columns a client may set (POST and PATCH share it). id, org_id, estimate_id, totals are server-set. */
export const ESTIMATE_LINE_FIELDS = new Set([
  'name', 'category', 'unit', 'qty', 'unit_price', 'line_total', 'is_labor', 'is_taxable', 'sort_order', 'pricebook_item_id', 'notes',
])

/** Picks the settable fields; null when the pricebook item named is not this company's. */
export async function pickEstimateLineFields(
  client: SupabaseClient,
  orgId: string,
  raw: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw ?? {})) if (ESTIMATE_LINE_FIELDS.has(key)) out[key] = raw[key]
  if (await firstForeignRef(client, orgId, { pricebook_item_id: ['pricebook_items', out.pricebook_item_id] })) return null
  return out
}
