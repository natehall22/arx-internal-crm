/** @jest-environment node */
import { readFileSync } from 'fs'
import path from 'path'

import {
  cleanPriceOptions,
  itemsForList,
  lineNameWithOption,
  optionsFloorPrice,
  perUnitLabel,
  readPriceOptions,
  resolveLinePrice,
  resolvePriceList,
  stampPriceOptions,
  unitLabel,
} from '@/lib/price-list'
import { applyPriceListFile, checkImportTarget, parsePriceListFile } from '@/lib/price-list-import'
import { PRICE_SHEET_UNITS, PROFILE_ONLY_UNITS, serviceUnitNotReadyMessage } from '@/lib/industry-profiles'
import * as units from '@/lib/price-list'
import { canEditPriceLists, cleanPriceListName } from '@/lib/price-list-access'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')

const mowing = { unit_price: 45, price_options: [{ key: 'o1', label: 'Small lot', price: 45 }, { key: 'o2', label: 'Medium lot', price: 60 }, { key: 'o3', label: 'Large lot', price: 80 }] }

describe('which price list', () => {
  const lists = [{ id: 'std', is_default: true }, { id: 'bld', is_default: false }]
  it('default list when nothing points anywhere', () => {
    expect(resolvePriceList({ lists })).toEqual({ id: 'std', source: 'default' })
  })
  it('customer list (Builder) beats the default; the quote’s own choice beats the customer', () => {
    expect(resolvePriceList({ lists, customerListId: 'bld' })).toEqual({ id: 'bld', source: 'customer' })
    expect(resolvePriceList({ lists, customerListId: 'bld', quoteListId: 'std' })).toEqual({ id: 'std', source: 'quote' })
  })
  it('a pointer to a list that is not this company’s is ignored', () => {
    expect(resolvePriceList({ lists, customerListId: 'other-company', quoteListId: 'gone' })).toEqual({ id: 'std', source: 'default' })
  })
  it('no lists at all = none', () => {
    expect(resolvePriceList({ lists: [] })).toEqual({ id: null, source: 'none' })
  })
  it('one list offers every item (ARX); several offer only the chosen list', () => {
    const items = [{ id: 'a', pricebook_id: 'std' }, { id: 'b', pricebook_id: 'bld' }, { id: 'c', pricebook_id: null }]
    expect(itemsForList(items, 1, 'std')).toHaveLength(3)
    expect(itemsForList(items, 2, 'bld').map((i) => i.id)).toEqual(['b'])
  })
})

describe('line price', () => {
  it('no options: the item price, exactly as before (ARX)', () => {
    const r = resolveLinePrice({ item: { unit_price: '451.2' } })
    expect(r).toEqual({ ok: true, line: { unitPrice: 451.2, optionKey: null, optionName: null, optionPrice: null, source: 'item' } })
  })
  it('options: the tapped option’s price and name', () => {
    const r = resolveLinePrice({ item: mowing, optionKey: 'o2' })
    expect(r).toEqual({ ok: true, line: { unitPrice: 60, optionKey: 'o2', optionName: 'Medium lot', optionPrice: 60, source: 'option' } })
  })
  it('an item with options needs one; an unknown option is refused', () => {
    expect(resolveLinePrice({ item: mowing })).toEqual({ ok: false, error: 'choose_option' })
    expect(resolveLinePrice({ item: mowing, optionKey: 'zzz' })).toEqual({ ok: false, error: 'unknown_option' })
  })
  it('a typed price wins, and the option list price is still remembered', () => {
    const r = resolveLinePrice({ item: mowing, optionKey: 'o3', manualPrice: 70 })
    expect(r).toEqual({ ok: true, line: { unitPrice: 70, optionKey: 'o3', optionName: 'Large lot', optionPrice: 80, source: 'manual' } })
    const plain = resolveLinePrice({ item: { unit_price: 100 }, manualPrice: 90 })
    expect(plain.ok && plain.line.source).toBe('manual')
    // typing the same number as the list price is not an override
    const same = resolveLinePrice({ item: { unit_price: 100 }, manualPrice: 100 })
    expect(same.ok && same.line.source).toBe('item')
  })
  it('builder list vs homeowner list: the same job, each list’s own price', () => {
    const homeowner = { unit_price: 60 }
    const builder = { unit_price: 45 }
    const a = resolveLinePrice({ item: homeowner })
    const b = resolveLinePrice({ item: builder })
    expect([a.ok && a.line.unitPrice, b.ok && b.line.unitPrice]).toEqual([60, 45])
  })
  it('names the size on the line', () => {
    expect(lineNameWithOption('Standard yard mowing', 'Medium lot')).toBe('Standard yard mowing (Medium lot)')
    expect(lineNameWithOption('Sod installation', null)).toBe('Sod installation')
  })
})

describe('size options', () => {
  it('cleans a save: stable keys, rounded money, unique names; empty = none', () => {
    expect(cleanPriceOptions([])).toEqual({ ok: true, value: null })
    expect(cleanPriceOptions(undefined)).toEqual({ ok: true, value: null })
    const r = cleanPriceOptions([{ label: ' Small ', price: '$45.504' }, { key: 'o9', label: 'Big', price: 80 }])
    expect(r.ok && r.value).toEqual([{ key: expect.any(String), label: 'Small', price: 45.5 }, { key: 'o9', label: 'Big', price: 80 }])
    expect(r.ok && new Set(r.value!.map((o) => o.key)).size).toBe(2)
  })
  it('refuses a blank name, a missing price, a duplicate name and too many', () => {
    expect(cleanPriceOptions([{ label: '', price: 1 }]).ok).toBe(false)
    expect(cleanPriceOptions([{ label: 'A', price: '' }]).ok).toBe(false)
    expect(cleanPriceOptions([{ label: 'A', price: 1 }, { label: 'a', price: 2 }]).ok).toBe(false)
    expect(cleanPriceOptions(Array.from({ length: 13 }, (_, i) => ({ label: `S${i}`, price: 1 }))).ok).toBe(false)
  })
  it('the item’s own price is its lowest option', () => {
    expect(optionsFloorPrice(readPriceOptions(mowing.price_options))).toBe(45)
  })
  it('a bad stored row never crashes a read', () => {
    expect(readPriceOptions('nope')).toEqual([])
    expect(readPriceOptions([null, { label: 'x' }, { key: 'k', label: 'ok', price: 3 }])).toEqual([{ key: 'k', label: 'ok', price: 3 }])
  })
  it('a save stamps the option name and price from the price book, never from the browser', () => {
    const items = new Map([['i1', { name: 'Standard yard mowing', ...mowing }]])
    const out = stampPriceOptions(
      [
        { pricebook_item_id: 'i1', price_option_key: 'o2', price_option_name: 'FAKE', price_option_price: 1, unit_price: 55 },
        { pricebook_item_id: 'i1', price_option_name: 'FAKE', price_option_price: 1 },
        { pricebook_item_id: 'gone', price_option_key: 'o2' },
      ],
      items
    )
    expect(out[0]).toMatchObject({ price_option_key: 'o2', price_option_name: 'Medium lot', price_option_price: 60, unit_price: 55 })
    // the size on the name is the server's, whatever the browser typed; the typed price stays (an override is allowed)
    const renamed = stampPriceOptions([{ pricebook_item_id: 'i1', price_option_key: 'o3', name: 'Mowing (Tiny lot)', unit_price: 10 }], items)
    expect(renamed[0]).toMatchObject({ name: 'Standard yard mowing (Large lot)', price_option_price: 80, unit_price: 10 })
    expect(out[1]).not.toHaveProperty('price_option_name')
    expect(out[2]).not.toHaveProperty('price_option_key')
  })
})

describe('one unit list', () => {
  it('the profile lists, the importer and the builder all read lib/price-list.ts', () => {
    expect(PROFILE_ONLY_UNITS).toBe(units.PROFILE_ONLY_UNITS)
    expect(PRICE_SHEET_UNITS).toBe(units.PRICE_SHEET_UNITS)
    for (const u of [...PROFILE_ONLY_UNITS, ...PRICE_SHEET_UNITS]) {
      expect([u, units.unitNeedsQuantity(u)]).toEqual([u, true])
      expect(units.IMPORTABLE_UNITS).toContain(u)
    }
    // roofing's quantity units are exactly what the builder had
    for (const u of ['each', 'sheet', 'bundle', 'roll', 'piece', 'unit', 'lf', 'linear foot', 'per_sqft', 'visits', 'months', 'hours']) expect([u, units.unitNeedsQuantity(u)]).toEqual([u, true])
    for (const u of ['square', 'sqft', 'job', 'percent', 'watt', '']) expect([u, units.unitNeedsQuantity(u)]).toEqual([u, false])
    expect(units.unitLabelForDisplay('per_sqft')).toBe('sq ft')
    expect(units.unitLabelForDisplay('sqft')).toBe('sq ft (roof auto)')
    expect(units.unitLabelForDisplay('pallet')).toBe('pallet')
    const b = read('app/proposals/builder/page.tsx')
    expect(b).not.toMatch(/const (getUnitLabel|perUnitLabel) =/)
    expect(read('app/admin/proposals/page.tsx')).not.toContain('function unitLabelForDisplay')
    expect(read('lib/industry-profiles.ts')).not.toMatch(/PRICE_SHEET_UNITS: readonly string\[\] =/)
  })
})

describe('who may make a price list', () => {
  it('one role check, one name rule', () => {
    expect(canEditPriceLists('admin')).toBe(true)
    expect(canEditPriceLists('operations')).toBe(true)
    expect(canEditPriceLists('sales_manager')).toBe(false)
    expect(canEditPriceLists(undefined)).toBe(false)
    expect(cleanPriceListName('  Builder ')).toEqual({ ok: true, name: 'Builder' })
    expect(cleanPriceListName('   ').ok).toBe(false)
    expect(cleanPriceListName(undefined).ok).toBe(false)
    expect(cleanPriceListName('x'.repeat(120)).ok).toBe(true)
    expect(cleanPriceListName('x'.repeat(121)).ok).toBe(false)
    expect(read('app/api/admin/pricing/route.ts')).toContain('canEditPriceLists(profile.role)')
    expect(read('app/api/admin/pricing/route.ts')).toContain('cleanPriceListName(data.name)')
    expect(read('app/admin/proposals/page.tsx')).toContain('canEditPriceLists(myRole)')
  })
})

describe('an add-on edit never names the new columns unless it has to (works before the migration)', () => {
  const route = read('app/api/admin/proposals/route.ts')
  const patch = route.slice(route.indexOf('export async function PATCH'), route.indexOf('export async function DELETE'))
  it('PATCH only includes price_options / description when sent non-empty or already stored', () => {
    expect(patch).toContain('...(touchOptions ? { price_options: options.value } : {})')
    expect(patch).toContain('...(touchDescription ?')
    expect(patch).not.toMatch(/data\.price_options !== undefined/)
    expect(patch).not.toMatch(/typeof data\.description === 'string' \? \{ description/)
  })
})

describe('hourly billing prices through the one rule', () => {
  it('reads the rate via resolveLinePrice and does not need the new column', () => {
    const h = read('lib/hourly-billing-db.ts')
    expect(h).toContain("import { resolveLinePrice } from '@/lib/price-list'")
    expect(h).toContain('unitPrice: resolveItemRate(r.unit_price)')
    expect(h).toContain(".select('id, name, unit, unit_price, is_taxable, active, is_labor')")
    // same number as the old `Number(x ?? 0) || 0` for every numeric(10,2) value
    for (const v of [0, 45, 250, 451.2, 12.34, '300.00', null, undefined, 'x']) {
      const r = resolveLinePrice({ item: { unit_price: Number(v ?? 0) || 0 } })
      expect(r.ok && r.line.unitPrice).toBe(Math.round((Number(v ?? 0) || 0) * 100) / 100)
      expect(r.ok && r.line.unitPrice).toBe(Number(v ?? 0) || 0)
    }
  })
})

describe('unit words', () => {
  it('the service units read "per pallet" and "3 pallets"', () => {
    for (const [u, plural] of [['package', 'packages'], ['pallet', 'pallets'], ['lot', 'lots'], ['home', 'homes'], ['load', 'loads'], ['service', 'services']]) {
      expect(perUnitLabel(u)).toBe(u)
      expect(unitLabel(u)).toBe(plural)
    }
  })
  it('the roofing words are exactly what the builder always said', () => {
    const old: Record<string, string> = { per_sqft: 'sq ft', sqft: 'sq ft', 'sq ft': 'sq ft', sf: 'sq ft', square: 'squares', sq: 'squares', squares: 'squares', lf: 'linear ft', each: 'each', job: 'job', hour: 'hours', visit: 'visits', month: 'months', watt: 'watts', bundle: 'bundles', roll: 'rolls', sheet: 'sheets', percent: '% of total' }
    for (const [u, w] of Object.entries(old)) expect([u, unitLabel(u)]).toEqual([u, w])
    expect(unitLabel('')).toBe('units')
    expect(unitLabel('Pallet')).toBe('pallets')
    // old per-phrase: singular for visit / month / hour, the usual label otherwise
    expect(perUnitLabel('hour')).toBe('hour')
    expect(perUnitLabel('square')).toBe('squares')
  })
})

describe('migration 202611220030 (file only)', () => {
  const sql = read('supabase/migrations/202611220030_price_sheet_units_options_lists.sql')
  it('adds every price-sheet unit, additively', () => {
    for (const u of PRICE_SHEET_UNITS) expect(sql).toContain(`ALTER TYPE unit ADD VALUE IF NOT EXISTS '${u}'`)
    expect(sql).not.toMatch(/DROP |DELETE FROM|TRUNCATE|SET NOT NULL/i)
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';")
  })
  it('every new column is nullable and guarded', () => {
    for (const c of ['price_options jsonb NULL', 'description text NULL', 'customers ADD COLUMN IF NOT EXISTS pricebook_id uuid NULL', 'proposals ADD COLUMN IF NOT EXISTS pricebook_id uuid NULL', 'price_option_key text NULL', 'price_option_name text NULL', 'price_option_price numeric(10, 2) NULL']) {
      expect(sql).toContain(c)
    }
  })
  it('a list pointer can only reach a list of its own company', () => {
    expect(sql).toContain('FOREIGN KEY (pricebook_id, org_id) REFERENCES public.pricebooks (id, org_id) ON DELETE SET NULL (pricebook_id)')
  })
  it('is the latest migration number and the unit-missing message names it', () => {
    const files = require('fs').readdirSync(path.join(process.cwd(), 'supabase/migrations')).filter((f: string) => /^\d{12}_/.test(f)).sort()
    expect(files[files.length - 1]).toBe('202611220030_price_sheet_units_options_lists.sql')
    expect(serviceUnitNotReadyMessage({ code: '22P02' }, 'pallet')).toContain('202611220030')
    expect(serviceUnitNotReadyMessage({ code: '22P02' }, 'visit')).toContain('202611100090')
  })
})

describe('Precision price sheet file', () => {
  const raw = JSON.parse(read('data/precision-builder-pricing.json'))
  const parsed = parsePriceListFile(raw)
  it('parses and matches the sheet', () => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const by = Object.fromEntries(parsed.file.items.map((i) => [i.name, i]))
    expect(parsed.file.items).toHaveLength(10)
    expect(by['Standard plant package']).toMatchObject({ unit: 'package', price: 550 })
    expect(by['Small plant package']).toMatchObject({ unit: 'package', price: 425 })
    expect(by['Sod installation']).toMatchObject({ unit: 'pallet', price: 220 })
    expect(by['Tractor rough grade']).toMatchObject({ unit: 'hour', price: 250 })
    expect(by['Tractor final grade']).toMatchObject({ unit: 'hour', price: 300 })
    expect(by['Haul outs']).toMatchObject({ unit: 'load', price: 50 })
    expect(by['Grading fill']).toMatchObject({ unit: 'load', price: 50, description: 'Only charged when more than one load is required.' })
    expect(by['Exterior cleaning']).toMatchObject({ unit: 'service', price: 75 })
    expect(by['Standard yard mowing'].options!.map((o) => o.price)).toEqual([45, 80])
    expect(by['Soft wash'].options!.map((o) => o.price)).toEqual([225, 400])
    expect(parsed.file.quoteTerms).toBe('Pricing reflects the services and quantities listed. Additional services or materials outside the standard scope will be quoted separately.')
  })
  it('the unconfirmed size cutoffs are marked as placeholders', () => {
    if (!parsed.ok) throw new Error('parse')
    for (const n of ['Standard yard mowing', 'Soft wash']) {
      const it = parsed.file.items.find((i) => i.name === n)!
      expect(it.placeholders).toBe(it.options!.length)
      for (const o of it.options!) expect(o.label).toContain('(size TBD)')
    }
  })
  it('refuses a bad file with reasons', () => {
    const bad = parsePriceListFile({ priceList: { name: 'X' }, items: [{ name: 'A', unit: 'bogus', price: 1 }, { name: 'B', unit: 'lot' }] })
    expect(bad.ok).toBe(false)
  })
})

describe('import writes only what is missing, inside one company', () => {
  type Row = Record<string, unknown>
  function fake(books: Row[], items: Row[], orgs: Row[] = [{ id: 'org-1', name: 'Precision Maintenance, LLC', profile: { id: 'lawn_landscape', version: 4 } }]) {
    const inserts: Array<{ table: string; row: Row }> = []
    const client = {
      from(table: string) {
        const state: { filters: Array<[string, unknown]> } = { filters: [] }
        const q: any = {
          select: () => q,
          eq: (c: string, v: unknown) => (state.filters.push([c, v]), q),
          insert: (row: Row) => {
            inserts.push({ table, row })
            const made = { id: `new-${inserts.length}`, name: row.name, is_default: row.is_default ?? false }
            return { select: () => ({ single: async () => ({ data: made, error: null }) }) }
          },
          then: (res: (v: unknown) => void) => {
            const src = table === 'pricebooks' ? books : table === 'orgs' ? orgs : items
            res({ data: src.filter((r) => state.filters.every(([c, v]) => r[c] === v)), error: null })
          },
          maybeSingle: async () => {
            const rows = (table === 'orgs' ? orgs : []).filter((r) => state.filters.every(([c, v]) => r[c] === v))
            return { data: rows[0] ?? null, error: null }
          },
        }
        return q
      },
    }
    return { client: client as never, inserts }
  }
  const file = (() => { const p = parsePriceListFile(JSON.parse(read('data/precision-builder-pricing.json'))); if (!p.ok) throw new Error('parse'); return p.file })()

  it('dry run writes nothing', async () => {
    const f = fake([], [])
    const lines = await applyPriceListFile(f.client, 'org-1', file, false, 'Precision Maintenance, LLC')
    expect(f.inserts).toEqual([])
    expect(lines.join('\n')).toContain('PLACEHOLDER')
    expect(lines[0]).toBe('company: Precision Maintenance, LLC')
  })
  it('refuses a company id that does not exist, a roofing company, and a name that does not match — writing nothing', async () => {
    const none = fake([], [], [])
    await expect(applyPriceListFile(none.client, 'org-x', file, true, 'Anyone')).rejects.toThrow('No company with id org-x')
    const roofing = fake([], [], [{ id: 'org-1', name: 'ARX Roofing', profile: null }])
    await expect(applyPriceListFile(roofing.client, 'org-1', file, true, 'ARX Roofing')).rejects.toThrow('roofing profile')
    const roofing2 = fake([], [], [{ id: 'org-1', name: 'Other', profile: { id: 'roofing', version: 1 } }])
    await expect(checkImportTarget(roofing2.client, 'org-1', 'Other')).rejects.toThrow('roofing profile')
    const wrong = fake([], [])
    await expect(applyPriceListFile(wrong.client, 'org-1', file, true, 'Somebody Else')).rejects.toThrow('not "Somebody Else"')
    await expect(applyPriceListFile(wrong.client, 'org-1', file, true, '')).rejects.toThrow('--company-name')
    for (const f of [none, roofing, wrong]) expect(f.inserts).toEqual([])
  })
  it('apply creates a default list when none exists, the Builder list, and every item stamped with the company', async () => {
    const f = fake([], [])
    await applyPriceListFile(f.client, 'org-1', file, true, 'Precision Maintenance, LLC')
    const lists = f.inserts.filter((i) => i.table === 'pricebooks')
    expect(lists.map((l) => [l.row.name, l.row.is_default])).toEqual([['Standard', true], ['Builder', false]])
    const items = f.inserts.filter((i) => i.table === 'pricebook_items')
    expect(items).toHaveLength(10)
    expect(items.every((i) => i.row.org_id === 'org-1' && i.row.is_adder === true)).toBe(true)
    expect(items.find((i) => i.row.name === 'Soft wash')!.row.unit_price).toBe(225)
  })
  it('re-running adds nothing that is already there', async () => {
    const f = fake([{ id: 'd', org_id: 'org-1', name: 'Standard', is_default: true }, { id: 'b', org_id: 'org-1', name: 'Builder', is_default: false }], file.items.map((i) => ({ org_id: 'org-1', pricebook_id: 'b', name: i.name })))
    await applyPriceListFile(f.client, 'org-1', file, true, 'Precision Maintenance, LLC')
    expect(f.inserts).toEqual([])
  })
})
