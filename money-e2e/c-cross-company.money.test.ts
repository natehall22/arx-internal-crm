/** @jest-environment node */
/** Scenario C - two companies side by side: nothing crosses (outbox -> own QuickBooks realm, invoices, ops board, reports, portal). */
import { admin, cents, makeCompany, qbMapping, QbWorld, sql, type Company } from './world'
import { seedSignedRoofingJob, type RoofingDeal } from './roofing'
import { agree, opsBoardJob, portalJobMoney, rptJob, rptPayments } from './readers'
import { signInAs } from './auth-mock'
import { syncJobSaleAndCommissionBase } from '@/lib/job-commission-base'
import { recordJobPayment } from '@/lib/job-payment-record'

jest.mock('@/lib/auth', () => require('./auth-mock').mockAuthModule())

const qb = new QbWorld()
let a: Company, b: Company, da: RoofingDeal, db: RoofingDeal

beforeAll(async () => {
  a = await makeCompany('Cross Roofing A', { features: { quickbooks: true, customerPortal: true }, quickbooks: qbMapping() })
  b = await makeCompany('Cross Lawn B', { features: { quickbooks: true, customerPortal: true }, quickbooks: qbMapping() })
  // the SAME job number and the SAME customer name in both companies: the nastiest collision for any key that forgets org_id
  da = await seedSignedRoofingJob(a, { n: 7, contractTotal: 10000, salesTax: 0, customerName: 'Pat Same', email: 'pat@example.test' })
  db = await seedSignedRoofingJob(b, { n: 7, contractTotal: 2500, salesTax: 0, customerName: 'Pat Same', email: 'pat@example.test' })
  await syncJobSaleAndCommissionBase(admin(), { orgId: a.id, jobId: da.jobId })
  await syncJobSaleAndCommissionBase(admin(), { orgId: b.id, jobId: db.jobId })
  await recordJobPayment(admin(), { orgId: a.id, jobId: da.jobId, paidAt: '2026-11-10', amountCents: 300000, paymentType: 'deposit', method: 'check', payer: 'homeowner', createdBy: null })
  await recordJobPayment(admin(), { orgId: b.id, jobId: db.jobId, paidAt: '2026-11-10', amountCents: 50000, paymentType: 'deposit', method: 'check', payer: 'homeowner', createdBy: null })
})

it('C1 each company reads only its own money (reports views, ops board)', async () => {
  signInAs(a.ownerId)
  const boardA = await opsBoardJob(da.jobId)
  agree('company A sale amount', { 'ops board (A signed in)': cents(boardA?.sale_amount), 'rpt_jobs': cents(rptJob(da.jobId)?.sale_amount), expected: 1000000 })
  expect(await opsBoardJob(db.jobId)).toBeUndefined() // B's job is invisible to A's board
  signInAs(b.ownerId)
  agree('company B sale amount', { 'ops board (B signed in)': cents((await opsBoardJob(db.jobId))?.sale_amount), 'rpt_jobs': cents(rptJob(db.jobId)?.sale_amount), expected: 250000 })
  expect(await opsBoardJob(da.jobId)).toBeUndefined()
  agree('payments per company (cents)', {
    'A rpt_payments': rptPayments(da.jobId).reduce((t, p: any) => t + cents(p.amount), 0),
    'B rpt_payments': rptPayments(db.jobId).reduce((t, p: any) => t + cents(p.amount), 0) + 250000,
  })
})

it('C2 QuickBooks: each outbox drains into its own realm only, same job number and customer do not merge', async () => {
  await qb.run(a.id)
  await qb.run(b.id)
  await qb.run(a.id)
  const ca = qb.company(a.id), cb = qb.company(b.id)
  const inv = (c: any) => c.all('Invoice').filter((i: any) => String(i.DocNumber ?? '').startsWith(da.jobNumber))
  agree('invoices per realm', { 'A realm': inv(ca).length, 'B realm': inv(cb).length, expected: 1 })
  agree('invoice total (cents)', { 'A realm': cents(inv(ca)[0].TotalAmt), 'B realm': cents(inv(cb)[0].TotalAmt) + 750000, expected: 1000000 })
  agree('QuickBooks customers per realm (1 customer + 1 job sub-customer)', { A: ca.all('Customer').length, B: cb.all('Customer').length, expected: 2 })
  agree('payments per realm (cents)', { 'A realm': ca.all('Payment').reduce((t: number, p: any) => t + cents(p.TotalAmt), 0), 'B realm': cb.all('Payment').reduce((t: number, p: any) => t + cents(p.TotalAmt), 0) + 250000, expected: 300000 })
  const stray = sql<any>(`select count(*)::int as total from integration_outbox where org_id in ('${a.id}','${b.id}') and status <> 'completed' and status <> 'skipped'`)[0].total
  agree('unfinished outbox events across both companies', { count: stray, expected: 0 })
})

it('C3 portal: each homeowner sees only their own company job (same name, same job number)', async () => {
  const { loadPortalHome } = await import('@/lib/portal/data')
  const ha: any = await loadPortalHome(admin(), { sessionId: 'money-e2e', orgId: a.id, customerId: da.customerId })
  const hb: any = await loadPortalHome(admin(), { sessionId: 'money-e2e', orgId: b.id, customerId: db.customerId })
  agree('portal job ids', { 'A portal': (ha?.jobs ?? []).map((j: any) => j.id).join(','), 'A expected': da.jobId })
  agree('portal job ids', { 'B portal': (hb?.jobs ?? []).map((j: any) => j.id).join(','), 'B expected': db.jobId })
})
