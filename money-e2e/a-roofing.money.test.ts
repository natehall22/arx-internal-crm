/** @jest-environment node */
/**
 * Scenario A - roofing (ARX-like), one job from signed contract to cancelled-and-restored, every number read from every reader.
 * Steps run in order and share one job; a failure names the two readers that disagree.
 */
import { admin, cents, makeCompany, qbMapping, QbWorld, sql, type Company } from './world'
import { givePercentPlan, seedSignedRoofingJob, signChangeOrder, type RoofingDeal } from './roofing'
import { makeUser, exec } from './world'
import { loadPayWeekFull, payWeekCsv } from '@/lib/payroll-pay-week'
import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { buildProviderExport } from '@/lib/payroll-provider-export'
import { buildPaySheet } from '@/lib/payroll-pay-sheet'
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

it('A5 final payment -> paid in full, every reader (and the money-in readers still agree)', async () => {
  const left = SALE1 + CO1 - 900000
  await recordJobPayment(admin(), { orgId: co.id, jobId: deal.jobId, paidAt: '2026-11-10', amountCents: left, paymentType: 'final', method: 'check', payer: 'homeowner', createdBy: null })
  await collectedReaders(SALE1 + CO1)
  const page = await jobPageMoney(deal.jobId)
  agree('paid in full', { 'job page summary': page.summary.paid_in_full, expected: true })
  agree('balance remaining (cents)', { 'job page summary remaining': page.summary.remaining_cents, expected: 0 })
  await qb.run(co.id)
  const s = qbSale(qb.company(co.id), deal.jobNumber)
  agree('QuickBooks gross payments after final (cents)', { 'QB payments applied': s.paymentCents, collected: SALE1 + CO1 })
})

const NOW = new Date('2026-11-13T15:00:00Z') // Friday: the week that closed Wednesday 11/11 is the one being paid
let closerId = ''
let setterId = ''
let periodId = ''
const BASE_AFTER_CO = SALE1 + CO1 - 70000 // 1,687,540
const pct = (base: number, p: number) => Math.round((base * p) / 100) // cents, half up

it('A6 job complete -> portal shows the balance as paid, board and page agree', async () => {
  closerId = await makeUser(co.id, 'sales_rep', 'Closer')
  setterId = await makeUser(co.id, 'setter', 'Setter')
  await givePercentPlan(co, closerId, 'sales_rep', 7)
  await givePercentPlan(co, setterId, 'setter', 5)
  await admin().from('opportunities').update({ owner_user_id: closerId, setter_user_id: setterId }).eq('id', deal.opportunityId)
  await admin().from('production_jobs').update({ salesperson_id: closerId, status: 'complete', completed_at: '2026-11-10T15:00:00-05:00' }).eq('id', deal.jobId)
  exec(`update job_payments set created_at = paid_at::timestamptz + interval '12 hours' where job_id = '${deal.jobId}'`)
  const page = await jobPageMoney(deal.jobId)
  const portal = await portalJobMoney(co.id, deal.customerId, deal.jobId)
  agree('paid in full once installed', { 'job page summary': page.summary.paid_in_full, 'portal job money': portal.paidInFull, expected: true })
  agree('customer total (cents)', { 'job page required': page.summary.sale_amount_cents, 'portal total': portal.totalCents, 'sale amount': SALE1 + CO1 })
  agree('customer paid (cents)', { 'job page collected': page.summary.collected_cents, 'portal paid': portal.paidCents, 'sale amount': SALE1 + CO1 })
})

it('A7 pay week: preview == approved == CSV == provider export == pay sheets == payout lines == reports', async () => {
  const preview = await loadPayWeekFull(admin(), co.id, NOW)
  expect(preview.week.state).toBe('draft')
  periodId = preview.week.period.id
  const closer = pct(BASE_AFTER_CO, 7)
  const setter = pct(BASE_AFTER_CO, 5)
  agree('preview pay (cents): oracle', { 'preview total': cents(preview.week.totals.amount), 'oracle 7% closer + 5% setter on the commission base': closer + setter })
  const lock = await lockPayrollPeriod(admin(), { orgId: co.id, periodId, actorUserId: co.ownerId, status: 'open', expectedTotal: preview.week.totals.amount, now: NOW })
  if (!lock.ok) throw new Error(`approve refused: ${JSON.stringify(lock.body)}`)
  const approved = await loadPayWeekFull(admin(), co.id, NOW, periodId)
  expect(approved.week.state).toBe('approved')
  const csvTotal = Number(payWeekCsv(approved.week).trim().split('\n').pop()!.split(',').pop())
  const sheets = approved.week.people.reduce((t, p) => t + cents(buildPaySheet(approved.week, p, { labels: {}, showMath: false }).total), 0)
  const exp = buildProviderExport({ provider: 'gusto', week: approved.week, people: new Map(approved.week.people.map((p) => [p.userId, { userId: p.userId, firstName: p.name.split(' ')[0], lastName: 'Test', email: null, employeeId: null }])) })
  const lines = sql<any>(`select coalesce(sum(net_amount),0) n from payroll_payout_lines where payroll_period_id='${periodId}'`)[0]
  const rpt = sql<any>(`select coalesce(sum(net_amount),0) n from rpt_payroll_lines where job_id='${deal.jobId}'`)[0]
  const dbTotal = sql<any>(`select coalesce(sum(raw) filter (where raw > 0),0) total from payroll_week_person_totals('${co.id}','${periodId}')`)[0]
  agree('approved pay (cents)', {
    'preview total': cents(preview.week.totals.amount),
    'approved week total': cents(approved.week.totals.amount),
    'lock summary total': cents((lock.summary as any).total),
    'pay-week CSV TOTAL row': cents(csvTotal),
    'provider export (Gusto) total': cents(exp.total),
    'pay sheets (sum of checks)': sheets,
    'payroll_payout_lines net sum': cents(lines.n),
    'rpt_payroll_lines net sum': cents(rpt.n),
    'SQL payroll_week_person_totals': cents(dbTotal.total),
  })
  // Per person
  const byName = (n: string) => approved.week.people.find((p) => p.userId === n)!
  agree('closer pay (cents)', { 'approved week': cents(byName(closerId).total), oracle: closer })
  agree('setter pay (cents)', { 'approved week': cents(byName(setterId).total), oracle: setter })
  // The base it was paid on is the base the job shows.
  const jv = approved.week.jobs.find((j) => j.jobId === deal.jobId)!
  agree('commission base on the pay week vs the job (cents)', { 'pay week job view': cents(jv.commissionBase), 'production_jobs.commission_comp_base': cents((await dbJob()).commission_comp_base) })
})
