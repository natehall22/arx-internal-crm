/** @jest-environment node */
/** Choosing a selection: one claim, overage → one change order (existing maker), failure undoes, other company's id finds nothing. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const createRemoteChangeOrder = jest.fn()
jest.mock('@/lib/change-orders-remote', () => ({ createRemoteChangeOrder: (...a: unknown[]) => createRemoteChangeOrder(...a) }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://acme.example.test' }))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Acme', phone: '', email: '' }) }))

const currentContractTotal = jest.fn()
jest.mock('@/lib/job-commission-base', () => ({ currentContractTotal: (...a: unknown[]) => currentContractTotal(...a) }))

import { cancelChosenSelection, chooseSelection, reissueSelectionChangeOrder } from '@/lib/project-tools/selections-db'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const SIG = `data:image/png;base64,${'A'.repeat(40)}`

const selection = (over: Record<string, unknown> = {}) => ({
  id: 's1', org_id: A, job_id: 'j1', item: 'Kitchen faucet', allowance: 500, status: 'sent', link_token: 'tok', change_order_id: null,
  options: [{ id: 'o1', label: 'Brushed nickel', price: 450 }, { id: 'o2', label: 'Matte black', price: 750 }],
  requested_by: 'u1', requested_by_name: 'Nathan Hall', requested_signature: SIG, due_date: null, ...over,
})
const world = (sel = selection()) =>
  createFakeDb({
    job_selections: [sel],
    production_jobs: [{ id: 'j1', org_id: A, project_id: 'p1', customer_id: 'c1', address_text: '12 Elm St', sale_amount: 100000 }],
    customers: [{ id: 'c1', org_id: A, name: 'Pat Lee', email: 'pat@example.test' }],
    job_change_orders: [{ id: 'co1', org_id: A, project_id: 'p1', co_number: 'CO-001', updated_total: 104000 }],
    job_payments: [{ job_id: 'j1', amount_cents: 2_000_000, funding_status: 'cleared' }],
  })

beforeEach(() => {
  currentContractTotal.mockReset()
  currentContractTotal.mockResolvedValue({ ok: true, total: 104000 }) // signed contract + SIGNED change orders
  createRemoteChangeOrder.mockReset()
  createRemoteChangeOrder.mockResolvedValue({ ok: true, changeOrderId: 'co-new', signingUrl: 'https://acme.example.test/change-orders/sign/t', signingToken: 't', emailed: false })
})

const choose = (db: ReturnType<typeof world>, over: Record<string, unknown> = {}) =>
  chooseSelection(db.client as never, { orgId: A, selectionId: 's1', optionId: 'o2', byName: 'Pat Lee', source: 'customer', ...over } as never)

test('within the allowance: approved, no change order', async () => {
  const db = world()
  const r = await choose(db, { optionId: 'o1' })
  expect(r).toMatchObject({ ok: true, state: 'approved', difference: -50 })
  expect(createRemoteChangeOrder).not.toHaveBeenCalled()
  expect(db.tables.job_selections[0]).toMatchObject({ status: 'chosen', chosen_label: 'Brushed nickel', chosen_price: 450, chosen_source: 'customer', chosen_by_name: 'Pat Lee' })
})

test('over the allowance: ONE change order for the difference, built on the current signed contract total, linked to the selection', async () => {
  const db = world()
  const r = await choose(db)
  expect(r).toMatchObject({ ok: true, state: 'needs_signature', difference: 250, signingUrl: 'https://acme.example.test/change-orders/sign/t' })
  expect(createRemoteChangeOrder).toHaveBeenCalledTimes(1)
  const input = createRemoteChangeOrder.mock.calls[0][1]
  expect(input).toMatchObject({ orgId: A, projectId: 'p1', jobId: 'j1', coNumber: 'CO-002', originalAmount: 104000, updatedTotal: 104250, customerPrintName: 'Pat Lee', repName: 'Nathan Hall', repSignature: SIG, customerEmail: null })
  expect(input.description).toContain('Kitchen faucet')
  expect(input.updatedRemaining).toBe(84250) // 104,250 - 20,000 collected
  expect(db.tables.job_selections[0].change_order_id).toBe('co-new')
})

test('no earlier change order: builds on the job sale amount; an office pick emails the customer', async () => {
  const db = world()
  db.tables.job_change_orders.length = 0
  currentContractTotal.mockResolvedValue({ ok: true, total: 100000 })
  await choose(db, { source: 'staff', staffUserId: 'u1', staffName: 'Riley Ops', staffSignature: SIG })
  expect(createRemoteChangeOrder.mock.calls[0][1]).toMatchObject({ coNumber: 'CO-001', originalAmount: 100000, updatedTotal: 100250, customerEmail: 'pat@example.test', repName: 'Riley Ops' })
})

test('a second tap (or second device) cannot choose again or make a second change order', async () => {
  const db = world()
  expect(await choose(db)).toMatchObject({ ok: true })
  expect(await choose(db)).toEqual({ error: 'This has already been chosen.', status: 409 })
  expect(createRemoteChangeOrder).toHaveBeenCalledTimes(1)
})

test('an option that is not on the selection is refused and nothing is claimed', async () => {
  const db = world()
  expect(await choose(db, { optionId: 'nope' })).toMatchObject({ status: 400 })
  expect(db.tables.job_selections[0].status).toBe('sent')
})

test('a failed change order undoes the choice (back to what it was)', async () => {
  const db = world()
  createRemoteChangeOrder.mockResolvedValue({ ok: false, status: 500, error: 'boom' })
  expect(await choose(db)).toMatchObject({ status: 500 })
  expect(db.tables.job_selections[0]).toMatchObject({ status: 'sent', chosen_option_id: null, chosen_price: null })
})

test('a taken CO number retries with a fresh read', async () => {
  const db = world()
  createRemoteChangeOrder.mockResolvedValueOnce({ ok: false, status: 409, error: 'dup' })
  const r = await choose(db)
  expect(r).toMatchObject({ ok: true })
  expect(createRemoteChangeOrder).toHaveBeenCalledTimes(2)
})

test('overage with no company signature on file asks the office to resend; nothing is claimed', async () => {
  const db = world(selection({ requested_signature: null }))
  expect(await choose(db)).toMatchObject({ status: 409 })
  expect(db.tables.job_selections[0].status).toBe('sent')
  expect(createRemoteChangeOrder).not.toHaveBeenCalled()
})

test('a job with no project cannot make a change order: undone with a plain message', async () => {
  const db = world()
  db.tables.production_jobs[0].project_id = null
  expect(await choose(db)).toMatchObject({ status: 409 })
  expect(db.tables.job_selections[0].status).toBe('sent')
})

test('another company cannot choose this selection', async () => {
  const db = world()
  const r = await chooseSelection(db.client as never, { orgId: B, selectionId: 's1', optionId: 'o1', byName: 'X', source: 'customer' } as never)
  expect(r).toEqual({ error: 'Not found', status: 404 })
  expect(db.tables.job_selections[0].status).toBe('sent')
})

test('a cancelled selection cannot be chosen', async () => {
  const db = world(selection({ status: 'cancelled' }))
  expect(await choose(db)).toMatchObject({ status: 409 })
})

test('the change order builds on the SIGNED total, not on an unsigned change order in the list', async () => {
  const db = world()
  db.tables.job_change_orders.push({ id: 'co2', org_id: A, project_id: 'p1', co_number: 'CO-002', updated_total: 999999, status: 'pending_customer' })
  await choose(db)
  expect(createRemoteChangeOrder.mock.calls[0][1]).toMatchObject({ coNumber: 'CO-003', originalAmount: 104000 })
})

test('a contract total the sync would refuse (chain conflict) undoes the pick instead of making a bad change order', async () => {
  const db = world()
  currentContractTotal.mockResolvedValue({ ok: false, reason: 'change_order_chain_conflict' })
  expect(await choose(db)).toMatchObject({ status: 409 })
  expect(createRemoteChangeOrder).not.toHaveBeenCalled()
  expect(db.tables.job_selections[0].status).toBe('sent')
})

test('the change order maker throwing undoes the pick', async () => {
  const db = world()
  createRemoteChangeOrder.mockRejectedValue(new Error('smtp down'))
  expect(await choose(db)).toMatchObject({ status: 500 })
  expect(db.tables.job_selections[0]).toMatchObject({ status: 'sent', chosen_option_id: null })
})

describe('chosen overage whose change order expired or was never made', () => {
  const chosen = (over: Record<string, unknown> = {}) =>
    selection({ status: 'chosen', chosen_option_id: 'o2', chosen_label: 'Matte black', chosen_price: 750, change_order_id: 'co-old', ...over })
  const ctx = { orgId: A, jobId: 'j1', userId: 'u2', userName: 'Riley Ops' }

  test('resend voids the expired change order, makes a new one and links it', async () => {
    const db = world(chosen())
    db.tables.job_change_orders.push({ id: 'co-old', org_id: A, project_id: 'p1', co_number: 'CO-002', status: 'pending_customer', signing_token: 'old', token_expires_at: '2020-01-01T00:00:00Z' })
    const r = await reissueSelectionChangeOrder(db.client as never, ctx, 's1', SIG)
    expect(r).toMatchObject({ signingUrl: 'https://acme.example.test/change-orders/sign/t' })
    expect(db.tables.job_change_orders.find((c) => c.id === 'co-old')).toMatchObject({ status: 'voided', signing_token: null })
    expect(db.tables.job_selections[0].change_order_id).toBe('co-new')
    expect(createRemoteChangeOrder.mock.calls[0][1]).toMatchObject({ customerEmail: 'pat@example.test', repName: 'Riley Ops' })
  })

  test('a link that is still good, or a signed change order, is not remade', async () => {
    const db = world(chosen())
    db.tables.job_change_orders.push({ id: 'co-old', org_id: A, project_id: 'p1', co_number: 'CO-002', status: 'pending_customer', signing_token: 'old', token_expires_at: '2999-01-01T00:00:00Z' })
    expect(await reissueSelectionChangeOrder(db.client as never, ctx, 's1', SIG)).toMatchObject({ status: 409 })
    db.tables.job_change_orders[db.tables.job_change_orders.length - 1].status = 'completed'
    expect(await reissueSelectionChangeOrder(db.client as never, ctx, 's1', SIG)).toMatchObject({ status: 409 })
    expect(createRemoteChangeOrder).not.toHaveBeenCalled()
  })

  test('cancel voids the unsigned change order (its link dies) and cancels the pick; a signed one blocks it', async () => {
    const db = world(chosen())
    db.tables.job_change_orders.push({ id: 'co-old', org_id: A, project_id: 'p1', co_number: 'CO-002', status: 'pending_customer', signing_token: 'old', token_expires_at: '2020-01-01T00:00:00Z' })
    expect(await cancelChosenSelection(db.client as never, { orgId: A, jobId: 'j1' }, 's1')).toEqual({ ok: true })
    expect(db.tables.job_change_orders.find((c) => c.id === 'co-old')).toMatchObject({ status: 'voided', signing_token: null })
    expect(db.tables.job_selections[0]).toMatchObject({ status: 'cancelled' })

    const signed = world(chosen())
    signed.tables.job_change_orders.push({ id: 'co-old', org_id: A, project_id: 'p1', co_number: 'CO-002', status: 'completed' })
    expect(await cancelChosenSelection(signed.client as never, { orgId: A, jobId: 'j1' }, 's1')).toMatchObject({ status: 409 })
    expect(signed.tables.job_selections[0].status).toBe('chosen')
  })
})
