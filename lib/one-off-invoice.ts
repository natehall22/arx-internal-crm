/**
 * "New invoice" from the customer page: a one-off invoice made of price-book lines and typed lines. It is NOT a second invoice
 * writer: the lines become `ServiceInvoiceLine`s and go to `createServiceInvoiceFromLines` (lib/invoices.ts, SQL
 * create_service_invoice — the one way an invoice without a job is made, with the one tax calculation). The invoice is born a
 * draft; the office reviews it, then emails it or marks it paid like any other. Price-book lines are priced HERE from the price
 * book (the customer's own list; an option's price), never from what the browser sent; a typed line is the office's own price.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceInvoiceFromLines, type ServiceInvoiceLine } from '@/lib/invoices'
import { itemsForList, lineNameWithOption, readPriceOptions, resolveLinePrice } from '@/lib/price-list'
import { resolveQuotePriceList } from '@/lib/price-list-server'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export const MAX_ONE_OFF_LINES = 40

export type OneOffLineInput =
  | { kind: 'item'; itemId: string; optionKey: string | null; qty: number; priceCents: number | null }
  | { kind: 'typed'; description: string; qty: number; priceCents: number; taxable: boolean }

export type OneOffBody = { lines: OneOffLineInput[]; propertyId: string | null; publicNote: string | null }

const isQty = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000
const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100_000_000

/** Pure: a request body → validated lines (or the sentence to show the office). */
export function parseOneOffBody(body: unknown): { ok: true; value: OneOffBody } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!Array.isArray(b.lines) || b.lines.length === 0) return { ok: false, error: 'Add at least one line' }
  if (b.lines.length > MAX_ONE_OFF_LINES) return { ok: false, error: `An invoice holds up to ${MAX_ONE_OFF_LINES} lines` }
  const lines: OneOffLineInput[] = []
  for (const raw of b.lines) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (!isQty(l.qty)) return { ok: false, error: 'Every line needs a quantity above zero' }
    if (typeof l.itemId === 'string' && l.itemId) {
      if (l.priceCents != null && !isCents(l.priceCents)) return { ok: false, error: 'A price is not valid' }
      lines.push({ kind: 'item', itemId: l.itemId, optionKey: typeof l.optionKey === 'string' && l.optionKey ? l.optionKey : null, qty: l.qty, priceCents: (l.priceCents as number | null | undefined) ?? null })
      continue
    }
    const description = typeof l.description === 'string' ? l.description.trim().slice(0, 200) : ''
    if (!description) return { ok: false, error: 'Every line needs a description' }
    if (!isCents(l.priceCents)) return { ok: false, error: 'Every line needs a price' }
    lines.push({ kind: 'typed', description, qty: l.qty, priceCents: l.priceCents, taxable: l.taxable === true })
  }
  const propertyId = typeof b.propertyId === 'string' && b.propertyId ? b.propertyId : null
  const publicNote = typeof b.publicNote === 'string' && b.publicNote.trim() ? b.publicNote.trim().slice(0, 1000) : null
  return { ok: true, value: { lines, propertyId, publicNote } }
}

export type CatalogItem = { id: string; name: string; unit: string; unitPriceCents: number; taxable: boolean; options: Array<{ key: string; label: string; priceCents: number }> }

const ITEM_COLS = 'id, name, unit, unit_price, is_taxable, active, pricebook_id, price_options'

async function readItems(admin: SupabaseClient, orgId: string, ids?: string[]) {
  const run = (cols: string) => {
    const q = orgDb(admin, orgId).from('pricebook_items').select(cols)
    return (ids ? q.in('id', ids) : q.order('name').limit(1000)) as Promise<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }>
  }
  let res = await run(ITEM_COLS)
  if (res.error && (isMissingColumn(res.error, 'pricebook_id') || isMissingColumn(res.error, 'price_options'))) res = await run('id, name, unit, unit_price, is_taxable, active')
  if (res.error) throw new Error(`one-off invoice: read price book: ${res.error.message}`)
  return res.data ?? []
}

/** The active price-book items THIS customer is quoted from (their price list, else the default), for the New invoice sheet. */
export async function loadCustomerCatalog(admin: SupabaseClient, orgId: string, customerId: string): Promise<CatalogItem[]> {
  const [rows, list] = await Promise.all([readItems(admin, orgId), resolveQuotePriceList(admin, orgId, { customerId })])
  const items = itemsForList(rows as Array<{ pricebook_id?: string | null }>, list.lists.length, list.id) as Array<Record<string, unknown>>
  return items
    .filter((r) => r.active !== false)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? 'Item'),
      unit: String(r.unit ?? ''),
      unitPriceCents: Math.round((Number(r.unit_price) || 0) * 100),
      taxable: r.is_taxable !== false,
      options: readPriceOptions(r.price_options).map((o) => ({ key: o.key, label: o.label, priceCents: Math.round(o.price * 100) })),
    }))
}

/** The lines as `create_service_invoice` takes them. Throws a sentence for a price-book line that cannot be priced. */
export async function buildOneOffLines(admin: SupabaseClient, orgId: string, customerId: string, inputs: OneOffLineInput[]): Promise<ServiceInvoiceLine[]> {
  const itemIds = Array.from(new Set(inputs.filter((l): l is Extract<OneOffLineInput, { kind: 'item' }> => l.kind === 'item').map((l) => l.itemId)))
  const byId = new Map<string, Record<string, unknown>>()
  if (itemIds.length) {
    const allowed = new Set((await loadCustomerCatalog(admin, orgId, customerId)).map((i) => i.id))
    for (const r of await readItems(admin, orgId, itemIds)) if (allowed.has(String(r.id))) byId.set(String(r.id), r)
  }
  return inputs.map((l): ServiceInvoiceLine => {
    if (l.kind === 'typed') return { description: l.description, qty: l.qty, unit_price_cents: l.priceCents, taxable: l.taxable }
    const item = byId.get(l.itemId)
    if (!item) throw new Error('A price-book item on this invoice is no longer available')
    const priced = resolveLinePrice({ item: { unit_price: item.unit_price as number, price_options: item.price_options }, optionKey: l.optionKey, manualPrice: l.priceCents == null ? null : l.priceCents / 100 })
    if (!priced.ok) throw new Error(priced.error === 'choose_option' ? `Pick a size for ${String(item.name)}` : `That size is not offered for ${String(item.name)}`)
    return {
      description: lineNameWithOption(String(item.name ?? 'Item'), priced.line.optionName),
      qty: l.qty,
      unit_price_cents: Math.round(priced.line.unitPrice * 100),
      taxable: item.is_taxable !== false,
      ...(String(item.unit) === 'hour' ? { unit: 'hour' as const } : {}),
    }
  })
}

/** Make the draft invoice (the one writer) and say which one it is. */
export async function createOneOffInvoice(admin: SupabaseClient, orgId: string, userId: string, customerId: string, body: OneOffBody): Promise<{ invoiceId: string }> {
  if (body.propertyId) {
    const { data } = await orgDb(admin, orgId).from('properties').select('id').eq('id', body.propertyId).eq('customer_id', customerId).maybeSingle()
    if (!data) throw new Error('That property is not this customer’s')
  }
  const lines = await buildOneOffLines(admin, orgId, customerId, body.lines)
  const made = await createServiceInvoiceFromLines(admin, orgId, { customerId, propertyId: body.propertyId, createdBy: userId, lines, publicNote: body.publicNote })
  if (!made.invoiceId) throw new Error('Could not make the invoice')
  return { invoiceId: made.invoiceId }
}
