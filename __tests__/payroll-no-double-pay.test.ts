/**
 * @jest-environment node
 *
 * App side of the payroll period API (DB side of the double-pay guard: supabase/tests/payroll_no_double_pay.sql +
 * run-payroll-no-double-pay.sh for migration 202610210002; the atomic commit: 202610280010 + payroll-atomic-approve.test.ts).
 *  1. The old period "lock" action is gone: Approve (Pay this week) is the one lock path.
 *  2. Cancel/reopen go through the one-transaction RPC.
 *  3. mark_paid / edits are conditional and refuse while a lock is in progress.
 */

jest.mock('@/lib/auth', () => ({ requireAuthApi: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
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
import { PATCH as periodPATCH } from '@/app/api/admin/payroll/periods/[periodId]/route'

type Resp = { data?: unknown; error?: unknown; count?: number | null }
type Builder = Record<string, jest.Mock> & { then: unknown }

function makeBuilder(response: Resp): Builder {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'not', 'lte', 'is', 'or', 'order', 'insert', 'update', 'upsert', 'delete', 'limit', 'range']) {
    builder[m] = jest.fn(() => builder)
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(response))
  builder.single = jest.fn(() => Promise.resolve(response))
  builder.then = (resolve: (v: Resp) => void) => resolve(response)
  return builder as Builder
}

/** Queued responses per table and per RPC name; every builder is recorded per table. */
function mockSupabase(queues: Record<string, Resp[]>, rpcQueues: Record<string, Resp[]> = {}) {
  const calls: Record<string, number> = {}
  const builders: Record<string, Builder[]> = {}
  const from = jest.fn((table: string) => {
    const idx = calls[table] || 0
    calls[table] = idx + 1
    const list = queues[table] || []
    const b = makeBuilder(list[idx] ?? list[list.length - 1] ?? { data: null, error: null })
    ;(builders[table] ||= []).push(b)
    return b
  })
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const rpc = jest.fn((name: string, args: Record<string, unknown>) => {
    const idx = rpcCalls.filter((c) => c.name === name).length
    rpcCalls.push({ name, args })
    const list = rpcQueues[name] || []
    return Promise.resolve(list[idx] ?? list[list.length - 1] ?? { data: null, error: null })
  })
  const deletes = (table: string) => (builders[table] || []).filter((b) => b.delete.mock.calls.length > 0)
  const updates = (table: string) => (builders[table] || []).filter((b) => b.update.mock.calls.length > 0)
  const rpcNamed = (name: string) => rpcCalls.filter((c) => c.name === name)
  return { client: { from, rpc } as never, calls, builders, deletes, updates, rpcNamed }
}

describe('PATCH /api/admin/payroll/periods/[periodId]', () => {
  const mockAuth = requireAuthApi as jest.MockedFunction<typeof requireAuthApi>
  const mockService = createServiceClient as jest.MockedFunction<typeof createServiceClient>

  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({
      authUser: { id: 'admin-1' },
      profile: { id: 'admin-1', org_id: 'org-1', role: 'admin' },
    } as never)
  })

  function call(body: Record<string, unknown>, periodId = 'period-1') {
    return periodPATCH({ json: async () => body } as never, { params: { periodId } })
  }

  describe('lock', () => {
    it('is retired: the one lock path is Approve on Pay this week', async () => {
      const m = mockSupabase({ payroll_periods: [{ data: { id: 'period-2', status: 'open', locked_at: null }, error: null }] })
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'lock' }, 'period-2')
      expect(res.status).toBe(410)
      expect(await res.json()).toMatchObject({ code: 'use_pay_this_week' })
      expect(m.rpcNamed('payroll_claim_period_lock')).toHaveLength(0)
      expect(m.rpcNamed('payroll_commit_week')).toHaveLength(0)
      expect(m.updates('payroll_periods')).toHaveLength(0)
    })
  })

  describe('cancel / reopen (one-transaction RPC)', () => {
    const periodLoad = { data: { id: 'period-1', status: 'locked', locked_at: 'x' }, error: null }

    for (const action of ['cancel', 'reopen']) {
      it(`passes org, period, action and actor to the RPC and never deletes from the app (${action})`, async () => {
        const m = mockSupabase(
          { payroll_periods: [periodLoad, { data: { id: 'period-1' }, error: null }] },
          { payroll_cancel_or_reopen_period: [{ data: { ok: true, snapshots_deleted: 0 }, error: null }] }
        )
        mockService.mockReturnValue(m.client)
        const res = await call({ action })
        expect(res.status).toBe(200)
        expect(m.rpcNamed('payroll_cancel_or_reopen_period')[0].args).toEqual({
          p_org_id: 'org-1',
          p_period_id: 'period-1',
          p_action: action,
          p_actor_user_id: 'admin-1',
        })
        expect(m.deletes('payroll_job_snapshots')).toHaveLength(0)
        expect(m.updates('payroll_periods')).toHaveLength(0)
        expect(await res.json()).not.toHaveProperty('message')
      })

      for (const [code, status] of [
        ['lock_in_progress', 409],
        ['period_has_payout_lines', 409],
        ['period_has_chargeback_applications', 409],
        ['not_found', 404],
        ['something_new', 500],
      ] as const) {
        it(`maps RPC refusal ${code} to ${status} (${action})`, async () => {
          const m = mockSupabase(
            { payroll_periods: [periodLoad] },
            { payroll_cancel_or_reopen_period: [{ data: { ok: false, code, snapshot_count: 3, application_count: 1 }, error: null }] }
          )
          mockService.mockReturnValue(m.client)
          const res = await call({ action })
          expect(res.status).toBe(status)
          if (status === 409) expect(await res.json()).toMatchObject({ code })
        })
      }

      it(`returns 500 when the RPC errors (${action})`, async () => {
        const m = mockSupabase(
          { payroll_periods: [periodLoad] },
          { payroll_cancel_or_reopen_period: [{ data: null, error: { message: 'down' } }] }
        )
        mockService.mockReturnValue(m.client)
        expect((await call({ action })).status).toBe(500)
      })

      it(`tells ops when partial lock rows were cleared (${action})`, async () => {
        const m = mockSupabase(
          { payroll_periods: [periodLoad, { data: { id: 'period-1' }, error: null }] },
          { payroll_cancel_or_reopen_period: [{ data: { ok: true, snapshots_deleted: 2 }, error: null }] }
        )
        mockService.mockReturnValue(m.client)
        const res = await call({ action })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({
          message: 'Cleared 2 unfinished job snapshot(s) from a lock that never completed.',
        })
      })
    }
  })

  describe('mark_paid and edits are conditional', () => {
    it('mark_paid only from locked with no live claim; 409 when no row matched', async () => {
      const m = mockSupabase({
        payroll_periods: [{ data: { id: 'period-1', status: 'locked', locked_at: 'x' }, error: null }, { data: null, error: null }],
      })
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'mark_paid' })
      expect(res.status).toBe(409)
      const upd = m.updates('payroll_periods')[0]
      expect(upd.eq).toHaveBeenCalledWith('status', 'locked')
      expect(upd.or).toHaveBeenCalledWith(expect.stringMatching(/^lock_claimed_at\.is\.null,lock_claimed_at\.lt\."[^"]+"$/))
    })

    it('field edits only while open with no live claim; 409 when no row matched', async () => {
      const m = mockSupabase({
        payroll_periods: [{ data: { id: 'period-1', status: 'open', locked_at: null }, error: null }, { data: null, error: null }],
      })
      mockService.mockReturnValue(m.client)
      const res = await call({ cutoff_at: '2026-10-22T03:59:59.000Z' })
      expect(res.status).toBe(409)
      const upd = m.updates('payroll_periods')[0]
      expect(upd.eq).toHaveBeenCalledWith('status', 'open')
      expect(upd.or).toHaveBeenCalled()
    })

    it('field edit succeeds when the row matched', async () => {
      const m = mockSupabase({
        payroll_periods: [
          { data: { id: 'period-1', status: 'open', locked_at: null }, error: null },
          { data: { id: 'period-1', cutoff_at: '2026-10-22T03:59:59.000Z' }, error: null },
        ],
      })
      mockService.mockReturnValue(m.client)
      expect((await call({ cutoff_at: '2026-10-22T03:59:59.000Z' })).status).toBe(200)
    })
  })
})
