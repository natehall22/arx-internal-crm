/**
 * @jest-environment node
 *
 * Phase 2 of docs/prompts/comp-plan-admin-editing.md —
 * PATCH/GET /api/admin/payroll/deal-commission-roles.
 *
 * Covers the four gaps identified in the spec:
 *  1. A blank reason must 400, not silently default.
 *  2. The audit write is checked; on failure the override write is rolled back.
 *  3. Overrides on jobs already PAID in a locked/paid period are rejected — while an old
 *     sale date that was never actually paid stays overridable.
 *  4. GET returns a read-only, org-wide register joined to the best-matching audit row.
 */

jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { PATCH as rolesPATCH, GET as rolesGET } from '@/app/api/admin/payroll/deal-commission-roles/route'

const mockRequireAuthApi = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>

type Resp = { data: unknown; error?: unknown }

/** A chainable builder that resolves to `response` however it's awaited — after
 * .maybeSingle()/.single(), or directly via `await builder` (no terminal call). */
function makeBuilder(response: Resp) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete', 'limit']) {
    builder[method] = jest.fn(() => builder)
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(response))
  builder.single = jest.fn(() => Promise.resolve(response))
  builder.then = (resolve: (v: Resp) => void) => resolve(response)
  return builder
}

/** Queues responses per table so successive `.from(table)` calls (e.g. the same
 * table queried for a lookup, then again for the write) return different data. */
function mockSupabaseQueues(queues: Record<string, Resp[]>) {
  const callCounts: Record<string, number> = {}
  const from = jest.fn((table: string) => {
    const idx = callCounts[table] || 0
    callCounts[table] = idx + 1
    const list = queues[table] || []
    const response = list[idx] ?? list[list.length - 1] ?? { data: null, error: null }
    return makeBuilder(response)
  })
  return { from, _callCounts: callCounts }
}

function makeRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof rolesPATCH>[0]
}

const payrollAdminAuth = {
  authUser: { id: 'admin-1', email: 'admin@example.com' },
  profile: { id: 'admin-1', org_id: 'org-1', role: 'admin' },
} as never

const validBody = {
  job_id: 'job-1',
  user_id: 'user-1',
  role: 'closer',
  override_amount: 500,
  reason: 'Manual price adjustment approved by ops',
}

// `salesperson_id` matters: a `closer` override only saves when the target user
// actually holds that producer role on the job (collectParticipants maps
// sales_rep -> closer), otherwise the row would be inert at payroll time.
// `project_id: null` keeps these fixtures opportunity-free.
const openJob = {
  id: 'job-1',
  job_number: '26-0099',
  sale_date: '2026-08-01',
  salesperson_id: 'user-1',
  project_id: null,
}
const settledJob = {
  id: 'job-1',
  job_number: '26-0001',
  sale_date: '2026-07-01',
  salesperson_id: 'user-1',
  project_id: null,
}
const targetUser = { id: 'user-1' }

describe('PATCH /api/admin/payroll/deal-commission-roles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when requireAuthApi throws', async () => {
    mockRequireAuthApi.mockRejectedValue(new Error('Unauthorized'))
    const res = await rolesPATCH(makeRequest(validBody))
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-payroll-admin role', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'closer-1' },
      profile: { id: 'closer-1', org_id: 'org-1', role: 'closer' },
    } as never)
    const res = await rolesPATCH(makeRequest(validBody))
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('rejects a blank reason instead of silently defaulting', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const supabase = mockSupabaseQueues({})
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest({ ...validBody, reason: '   ' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/reason/i)
    // Never even looked up the job — validation happens before any DB call.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejects an override on a job already paid out in a settled period', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: settledJob }],
      payroll_payout_lines: [
        {
          data: [
            {
              id: 'line-1',
              payroll_period_id: 'period-1',
              payroll_periods: { id: 'period-1', period_label: '2026-W29', status: 'paid' },
            },
          ],
        },
      ],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('locked_period')
    expect(body.period.label).toBe('2026-W29')
  })

  it('rejects a producer override on someone who holds no such role on the job', async () => {
    // The 26-0035 failure mode: a `setter`/`closer` row matching nobody used to be
    // saved, audited, and then silently dropped at payroll time. It now 400s, because
    // the admin's real intent (change this person's pay) cannot be honoured.
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: { ...openJob, salesperson_id: 'someone-else' } }],
      payroll_payout_lines: [{ data: [] }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('not_a_producer_on_job')
    // Nothing was written, so no audit row can claim pay was changed.
    expect(supabase.from.mock.calls.filter((c) => c[0] === 'deal_commission_roles')).toHaveLength(0)
    expect(supabase.from.mock.calls.filter((c) => c[0] === 'payroll_override_audit')).toHaveLength(0)
  })

  it('rejects a setter override aimed at the job’s closer', async () => {
    // collectParticipants dedupes by user, so one person closing AND setting a job
    // holds only the closer line — a `setter` row for them would never be read.
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: openJob }], // user-1 is the salesperson
      payroll_payout_lines: [{ data: [] }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest({ ...validBody, role: 'setter' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('not_a_producer_on_job')
  })

  it('still accepts a custom override for a user with no producer role', async () => {
    // `custom` adds a separate paid line, so it has no producer to match — this is the
    // documented path for paying someone who is not the job's setter or closer.
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const savedRole = {
      id: 'role-9',
      job_id: 'job-1',
      user_id: 'user-1',
      role: 'custom',
      override_amount: 500,
      override_percent: null,
    }
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: { ...openJob, salesperson_id: 'someone-else' } }],
      payroll_payout_lines: [{ data: [] }],
      users: [{ data: targetUser }],
      deal_commission_roles: [{ data: null }, { data: savedRole }],
      payroll_override_audit: [{ data: null, error: null }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest({ ...validBody, role: 'custom' }))
    expect(res.status).toBe(200)
  })

  it('permits an override on an OLD job that was never actually paid', async () => {
    // The regression this guard must not reintroduce: payroll_periods has no start
    // date and materialization has no lower bound, so an old sale date says nothing
    // about whether the job was paid. Prod holds 26 such jobs with zero payout lines.
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const savedRole = {
      id: 'role-1',
      job_id: 'job-1',
      user_id: 'user-1',
      role: 'closer',
      override_amount: 500,
      override_percent: null,
    }
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: settledJob }], // sale_date 2026-07-01, before the newest settled cutoff
      payroll_payout_lines: [{ data: [] }], // but nothing was ever paid on it
      users: [{ data: targetUser }],
      deal_commission_roles: [{ data: null }, { data: savedRole }],
      payroll_override_audit: [{ data: null, error: null }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest(validBody))
    expect(res.status).toBe(200)
  })

  it('permits an override on a job with no settled payout lines', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const savedRole = {
      id: 'role-1',
      job_id: 'job-1',
      user_id: 'user-1',
      role: 'closer',
      override_amount: 500,
      override_percent: null,
    }
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: openJob }],
      payroll_payout_lines: [{ data: [] }],
      users: [{ data: targetUser }],
      deal_commission_roles: [{ data: null }, { data: savedRole }],
      payroll_override_audit: [{ data: null, error: null }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.role).toEqual(savedRole)
  })

  it('rolls back a fresh override (insert) when the audit write fails, and 500s', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const savedRole = {
      id: 'role-1',
      job_id: 'job-1',
      user_id: 'user-1',
      role: 'closer',
      override_amount: 500,
      override_percent: null,
    }
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: openJob }],
      payroll_payout_lines: [{ data: [] }],
      users: [{ data: targetUser }],
      // 1st call: existing lookup (none). 2nd call: the insert write. 3rd call: rollback delete.
      deal_commission_roles: [{ data: null }, { data: savedRole }, { data: null, error: null }],
      payroll_override_audit: [{ data: null, error: { message: 'insert failed' } }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/audit/i)
    // 3 calls into deal_commission_roles: existing lookup, insert, rollback delete.
    expect(supabase.from.mock.calls.filter((c) => c[0] === 'deal_commission_roles')).toHaveLength(3)
  })

  it('rolls back an updated override to its prior values when the audit write fails', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)
    const existingRole = { id: 'role-1', override_amount: 100, override_percent: null }
    const savedRole = {
      id: 'role-1',
      job_id: 'job-1',
      user_id: 'user-1',
      role: 'closer',
      override_amount: 500,
      override_percent: null,
    }
    const supabase = mockSupabaseQueues({
      production_jobs: [{ data: openJob }],
      payroll_payout_lines: [{ data: [] }],
      users: [{ data: targetUser }],
      // 1st call: existing lookup (found). 2nd: the update write. 3rd: rollback update.
      deal_commission_roles: [{ data: existingRole }, { data: savedRole }, { data: null, error: null }],
      payroll_override_audit: [{ data: null, error: { message: 'insert failed' } }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesPATCH(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/audit/i)
    expect(supabase.from.mock.calls.filter((c) => c[0] === 'deal_commission_roles')).toHaveLength(3)
  })
})

describe('GET /api/admin/payroll/deal-commission-roles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 403 for a non-payroll-admin role', async () => {
    mockRequireAuthApi.mockResolvedValue({
      authUser: { id: 'closer-1' },
      profile: { id: 'closer-1', org_id: 'org-1', role: 'closer' },
    } as never)
    const res = await rolesGET()
    expect(res.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('prefers the audit row whose after_value names the exact user over a role-only match', async () => {
    mockRequireAuthApi.mockResolvedValue(payrollAdminAuth)

    const overrideRow = {
      id: 'dcr-1',
      job_id: 'job-1',
      role: 'closer',
      user_id: 'user-2',
      override_amount: 500,
      override_percent: null,
      premier_pricing_amount: null,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      job: { id: 'job-1', job_number: '26-0099', sale_date: '2026-08-01' },
      user: { id: 'user-2', full_name: 'Jane Closer', email: 'jane@example.com' },
    }

    // Two audit rows on the same job_id/role: an older one (no user_id captured,
    // legacy shape) and a newer one that DOES name user-2. The newer, user-matched
    // row should win even though it isn't first by recency alone in this fixture.
    const legacyAudit = {
      id: 'audit-legacy',
      job_id: 'job-1',
      actor_user_id: 'admin-1',
      reason: 'Old override before user_id was tracked',
      before_value: { role: 'closer' },
      after_value: { role: 'closer', override_amount: 400 },
      created_at: '2026-07-01T00:00:00Z',
      actor: { full_name: 'Old Admin', email: 'old@example.com' },
    }
    const matchedAudit = {
      id: 'audit-matched',
      job_id: 'job-1',
      actor_user_id: 'admin-1',
      reason: 'Manual price adjustment approved by ops',
      before_value: { role: 'closer', user_id: 'user-2', override_amount: null },
      after_value: { role: 'closer', user_id: 'user-2', override_amount: 500 },
      created_at: '2026-08-01T00:00:00Z',
      actor: { full_name: 'Admin One', email: 'admin@example.com' },
    }

    const supabase = mockSupabaseQueues({
      deal_commission_roles: [{ data: [overrideRow] }],
      payroll_override_audit: [{ data: [legacyAudit, matchedAudit] }],
    })
    mockCreateServiceClient.mockReturnValue(supabase as never)

    const res = await rolesGET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.overrides).toHaveLength(1)
    const row = body.overrides[0]
    expect(row.jobNumber).toBe('26-0099')
    expect(row.userName).toBe('Jane Closer')
    expect(row.audit.reason).toBe('Manual price adjustment approved by ops')
    expect(row.audit.actorName).toBe('Admin One')
  })
})
