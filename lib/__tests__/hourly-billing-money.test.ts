/**
 * Time & materials money rules: line amounts match Postgres exactly (integer math), a T&M job's commission base is what
 * it was invoiced minus tax (lib/job-commission-base.ts, the one writer), fixed-price jobs untouched; who sees rates;
 * switching back to "as sold" and copying an hours invoice are refused while hours are billed.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { lineTotalCents } from '@/lib/invoice-lines'
import { syncJobSaleAndCommissionBase, syncTimeAndMaterialsCommissionBase, timeAndMaterialsCommissionBase } from '@/lib/job-commission-base'
import { hourlyAccessFor } from '@/lib/hourly-billing-access'
import { invoiceHasBilledHours, liveBilledHoursInvoices, saveJobHourlySetup } from '@/lib/hourly-billing-db'

/** Postgres `round(qty::numeric(10,2) * cents)`: exact decimal, half away from zero (BigInt reference). */
function pgRound(qtyText: string, cents: number): number {
  const [w, f = ''] = qtyText.split('.')
  const hundredths = BigInt(w) * BigInt(100) + BigInt((f + '00').slice(0, 2))
  const p = hundredths * BigInt(cents) // in 1/100 cent
  const q = p / BigInt(100)
  const r = p % BigInt(100)
  return Number(r >= BigInt(50) ? q + BigInt(1) : q)
}

describe('line amount = what Postgres writes', () => {
  it('the reviewed pairs', () => {
    expect(lineTotalCents(0.69, 4550)).toBe(3140)
    expect(lineTotalCents(2.3, 6550)).toBe(15065)
    expect(Math.round(0.69 * 4550)).toBe(3139) // the old float math was a cent off
  })
  it('every hundredth of an hour up to 24 h × common rates', () => {
    const rates = [1, 3, 99, 2550, 4550, 6500, 6550, 7375, 9500, 12345, 99999]
    let checked = 0
    for (let h = 1; h <= 2400; h++) {
      const text = (h / 100).toFixed(2)
      for (const r of rates) {
        expect([text, r, lineTotalCents(Number(text), r)]).toEqual([text, r, pgRound(text, r)])
        checked++
      }
    }
    expect(checked).toBe(2400 * rates.length)
  })
  it('qty 1 lines (every fixed-price invoice) unchanged', () => {
    for (const c of [0, 1, 100, 1632500, 99999999]) expect(lineTotalCents(1, c)).toBe(c)
  })
})

describe('who may see / set a job’s hourly billing', () => {
  it('rates are prices: money people, or job editors with financials', () => {
    expect(hourlyAccessFor(true, { bill: true, canEditJobs: false, financials: false, owner: false })).toMatchObject({ bill: true, viewJob: true, editJob: false })
    expect(hourlyAccessFor(true, { bill: false, canEditJobs: true, financials: false, owner: false })).toMatchObject({ viewJob: false, editJob: false })
    expect(hourlyAccessFor(true, { bill: false, canEditJobs: true, financials: true, owner: false })).toMatchObject({ viewJob: true, editJob: true })
    expect(hourlyAccessFor(false, { bill: true, canEditJobs: true, financials: true, owner: true })).toMatchObject({ bill: false, viewJob: false, editJob: false, owner: false })
  })
})

const ORG = 'org1'
const TM = 'job-tm'
const FIXED = 'job-fixed'
function seed() {
  return createFakeDb({
    production_jobs: [
      { id: TM, org_id: ORG, billing_mode: 'time_materials', sale_amount: 5000, commission_comp_base: 4650, commission_pre_tax_subtotal: null, project_id: null },
      { id: FIXED, org_id: ORG, billing_mode: null, sale_amount: 16325, commission_comp_base: 16325, commission_pre_tax_subtotal: null, project_id: null },
    ],
    job_invoices: [
      { id: 'i1', org_id: ORG, job_id: TM, status: 'sent', invoice_number: 'INV-26-1', total_cents: 107000, tax_cents: 7000 },
      { id: 'i2', org_id: ORG, job_id: TM, status: 'draft', invoice_number: 'INV-26-2', total_cents: 32500, tax_cents: 0 },
      { id: 'i3', org_id: ORG, job_id: TM, status: 'void', invoice_number: 'INV-26-3', total_cents: 99900, tax_cents: 0 },
      { id: 'i4', org_id: ORG, job_id: FIXED, status: 'sent', invoice_number: 'INV-26-4', total_cents: 1632500, tax_cents: 0 },
    ],
    billed_time_days: [
      { id: 'b1', org_id: ORG, production_job_id: TM, status: 'approved', invoice_id: 'i1' },
      { id: 'b2', org_id: ORG, production_job_id: TM, status: 'approved', invoice_id: 'i3' },
    ],
    order_form_contracts: [],
    job_change_orders: [],
    pricebook_items: [],
  })
}

describe('commission base for a job billed by the hour = invoiced − tax', () => {
  it('pure', () => {
    expect(timeAndMaterialsCommissionBase({ issuedPreTaxCents: 132500 })).toBe(1325)
    expect(timeAndMaterialsCommissionBase(null)).toBe(0)
  })
  it('the one writer: non-void invoices, tax out, the estimate (sale amount) left as signed', async () => {
    const db = seed()
    const r = await syncJobSaleAndCommissionBase(db.client, { orgId: ORG, jobId: TM })
    expect(r).toEqual({ status: 'time_materials', changed: true, commissionBase: 1325 }) // (107000 − 7000 + 32500) / 100
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_comp_base: 1325, sale_amount: 5000 })
    expect(await syncJobSaleAndCommissionBase(db.client, { orgId: ORG, jobId: TM })).toMatchObject({ changed: false })
  })
  it('a fixed-price job (ARX): the invoice re-sync does nothing at all', async () => {
    const db = seed()
    expect(await syncTimeAndMaterialsCommissionBase(db.client, ORG, FIXED)).toBeNull()
    expect(db.writes.filter((w) => w.table === 'production_jobs')).toEqual([])
    expect(db.tables.production_jobs[1].commission_comp_base).toBe(16325)
  })
  it('another company’s job is never touched', async () => {
    const db = seed()
    expect(await syncTimeAndMaterialsCommissionBase(db.client, 'org2', TM)).toBeNull()
    expect(db.writes).toEqual([])
  })
})

describe('billed hours are billed once', () => {
  it('back to "as sold" refused while billed hours sit on a live invoice; allowed once voided', async () => {
    const db = seed()
    expect(await liveBilledHoursInvoices(db.client, ORG, TM)).toEqual(['INV-26-1'])
    expect(await saveJobHourlySetup(db.client, ORG, TM, { mode: 'fixed', estimatedHours: null, rateItemId: null })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('INV-26-1') })
    db.tables.job_invoices[0].status = 'void'
    expect(await saveJobHourlySetup(db.client, ORG, TM, { mode: 'fixed', estimatedHours: null, rateItemId: null })).toEqual({ ok: true })
    expect(db.tables.production_jobs[0].billing_mode).toBeNull()
  })
  it('an invoice carrying approved hours can’t be copied (that would bill them twice)', async () => {
    const db = seed()
    expect(await invoiceHasBilledHours(db.client, ORG, 'i1')).toBe(true)
    expect(await invoiceHasBilledHours(db.client, ORG, 'i4')).toBe(false)
    expect(await invoiceHasBilledHours(db.client, 'org2', 'i1')).toBe(false)
  })
})
