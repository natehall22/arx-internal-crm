/**
 * Price lists, server side (rules are pure in lib/price-list.ts). Every read is company-scoped through orgDb.
 * Works before migration 202611220030: a missing column simply reads as "none" (no pointers, no options).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'
import { isMissingColumn } from '@/lib/supabase/errors'
import { resolvePriceList, stampPriceOptions, type PriceListRef } from '@/lib/price-list'

export type PriceList = PriceListRef & { name: string; is_default: boolean }

/** The company's price lists, default first. A company with none gets []. */
export async function loadPriceLists(admin: SupabaseClient, orgId: string): Promise<PriceList[]> {
  const { data } = await orgDb(admin, orgId).from('pricebooks').select('id, name, is_default').order('is_default', { ascending: false }).order('name')
  return ((data ?? []) as Array<{ id: string; name: string | null; is_default: boolean | null }>).map((r) => ({ id: r.id, name: r.name || 'Price list', is_default: r.is_default === true }))
}

/** A customer's own list pointer (null when none, or before the migration). */
export async function loadCustomerPriceListId(admin: SupabaseClient, orgId: string, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null
  const { data, error } = await orgDb(admin, orgId).from('customers').select('pricebook_id').eq('id', customerId).maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'pricebook_id')) return null
    throw new Error(`price list: read customer: ${error.message}`)
  }
  return ((data as { pricebook_id?: string | null } | null)?.pricebook_id) ?? null
}

/** The list a quote uses: the quote's own, else the customer's, else the default. */
export async function resolveQuotePriceList(
  admin: SupabaseClient,
  orgId: string,
  input: { quoteListId?: string | null; customerId?: string | null }
) {
  const [lists, customerListId] = await Promise.all([loadPriceLists(admin, orgId), loadCustomerPriceListId(admin, orgId, input.customerId)])
  return { lists, ...resolvePriceList({ quoteListId: input.quoteListId, customerListId, lists }) }
}

/** A list id from a request is kept only when it is one of THIS company's lists. */
export async function ownListIdOrNull(admin: SupabaseClient, orgId: string, id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await orgDb(admin, orgId).from('pricebooks').select('id').eq('id', id).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Quote lines about to be saved: the stored option name/price come from the price book, never from the browser. */
export async function stampLineOptions<T extends Record<string, unknown>>(admin: SupabaseClient, orgId: string, lines: readonly T[]) {
  const ids = Array.from(new Set(lines.filter((l) => typeof l.price_option_key === 'string' && typeof l.pricebook_item_id === 'string').map((l) => l.pricebook_item_id as string)))
  const byId = new Map<string, { name?: string | null; price_options?: unknown }>()
  if (ids.length) {
    const { data, error } = await orgDb(admin, orgId).from('pricebook_items').select('id, name, price_options').in('id', ids)
    if (error && !isMissingColumn(error, 'price_options')) throw new Error(`price list: read options: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; name?: string | null; price_options?: unknown }>) byId.set(r.id, r)
  }
  return stampPriceOptions(lines, byId)
}
