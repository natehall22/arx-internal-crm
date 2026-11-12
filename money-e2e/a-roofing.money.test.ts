/** @jest-environment node */
/**
 * Scenario A - roofing (ARX-like), one job from signed contract to cancelled-and-restored, every number read from every reader.
 * Steps run in order and share one job; a failure names the two readers that disagree.
 */
import { admin, cents, must, makeCompany, qbMapping, QbWorld, sql, type Company } from './world'
import { givePercentPlan, seedSignedRoofingJob, signChangeOrder, type RoofingDeal } from './roofing'
import { makeUser, exec } from './world'
import { loadPayWeekFull, payWeekCsv } from '@/lib/payroll-pay-week'
import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { buildProviderExport } from '@/lib/payroll-provider-export'
import { buildPaySheet } from '@/lib/payroll-pay-sheet'
import { addJobCostLine, jobDirectCost, resolveVendorId } from '@/lib/job-cost-ledger'
import { recordPoBill } from '@/lib/purchase-orders-db'
import { summarizeJobEconomics } from '@/lib/goals-job-economics'
import { jobProfitCents, loadJobCommissions } from '@/lib/job-commission-actual'
import { rptCosts } from './readers'
import { POST as cancelPOST, DELETE as uncancelDELETE } from '@/app/api/ops/jobs/[id]/cancel/route'
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
  const portal = (await portalJobMoney(co.id, deal.customerId, deal.jobId))!
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

it('A8 costs: manual lines + a supplier PO bill + the dealer-fee mirror line -> ledger == board == reports == profit tracker == Financials card', async () => {
  const db = admin()
  const abc = await resolveVendorId(db, co.id, 'ABC Supply', null)
  const add = (description: string, amount: number, costType: any, over: Record<string, unknown> = {}) =>
    addJobCostLine(db, { orgId: co.id, jobId: deal.jobId, userId: co.ownerId, description, amount, costType, vendorId: abc, source: 'manual', ...over })
  for (const r of [await add('Shingles + underlayment', 4100, 'material'), await add('Crew labor', 2350.55, 'subcontractor'), await add('Permit', 75, 'permit'), await add('Return: unused bundles', 118.25, 'material', { credit: true })]) expect(r.ok).toBe(true)
  // The financing dealer fee is mirrored as a ledger line (source dealer_fee_sync); it must be counted ONCE, with job.dealer_fee_amount.
  const fee = await add('Lender / dealer fee', 571.38, 'other', { source: 'dealer_fee_sync' })
  expect(fee.ok).toBe(true)
  // A supplier PO that was sent, and its bill: one cost line per bill.
  const po = await must(db.from('supplier_orders').insert({ org_id: co.id, job_id: deal.jobId, vendor_id: abc, po_number: 'PO-9001', po_letter: 'A', status: 'sent', kind: 'general', first_sent_at: new Date().toISOString() }).select('id').single(), 'po')
  const bill = await recordPoBill(db, co.id, co.ownerId, (po as { id: string }).id, { amountCents: 264017, billNumber: 'ABC-7731', billDate: '2026-11-08', isCredit: false, notes: null, costType: 'material', clientKey: 'k1' }, { over: true, duplicate: true })
  if (!bill.ok) throw new Error(`bill refused: ${bill.message}`)
  const again = await recordPoBill(db, co.id, co.ownerId, (po as { id: string }).id, { amountCents: 264017, billNumber: 'ABC-7731', billDate: '2026-11-08', isCredit: false, notes: null, costType: 'material', clientKey: 'k1' }, { over: true, duplicate: true })
  expect(again.ok && again.billId).toBe(bill.billId) // a retried bill never doubles a cost

  const lines = 410000 + 235055 + 7500 - 11825 + 264017 // 905,..: every line except the dealer-fee mirror
  const dealerFee = 57138
  const j = (await db.from('production_jobs').select('*').eq('id', deal.jobId).single()).data as any
  const page = await jobPageMoney(deal.jobId)
  const board = await opsBoardJob(deal.jobId)
  const rj = rptJob(deal.jobId)
  agree('job direct cost (cents): ledger + dealer fee once', {
    'job page ledger (jobDirectCost)': cents(jobDirectCost(page.cost, j.dealer_fee_amount)),
    'ops board job_costs.total + dealer fee': cents(board?.job_costs?.total) + dealerFee,
    'rpt_jobs.cost_total': cents(rj.cost_total),
    'rpt_job_costs rows (non-fee) + dealer fee': rptCosts(deal.jobId).filter((r) => r.description !== 'Lender / dealer fee').reduce((t, r) => t + cents(r.amount), 0) + dealerFee,
    'by hand: lines + dealer fee': lines + dealerFee,
  })
  const commission = (await loadJobCommissions(db, co.id, [deal.jobId])).get(deal.jobId) ?? null
  const econ = summarizeJobEconomics([{ id: deal.jobId, sale_amount: j.sale_amount, sale_date: j.sale_date, created_at: j.created_at, dealer_fee_amount: j.dealer_fee_amount, commission_comp_base: j.commission_comp_base }], new Map([[deal.jobId, page.cost]]), new Map([[deal.jobId, commission]]))
  const cardProfit = jobProfitCents({ saleCents: cents(j.sale_amount), directCostCents: cents(jobDirectCost(page.cost, j.dealer_fee_amount)), commissionCents: commission?.cents ?? null })?.profitCents ?? null
  agree('job profit (cents) - Financials card formula vs goals economics', { 'Financials card (sale - direct - payroll commission)': cardProfit, 'goals-job-economics netProfit': cents(econ.netProfit) })
  agree('profit before commission (cents)', { 'rpt_jobs.profit_before_commission': cents(rj.profit_before_commission), 'sale - dealer fee - ledger lines': cents(j.sale_amount) - dealerFee - lines })
})

it('A8b QuickBooks bill: ONE Bill = the PO bill, none for typed-in cost lines, payroll is not posted; a second run adds nothing', async () => {
  await qb.run(co.id)
  const c = qb.company(co.id)
  const bills = c.all('Bill')
  agree('QuickBooks Bills vs CRM approved PO bills', { 'QB bill count': bills.length, 'CRM approved bills': 1 })
  agree('QuickBooks bill total (cents)', { 'QB bill': cents(bills[0].TotalAmt), 'purchase_order_bills.amount': 264017 })
  const before = JSON.stringify(Object.fromEntries(Object.entries(c.store).map(([k, v]) => [k, v.length])))
  await qb.run(co.id)
  expect(JSON.stringify(Object.fromEntries(Object.entries(c.store).map(([k, v]) => [k, v.length])))).toBe(before)
  expect(Object.keys(c.store).filter((k) => /payroll|salary|timeactivity|employee/i.test(k))).toEqual([])
})

describe('cancel, undo, refund (a second job that has not been installed)', () => {
  let deal2: RoofingDeal
  const SALE2 = 980000
  const board2 = async () => (await opsBoardJob(deal2.jobId)) as any
  const cancel = (reason = 'customer_backed_out') => cancelPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ reason }) }), { params: { id: deal2.jobId } })

  it('A9 deposit then cancel -> QuickBooks invoice voided (not deleted), sales readers drop it, the money stays recorded', async () => {
    deal2 = await seedSignedRoofingJob(co, { n: 2, contractTotal: SALE2 / 100, salesTax: 0, customerName: 'Sam Second', email: 'sam@example.test' })
    await syncJobSaleAndCommissionBase(admin(), { orgId: co.id, jobId: deal2.jobId })
    await recordJobPayment(admin(), { orgId: co.id, jobId: deal2.jobId, paidAt: '2026-11-10', amountCents: 300000, paymentType: 'deposit', method: 'card', payer: 'homeowner', createdBy: null, idempotencyKey: 'pi_3Money002' })
    await qb.run(co.id)
    let s = qbSale(qb.company(co.id), deal2.jobNumber)
    agree('job 2 QuickBooks invoice before cancel (cents)', { 'QB invoice': s.invoiceCents, 'sale amount': SALE2 })
    agree('job 2 QuickBooks payment before cancel (cents)', { 'QB payment': s.paymentCents, 'job_payments': 300000 })
    const res = await cancel()
    expect(res.status).toBe(200)
    await qb.run(co.id)
    s = qbSale(qb.company(co.id), deal2.jobNumber)
    expect(s.invoices).toHaveLength(1) // kept, not deleted
    agree('job 2 QuickBooks invoice after cancel (cents)', { 'QB invoice (voided = 0)': s.invoiceCents, expected: 0 })
    const contracts = sql<any>(`select count(*)::int n from order_form_contracts where id = '${deal2.contractId}' and status = 'completed'`)[0].n
    agree('job 2 live signed contracts after cancel', { 'order_form_contracts completed': contracts, expected: 0 })
    agree('job 2 sale amount in reports after cancel (cents)', { 'rpt_jobs.sale_amount': cents(rptJob(deal2.jobId).sale_amount), expected: 0 })
    agree('job 2 collected after cancel (cents)', { 'job_payments': 300000, 'rpt_jobs.collected': cents(rptJob(deal2.jobId).collected), 'ops board collected': (await board2()).collected_cents })
  })

  it('A10 refund recorded on the cancelled job -> Needs you, never a second credit in QuickBooks, a repeat adds nothing', async () => {
    const r1 = await recordJobPayment(admin(), { orgId: co.id, jobId: deal2.jobId, paidAt: '2026-11-11', amountCents: -300000, paymentType: 'other', method: 'card', payer: 'homeowner', createdBy: null, idempotencyKey: 're_3Money002', eventType: 'payment.refunded' })
    expect(r1.ok).toBe(true)
    const r2 = await recordJobPayment(admin(), { orgId: co.id, jobId: deal2.jobId, paidAt: '2026-11-11', amountCents: -300000, paymentType: 'other', method: 'card', payer: 'homeowner', createdBy: null, idempotencyKey: 're_3Money002', eventType: 'payment.refunded' })
    expect(r2.ok && r2.duplicate).toBe(true)
    const c = qb.company(co.id)
    const refundsBefore = c.all('RefundReceipt').length + c.all('CreditMemo').length
    await qb.run(co.id)
    await qb.run(co.id)
    agree('QuickBooks refund documents for a cancelled sale', { 'RefundReceipt + CreditMemo': c.all('RefundReceipt').length + c.all('CreditMemo').length, expected: refundsBefore })
    const needs = sql<any>(`select event_type, status, last_error from integration_outbox where org_id='${co.id}' and entity_table='job_payments' and event_type='payment.refunded'`)
    expect(needs).toHaveLength(1) // ONE refund event, however many times it was recorded twice
    expect(needs[0].status).toBe('failed') // outbox_status 'failed' IS the Needs-you state
    expect(String(needs[0].last_error)).toMatch(/cancel|credit|refund/i)
    agree('job 2 net collected after refund (cents)', { 'job_payments sum': sql<any>(`select sum(amount_cents)::int n from job_payments where job_id='${deal2.jobId}'`)[0].n, 'rpt_jobs.collected': cents(rptJob(deal2.jobId).collected), expected: 0 })
  })

  it('A11 undo cancel -> job and contract back, sale amount back everywhere, ONE live QuickBooks invoice (reissued), no duplicate customer', async () => {
    const res = await uncancelDELETE(new Request('http://x', { method: 'DELETE' }), { params: { id: deal2.jobId } })
    expect(res.status).toBe(200)
    await qb.run(co.id)
    await qb.run(co.id)
    const c = qb.company(co.id)
    const s = qbSale(c, deal2.jobNumber)
    const live = s.invoices.filter((i) => cents(i.TotalAmt) > 0)
    agree('job 2 live QuickBooks invoices after undo', { 'live invoices': live.length, expected: 1 })
    agree('job 2 live QuickBooks invoice total after undo (cents)', { 'QB live invoice': cents(live[0].TotalAmt), 'production_jobs.sale_amount': cents((await admin().from('production_jobs').select('sale_amount').eq('id', deal2.jobId).single()).data!.sale_amount), 'rpt_jobs.sale_amount': cents(rptJob(deal2.jobId).sale_amount) })
    const names = c.all('Customer').map((x) => x.DisplayName)
    agree('QuickBooks customers (one per person)', { 'distinct customers': new Set(names).size, 'customers': names.length })
  })
})

describe('cancel then undo with the deposit still held', () => {
  // FINDING: undo-cancel reissues the invoice as <number>-R but the deposit stays linked to the voided one.
  it.failing('A12 the customer deposit follows the job: QuickBooks payments applied to the LIVE invoice == CRM collected', async () => {
    const d3 = await seedSignedRoofingJob(co, { n: 3, contractTotal: 12000, salesTax: 0, customerName: 'Terry Third', email: 'terry@example.test' })
    await syncJobSaleAndCommissionBase(admin(), { orgId: co.id, jobId: d3.jobId })
    await recordJobPayment(admin(), { orgId: co.id, jobId: d3.jobId, paidAt: '2026-11-10', amountCents: 400000, paymentType: 'deposit', method: 'check', payer: 'homeowner', createdBy: null })
    await qb.run(co.id)
    const res = await cancelPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ reason: 'credit_fail' }) }), { params: { id: d3.jobId } })
    expect(res.status).toBe(200)
    await qb.run(co.id)
    expect((await uncancelDELETE(new Request('http://x', { method: 'DELETE' }), { params: { id: d3.jobId } })).status).toBe(200)
    await qb.run(co.id)
    await qb.run(co.id)
    const c = qb.company(co.id)
    const live = c.all('Invoice').filter((i) => String(i.DocNumber ?? '').startsWith(d3.jobNumber) && cents(i.TotalAmt) > 0)
    expect(live).toHaveLength(1)
    const appliedToLive = c.all('Payment').reduce((t, p) => t + ((p.Line ?? []) as any[]).filter((l) => l.LinkedTxn?.some((x: any) => x.TxnId === live[0].Id)).reduce((a, l) => a + cents(l.Amount), 0), 0)
    agree('job 3 deposit after cancel + undo (cents)', { 'CRM job_payments sum': 400000, 'QuickBooks payments applied to the live invoice': appliedToLive, })
  })
})

describe('known disagreements (were it.failing; fixed on feat/money-simple, now normal tests)', () => {
  // FINDING D1: the report view ignores invoice tax that the job page, ops board and payroll eligibility all add to what is owed.
  // supabase/migrations/202610220010_reporting_views.sql:37 (rpt_jobs.balance_due = sale_amount - collected) vs lib/job-collection.ts (invoiceTaxCents) via lib/job-payments.ts:47.
  it('D1 invoice tax: rpt_jobs.balance_due == the job page remaining balance (paid-in-full)', async () => {
    const d4 = await seedSignedRoofingJob(co, { n: 4, contractTotal: 10000, salesTax: 0, customerName: 'Dana Fourth', email: 'dana@example.test' })
    await syncJobSaleAndCommissionBase(admin(), { orgId: co.id, jobId: d4.jobId })
    await must(admin().from('job_invoices').insert({ org_id: co.id, job_id: d4.jobId, invoice_number: `${d4.jobNumber}-X1`, status: 'sent', issued_at: '2026-11-10', subtotal_cents: 1000000, taxable_subtotal_cents: 500000, tax_cents: 35000, total_cents: 1035000 }).select('id').single(), 'invoice with tax')
    await recordJobPayment(admin(), { orgId: co.id, jobId: d4.jobId, paidAt: '2026-11-10', amountCents: 1000000, paymentType: 'final', method: 'check', payer: 'homeowner', createdBy: null })
    const page = await jobPageMoney(d4.jobId)
    agree('balance due after paying the contract but not the invoice tax (cents)', {
      'job page remaining (sale + invoice tax - collected)': Math.max(page.summary.remaining_cents ?? 0, 0),
      'rpt_jobs.balance_due': cents(rptJob(d4.jobId)?.balance_due),
    })
  })

  // FINDING D2: the Financials card and goals economics subtract the 18% pool CAP as commission cost; payroll pays what the plans say (7% closer + 5% setter here).
  // app/ops/jobs/[id]/JobDetailClient.tsx:1374 and lib/goals-job-economics.ts:49 (poolCap) vs lib/payroll-pay-week.ts (actual lines).
  it('D2 commission cost on the job: Financials card / goals economics == what payroll actually paid', async () => {
    const j = (await admin().from('production_jobs').select('*').eq('id', deal.jobId).single()).data as any
    const card = (await loadJobCommissions(admin(), co.id, [deal.jobId])).get(deal.jobId)
    const econ = summarizeJobEconomics([{ id: deal.jobId, sale_amount: j.sale_amount, sale_date: j.sale_date, created_at: j.created_at }], new Map(), new Map([[deal.jobId, card ?? null]]))
    const paid = cents(sql<any>(`select coalesce(sum(net_amount),0) n from payroll_payout_lines where job_id='${deal.jobId}'`)[0].n)
    agree('commission cost of the job (cents)', { 'Financials card (payroll commission)': card?.cents ?? -1, 'goals economics totalCommissions': cents(econ.totalCommissions), 'payroll_payout_lines actually paid': paid })
  })
})
