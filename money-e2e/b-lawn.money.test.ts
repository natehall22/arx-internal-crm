/** @jest-environment node */
/**
 * Scenario B - lawn care (Precision-like), billed by the hour: time clock -> approved hours -> invoice with Florida-style
 * stacked tax -> partial payments -> QuickBooks in every-invoice mode -> a payment taken back out.
 * NOT covered here (needs its own seeding): service-plan visit invoices, autopay, hourly payroll.
 */
import { admin, cents, must, makeCompany, makeUser, qbMapping, QbWorld, sql, type Company } from './world'
import { seedSignedRoofingJob, type RoofingDeal } from './roofing'
import { agree, jobPageMoney, opsBoardJob, rptJob } from './readers'
import { signInAs } from './auth-mock'
import { recordJobPayment } from '@/lib/job-payment-record'
import { approveHours } from '@/lib/hourly-billing-db'
import { DELETE as deletePayment } from '@/app/api/ops/jobs/[id]/payments/[paymentId]/route'

jest.mock('@/lib/auth', () => require('./auth-mock').mockAuthModule())

const FL_TAX = { enabled: true, rates: [{ id: 'fl', name: 'Florida state', percent: 6, active: true }, { id: 'ora', name: 'Orange County', percent: 0.5, active: true }], defaultRateIds: ['fl', 'ora'] }
const NOW = new Date('2026-11-13T15:00:00Z')
let co: Company
let deal: RoofingDeal
let invoiceId = ''
let invoiceTotal = 0
const qb = new QbWorld()

beforeAll(async () => {
  co = await makeCompany('Precision-like Lawn', { features: { quickbooks: true, customerPortal: true }, salesTax: FL_TAX, quickbooks: qbMapping({ invoiceMode: 'per_invoice', tax: { mode: 'code', taxCodeId: 'tc-fl', rateMap: { fl: 'rate-fl', ora: 'rate-ora' } } }) }, { timezone: 'America/New_York' })
  signInAs(co.ownerId)
  const crew = await makeUser(co.id, 'sales_rep', 'Crew One')
  const pb = await must(admin().from('pricebooks').insert({ org_id: co.id, name: 'Lawn', is_default: true }).select('id').single(), 'pricebook')
  const labor = await must(admin().from('pricebook_items').insert({ org_id: co.id, pricebook_id: (pb as any).id, category: 'addons', item_type: 'install', name: 'Crew labor', unit: 'hour', unit_price: 65, is_labor: true, is_taxable: true }).select('id').single(), 'labor item')
  deal = await seedSignedRoofingJob(co, { n: 1, contractTotal: 520, salesTax: 0, customerName: 'Lee Lawnowner', email: 'lee@example.test' })
  await must(admin().from('production_jobs').update({ billing_mode: 'time_materials', hourly_rate_item_id: (labor as any).id, estimated_hours: 8 }).eq('id', deal.jobId).select('id').single(), 'T&M job')
  // 4.5 h clocked on Nov 9 (14:00-18:30 UTC = 9:00-13:30 Eastern)
  await must(admin().from('time_entries').insert({ org_id: co.id, user_id: crew, production_job_id: deal.jobId, kind: 'work', started_at: '2026-11-09T14:00:00Z', ended_at: '2026-11-09T18:30:00Z', source: 'typed', tapped_via: 'office' }).select('id').single(), 'time entry')
})

it('B1 approved hours -> ONE invoice: hours x rate, stacked tax rounded per rate; every invoice reader agrees', async () => {
  const r = await approveHours(admin(), co.id, co.ownerId, { target: { kind: 'job', id: deal.jobId }, days: [{ date: '2026-11-09' }] }, NOW)
  if (!r.ok) throw new Error(`approve refused: ${r.error}`)
  invoiceId = r.invoiceId
  invoiceTotal = r.totalCents
  const sub = 4.5 * 6500 // 29,250
  const tax = Math.round(sub * 0.06) + Math.round(sub * 0.005) // 1,755 + 146 (half-up per rate)
  const inv = sql<any>(`select subtotal_cents, tax_cents, total_cents from job_invoices where id='${invoiceId}'`)[0]
  agree('invoice (cents)', { 'approveHours result total': r.totalCents, 'job_invoices.total_cents': inv.total_cents, 'by hand: 4.5h x $65 + 6% + 0.5%': sub + tax, 'subtotal + tax': inv.subtotal_cents + inv.tax_cents })
})

it('B2 issued invoice = what is owed on a time-and-materials job (not the $520 estimate): page, board and reports', async () => {
  await must(admin().from('job_invoices').update({ status: 'sent', issued_at: '2026-11-09', sent_at: NOW.toISOString() }).eq('id', invoiceId).select('id').single(), 'issue')
  await recordJobPayment(admin(), { orgId: co.id, jobId: deal.jobId, paidAt: '2026-11-10', amountCents: 10000, paymentType: 'deposit', method: 'card', payer: 'homeowner', createdBy: null })
  const page = await jobPageMoney(deal.jobId)
  const board = await opsBoardJob(deal.jobId)
  agree('owed after a $100.00 payment (cents)', {
    'job page remaining': page.summary.remaining_cents,
    'invoice total - collected': invoiceTotal - 10000,
  })
  agree('collected on the job (cents)', { 'ops board collected_cents': board?.collected_cents, 'rpt_jobs.collected': cents(rptJob(deal.jobId)?.collected), 'job page': page.summary.total_paid_cents ?? page.summary.collected_cents })

  agree('not paid in full', { 'job page paid_in_full': page.summary.paid_in_full ? 'paid' : 'open', expected: 'open' })
})

it('B3 QuickBooks, every-invoice mode: ONE invoice = the CRM invoice incl. tax; the payment applied; a second run adds nothing', async () => {
  await qb.run(co.id)
  await qb.run(co.id)
  const c = qb.company(co.id)
  const invs = c.all('Invoice')
  agree('QuickBooks invoices', { count: invs.length, expected: 1 })
  agree('QuickBooks invoice total (cents)', { QuickBooks: cents(invs[0].TotalAmt), 'CRM job_invoices.total_cents': invoiceTotal })
  const applied = c.all('Payment').reduce((t, p) => t + cents(p.TotalAmt), 0)
  agree('QuickBooks payments (cents)', { QuickBooks: applied, 'CRM job_payments': 10000 })
})

// FINDING B2b: for a time-and-materials job the report view still owes the ESTIMATE ($520 - collected), not the hours billed.
// supabase/migrations/202610220010_reporting_views.sql:37 (rpt_jobs.balance_due = sale_amount - collected) vs lib/job-collection.ts (timeAndMaterialsInvoicedCents).
it.failing('B2b time-and-materials: rpt_jobs.balance_due == the job page remaining balance', async () => {
  const page = await jobPageMoney(deal.jobId)
  agree('balance due on a time-and-materials job (cents)', { 'job page remaining': page.summary.remaining_cents, 'rpt_jobs.balance_due': cents(rptJob(deal.jobId)?.balance_due) })
})

// FINDING B4: the payments route hard-deletes a payment row; QuickBooks already holds it, and no event tells QuickBooks.
// app/api/ops/jobs/[id]/payments/[paymentId]/route.ts:43 (.delete()) vs lib/job-payment-record.ts:17 ("a payment is never edited or deleted").
it.failing('B4 a payment taken back out (Delete payment): CRM collected == QuickBooks payments, and the job is not paid in full', async () => {
  const pay = await must(admin().from('job_payments').select('id').eq('job_id', deal.jobId).limit(1).single(), 'payment')
  const res = await deletePayment(new Request('http://x', { method: 'DELETE' }), { params: { id: deal.jobId, paymentId: (pay as any).id } })
  expect(res.status).toBe(200)
  await qb.run(co.id)
  const crm = cents(sql<any>(`select coalesce(sum(amount_cents),0)::int as total from job_payments where job_id='${deal.jobId}'`)[0].total) / 100
  const inQb = qb.company(co.id).all('Payment').reduce((t, p) => t + cents(p.TotalAmt), 0)
  agree('payments after Delete payment (cents)', { 'CRM job_payments': crm, QuickBooks: inQb, 'rpt_jobs.collected': cents(rptJob(deal.jobId)?.collected) })
})
