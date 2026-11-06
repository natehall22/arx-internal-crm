/** @jest-environment node */
/**
 * POST /api/ops/jobs (push a project to the job board) stores sale_amount + commission base from ONE
 * writer, lib/job-commission-base.ts. The starting sale amount used to come from the LAST change order's
 * updated_total with no status filter (an unsigned CO could price the job until the sync overwrote it).
 * That second answer is deleted; these fixtures pin the values the route stores, which must not move.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => ({
    authUser: { id: 'u-ops' },
    profile: { id: 'u-ops', org_id: 'org-1', role: 'operations', custom_role_id: null },
  })),
}))
jest.mock('@/lib/ops-access', () => {
  const actual = jest.requireActual('@/lib/ops-access')
  return {
    ...actual,
    resolveOpsAccess: jest.fn(async () => ({ canCreateProductionJob: true, canViewJobFinancials: true, canJobBoard: true })),
  }
})
jest.mock('@/lib/project-review', () => ({ importProjectReviewNoteToJob: jest.fn(async () => ({ ok: true })) }))

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

function seed(opts: { contractCost: number; changeOrders: Array<{ id: string; status: string; original: number; updated: number; created_at: string }> }) {
  db = createFakeDb({
    projects: [
      { id: 'proj-1', org_id: 'org-1', opportunity_id: 'opp-1', project_type: 'roofing', customer_id: 'cust-1', address_text: '12 Elm St', owner_user_id: 'u-closer' },
    ],
    opportunities: [{ id: 'opp-1', org_id: 'org-1', job_source: 'retail', insurance_stage: null }],
    proposals: [
      { id: 'prop-1', org_id: 'org-1', project_id: 'proj-1', opportunity_id: 'opp-1', accepted_at: '2026-10-01T12:00:00Z', subtotal: 19000, tax_amount: 400, dealer_fee_amount: null, dealer_fee_percent: null, financing_program_id: null, financed_contract_total: null },
    ],
    order_form_contracts: [
      { id: 'c-1', org_id: 'org-1', proposal_id: 'prop-1', opportunity_id: 'opp-1', agreement_type: 'installation', status: 'completed', project_cost: opts.contractCost, payment_method: 'cash', project_address: '12 Elm St', created_at: '2026-10-02T12:00:00Z' },
    ],
    job_change_orders: opts.changeOrders.map((co) => ({
      id: co.id,
      org_id: 'org-1',
      project_id: 'proj-1',
      job_id: null,
      status: co.status,
      original_amount: co.original,
      updated_total: co.updated,
      is_commissionable: true,
      created_at: co.created_at,
    })),
    production_jobs: [],
    activities: [],
  })
}

async function createJob() {
  const { POST } = await import('@/app/api/ops/jobs/route')
  const res = await POST(new Request('http://localhost/api/ops/jobs', { method: 'POST', body: JSON.stringify({ project_id: 'proj-1' }) }))
  expect(res.status).toBe(200)
  const stored = db.tables.production_jobs[0]
  return { sale: stored.sale_amount, base: stored.commission_comp_base }
}

describe('POST /api/ops/jobs stores the signed sale amount', () => {
  it('signed + unsigned change orders: only the signed one counts (same values as before the delete)', async () => {
    seed({
      contractCost: 20000,
      changeOrders: [
        { id: 'co-signed', status: 'completed', original: 20000, updated: 21500, created_at: '2026-10-05T12:00:00Z' },
        // Unsigned draft written later — its updated_total used to be the starting sale amount.
        { id: 'co-draft', status: 'draft', original: 21500, updated: 23000, created_at: '2026-10-06T12:00:00Z' },
      ],
    })
    expect(await createJob()).toEqual({ sale: 21500, base: 21100 })
  })

  it('no change orders: contract total, base minus sales tax', async () => {
    seed({ contractCost: 20000, changeOrders: [] })
    expect(await createJob()).toEqual({ sale: 20000, base: 19600 })
  })
})
