/**
 * Load a price list from a JSON file (data/precision-builder-pricing.json) into one company. Pure parse + one writer.
 * Dry run by default; creates only what is missing (an item already in that list by name is left exactly as it is).
 * Items are add-ons (`is_adder`), the way the add-on editor and the Jobber import make them.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { cleanPriceOptions, IMPORTABLE_UNITS, optionsFloorPrice, type PriceOption } from '@/lib/price-list'
import { resolveOrgProfile } from '@/lib/org-profile'
import { orgDb } from '@/lib/supabase/org-db'

const UNITS = new Set<string>(IMPORTABLE_UNITS)

export type ImportItem = { name: string; unit: string; price: number; category: string; description: string | null; options: PriceOption[] | null; placeholders: number }
export type PriceListFile = { listName: string; quoteTerms: string | null; items: ImportItem[] }

export function parsePriceListFile(raw: unknown): { ok: true; file: PriceListFile } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const listName = typeof (root.priceList as { name?: unknown } | undefined)?.name === 'string' ? String((root.priceList as { name: string }).name).trim() : ''
  if (!listName) errors.push('priceList.name is required')
  const rows = Array.isArray(root.items) ? root.items : []
  if (rows.length === 0) errors.push('items must be a non-empty list')
  const items: ImportItem[] = []
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
    const where = `items[${i}]`
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) return errors.push(`${where}.name is required`)
    if (seen.has(name.toLowerCase())) return errors.push(`${where} "${name}" is listed twice`)
    seen.add(name.toLowerCase())
    const unit = typeof o.unit === 'string' ? o.unit : ''
    if (!UNITS.has(unit)) return errors.push(`${where} "${name}": unit "${unit}" is not one of ${Array.from(UNITS).join(', ')}`)
    const opts = cleanPriceOptions(o.options)
    if (!opts.ok) return errors.push(`${where} "${name}": ${opts.error}`)
    const price = opts.value ? optionsFloorPrice(opts.value) : Number(o.price)
    if (!Number.isFinite(price) || price <= 0) return errors.push(`${where} "${name}": needs a price or options`)
    const placeholders = Array.isArray(o.options) ? o.options.filter((x) => (x as { placeholder?: unknown })?.placeholder === true).length : 0
    items.push({
      name,
      unit,
      price,
      category: typeof o.category === 'string' && o.category.trim() ? o.category.trim() : 'Other',
      description: typeof o.description === 'string' && o.description.trim() ? o.description.trim().slice(0, 500) : null,
      options: opts.value,
      placeholders,
    })
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, file: { listName, quoteTerms: typeof root.quoteTerms === 'string' && root.quoteTerms.trim() ? root.quoteTerms.trim() : null, items } }
}

export class ImportRefused extends Error {}

/**
 * Pure-ish guard: is this the company the person meant? Refuses an id that is not a company, a company on the roofing
 * profile (nothing stored = roofing — the price sheet is for service companies), and a name that does not match the
 * `--company-name` typed by the person. Returns the company's name for the dry-run header.
 */
export async function checkImportTarget(admin: SupabaseClient, orgId: string, expectedName: string): Promise<string> {
  const { data, error } = await admin.from('orgs').select('id, name, profile:settings->profile').eq('id', orgId).maybeSingle()
  if (error) throw new Error(`read company: ${error.message}`)
  const org = data as { id: string; name: string | null; profile?: unknown } | null
  if (!org) throw new ImportRefused(`No company with id ${orgId}`)
  const name = (org.name ?? '').trim()
  if (resolveOrgProfile({ profile: org.profile }).id === 'roofing') {
    throw new ImportRefused(`"${name}" is on the roofing profile (or has none). This price sheet is for service companies; nothing was written.`)
  }
  if (!expectedName.trim() || name.toLowerCase() !== expectedName.trim().toLowerCase()) {
    throw new ImportRefused(`The company is "${name}", not "${expectedName}". Pass --company-name exactly as it is spelled; nothing was written.`)
  }
  return name
}

/** Create the list (and a default list when the company has none) and the items that are missing. Writes nothing unless `apply`. */
export async function applyPriceListFile(admin: SupabaseClient, orgId: string, file: PriceListFile, apply: boolean, companyName: string): Promise<string[]> {
  const say: string[] = [`company: ${await checkImportTarget(admin, orgId, companyName)}`]
  const db = orgDb(admin, orgId)
  const { data: books, error: bErr } = await db.from('pricebooks').select('id, name, is_default')
  if (bErr) throw new Error(`read price lists: ${bErr.message}`)
  const lists = (books ?? []) as Array<{ id: string; name: string; is_default: boolean }>
  if (!lists.some((l) => l.is_default)) {
    say.push('no default price list yet: would create an empty "Standard" default so the builder list is not the default')
    if (apply) {
      const { data, error } = await db.from('pricebooks').insert({ name: 'Standard', is_default: true }).select('id, name, is_default').single()
      if (error) throw new Error(`create default list: ${error.message}`)
      lists.push(data as { id: string; name: string; is_default: boolean })
    }
  }
  let list = lists.find((l) => l.name.trim().toLowerCase() === file.listName.toLowerCase())
  if (list) say.push(`price list "${list.name}" exists`)
  else {
    say.push(`create price list "${file.listName}"`)
    if (apply) {
      const { data, error } = await db.from('pricebooks').insert({ name: file.listName, is_default: false }).select('id, name, is_default').single()
      if (error) throw new Error(`create list: ${error.message}`)
      list = data as { id: string; name: string; is_default: boolean }
    }
  }
  const existing = new Set<string>()
  if (list) {
    const { data, error } = await db.from('pricebook_items').select('name').eq('pricebook_id', list.id)
    if (error) throw new Error(`read items: ${error.message}`)
    for (const r of (data ?? []) as Array<{ name: string }>) existing.add(r.name.trim().toLowerCase())
  }
  for (const it of file.items) {
    if (existing.has(it.name.toLowerCase())) {
      say.push(`  keep   ${it.name} (already there, untouched)`)
      continue
    }
    say.push(`  add    ${it.name} — ${it.options ? `${it.options.map((o) => `${o.label} $${o.price}`).join(', ')}` : `$${it.price}`} per ${it.unit}${it.placeholders ? '  [PLACEHOLDER sizes: confirm with the owner]' : ''}`)
    if (apply && list) {
      const { error } = await db.from('pricebook_items').insert({
        pricebook_id: list.id,
        category: 'addons',
        item_type: 'addon',
        name: it.name,
        unit: it.unit,
        unit_price: it.price,
        is_adder: true,
        adder_category: it.category,
        price_type: 'fixed',
        is_commissionable: false,
        visibility: 'sales_reps',
        active: true,
        ...(it.options ? { price_options: it.options } : {}),
        ...(it.description ? { description: it.description } : {}),
      })
      if (error) throw new Error(`add "${it.name}": ${error.message}`)
    }
  }
  if (file.quoteTerms) say.push('quote footer not loaded here: paste it into Settings → Quote approval → Terms')
  return say
}
