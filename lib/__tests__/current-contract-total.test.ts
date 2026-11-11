/** @jest-environment node */
/** currentContractTotal: signed contract + SIGNED change orders only — the same inputs the sale sync reads. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { currentContractTotal } from '@/lib/job-commission-base'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const world = (cos: Array<Record<string, unknown>> = [], contracts: Array<Record<string, unknown>> | null = null) =>
  createFakeDb({
    production_jobs: [{ id: 'j1', org_id: A, project_id: 'p1', linked_proposal_id: 'pr1', accepted_proposal_id: null }],
    projects: [{ id: 'p1', org_id: A, opportunity_id: 'o1' }],
    proposals: [{ id: 'pr1', org_id: A, tax_amount: 0 }],
    order_form_contracts: contracts ?? [{ id: 'c1', org_id: A, proposal_id: 'pr1', opportunity_id: 'o1', status: 'completed', agreement_type: 'installation', project_cost: 100000 }],
    job_change_orders: cos,
  })

test('signed contract plus signed change orders; an unsigned one is not counted', async () => {
  const db = world([
    { id: 'a', org_id: A, project_id: 'p1', job_id: 'j1', status: 'completed', original_amount: 100000, updated_total: 104000, is_commissionable: true, created_at: '2026-01-01' },
    { id: 'b', org_id: A, project_id: 'p1', job_id: 'j1', status: 'pending_customer', original_amount: 104000, updated_total: 150000, is_commissionable: true, created_at: '2026-02-01' },
  ])
  expect(await currentContractTotal(db.client as never, A, 'j1')).toEqual({ ok: true, total: 104000 })
})

test('no change orders: the contract total', async () => {
  expect(await currentContractTotal(world().client as never, A, 'j1')).toEqual({ ok: true, total: 100000 })
})

test('a first signed change order that disagrees with the contract is the sync chain conflict', async () => {
  const db = world([{ id: 'a', org_id: A, project_id: 'p1', job_id: 'j1', status: 'completed', original_amount: 90000, updated_total: 95000, created_at: '2026-01-01' }])
  expect(await currentContractTotal(db.client as never, A, 'j1')).toEqual({ ok: false, reason: 'change_order_chain_conflict' })
})

test('nothing signed, or another company\'s job', async () => {
  expect(await currentContractTotal(world([], []).client as never, A, 'j1')).toEqual({ ok: false, reason: 'no_signed_contract' })
  expect(await currentContractTotal(world().client as never, 'bbbbbbbb-0000-4000-8000-000000000002', 'j1')).toEqual({ ok: false, reason: 'job_not_found' })
})
