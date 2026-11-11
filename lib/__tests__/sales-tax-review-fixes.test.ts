/** @jest-environment node */
import { evaluateJobCollection } from '@/lib/job-collection'
import { invoicedPreTaxCents } from '@/lib/invoices'
import { initialQuoteTaxRateIds, type SalesTaxSettings } from '@/lib/sales-tax'
import { salesTaxColumnsReady } from '@/lib/sales-tax-server'
import { readFileSync } from 'fs'
import path from 'path'
import { runCompanySeed, parseCompanySeedInput } from '@/lib/company-seed'

const settings: SalesTaxSettings = {
  enabled: true,
  rates: [
    { id: 'state', name: 'State', percent: 6, active: true },
    { id: 'county', name: 'County', percent: 1.5, active: true },
  ],
  defaultRateIds: ['state', 'county'],
}

describe('invoice tax vs the sale amount (one rule: sale_amount is pre-invoice-tax)', () => {
  it('ARX (no invoice tax): unchanged', () => {
    const c = evaluateJobCollection({ saleAmount: 16325, collectedCents: 1632500 })
    expect(c).toMatchObject({ requiredCents: 1632500, paidInFull: true, remainingCents: 0 })
    expect(invoicedPreTaxCents([{ total_cents: 816250 }, { total_cents: 816250, tax_cents: null }])).toBe(1632500)
  })

  it('contract paid but invoice tax not: blocked (not paid in full)', () => {
    const c = evaluateJobCollection({ saleAmount: 1000, invoiceTaxCents: 7500, collectedCents: 100000 })
    expect(c).toMatchObject({ requiredCents: 107500, remainingCents: 7500, paidInFull: false })
  })

  it('contract + invoice tax paid: paid in full, not overpaid', () => {
    const c = evaluateJobCollection({ saleAmount: 1000, invoiceTaxCents: 7500, collectedCents: 107500 })
    expect(c).toMatchObject({ remainingCents: 0, paidInFull: true })
  })

  it('no sale amount: invoice tax alone never makes a job "collectable"', () => {
    expect(evaluateJobCollection({ saleAmount: 0, invoiceTaxCents: 500, collectedCents: 500 })).toMatchObject({ missingSaleAmount: true, paidInFull: false })
  })

  it('a taxed invoice uses up only its pre-tax amount of the contract, so the next invoice is not blocked by tax', () => {
    // $1,000 contract; first invoice $600 + $45 tax. Remaining contract = $400, not $355.
    const invoiced = invoicedPreTaxCents([{ total_cents: 64500, tax_cents: 4500 }])
    expect(100000 - invoiced).toBe(40000)
  })
})

describe('quote reopened in the builder', () => {
  const lines = [{ id: 'state', name: 'State', percent: 6, amount_cents: 600 }]
  it('customer was exempt when saved, no longer exempt: company defaults, flagged', () => {
    expect(initialQuoteTaxRateIds({ settings, existing: true, savedTaxLines: [], savedExempt: true, customerExempt: false })).toEqual({
      ids: ['state', 'county'],
      exemptionLifted: true,
    })
  })
  it('still exempt: stays exempt; normal quote keeps its saved rates; legacy stays legacy; new quote gets defaults', () => {
    expect(initialQuoteTaxRateIds({ settings, existing: true, savedTaxLines: [], savedExempt: true, customerExempt: true }).exemptionLifted).toBe(false)
    expect(initialQuoteTaxRateIds({ settings, existing: true, savedTaxLines: lines, savedExempt: false, customerExempt: false }).ids).toEqual(['state'])
    expect(initialQuoteTaxRateIds({ settings, existing: true, savedTaxLines: null, savedExempt: false, customerExempt: false }).ids).toBeNull()
    expect(initialQuoteTaxRateIds({ settings, existing: false, savedTaxLines: null, savedExempt: false, customerExempt: false }).ids).toEqual(['state', 'county'])
    expect(initialQuoteTaxRateIds({ settings: null, existing: false, savedTaxLines: null, savedExempt: false, customerExempt: false }).ids).toBeNull()
  })
})

function probeClient(missing: boolean, inserts: unknown[] = []) {
  const err = missing ? { code: '42703', message: 'column proposals.tax_lines does not exist' } : null
  const builder = (table: string) => {
    const rows: Record<string, unknown>[] = []
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const k of ['select', 'eq', 'ilike', 'neq', 'single']) b[k] = chain
    b.limit = () => Promise.resolve({ data: [], error: err })
    b.maybeSingle = () => Promise.resolve({ data: null, error: null })
    b.insert = (row: unknown) => (inserts.push({ table, row }), { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-org' }, error: null }) }) })
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, count: 0, error: null }).then(res)
    return b
  }
  return { from: builder, rpc: () => Promise.resolve({ data: null, error: null }), auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [] }, error: null }), createUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }) } } } as never
}

describe('migration 202611110040 check (owner save + company seed)', () => {
  it('reports missing columns', async () => {
    expect(await salesTaxColumnsReady(probeClient(true))).toBe(false)
    expect(await salesTaxColumnsReady(probeClient(false))).toBe(true)
  })

  it('seed does not turn sales tax on before the migration (dry run says so; apply writes no salesTax)', async () => {
    const r = parseCompanySeedInput(JSON.parse(readFileSync(path.join(process.cwd(), 'scripts', 'seed-company.example.json'), 'utf8')))
    if (!r.ok) throw new Error(r.errors.join('; '))
    const dry = await runCompanySeed(probeClient(true), r.input, { apply: false })
    expect(dry.lines.join('\n')).toContain('sales tax: NOT set up')
    const inserts: Array<{ table: string; row: { settings?: unknown } }> = []
    await runCompanySeed(probeClient(true, inserts), r.input, { apply: true }).catch(() => null) // later steps hit the thin fake
    expect(inserts.find((i) => i.table === 'orgs')?.row.settings).toEqual({})
    const ready: typeof inserts = []
    await runCompanySeed(probeClient(false, ready), r.input, { apply: true }).catch(() => null)
    expect(ready.find((i) => i.table === 'orgs')?.row.settings).toEqual({ salesTax: { enabled: true, rates: [], defaultRateIds: [] } })
  })
})
