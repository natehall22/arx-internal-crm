/** @jest-environment node */
/**
 * Auto draft invoice when a service visit is marked done (orgs.settings.serviceBilling.autoDraftOnDone, default off).
 * Through the ONE completion writer (applyVisitAction), so the office and the crew phone link are both covered.
 */
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
const featureOn = jest.fn(async () => true)
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: (...a: unknown[]) => (featureOn as unknown as (...x: unknown[]) => Promise<boolean>)(...a) }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { applyVisitAction } from '@/lib/service-plans-db'
import { readServiceBillingSettings } from '@/lib/service-billing-settings'
import { mergeOrgSettings } from '@/lib/org-settings'

const ORG = 'org-a'
const NOW = new Date('2026-11-11T15:00:00Z')
const relations = {
  job_invoice_items: { job_invoices: { table: 'job_invoices', fk: 'invoice_id' } },
  job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true } },
}
const wo = (id: string, plan: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: ORG, work_order_type: 'service_visit', visit_step: 'service', status: 'scheduled', service_plan_id: plan, customer_id: 'c1', property_id: 'p1',
  scheduled_date: '2026-11-11', service_planned_date: '2026-11-11', assigned_sub_id: 'crew1', completed_at: null, updated_at: '2026-11-01T00:00:00Z', ...extra,
})

function seed(settings: Record<string, unknown>, opts: { rpcThrows?: boolean } = {}) {
  const calls: unknown[] = []
  const db = createFakeDb(
    {
      orgs: [{ id: ORG, name: 'Green Co', settings, timezone: 'America/New_York' }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat', email: 'pat@example.com', tax_exempt: false }],
      properties: [{ id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St' }],
      service_plans: [
        { id: 'mow', org_id: ORG, customer_id: 'c1', property_id: 'p1', name: 'Weekly mowing', billing_basis: 'per_visit', price: 45, taxable: false },
        { id: 'care', org_id: ORG, customer_id: 'c1', property_id: 'p1', name: 'Gutter care', billing_basis: 'per_month', price: 100, taxable: false },
      ],
      work_orders: [wo('v1', 'mow'), wo('v2', 'care'), wo('v3', 'mow'), wo('fu', 'mow', { visit_step: 'inspect' })],
      service_visit_charges: [
        { work_order_id: 'v1', org_id: ORG, price: 45, taxable: false },
        { work_order_id: 'v2', org_id: ORG, price: null, taxable: false },
        { work_order_id: 'v3', org_id: ORG, price: 45, taxable: false },
        { work_order_id: 'fu', org_id: ORG, price: null, taxable: false },
      ],
      job_invoices: [],
      job_invoice_items: [],
    },
    {
      relations,
      rpc: {
        create_service_invoice: (args, t) => {
          calls.push(args)
          if (opts.rpcThrows) throw new Error('db down')
          const lines = args.p_lines as Array<Record<string, unknown>>
          const held = lines.some((l) => t.job_invoice_items.some((it) => it.work_order_id === l.work_order_id && t.job_invoices.some((i) => i.id === it.invoice_id && i.status !== 'void')))
          if (held) return { invoice_id: null, skipped: [{}] }
          const id = `00000000-0000-4000-8000-${String(t.job_invoices.length + 1).padStart(12, '0')}`
          const totals = args.p_totals as Record<string, unknown>
          t.job_invoices.push({ id, org_id: args.p_org, customer_id: args.p_customer, job_id: null, status: 'draft', invoice_kind: 'service', total_cents: totals.total_cents, created_by: args.p_created_by })
          lines.forEach((l, i) => t.job_invoice_items.push({ id: `${id}-${i}`, invoice_id: id, ...l }))
          return { invoice_id: id, skipped: [] }
        },
      },
    }
  )
  return { ...db, calls }
}

const done = (d: ReturnType<typeof seed>, id: string, by = { userId: 'u1' as string | null, subId: null as string | null }, o: Record<string, unknown> = {}) =>
  applyVisitAction(d.client, ORG, id, { action: 'done' }, by, { now: NOW, ...o })

beforeEach(() => {
  featureOn.mockResolvedValue(true)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('auto draft invoice on done', () => {
  it('setting off (default): nothing is made', async () => {
    const d = seed({})
    expect((await done(d, 'v1')).ok).toBe(true)
    expect(d.tables.job_invoices).toHaveLength(0)
  })

  it('on + per-visit plan: ONE draft, never sent, at the visit price', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    expect((await done(d, 'v1')).ok).toBe(true)
    expect(d.tables.job_invoices).toHaveLength(1)
    expect(d.tables.job_invoices[0]).toMatchObject({ status: 'draft', customer_id: 'c1', total_cents: 4500, created_by: 'u1' })
    expect(d.tables.job_invoice_items).toEqual([expect.objectContaining({ work_order_id: 'v1', unit_price_cents: 4500 })])
  })

  it('servicePlans off: nothing is made even with the setting on', async () => {
    featureOn.mockResolvedValue(false)
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    await done(d, 'v1')
    expect(d.tables.job_invoices).toHaveLength(0)
  })

  it('per-month plan visits and follow-on steps are skipped', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    expect((await done(d, 'v2')).ok).toBe(true)
    expect((await done(d, 'fu')).ok).toBe(true)
    expect(d.tables.job_invoices).toHaveLength(0)
  })

  it('already on a live invoice: nothing more is made, completion stands', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    d.tables.job_invoices.push({ id: 'inv0', org_id: ORG, status: 'sent', job_id: null })
    d.tables.job_invoice_items.push({ id: 'i0', invoice_id: 'inv0', work_order_id: 'v1' })
    expect((await done(d, 'v1')).ok).toBe(true)
    expect(d.tables.job_invoices).toHaveLength(1)
    expect(d.calls).toHaveLength(0)
  })

  it('a double tap makes one invoice', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    await done(d, 'v1')
    expect((await done(d, 'v1')).ok).toBe(false) // second tap: not scheduled any more
    expect(d.tables.job_invoices).toHaveLength(1)
  })

  it('writer error: the completion still succeeds', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } }, { rpcThrows: true })
    expect((await done(d, 'v3')).ok).toBe(true)
    expect(d.tables.work_orders.find((r) => r.id === 'v3')!.status).toBe('completed')
    expect(d.tables.job_invoices).toHaveLength(0)
  })

  it('crew phone link completion (no user, own crew only) makes the draft too', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    expect((await done(d, 'v1', { userId: null, subId: 'crew1' }, { onlySubId: 'crew1' })).ok).toBe(true)
    expect(d.tables.job_invoices).toHaveLength(1)
    expect(d.tables.job_invoices[0].created_by).toBeNull()
  })

  it('reopening a visit on its draft invoice says to void that invoice first', async () => {
    const d = seed({ serviceBilling: { autoDraftOnDone: true } })
    await done(d, 'v1')
    const res = await applyVisitAction(d.client, ORG, 'v1', { action: 'reopen' }, { userId: 'u1', subId: null }, { now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/void that invoice first/) })
  })
})

describe('the setting', () => {
  it('reads only an explicit true; the generic top-level save refuses it', async () => {
    expect(readServiceBillingSettings({})).toEqual({ autoDraftOnDone: false })
    expect(readServiceBillingSettings({ serviceBilling: { autoDraftOnDone: 'yes' } })).toEqual({ autoDraftOnDone: false })
    expect(readServiceBillingSettings({ serviceBilling: { autoDraftOnDone: true } })).toEqual({ autoDraftOnDone: true })
    const r = await mergeOrgSettings({} as never, ORG, { serviceBilling: { autoDraftOnDone: true } })
    expect(r.error).toMatch(/serviceBilling/)
  })
})
