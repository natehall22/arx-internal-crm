/**
 * Read-only pulls of the company's own QuickBooks lists for the mapping screen, and the obvious picks pre-selected from them.
 * Nothing here writes to QuickBooks. A list that cannot be read is empty (the screen says so); it never blocks the others.
 */
import type { QbClient, QbObject } from './client'
import type { QbSettings } from './mapping'
import type { SalesTaxRate } from '@/lib/sales-tax'

export type QbPick = { id: string; name: string }
export type QbTaxCodeInfo = { id: string; name: string; rates: Array<{ id: string; name: string; percent: number }> }
export type QbLists = {
  country: string | null
  items: Array<QbPick & { type: string }>
  incomeAccounts: QbPick[]
  depositAccounts: Array<QbPick & { subType: string | null }>
  receivableAccounts: QbPick[]
  expenseAccounts: QbPick[]
  taxCodes: QbTaxCodeInfo[]
  classes: QbPick[]
  /** "Custom transaction numbers" is on: QuickBooks keeps the document numbers we send. */
  customTxnNumbers: boolean | null
  /** Names of lists that could not be read. */
  unreadable: string[]
}

const pick = (o: QbObject): QbPick => ({ id: String(o.Id), name: String(o.FullyQualifiedName ?? o.Name ?? o.Id) })
const byName = (a: QbPick, b: QbPick) => a.name.localeCompare(b.name)

export async function loadQbLists(client: QbClient): Promise<QbLists> {
  const unreadable: string[] = []
  const get = async (label: string, entity: Parameters<QbClient['query']>[0], where?: string) => {
    const r = await client.query<QbObject>(entity, where ?? null, { max: 1000 })
    if (!r.ok) {
      unreadable.push(label)
      return [] as QbObject[]
    }
    return r.value
  }
  const [company, items, accounts, codes, rates, classes, prefs] = await Promise.all([
    get('company', 'CompanyInfo'),
    get('products and services', 'Item', 'Active = true'),
    get('accounts', 'Account', 'Active = true'),
    get('sales tax codes', 'TaxCode', 'Active = true'),
    get('sales tax rates', 'TaxRate', 'Active = true'),
    get('classes', 'Class', 'Active = true'),
    get('preferences', 'Preferences'),
  ])
  // (Sequential in the real client anyway: it paces one call per 120 ms per company.)
  const rateById = new Map(rates.map((r) => [String(r.Id), { id: String(r.Id), name: String(r.Name ?? r.Id), percent: Number(r.RateValue) || 0 }]))
  const acct = (types: string[]) => accounts.filter((a) => types.includes(String(a.AccountType)))
  return {
    country: typeof company[0]?.Country === 'string' ? (company[0].Country as string) : null,
    items: items.filter((i) => ['Service', 'NonInventory', 'Inventory', 'Category'].includes(String(i.Type)) && String(i.Type) !== 'Category').map((i) => ({ ...pick(i), type: String(i.Type) })).sort(byName),
    incomeAccounts: acct(['Income', 'Other Income']).map(pick).sort(byName),
    depositAccounts: acct(['Bank', 'Other Current Asset', 'Credit Card']).map((a) => ({ ...pick(a), subType: typeof a.AccountSubType === 'string' ? a.AccountSubType : null })).sort(byName),
    receivableAccounts: acct(['Accounts Receivable']).map(pick).sort(byName),
    expenseAccounts: acct(['Expense', 'Cost of Goods Sold', 'Other Expense']).map(pick).sort(byName),
    taxCodes: codes
      .filter((c) => !['TAX', 'NON'].includes(String(c.Id)) && c.Taxable !== false && Array.isArray(c.SalesTaxRateList?.TaxRateDetail))
      .map((c) => ({
        id: String(c.Id),
        name: String(c.Name ?? c.Id),
        rates: (c.SalesTaxRateList.TaxRateDetail as Array<Record<string, any>>).map((d) => rateById.get(String(d.TaxRateRef?.value))).filter((r): r is { id: string; name: string; percent: number } => !!r),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    classes: classes.map(pick).sort(byName),
    customTxnNumbers: typeof prefs[0]?.SalesFormsPrefs?.CustomTxnNumbers === 'boolean' ? prefs[0].SalesFormsPrefs.CustomTxnNumbers : null,
    unreadable,
  }
}

/** CRM rate id -> QuickBooks rate id, matched by percent inside the chosen tax code. Rates with no match are left out (the screen says which). */
export function rateMapFor(code: QbTaxCodeInfo | undefined, crmRates: ReadonlyArray<Pick<SalesTaxRate, 'id' | 'percent' | 'active'>>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!code) return out
  const used = new Set<string>()
  for (const r of crmRates.filter((x) => x.active)) {
    const hit = code.rates.find((q) => !used.has(q.id) && Math.abs(q.percent - r.percent) < 0.0001)
    if (hit) {
      out[r.id] = hit.id
      used.add(hit.id)
    }
  }
  return out
}

const only = <T,>(xs: T[]): T | null => (xs.length === 1 ? xs[0] : null)

/** The obvious picks, from the company's own lists. Nothing is guessed when there is more than one good answer. */
export function suggestSettings(lists: QbLists, current: QbSettings, crmRates: ReadonlyArray<Pick<SalesTaxRate, 'id' | 'percent' | 'active'>>, todayIso: string): Partial<QbSettings> {
  const services = lists.items.filter((i) => i.type === 'Service')
  const incomeItem = current.income.defaultItemId ?? only(services)?.id ?? lists.items.find((i) => /^(sales|services|roofing|installation)/i.test(i.name))?.id ?? null
  const deposit = current.depositToAccountId ?? lists.depositAccounts.find((a) => a.subType === 'UndepositedFunds')?.id ?? null
  const expense = current.bills.expenseAccountId ?? lists.expenseAccounts.find((a) => /^cost of goods sold$/i.test(a.name))?.id ?? lists.expenseAccounts.find((a) => /job (materials|expenses)|materials|subcontract/i.test(a.name))?.id ?? null
  const code = current.tax.taxCodeId ? lists.taxCodes.find((c) => c.id === current.tax.taxCodeId) : only(lists.taxCodes) ?? undefined
  return {
    startDate: current.startDate ?? todayIso,
    income: { defaultItemId: incomeItem, byTrade: current.income.byTrade },
    depositToAccountId: deposit,
    receivablesAccountId: current.receivablesAccountId,
    bills: { ...current.bills, expenseAccountId: expense },
    tax: current.tax.mode === 'none' && !current.confirmedAt ? { mode: lists.taxCodes.length ? 'code' : 'none', taxCodeId: code?.id ?? null, rateMap: rateMapFor(code, crmRates) } : { ...current.tax, rateMap: { ...rateMapFor(code, crmRates), ...current.tax.rateMap } },
  }
}

