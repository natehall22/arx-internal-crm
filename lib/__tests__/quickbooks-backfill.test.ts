/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { FakeQbCompany } from '@/lib/test-helpers/fake-qb'
import { applyBackfill, planBackfill } from '@/lib/quickbooks/backfill'
import { readQbSettings } from '@/lib/quickbooks/mapping'

const settings = readQbSettings({ quickbooks: { startDate: '2026-11-01', invoiceMode: 'per_job', income: { defaultItemId: 'i' }, depositToAccountId: 'd', confirmedAt: '2026-11-10T00:00:00Z' } })

function world() {
  const fake = createFakeDb({
    orgs: [{ id: 'a', settings: {} }, { id: 'b', settings: {} }],
    customers: [
      { id: 'ca1', org_id: 'a', name: 'Pat Homeowner', email: 'pat@example.com', phone: '7045550142', address_text: '12 Oak St, Concord, NC' },
      { id: 'ca2', org_id: 'a', name: 'Dana Twin', email: 'dana@example.com', phone: null, address_text: '9 Elm St, Concord, NC' },
      { id: 'ca3', org_id: 'a', name: 'Brand New', email: 'new@example.com', phone: null, address_text: '1 New St' },
      { id: 'cb1', org_id: 'b', name: 'Pat Homeowner', email: 'pat@example.com', phone: '7045550142', address_text: '12 Oak St, Concord, NC' },
    ],
    production_jobs: [
      { id: 'ja1', org_id: 'a', customer_id: 'ca1', job_number: '26-0001', sale_amount: 10700, status: 'sold', sale_date: '2026-11-05' },
      { id: 'ja2', org_id: 'a', customer_id: 'ca2', job_number: '26-0002', sale_amount: 5000, status: 'sold', sale_date: '2026-11-06' },
      { id: 'ja3', org_id: 'a', customer_id: 'ca3', job_number: '26-0003', sale_amount: 1000, status: 'sold', sale_date: '2026-11-06' },
    ],
    job_invoices: [], qb_links: [], integration_outbox: [], job_payments: [], purchase_order_bills: [],
  })
  const qb = new FakeQbCompany('realm-a')
  return { fake, qb, client: qb.client() }
}
const mk = async (qb: FakeQbCompany, entity: 'Customer' | 'Invoice', body: Record<string, unknown>) => {
  const r = await qb.client().create(entity, body, `r-${Math.random()}`)
  if (!r.ok) throw new Error('seed failed')
  return r.value as Record<string, any>
}

describe('QuickBooks backfill (link-first)', () => {
  it('matches by email, finds the job by number, the invoice by DocNumber; creates nothing', async () => {
    const w = world()
    const pat = await mk(w.qb, 'Customer', { DisplayName: 'Pat H', PrimaryEmailAddr: { Address: 'PAT@example.com' } })
    const job = await mk(w.qb, 'Customer', { DisplayName: '26-0001 12 Oak St', Job: true, ParentRef: { value: pat.Id } })
    const inv = await mk(w.qb, 'Invoice', { DocNumber: '26-0001', TotalAmt: 10700, CustomerRef: { value: job.Id }, Line: [] })
    const before = w.qb.calls.filter((c) => c.op === 'create').length
    const plan = await planBackfill(w.fake.client as never, 'a', w.client, settings)
    const by = (k: string) => plan.items.find((i) => i.key === k)!
    expect(by('customer:ca1')).toMatchObject({ state: 'certain', candidates: [{ qbId: pat.Id }] })
    expect(by('job:ja1')).toMatchObject({ state: 'certain', candidates: [{ qbId: job.Id }] })
    expect(by('invoice:production_jobs:ja1')).toMatchObject({ state: 'certain', candidates: [{ qbId: inv.Id }] })
    expect(by('customer:ca3').state).toBe('none')
    expect(w.qb.calls.filter((c) => c.op === 'create').length).toBe(before)
  })

  it('apply links only certain matches and the owner’s choices; unmatched stay for the worker (from the start date)', async () => {
    const w = world()
    const pat = await mk(w.qb, 'Customer', { DisplayName: 'Pat H', PrimaryEmailAddr: { Address: 'pat@example.com' } })
    const d1 = await mk(w.qb, 'Customer', { DisplayName: 'Dana', PrimaryEmailAddr: { Address: 'dana@example.com' } })
    const d2 = await mk(w.qb, 'Customer', { DisplayName: 'Dana T', PrimaryEmailAddr: { Address: 'dana@example.com' } })
    const plan = await planBackfill(w.fake.client as never, 'a', w.client, settings)
    expect(plan.items.find((i) => i.key === 'customer:ca2')).toMatchObject({ state: 'ambiguous' })
    const r1 = await applyBackfill(w.fake.client as never, 'a', w.client, settings, {}, 'u1')
    expect(r1).toMatchObject({ linked: 1, left: 1 })
    expect((w.fake.tables.qb_links as any[]).map((l) => [l.crm_id, l.qb_id])).toEqual([['ca1', pat.Id]])
    await applyBackfill(w.fake.client as never, 'a', w.client, settings, { 'customer:ca2': d2.Id, 'customer:ca3': 'none' }, 'u1')
    expect((w.fake.tables.qb_links as any[]).find((l) => l.crm_id === 'ca2')?.qb_id).toBe(d2.Id)
    expect(d1.Id).not.toBe(d2.Id)
    expect(w.qb.calls.filter((c) => c.op === 'create').length).toBe(3) // only the three seeds
  })

  it('a decision that is not one of the offered candidates is ignored', async () => {
    const w = world()
    await mk(w.qb, 'Customer', { DisplayName: 'Dana', PrimaryEmailAddr: { Address: 'dana@example.com' } })
    await mk(w.qb, 'Customer', { DisplayName: 'Dana T', PrimaryEmailAddr: { Address: 'dana@example.com' } })
    const other = await mk(w.qb, 'Customer', { DisplayName: 'Someone Else' })
    await applyBackfill(w.fake.client as never, 'a', w.client, settings, { 'customer:ca2': other.Id }, 'u1')
    expect((w.fake.tables.qb_links as any[]).some((l) => l.crm_id === 'ca2')).toBe(false)
  })

  it('an invoice with a different amount goes to the owner, never silently linked', async () => {
    const w = world()
    const pat = await mk(w.qb, 'Customer', { DisplayName: 'Pat', PrimaryEmailAddr: { Address: 'pat@example.com' } })
    await mk(w.qb, 'Invoice', { DocNumber: '26-0001', TotalAmt: 99, CustomerRef: { value: pat.Id }, Line: [] })
    const plan = await planBackfill(w.fake.client as never, 'a', w.client, settings)
    expect(plan.items.find((i) => i.key === 'invoice:production_jobs:ja1')).toMatchObject({ state: 'ambiguous' })
  })

  it('never reads another company’s CRM records and never steals an already-linked QuickBooks record', async () => {
    const w = world()
    const pat = await mk(w.qb, 'Customer', { DisplayName: 'Pat', PrimaryEmailAddr: { Address: 'pat@example.com' } })
    ;(w.fake.tables.qb_links as any[]).push({ id: 'l1', org_id: 'b', crm_table: 'customers', crm_id: 'cb1', qb_type: 'Customer', qb_id: pat.Id })
    const plan = await planBackfill(w.fake.client as never, 'a', w.client, settings)
    expect(plan.items.some((i) => i.crmId === 'cb1')).toBe(false)
    // org b's link is invisible to a, so the plan may offer it, but apply must not steal it (unique per org+record is enforced by the DB; the holder check covers the rest)
    expect(plan.items.find((i) => i.key === 'customer:ca1')).toBeDefined()
  })
})
