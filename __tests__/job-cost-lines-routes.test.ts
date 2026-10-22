/**
 * @jest-environment node
 *
 * The ONE write path for job costs: /api/ops/jobs/[id]/cost-lines (+ /[costLineId]).
 */
jest.mock('@/lib/auth', () => ({ requireAuthApi: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: jest.fn() }))
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
import { resolveOpsAccess } from '@/lib/ops-access'
import { POST, GET } from '@/app/api/ops/jobs/[id]/cost-lines/route'
import { PATCH, DELETE } from '@/app/api/ops/jobs/[id]/cost-lines/[costLineId]/route'

const mockAuth = requireAuthApi as jest.Mock
const mockClient = createServiceClient as jest.Mock
const mockAccess = resolveOpsAccess as jest.Mock

type Op = { table: string; method: string; args: unknown[] }

/** Each from(table) call takes the next queued response for that table. */
function fakeSupabase(responses: Record<string, Array<{ data: unknown; error?: unknown }>>) {
  const ops: Op[] = []
  return {
    ops,
    from: jest.fn((table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'range', 'limit', 'ilike', 'insert', 'update', 'neq']) {
        b[m] = jest.fn((...args: unknown[]) => {
          ops.push({ table, method: m, args })
          return b
        })
      }
      const next = () => {
        const q = responses[table]
        if (!q || q.length === 0) throw new Error(`no response queued for ${table}`)
        const r = q.shift()!
        return { data: r.data, error: r.error ?? null }
      }
      b.single = jest.fn(async () => next())
      b.maybeSingle = jest.fn(async () => next())
      b.then = (resolve: (v: unknown) => void) => resolve(next())
      return b
    }),
  }
}

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = { params: { id: 'job-1' } }
const lineParams = { params: { id: 'job-1', costLineId: 'line-1' } }

beforeEach(() => {
  jest.resetAllMocks()
  mockAuth.mockResolvedValue({ authUser: { id: 'auth-1' }, profile: { id: 'u1', org_id: 'org-1', role: 'operations' } })
  mockAccess.mockResolvedValue({ canJobBoard: true, canViewJobFinancials: true })
})

describe('POST cost-lines', () => {
  it('writes the ledger with vendor_id, source=manual and non-blocking payroll flags', async () => {
    const sb = fakeSupabase({
      production_jobs: [{ data: { id: 'job-1', org_id: 'org-1' } }],
      vendors: [{ data: [] }, { data: { id: 'v1' } }],
      job_cost_lines: [{ data: { id: 'new' } }],
    })
    mockClient.mockReturnValue(sb)
    const res: any = await POST(req({ description: 'Shingles', supplier: 'QXO', amount: '4170.42', cost_type: 'material' }), params)
    expect(res.status).toBe(200)
    const insert = sb.ops.find((o) => o.table === 'job_cost_lines' && o.method === 'insert')!
    expect(insert.args[0]).toMatchObject({
      org_id: 'org-1',
      job_id: 'job-1',
      description: 'Shingles',
      vendor_id: 'v1',
      amount: 4170.42,
      cost_type: 'material',
      source: 'manual',
      approved: false,
      deduct_from_commission_base: false,
    })
  })

  it('stores a return as a negative amount, and rejects a raw negative', async () => {
    const sb = fakeSupabase({
      production_jobs: [{ data: { id: 'job-1' } }, { data: { id: 'job-1' } }],
      job_cost_lines: [{ data: { id: 'new' } }],
    })
    mockClient.mockReturnValue(sb)
    await POST(req({ description: 'Roofing return', amount: 446.29, credit: true }), params)
    const insert = sb.ops.find((o) => o.method === 'insert')!
    expect((insert.args[0] as { amount: number }).amount).toBe(-446.29)

    const res: any = await POST(req({ description: 'Typo', amount: -5 }), params)
    expect(res.status).toBe(400)
  })

  it('requires the job board and an org-scoped job', async () => {
    mockAccess.mockResolvedValue({ canJobBoard: false, canViewJobFinancials: false })
    mockClient.mockReturnValue(fakeSupabase({}))
    expect(((await POST(req({ description: 'x', amount: 1 }), params)) as any).status).toBe(403)

    mockAccess.mockResolvedValue({ canJobBoard: true, canViewJobFinancials: true })
    mockClient.mockReturnValue(fakeSupabase({ production_jobs: [{ data: null }] }))
    expect(((await POST(req({ description: 'x', amount: 1 }), params)) as any).status).toBe(404)
  })

  it('401 when not signed in', async () => {
    mockAuth.mockRejectedValue(new Error('no session'))
    expect(((await POST(req({}), params)) as any).status).toBe(401)
  })
})

describe('GET cost-lines', () => {
  it('returns every live line + the summary, and hides money without the financials permission', async () => {
    const rows = [
      { id: 'a', job_id: 'job-1', description: 'Shingles', amount: 100, cost_type: 'material', approved: true },
      { id: 'b', job_id: 'job-1', description: 'Lender / dealer fee', amount: 50, cost_type: 'misc', approved: true },
    ]
    mockClient.mockReturnValue(fakeSupabase({ production_jobs: [{ data: { id: 'job-1' } }], job_cost_lines: [{ data: rows }] }))
    const res: any = await GET(req({}), params)
    const body = await res.json()
    expect(body.costLines).toHaveLength(2)
    expect(body.summary.total).toBe(100)

    mockAccess.mockResolvedValue({ canJobBoard: true, canViewJobFinancials: false })
    mockClient.mockReturnValue(fakeSupabase({ production_jobs: [{ data: { id: 'job-1' } }], job_cost_lines: [{ data: rows }] }))
    const hidden = await ((await GET(req({}), params)) as any).json()
    expect(hidden.summary).toBeNull()
    expect(hidden.costLines.every((l: { amount: unknown }) => l.amount === null)).toBe(true)
  })
})

describe('PATCH cost line', () => {
  it('editing the amount of an approved line sends it back for review', async () => {
    const sb = fakeSupabase({
      job_cost_lines: [
        { data: { id: 'line-1', description: 'Shingles', amount: 100, cost_type: 'material', approved: true } },
        { data: { id: 'line-1' } },
      ],
    })
    mockClient.mockReturnValue(sb)
    const res: any = await PATCH(req({ amount: 120 }), lineParams)
    expect(res.status).toBe(200)
    const update = sb.ops.find((o) => o.method === 'update')!
    expect(update.args[0]).toMatchObject({ amount: 120, approved: false, approved_by: null, approved_at: null })
  })

  it('a description-only edit keeps the approval', async () => {
    const sb = fakeSupabase({
      job_cost_lines: [
        { data: { id: 'line-1', description: 'Shingles', amount: 100, cost_type: 'material', approved: true } },
        { data: { id: 'line-1' } },
      ],
    })
    mockClient.mockReturnValue(sb)
    await PATCH(req({ description: 'Shingles - IKO' }), lineParams)
    const update = sb.ops.find((o) => o.method === 'update')!
    expect(update.args[0]).toEqual({ description: 'Shingles - IKO' })
  })

  it('refuses to edit the dealer-fee system line', async () => {
    mockClient.mockReturnValue(
      fakeSupabase({
        job_cost_lines: [{ data: { id: 'line-1', description: 'Lender / dealer fee', amount: 50, cost_type: 'misc', approved: true } }],
      })
    )
    expect(((await PATCH(req({ amount: 1 }), lineParams)) as any).status).toBe(409)
  })

  it('approval stays payroll-admin only', async () => {
    mockAuth.mockResolvedValue({ authUser: { id: 'a' }, profile: { id: 'u', org_id: 'org-1', role: 'sales_rep' } })
    mockClient.mockReturnValue(fakeSupabase({}))
    expect(((await PATCH(req({ approved: true }), lineParams)) as any).status).toBe(403)
  })
})

describe('DELETE cost line', () => {
  it('admin only, and soft-deletes', async () => {
    mockClient.mockReturnValue(fakeSupabase({}))
    expect(((await DELETE(req({}), lineParams)) as any).status).toBe(403)

    mockAuth.mockResolvedValue({ authUser: { id: 'a' }, profile: { id: 'u1', org_id: 'org-1', role: 'admin' } })
    const sb = fakeSupabase({
      job_cost_lines: [
        { data: { id: 'line-1', description: 'Shingles', amount: 1, cost_type: 'material', approved: true } },
        { data: null },
      ],
    })
    mockClient.mockReturnValue(sb)
    expect(((await DELETE(req({}), lineParams)) as any).status).toBe(200)
    const update = sb.ops.find((o) => o.method === 'update')!
    expect(update.args[0]).toMatchObject({ status: 'archived', deleted_by: 'u1' })
  })
})
