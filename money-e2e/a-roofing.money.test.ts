/** @jest-environment node */
/**
 * Scenario A - roofing (ARX-like), one job from signed contract to cancelled-and-restored, every number read from every reader.
 * Steps run in order and share one job; a failure names the two readers that disagree.
 */
import { admin, cents, makeCompany, qbMapping, QbWorld, sql, type Company } from './world'
import { seedSignedRoofingJob, signChangeOrder, type RoofingDeal } from './roofing'
import { agree, jobPageMoney, opsBoardJob, portalJobMoney, qbSale, rptJob, rptPayments } from './readers'
import { signInAs } from './auth-mock'
import { syncJobSaleAndCommissionBase, currentContractTotal } from '@/lib/job-commission-base'
import { recordJobPayment } from '@/lib/job-payment-record'

jest.mock('@/lib/auth', () => require('./auth-mock').mockAuthModule())

let co: Company
let deal: RoofingDeal
const qb = new QbWorld()
const SALE1 = 1632500 // $16,325.00 signed contract (incl. $700.00 sales tax)
const TAX_SETTINGS = { enabled: true, rates: [{ id: 'nc', name: 'NC state', percent: 4.75, active: true }, { id: 'cab', name: 'Cabarrus County', percent: 2.25, active: true }], defaultRateIds: ['nc', 'cab'] }
const CO1 = 125040 // +$1,250.40 change order

beforeAll(async () => {
  co = await makeCompany('ARX-like Roofing', { features: { quickbooks: true, customerPortal: true }, salesTax: TAX_SETTINGS, quickbooks: qbMapping({ tax: { mode: 'code', taxCodeId: 'tc-1', rateMap: { nc: 'rate-nc', cab: 'rate-cab' } } }) })
  signInAs(co.ownerId)
  deal = await seedSignedRoofingJob(co, { n: 1, contractTotal: SALE1 / 100, salesTax: 700 })
  await admin().from('proposals').update({ tax_lines: [{ id: 'nc', name: 'NC state', percent: 4.75, amount_cents: 47500 }, { id: 'cab', name: 'Cabarrus County', percent: 2.25, amount_cents: 22500 }] }).eq('id', deal.proposalId)
  await admin().from('production_jobs').update({ dealer_fee_amount: 571.38, dealer_fee_percent: 3.5 }).eq('id', deal.jobId)
})

const dbJob = async () => (await admin().from('production_jobs').select('sale_amount, commission_comp_base, status').eq('id', deal.jobId).single()).data as any

async function saleReaders(expectCents: number) {
  const j = await dbJob()
  const board = await opsBoardJob(deal.jobId)
  const page = await jobPageMoney(deal.jobId)
  const contract = await currentContractTotal(admin(), co.id, deal.jobId)
  agree('sale amount (cents)', {
    'production_jobs.sale_amount': cents(j.sale_amount),
    'currentContractTotal (contract + signed COs)': contract.ok ? cents(contract.total) : -1,
    'ops board job.sale_amount': cents(board?.sale_amount),
    'job page payment summary (required)': page.summary.sale_amount_cents,
    'rpt_jobs.sale_amount': cents(rptJob(deal.jobId)?.sale_amount),
    expected: expectCents,
  })
  return j
}

it('A1 contract signed -> sale amount and commission base (tax out, dealer fee NOT out)', async () => {
  const r = await syncJobSaleAndCommissionBase(admin(), { orgId: co.id, jobId: deal.jobId })
  expect(r.status).toBe('updated')
  const j = await saleReaders(SALE1)
  agree('commission base (cents)', { 'production_jobs.commission_comp_base': cents(j.commission_comp_base), 'sale - sales tax (dealer fee 571.38 must NOT reduce it)': SALE1 - 70000 })
})

it('A2 change order signed -> base and sale move, ONE QuickBooks invoice event', async () => {
  await signChangeOrder(co, deal, { coNumber: 'CO-1', original: SALE1 / 100, updated: (SALE1 + CO1) / 100 })
  const r = await syncJobSaleAndCommissionBase(admin(), { orgId: co.id, jobId: deal.jobId })
  expect(r.status).toBe('updated')
  const j = await saleReaders(SALE1 + CO1)
  agree('commission base after CO (cents)', { db: cents(j.commission_comp_base), 'sale - tax': SALE1 + CO1 - 70000 })
  const ev = sql<any>(`select event_type, status from integration_outbox where org_id='${co.id}' and entity_id='${deal.jobId}' and event_type like 'invoice.%' order by created_at`)
  expect(ev.map((e) => e.event_type)).toEqual(['invoice.upserted', 'invoice.upserted'])
})

it('A3 Stripe-style card payment + cash payment, readers agree on collected; replays do not double count', async () => {
  const card = await recordJobPayment(admin(), { orgId: co.id, jobId: deal.jobId, paidAt: '2026-11-06', amountCents: 500000, paymentType: 'deposit', method: 'card', payer: 'homeowner', createdBy: null, idempotencyKey: 'pi_3Money001' })
  expect(card.ok).toBe(true)
  const replay = await recordJobPayment(admin(), { orgId: co.id, jobId: deal.jobId, paidAt: '2026-11-06', amountCents: 500000, paymentType: 'deposit', method: 'card', payer: 'homeowner', createdBy: null, idempotencyKey: 'pi_3Money001' })
  expect(replay.ok && replay.duplicate).toBe(true)
  await recordJobPayment(admin(), { orgId: co.id, jobId: deal.jobId, paidAt: '2026-11-09', amountCents: 400000, paymentType: 'final', method: 'cash', payer: 'homeowner', createdBy: null })
  await collectedReaders(900000)
})

async function collectedReaders(expectCents: number) {
  const board = await opsBoardJob(deal.jobId)
  const page = await jobPageMoney(deal.jobId)
  const raw = sql<any>(`select coalesce(sum(amount_cents),0)::int c from job_payments where job_id='${deal.jobId}'`)[0].c
  agree('collected (cents)', {
    'job_payments sum': raw,
    'ops board collected_cents': board?.collected_cents,
    'job page summary collected': page.summary.collected_cents,
    'rpt_jobs.collected': cents(rptJob(deal.jobId)?.collected),
    'rpt_payments sum': rptPayments(deal.jobId).reduce((t, p) => t + cents(p.amount), 0),
    expected: expectCents,
  })
}

it('A4 QuickBooks: one customer, one job, ONE invoice = sale amount, payments gross; second run adds nothing', async () => {
  await qb.run(co.id)
  const c = qb.company(co.id)
  const first = JSON.stringify(Object.fromEntries(Object.entries(c.store).map(([k, v]) => [k, v.length])))
  const s = qbSale(c, deal.jobNumber)
  agree('QuickBooks invoice vs sale amount (cents)', { 'QB invoice total': s.invoiceCents, 'production_jobs.sale_amount': cents((await dbJob()).sale_amount) })
  agree('QuickBooks payments vs collected (cents)', { 'QB payments applied': s.paymentCents, 'job_payments sum': 900000 })
  expect(s.invoices).toHaveLength(1)
  await qb.run(co.id)
  const second = JSON.stringify(Object.fromEntries(Object.entries(c.store).map(([k, v]) => [k, v.length])))
  expect(second).toBe(first)
})
