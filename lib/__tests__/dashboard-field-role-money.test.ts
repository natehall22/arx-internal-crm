/** @jest-environment node */
/**
 * Codex audit 2026-11-13 #2 / #3: the dashboard APIs read with the service client (no RLS), so each route must itself keep
 * money and production away from field roles — setters, canvassers, inside sales / call center, by role slug OR custom-role NAME
 * (CLAUDE.md "Field roles never see production or money"). A per-user grant or a custom role's permissions never undo that.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

type Profile = { id: string; org_id: string; role: string; custom_role_id: string | null }
let profile: Profile
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => ({ authUser: { id: profile.id, email: null }, profile })),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET as opsGET } from '@/app/api/dashboard/ops/route'
import { GET as opsMetricsGET } from '@/app/api/dashboard/ops-metrics/route'
import { GET as attachedGET } from '@/app/api/dashboard/attached-sales/route'

const ORG = 'org-a'
const P = (name: string) => ({ id: `perm-${name}`, name })
const PERMS = ['ops:dashboard:view', 'jobs:view', 'jobs:financials:view'].map(P)

function seed() {
  db = createFakeDb(
    {
      orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }],
      permissions: PERMS,
      custom_roles: [
        { id: 'cr-setter', org_id: ORG, name: 'Setter', display_name: 'Setter' },
        { id: 'cr-ops', org_id: ORG, name: 'Ops Lead', display_name: 'Ops Lead' },
      ],
      // The custom "Setter" role was (wrongly) given every ops permission; the "Ops Lead" role only the ops dashboard.
      // (rows carry the embedded permission: the fake client does not follow the aliased permission:permissions(name) embed)
      role_permissions: [
        ...PERMS.map((p) => ({ role_id: 'cr-setter', permission_id: p.id, permission: { name: p.name } })),
        { role_id: 'cr-ops', permission_id: 'perm-ops:dashboard:view', permission: { name: 'ops:dashboard:view' } },
      ],
      // A setter given the ops dashboard + financials by hand.
      user_permissions: [
        { user_id: 'u-setter-granted', permission_id: 'perm-ops:dashboard:view', permission: { name: 'ops:dashboard:view' } },
        { user_id: 'u-setter-granted', permission_id: 'perm-jobs:financials:view', permission: { name: 'jobs:financials:view' } },
      ],
      users: [
        { id: 'u-closer', org_id: ORG, full_name: 'Cal Closer', role: 'sales_rep' },
        { id: 'u-setter', org_id: ORG, full_name: 'Sam Setter', role: 'setter' },
      ],
      customers: [{ id: 'cust-1', org_id: ORG, name: 'Pat Homeowner' }],
      opportunities: [{ id: 'opp-1', org_id: ORG, owner_user_id: 'u-closer', setter_user_id: 'u-setter' }],
      projects: [{ id: 'proj-1', org_id: ORG, opportunity_id: 'opp-1' }],
      production_jobs: [
        {
          id: 'job-1', org_id: ORG, job_number: '26-0101', status: 'scheduled', address_text: '1 Main St', sale_amount: 16325,
          sale_date: '2026-11-02', salesperson_id: 'u-closer', accepted_proposal_id: null, project_id: 'proj-1', customer_id: 'cust-1',
          scheduled_date: '2026-11-20', completed_at: null, updated_at: '2026-11-10T12:00:00Z', materials_status: 'ordered',
          allow_close_with_balance: false, close_balance_by: null,
          // The fake client does not follow aliased embeds (customer:customers(...)); the rows carry them already.
          customer: { id: 'cust-1', name: 'Pat Homeowner' }, project: { id: 'proj-1', opportunity_id: 'opp-1', customers: null, leads: null },
        },
      ],
      job_payments: [{ id: 'pay-1', job_id: 'job-1', amount_cents: 500000, funding_status: 'cleared' }],
      job_cost_lines: [{ id: 'cl-1', org_id: ORG, job_id: 'job-1', description: 'Shingles', amount: 4321.5, cost_type: 'material', status: 'active', deleted_at: null, created_at: '2026-11-09T12:00:00Z', job: { job_number: '26-0101', customer: { name: 'Pat Homeowner' } } }],
    },
  )
}

const FIELD: Array<[string, Profile]> = [
  ['setter', { id: 'u-setter', org_id: ORG, role: 'setter', custom_role_id: null }],
  ['canvasser', { id: 'u-canv', org_id: ORG, role: 'canvasser', custom_role_id: null }],
  ['inside_sales', { id: 'u-is', org_id: ORG, role: 'inside_sales', custom_role_id: null }],
  ['custom role named "Setter" holding every ops permission', { id: 'u-cr', org_id: ORG, role: 'sales_rep', custom_role_id: 'cr-setter' }],
  ['setter granted the ops dashboard by hand', { id: 'u-setter-granted', org_id: ORG, role: 'setter', custom_role_id: null }],
]
const ADMIN: Profile = { id: 'u-admin', org_id: ORG, role: 'admin', custom_role_id: null }
const OPS_NO_MONEY: Profile = { id: 'u-ops', org_id: ORG, role: 'sales_rep', custom_role_id: 'cr-ops' }

const MONEY_OR_PRODUCTION = /saleAmount|totalVolume|averageProgress|progressPercent|jobStatus|statusLabel|scheduledDate|completedAt|jobNumber|26-0101|16325|16,325/

beforeEach(seed)

describe('GET /api/dashboard/ops', () => {
  it.each(FIELD)('%s → 403', async (_label, p) => {
    profile = p
    const res = await opsGET()
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toMatch(/26-0101|outstanding|4321/)
  })

  it('an admin gets the dashboard with money', async () => {
    profile = ADMIN
    const res = await opsGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.outstandingPayments).toBeCloseTo(11325)
    expect(body.recentOrders[0]).toMatchObject({ job_number: '26-0101', amount: 4321.5 })
  })

  it('ops dashboard without job financials: production yes, money no', async () => {
    profile = OPS_NO_MONEY
    const res = await opsGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.outstandingPayments).toBeNull()
    expect(body.recentOrders[0].amount).toBeNull()
    expect(JSON.stringify(body)).not.toMatch(/4321|11325|Payment needed/)
  })

  it('a role without the ops dashboard permission → 403', async () => {
    profile = { id: 'u-closer', org_id: ORG, role: 'sales_rep', custom_role_id: null }
    expect((await opsGET()).status).toBe(403)
  })
})

describe('GET /api/dashboard/ops-metrics', () => {
  const get = () => opsMetricsGET(new Request('https://crm.example/api/dashboard/ops-metrics?timeframe=month') as never)
  it.each(FIELD)('%s → 403', async (_label, p) => {
    profile = p
    expect((await get()).status).toBe(403)
  })
  it('an admin gets the counts', async () => {
    profile = ADMIN
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobsSold: expect.any(Number), installations: expect.any(Number), cancellations: expect.any(Number) })
  })
})

describe('GET /api/dashboard/attached-sales', () => {
  it.each(FIELD.filter(([l]) => !l.includes('granted')))('%s gets the sales-only shape (no money, no production)', async (_label, p) => {
    profile = { ...p, id: 'u-setter' } // attached to the deal as its setter
    const res = await attachedGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fieldView).toBe(true)
    expect(body.sales).toHaveLength(1)
    expect(body.sales[0]).toEqual({
      id: 'job-1', customerName: 'Pat Homeowner', projectAddress: '1 Main St', signedAt: '2026-11-02', attachment: 'Setter', setterName: 'Sam Setter', closerName: 'Cal Closer',
    })
    expect(body.summary).toEqual({ count: 1, shown: 1 })
    expect(JSON.stringify(body)).not.toMatch(MONEY_OR_PRODUCTION)
  })

  it('a closer keeps the full pipeline view (amount, status, progress)', async () => {
    profile = { id: 'u-closer', org_id: ORG, role: 'sales_rep', custom_role_id: null }
    const body = await (await attachedGET()).json()
    expect(body.fieldView).toBeUndefined()
    expect(body.sales[0]).toMatchObject({ saleAmount: 16325, jobNumber: '26-0101', jobStatus: 'scheduled', statusLabel: 'Scheduled', progressPercent: 60, scheduledDate: '2026-11-20' })
    expect(body.summary).toMatchObject({ totalVolume: 16325, averageProgress: 60 })
  })
})
