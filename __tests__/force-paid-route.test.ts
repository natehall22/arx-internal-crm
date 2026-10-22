/**
 * @jest-environment node
 *
 * POST /api/ops/jobs/[id]/force-paid — owner-only, reason required, audited.
 */
jest.mock('@/lib/auth', () => ({ requireAuthApi: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/job-payments', () => ({ getJobPaymentSummary: jest.fn() }))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}))

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getJobPaymentSummary } from '@/lib/job-payments'
import { POST } from '@/app/api/ops/jobs/[id]/force-paid/route'

const mockAuth = requireAuthApi as jest.Mock
const mockClient = createServiceClient as jest.Mock
const mockSummary = getJobPaymentSummary as jest.Mock

function builder(response: { data: unknown; error?: unknown }, calls: Array<{ table: string; op: string; arg?: unknown }>, table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in']) b[m] = jest.fn(() => b)
  b.update = jest.fn((arg: unknown) => { calls.push({ table, op: 'update', arg }); return b })
  b.insert = jest.fn((arg: unknown) => { calls.push({ table, op: 'insert', arg }); return b })
  b.maybeSingle = jest.fn(() => Promise.resolve(response))
  b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: response.error ?? null })
  return b
}

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const job = { id: 'j1', org_id: 'org', project_id: 'p1', status: 'complete', allow_close_with_balance: false, close_balance_reason: null, close_balance_by: null, close_balance_at: null }

function setup(auditError: unknown = null) {
  const calls: Array<{ table: string; op: string; arg?: unknown }> = []
  mockClient.mockReturnValue({
    from: (table: string) =>
      builder(table === 'payroll_override_audit' ? { data: null, error: auditError } : { data: job }, calls, table),
  })
  mockSummary.mockResolvedValue({ sale_amount_cents: 770000, collected_cents: 700000, remaining_cents: 70000 })
  return calls
}

describe('force-paid route', () => {
  beforeEach(() => jest.clearAllMocks())

  it('403s for a non-super-admin, even role admin', async () => {
    mockAuth.mockResolvedValue({ profile: { id: 'u', org_id: 'org', role: 'admin', is_super_admin: false } })
    setup()
    const res = await POST(req({ reason: 'x' }), { params: { id: 'j1' } })
    expect(res.status).toBe(403)
  })

  it('400s without a reason', async () => {
    mockAuth.mockResolvedValue({ profile: { id: 'o', org_id: 'org', role: 'admin', is_super_admin: true } })
    setup()
    const res = await POST(req({ reason: '   ' }), { params: { id: 'j1' } })
    expect(res.status).toBe(400)
  })

  it('stores who/when/why and writes an audit row', async () => {
    mockAuth.mockResolvedValue({ profile: { id: 'o', org_id: 'org', role: 'admin', is_super_admin: true } })
    const calls = setup()
    const res = await POST(req({ reason: 'Insurer kept depreciation', mark_collected: true }), { params: { id: 'j1' } })
    expect(res.status).toBe(200)
    const jobUpdate = calls.find((c) => c.table === 'production_jobs' && c.op === 'update')?.arg as Record<string, unknown>
    expect(jobUpdate).toMatchObject({ allow_close_with_balance: true, close_balance_reason: 'Insurer kept depreciation', close_balance_by: 'o', status: 'collected' })
    expect(typeof jobUpdate.close_balance_at).toBe('string')
    const audit = calls.find((c) => c.table === 'payroll_override_audit')?.arg as Record<string, unknown>
    expect(audit).toMatchObject({ override_type: 'force_paid_in_full', job_id: 'j1', actor_user_id: 'o', org_id: 'org' })
  })

  it('reverts the job when the audit row fails', async () => {
    mockAuth.mockResolvedValue({ profile: { id: 'o', org_id: 'org', role: 'admin', is_super_admin: true } })
    const calls = setup({ message: 'boom' })
    const res = await POST(req({ reason: 'x' }), { params: { id: 'j1' } })
    expect(res.status).toBe(500)
    const updates = calls.filter((c) => c.table === 'production_jobs' && c.op === 'update')
    expect(updates).toHaveLength(2)
    expect(updates[1].arg).toMatchObject({ allow_close_with_balance: false, close_balance_by: null, status: 'complete' })
  })
})
