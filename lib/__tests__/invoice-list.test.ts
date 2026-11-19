/** @jest-environment node */
/**
 * Billing → All invoices: every invoice (job + service, any status) with owed/late computed once, company-scoped; the
 * filters shared by the screen and the CSV; the CSV needs reports:financials + export on top of money:record.
 */
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { loadAllInvoices } from '@/lib/service-billing-db'
import { filterInvoiceRows, invoiceSearchText, invoicePeriodOf, invoiceRowsToResult, invoiceStanding, invoiceStandingLabel } from '@/lib/invoice-list'
import { resultToCsv } from '@/lib/reporting/run'

const ORG = 'org-a'
const TODAY = '2026-11-11'
const inv = (id: string, o: Record<string, unknown>) => ({ id, org_id: ORG, job_id: null, customer_id: 'c1', invoice_number: `INV-${id}`, status: 'sent', total_cents: 10000, due_at: '2026-11-01', issued_at: '2026-10-25', created_at: `2026-10-25T00:00:0${id}Z`, ...o })

function db() {
  return createFakeDb({
    production_jobs: [{ id: 'job-1', org_id: ORG, customer_id: 'c2', job_number: '26-0030', sale_amount: 1000, status: 'complete' }],
    customers: [
      { id: 'c1', org_id: ORG, name: 'Pat Lee', email: 'p@example.com' },
      { id: 'c2', org_id: ORG, name: 'Sam Roe', email: null },
      { id: 'cx', org_id: 'org-b', name: 'Other', email: null },
    ],
    job_invoices: [
      inv('1', {}), // 100 sent, $25 applied -> owes 75, 10 days late
      inv('2', { status: 'draft', due_at: null, issued_at: null }),
      inv('3', { status: 'void' }),
      inv('4', { status: 'paid' }),
      inv('5', { job_id: 'job-1', customer_id: null, total_cents: 100000, due_at: '2026-11-20' }), // job invoice, nothing paid, job owes 1000
      inv('6', { org_id: 'org-b', customer_id: 'cx' }), // another company: never listed
      inv('7', { due_at: '2026-12-01', status: 'partially_paid' }), // not due yet
    ],
    invoice_payments: [
      { id: 'a1', invoice_id: '1', applied_cents: 2500 },
      { id: 'a2', invoice_id: '4', applied_cents: 10000 },
      { id: 'a3', invoice_id: '7', applied_cents: 1000 },
    ],
    job_payments: [],
  })
}

describe('loadAllInvoices', () => {
  test('every status, company-scoped, newest first, with owed and days late', async () => {
    const r = await loadAllInvoices(db().client as never, ORG, { today: TODAY })
    const rows = r!.rows
    expect(rows.map((x) => x.id).sort()).toEqual(['1', '2', '3', '4', '5', '7'])
    expect(rows.find((x) => x.id === '6')).toBeUndefined()
    const by = Object.fromEntries(rows.map((x) => [x.id, x]))
    expect(by['1']).toMatchObject({ balanceCents: 7500, paidCents: 2500, daysOverdue: 10, customerName: 'Pat Lee' })
    expect(by['2']).toMatchObject({ balanceCents: 0, daysOverdue: 0 }) // a draft owes nothing
    expect(by['3']).toMatchObject({ balanceCents: 0, paidCents: 0 }) // a void owes nothing
    expect(by['4']).toMatchObject({ balanceCents: 0, paidCents: 10000 })
    expect(by['7']).toMatchObject({ balanceCents: 9000, daysOverdue: 0 })
    // a job invoice: customer through the job, never owed more than the job owes
    expect(by['5']).toMatchObject({ customerName: 'Sam Roe', jobNumber: '26-0030', balanceCents: 100000 })
    expect(r!.capped).toBe(false)
  })

  test('the same owed answer as the unpaid list for an open job invoice', async () => {
    const d = db()
    ;(d.tables.job_invoices as Array<Record<string, unknown>>).find((x) => x.id === '5')!.total_cents = 500000 // sent for more than the job is worth
    const r = await loadAllInvoices(d.client as never, ORG, { today: TODAY })
    expect(r!.rows.find((x) => x.id === '5')!.balanceCents).toBe(100000) // capped at the job's $1,000
  })

  test('one customer: their service invoices and their jobs invoices only', async () => {
    const r = await loadAllInvoices(db().client as never, ORG, { today: TODAY, customerId: 'c2' })
    expect(r!.rows.map((x) => x.id)).toEqual(['5'])
    const mine = await loadAllInvoices(db().client as never, ORG, { today: TODAY, customerId: 'c1' })
    expect(mine!.rows.map((x) => x.id).sort()).toEqual(['1', '2', '3', '4', '7'])
  })

  test('caps the read and says so', async () => {
    const r = await loadAllInvoices(db().client as never, ORG, { today: TODAY, cap: 2 })
    expect(r!.rows).toHaveLength(2)
    expect(r!.capped).toBe(true)
  })
})

describe('filters shared by the screen and the CSV', () => {
  const rows = async () => (await loadAllInvoices(db().client as never, ORG, { today: TODAY }))!.rows

  test('standing', async () => {
    const r = await rows()
    expect(filterInvoiceRows(r, { status: 'overdue' }, TODAY).map((x) => x.id)).toEqual(['1'])
    expect(filterInvoiceRows(r, { status: 'open' }, TODAY).map((x) => x.id).sort()).toEqual(['5', '7'])
    expect(filterInvoiceRows(r, { status: 'paid' }, TODAY).map((x) => x.id)).toEqual(['4'])
    expect(filterInvoiceRows(r, { status: 'draft' }, TODAY).map((x) => x.id)).toEqual(['2'])
    expect(filterInvoiceRows(r, { status: 'void' }, TODAY).map((x) => x.id)).toEqual(['3'])
    expect(invoiceStandingLabel(r.find((x) => x.id === '1')!)).toBe('Overdue 10 days')
  })

  test('customer, search and period', async () => {
    const r = await rows()
    expect(filterInvoiceRows(r, { customer: 'c2' }, TODAY).map((x) => x.id)).toEqual(['5'])
    expect(filterInvoiceRows(r, { q: 'sam' }, TODAY).map((x) => x.id)).toEqual(['5'])
    expect(filterInvoiceRows(r, { q: '26-0030' }, TODAY).map((x) => x.id)).toEqual(['5'])
    expect(filterInvoiceRows(r, { period: 'last_month' }, TODAY).length).toBeGreaterThan(0)
    expect(invoicePeriodOf({ issuedAt: '2026-11-02', createdDay: '2026-11-02' }, TODAY)).toBe('this_month')
    expect(invoicePeriodOf({ issuedAt: '2026-10-31', createdDay: '' }, TODAY)).toBe('last_month')
    expect(invoicePeriodOf({ issuedAt: '2026-03-01', createdDay: '' }, TODAY)).toBe('earlier_this_year')
    expect(invoicePeriodOf({ issuedAt: '2025-12-31', createdDay: '' }, TODAY)).toBe('older')
    expect(invoicePeriodOf({ issuedAt: '2026-01-15', createdDay: '' }, '2026-01-20')).toBe('this_month')
    expect(invoicePeriodOf({ issuedAt: '2025-12-15', createdDay: '' }, '2026-01-20')).toBe('last_month') // year boundary
  })

  test('a settled job invoice that is still "sent" reads paid', () => {
    expect(invoiceStanding({ status: 'sent', balanceCents: 0, daysOverdue: 0 })).toBe('paid')
  })
})

describe('CSV', () => {
  test('dollars, one writer (formula-safe), same rows as the filter', async () => {
    const r = (await loadAllInvoices(db().client as never, ORG, { today: TODAY }))!.rows
    const csv = resultToCsv(invoiceRowsToResult(filterInvoiceRows(r, { status: 'overdue' }, TODAY)) as never)
    expect(csv.split('\n')).toEqual(['Invoice #,Customer,Job #,PO #,Master invoice,Status,Issued,Due,Total,Paid,Owed,Days late', 'INV-1,Pat Lee,,,,Overdue 10 days,2026-10-25,2026-11-01,100,25,75,10'])
    const evil = invoiceRowsToResult([{ ...r[0], customerName: '=HYPERLINK("x")' }])
    expect(resultToCsv(evil as never)).toContain("'=HYPERLINK")
  })
})

describe('routes', () => {
  const profile = { id: 'u1', org_id: ORG, role: 'admin' }
  let canBill = true
  let finance = true
  let canExport = true
  jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile }) }))
  jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db().client }))
  jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: async () => canBill }))
  jest.mock('@/lib/reporting/run', () => ({
    ...jest.requireActual('@/lib/reporting/run'),
    buildReportContext: async () => ({ finance, canExport }),
  }))

  test('list needs money:record; export also needs reports:financials AND export', async () => {
    const { GET: list } = await import('@/app/api/invoices/route')
    const { GET: exp } = await import('@/app/api/invoices/export/route')
    const req = (qs = '') => ({ nextUrl: new URL(`http://x/api/invoices/export${qs}`) }) as never
    canBill = false
    expect((await list()).status).toBe(403)
    expect((await exp(req())).status).toBe(403)
    canBill = true
    finance = true
    canExport = true
    const ok = await list()
    expect(ok.status).toBe(200)
    expect((await ok.json()).canExport).toBe(true)
    const csv = await exp(req('?status=overdue'))
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    finance = false
    expect((await exp(req())).status).toBe(403)
    expect((await (await list()).json()).canExport).toBe(false)
    finance = true
    canExport = false
    expect((await exp(req())).status).toBe(403)
  })
})

describe('a draft belongs to the company day it was made, not the UTC day', () => {
  test('made 9pm Oct 31 in New York (UTC Nov 1) is last month', async () => {
    const d = db()
    ;(d.tables.job_invoices as Array<Record<string, unknown>>).find((i) => i.id === '2')!.created_at = '2026-11-01T01:00:00Z'
    const r = (await loadAllInvoices(d.client as never, ORG, { today: TODAY }))!.rows.find((x) => x.id === '2')!
    expect(r.createdDay).toBe('2026-10-31')
    expect(invoicePeriodOf(r, TODAY)).toBe('last_month')
  })
})

describe('the CSV search is the screen search', () => {
  test('invoice number, customer and job number all match, in both', async () => {
    const rows = (await loadAllInvoices(db().client as never, ORG, { today: TODAY }))!.rows
    for (const q of ['INV-1', 'pat', '26-0030']) {
      expect(filterInvoiceRows(rows, { status: '', period: '', customer: '', q }, TODAY).map((r) => r.id)).toEqual(
        rows.filter((r) => invoiceSearchText(r).toLowerCase().includes(q.toLowerCase())).map((r) => r.id)
      )
    }
  })
})
