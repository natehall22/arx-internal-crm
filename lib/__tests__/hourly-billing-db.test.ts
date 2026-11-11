/**
 * Hours to bill end to end on the in-memory database: the screen's load, approve → ONE invoice (job or the customer's for
 * a visit) with sales tax from the ONE tax calculation, idempotency (a day billed once), edits need a reason, typed hours
 * when nobody clocked, a running clock refuses, un-approve only after void — and payroll / the clock are never written.
 *
 * approve_billed_time / unapprove_billed_time are mirrored here in JS (like lib/test-helpers/fake-service-plan-rpc.ts,
 * Known Redundancy 35): the real SQL runs on Postgres in supabase/tests/hourly_billing.test.sql.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { approveHours, loadHoursToBill, loadJobHourlySetup, parseApproveRequest, parseJobHourlyPatch, saveJobHourlySetup, unapproveHours } from '@/lib/hourly-billing-db'
import { buildBillingUnits } from '@/lib/service-billing'
import { localTimeToInstant } from '@/lib/time-tracking'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const TZ = DEFAULT_TIMEZONE
const at = (ymd: string, hm: string) => localTimeToInstant(ymd, hm, TZ)!.toISOString()
const NOW = new Date(at('2026-11-06', '17:00'))
const ORG = 'org1'
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const JOB = '22222222-2222-4222-8222-000000000001'
const JOB_FIXED = '22222222-2222-4222-8222-000000000002'
const OTHER_ORG_JOB = '22222222-2222-4222-8222-000000000009'
const VISIT = '11111111-1111-4111-8111-000000000001'
const PLAN = '44444444-4444-4444-8444-000000000001'
const LABOR = '33333333-3333-4333-8333-000000000001'
const TRACTOR = '33333333-3333-4333-8333-000000000002'
const CUST = '55555555-5555-4555-8555-000000000001'
const EXEMPT = '55555555-5555-4555-8555-000000000002'

type Row = Record<string, unknown>
let seq = 0
function fakeApprove(args: Record<string, unknown>, t: Record<string, Row[]>) {
  const err = (code: string, message: string) => Object.assign(new Error(message), { code })
  const job = args.p_job as string | null
  const visit = args.p_visit as string | null
  const days = args.p_days as Row[]
  const lines = args.p_lines as Row[]
  const totals = args.p_totals as Record<string, number>
  let customer: string | null = null
  let property: string | null = null
  if (job) {
    const j = (t.production_jobs ?? []).find((r) => r.id === job && r.org_id === args.p_org)
    if (!j) throw err('P0002', 'not found')
    if (j.billing_mode !== 'time_materials') throw err('22023', 'This job is not billed by the hour')
    customer = j.customer_id as string
  } else {
    const w = (t.work_orders ?? []).find((r) => r.id === visit && r.org_id === args.p_org)
    if (!w) throw err('P0002', 'not found')
    customer = w.customer_id as string
    property = (w.property_id as string) ?? null
    const billed = (t.job_invoice_items ?? []).some((i) => i.work_order_id === visit && (t.job_invoices ?? []).find((x) => x.id === i.invoice_id)?.status !== 'void')
    if (billed) return { invoice_id: null, skipped: [{ work_order_id: visit }] }
  }
  const skipped = days.filter((d) => (t.billed_time_days ?? []).some((b) => b.status === 'approved' && b.work_date === d.work_date && (job ? b.production_job_id === job : b.work_order_id === visit)))
  if (skipped.length) return { invoice_id: null, skipped: skipped.map((d) => ({ work_date: d.work_date })) }
  const subtotal = lines.reduce((n, l) => n + Math.round(Number(l.qty) * Number(l.unit_price_cents)), 0)
  if (totals.subtotal_cents !== subtotal || totals.total_cents !== subtotal + (totals.tax_cents ?? 0)) throw err('22023', 'totals do not match the lines')
  for (const d of days) if (d.source === 'edited' && !d.edit_reason) throw err('23514', 'edit reason')
  const id = `inv-${++seq}`
  const number = job ? `INV-26-${seq}` : `INV-26-0000${seq}`
  ;(t.job_invoices ??= []).push({ id, org_id: args.p_org, job_id: job, customer_id: job ? null : customer, property_id: property, status: 'draft', invoice_number: number, subtotal_cents: subtotal, tax_cents: totals.tax_cents, total_cents: totals.total_cents, invoice_kind: job ? 'standard' : 'service' })
  lines.forEach((l, i) => (t.job_invoice_items ??= []).push({ id: `${id}-${i}`, invoice_id: id, ...l, work_order_id: visit }))
  for (const d of days) (t.billed_time_days ??= []).push({ id: `bt-${++seq}`, org_id: args.p_org, production_job_id: job, work_order_id: visit, status: 'approved', invoice_id: id, approved_at: NOW.toISOString(), ...d })
  return { invoice_id: id, invoice_number: number, skipped: [] }
}
function fakeUnapprove(args: Record<string, unknown>, t: Record<string, Row[]>) {
  const row = (t.billed_time_days ?? []).find((b) => b.id === args.p_id && b.org_id === args.p_org && b.status === 'approved')
  if (!row) return false
  const inv = (t.job_invoices ?? []).find((x) => x.id === row.invoice_id)
  if (inv && inv.status !== 'void') return false
  row.status = 'unapproved'
  row.unapprove_reason = args.p_reason
  return true
}

function seed(extra: Partial<Record<string, Row[]>> = {}) {
  seq = 0
  const work = (id: string, user: string, ymd: string, from: string, to: string | null, where: Row = { production_job_id: JOB }) => ({
    id, org_id: ORG, user_id: user, kind: 'work', started_at: at(ymd, from), ended_at: to ? at(ymd, to) : null, source: 'lead_tap', end_source: to ? 'lead_tap' : null,
    closed_for_travel: false, needs_review: false, removed_at: null, work_order_id: null, production_job_id: null, ...where,
  })
  return createFakeDb(
    {
      orgs: [{ id: ORG, timezone: TZ, settings: { hourlyBilling: { rounding: 'up15', minimumHours: 2 }, salesTax: { enabled: true, rates: [{ id: 'fl', name: 'FL', percent: 7, active: true }], defaultRateIds: ['fl'] } } }],
      users: [{ id: U1, org_id: ORG, full_name: 'Ana', active: true }, { id: U2, org_id: ORG, full_name: 'Bo', active: true }],
      customers: [{ id: CUST, org_id: ORG, name: 'Pat Doe', email: 'pat@example.com', tax_exempt: false }, { id: EXEMPT, org_id: ORG, name: 'County', email: null, tax_exempt: true }],
      pricebook_items: [
        { id: LABOR, org_id: ORG, name: 'Grading labor', unit: 'hour', unit_price: 65, is_taxable: false, active: true, is_labor: true },
        { id: TRACTOR, org_id: ORG, name: 'Tractor', unit: 'hour', unit_price: 95, is_taxable: true, active: true, is_labor: false },
      ],
      production_jobs: [
        { id: JOB, org_id: ORG, job_number: '26-0041', customer_id: CUST, address_text: '9 Pine Rd', status: 'scheduled', billing_mode: 'time_materials', estimated_hours: 20, hourly_rate_item_id: LABOR },
        { id: JOB_FIXED, org_id: ORG, job_number: '26-0042', customer_id: CUST, status: 'scheduled', billing_mode: null },
        { id: OTHER_ORG_JOB, org_id: 'org2', job_number: '26-0099', customer_id: 'c2', status: 'scheduled', billing_mode: 'time_materials', hourly_rate_item_id: null },
      ],
      service_plans: [{ id: PLAN, org_id: ORG, name: 'Bush hogging', customer_id: CUST, property_id: null, price: 75, previous_price: null, price_starts_on: null, taxable: false, billing_basis: 'per_hour' }],
      work_orders: [{ id: VISIT, org_id: ORG, work_order_type: 'service_visit', job_id: null, service_plan_id: PLAN, customer_id: CUST, property_id: null, scheduled_date: '2026-11-05', status: 'completed', visit_step: 'service' }],
      time_entries: [
        // Tue Nov 3: Ana + Bo 08:00–14:07 on the job, Ana lunch 30 min; tractor started by Ana 08:00–16:00 (forgot to stop it).
        work('t1', U1, '2026-11-03', '08:00', '14:07'),
        work('t2', U2, '2026-11-03', '08:00', '14:07'),
        { id: 't3', org_id: ORG, user_id: U1, kind: 'break', started_at: at('2026-11-03', '12:00'), ended_at: at('2026-11-03', '12:30'), source: 'lead_tap', closed_for_travel: false, needs_review: false, removed_at: null },
        { id: 't4', org_id: ORG, user_id: null, kind: 'equipment', pricebook_item_id: TRACTOR, tapped_by_user_id: U1, production_job_id: JOB, started_at: at('2026-11-03', '08:00'), ended_at: at('2026-11-03', '16:00'), source: 'lead_tap', closed_for_travel: false, needs_review: false, removed_at: null },
        // Wed Nov 4: Ana 45 min (the 2 h minimum applies).
        work('t5', U1, '2026-11-04', '09:00', '09:45'),
        // Fri Nov 6: Bo still clocked in.
        work('t6', U2, '2026-11-06', '08:00', null),
        // Thu Nov 5: the visit, Ana 1:10.
        work('t7', U1, '2026-11-05', '10:00', '11:10', { work_order_id: VISIT }),
        // A removed entry never counts.
        { ...work('t8', U1, '2026-11-03', '15:00', '18:00'), removed_at: at('2026-11-04', '08:00') },
      ],
      job_invoices: [],
      job_invoice_items: [],
      billed_time_days: [],
      payroll_rep_hours: [],
      ...extra,
    },
    { rpc: { approve_billed_time: fakeApprove, unapprove_billed_time: fakeUnapprove } }
  )
}

const req = (body: unknown) => {
  const p = parseApproveRequest(body)
  if ('error' in p) throw new Error(p.error)
  return p.req
}

describe('the Hours to bill screen', () => {
  it('lists each day with what it bills and why', async () => {
    const db = seed()
    const data = await loadHoursToBill(db.client, ORG, { now: NOW })
    if (!data.ready) throw new Error('not ready')
    const job = data.targets.find((t) => t.id === JOB)!
    expect(job.customerName).toBe('Pat Doe')
    expect(job.title).toBe('Job 26-0041')
    expect(job.days.map((d) => [d.date, d.status])).toEqual([
      ['2026-11-06', 'open'],
      ['2026-11-04', 'ready'],
      ['2026-11-03', 'ready'],
    ])
    const tue = job.days.find((d) => d.date === '2026-11-03')!
    // Ana 5:37 → 5.75, Bo 6:07 → 6.25 (up to 15 min each); tractor = Ana's 5:37 at that stop → 5.75
    expect(tue.lines.map((l) => [l.kind, l.hours, l.rateCents])).toEqual([['labor', 12, 6500], ['equipment', 5.75, 9500]])
    expect(job.days.find((d) => d.date === '2026-11-04')!.lines[0].hours).toBe(2)
    expect(data.targets.some((t) => t.id === JOB_FIXED || t.id === OTHER_ORG_JOB)).toBe(false)
    const visit = data.targets.find((t) => t.id === VISIT)!
    expect(visit.labor).toEqual({ itemId: null, name: 'Bush hogging', rateCents: 7500, taxable: false })
    expect(visit.days[0].lines[0].hours).toBe(2) // 1:10 → 1.25, raised to the 2 h minimum
  })
})

describe('approve → invoice', () => {
  it('bills two days on ONE job invoice with tax on the taxable machine; a second tap bills nothing', async () => {
    const db = seed()
    const r = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-03' }, { date: '2026-11-04' }] }), NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.isJobInvoice).toBe(true)
    const inv = db.tables.job_invoices[0]
    expect(inv.job_id).toBe(JOB)
    // labor 12 h × 65 = 780 + tractor 5.75 × 95 = 546.25 + labor 2 × 65 = 130 → 1,456.25; tax 7% of 546.25 = 38.24
    expect(inv.subtotal_cents).toBe(145625)
    expect(inv.tax_cents).toBe(3824)
    expect(inv.total_cents).toBe(145625 + 3824)
    expect(db.tables.job_invoice_items.map((i) => [i.description, i.qty, i.unit, i.service_date])).toEqual([
      ['Grading labor — 2 people', 12, 'hour', '2026-11-03'],
      ['Tractor', 5.75, 'hour', '2026-11-03'],
      ['Grading labor', 2, 'hour', '2026-11-04'],
    ])
    expect(db.tables.billed_time_days.map((b) => [b.work_date, b.source, b.billable_hours, b.clocked_seconds])).toEqual([
      ['2026-11-03', 'clock', 17.75, (5 * 60 + 37 + 6 * 60 + 7) * 60],
      ['2026-11-04', 'clock', 2, 45 * 60],
    ])
    const again = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-03' }] }), NOW)
    expect(again).toEqual({ ok: false, status: 409, error: '2026-11-03 is already billed' })
    expect(db.tables.job_invoices).toHaveLength(1)
  })

  it('payroll and the clock are never written (exact minutes stay in time_entries)', async () => {
    const db = seed()
    await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-03' }] }), NOW)
    expect(db.writes.filter((w) => ['time_entries', 'payroll_rep_hours', 'job_cost_lines'].includes(w.table))).toEqual([])
  })

  it('an exempt customer pays no tax', async () => {
    const db = seed()
    db.tables.production_jobs[0].customer_id = EXEMPT
    const r = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-03' }] }), NOW)
    expect(r.ok).toBe(true)
    expect(db.tables.job_invoices[0].tax_cents).toBe(0)
  })

  it('a running clock refuses until it stops or the office types the hours (with a reason)', async () => {
    const db = seed()
    const r = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-06' }] }), NOW)
    expect(r).toMatchObject({ ok: false, status: 409 })
    const noReason = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-06', edit: { lines: [{ kind: 'labor', people: 1, hours: 8 }] } }] }), NOW)
    expect(noReason).toMatchObject({ ok: false, status: 400, error: 'Say why the hours changed' })
    const ok = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-06', edit: { lines: [{ kind: 'labor', people: 1, hours: 8 }], reason: 'Bo forgot to clock out' } }] }), NOW)
    expect(ok.ok).toBe(true)
    expect(db.tables.billed_time_days[0]).toMatchObject({ source: 'edited', edit_reason: 'Bo forgot to clock out', billable_hours: 8 })
  })

  it('an edit equal to the clock is the clock (no reason needed); a changed one needs one', async () => {
    const db = seed()
    const same = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-04', edit: { lines: [{ kind: 'labor', people: 1, hours: 2 }] } }] }), NOW)
    expect(same.ok).toBe(true)
    expect(db.tables.billed_time_days[0].source).toBe('clock')
    const changed = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-03', edit: { lines: [{ kind: 'labor', people: 2, hours: 11 }] } }] }), NOW)
    expect(changed).toMatchObject({ ok: false, error: 'Say why the hours changed' })
  })

  it('typed hours on a day nobody clocked (a sub crew) — marked typed; rates from the price book, never the browser', async () => {
    const db = seed()
    const r = await approveHours(
      db.client, ORG, U1,
      req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-02', edit: { lines: [{ kind: 'labor', people: 3, hours: 24, rateCents: 1 }, { kind: 'equipment', itemId: TRACTOR, hours: 8 }] } }] }),
      NOW
    )
    expect(r.ok).toBe(true)
    expect(db.tables.billed_time_days[0]).toMatchObject({ source: 'typed', clocked_seconds: 0, billable_hours: 32 })
    expect(db.tables.job_invoice_items.map((i) => i.unit_price_cents)).toEqual([6500, 9500])
  })

  it('no clock time and no typed hours → nothing to approve; future days refused; a fixed-price / other company job refused', async () => {
    const db = seed()
    expect(await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-01' }] }), NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-07' }] }), NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB_FIXED }, days: [{ date: '2026-11-03' }] }), NOW)).toMatchObject({ ok: false, status: 404 })
    expect(await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: OTHER_ORG_JOB }, days: [{ date: '2026-11-03' }] }), NOW)).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.job_invoices).toHaveLength(0)
  })

  it('no labor rate on the job → refused with what to do', async () => {
    const db = seed()
    db.tables.production_jobs[0].hourly_rate_item_id = null
    expect(await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-04' }] }), NOW)).toMatchObject({ ok: false, error: 'Set the labor rate for this job first' })
  })

  it("a visit of a per-hour plan: the customer's invoice at the plan's rate, then it is billed (not offered again)", async () => {
    const db = seed()
    const r = await approveHours(db.client, ORG, U1, req({ target: { kind: 'visit', id: VISIT }, days: [{ date: '2026-11-05' }] }), NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.isJobInvoice).toBe(false)
    expect(db.tables.job_invoices[0]).toMatchObject({ job_id: null, customer_id: CUST, invoice_kind: 'service', subtotal_cents: 15000, tax_cents: 0 })
    expect(db.tables.job_invoice_items[0]).toMatchObject({ work_order_id: VISIT, qty: 2, unit_price_cents: 7500 })
    const data = await loadHoursToBill(db.client, ORG, { now: NOW })
    if (!data.ready) throw new Error('not ready')
    expect(data.targets.find((t) => t.id === VISIT)!.days.map((d) => d.status)).toEqual(['approved'])
  })

  it('Ready to bill leaves per-hour plan visits to Hours to bill', () => {
    const { units, notBillable } = buildBillingUnits(
      [{ visitId: VISIT, planId: PLAN, customerId: CUST, propertyId: null, servedOn: '2026-11-05', visitStep: 'service', price: null, taxable: false }],
      new Map([[PLAN, { id: PLAN, name: 'Bush hogging', billing_basis: 'per_hour', price: 75, previous_price: null, price_starts_on: null, taxable: false, customer_id: CUST, property_id: null }]]),
      { visitIds: new Set(), planMonths: new Set() }
    )
    expect(units).toEqual([])
    expect(notBillable[0].reason).toBe('hourly')
  })
})

describe('un-approve', () => {
  it('only once the invoice is void, with a reason; then the day is billable again', async () => {
    const db = seed()
    await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-04' }] }), NOW)
    const id = String(db.tables.billed_time_days[0].id)
    expect(await unapproveHours(db.client, ORG, U1, id, '')).toMatchObject({ ok: false, status: 400 })
    expect(await unapproveHours(db.client, ORG, U1, id, 'wrong')).toMatchObject({ ok: false, status: 409, error: 'Void invoice INV-26-1 first, then un-approve' })
    db.tables.job_invoices[0].status = 'void'
    expect(await unapproveHours(db.client, ORG, U1, id, 'wrong rate')).toEqual({ ok: true })
    expect(await unapproveHours(db.client, ORG, U1, id, 'again')).toMatchObject({ ok: false, status: 404 })
    const again = await approveHours(db.client, ORG, U1, req({ target: { kind: 'job', id: JOB }, days: [{ date: '2026-11-04' }] }), NOW)
    expect(again.ok).toBe(true)
  })
})

describe("a job's billing setup", () => {
  it('reads and saves; the rate must be this company’s per-hour item', async () => {
    const db = seed()
    const s = await loadJobHourlySetup(db.client, ORG, JOB_FIXED)
    expect(s).toMatchObject({ mode: 'fixed', rateChoices: [expect.objectContaining({ id: LABOR, isLabor: true }), expect.objectContaining({ id: TRACTOR })] })
    expect(parseJobHourlyPatch({ mode: 'time_materials', estimatedHours: '12.5', rateItemId: LABOR })).toEqual({ patch: { mode: 'time_materials', estimatedHours: 12.5, rateItemId: LABOR } })
    expect(parseJobHourlyPatch({ mode: 'hourly' })).toHaveProperty('error')
    expect(await saveJobHourlySetup(db.client, ORG, JOB_FIXED, { mode: 'time_materials', estimatedHours: 12.5, rateItemId: '33333333-3333-4333-8333-0000000000ff' })).toMatchObject({ ok: false, status: 400 })
    expect(await saveJobHourlySetup(db.client, ORG, JOB_FIXED, { mode: 'time_materials', estimatedHours: 12.5, rateItemId: LABOR })).toEqual({ ok: true })
    expect(db.tables.production_jobs[1]).toMatchObject({ billing_mode: 'time_materials', estimated_hours: 12.5, hourly_rate_item_id: LABOR })
    expect(await saveJobHourlySetup(db.client, ORG, OTHER_ORG_JOB, { mode: 'fixed', estimatedHours: null, rateItemId: null })).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.production_jobs[2].billing_mode).toBe('time_materials')
  })
})
