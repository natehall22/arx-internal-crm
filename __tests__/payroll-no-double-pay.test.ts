/**
 * @jest-environment node
 *
 * App side of the double-pay guard (DB side: supabase/tests/payroll_no_double_pay.sql +
 * run-payroll-no-double-pay.sh for migration 202610210002_payroll_no_cross_period_double_pay.sql).
 *  1. A job the DB trigger rejects as already paid (snapshot or line) is skipped, not a 500.
 *  2. A failed payout-line write discards the lineless snapshot via the atomic RPC; any
 *     non-guard error still fails the lock. A lineless snapshot in THIS period is retried.
 *  3. Lock claims the period before writing, flips to locked only with its claim token,
 *     and always releases the claim. Cancel/reopen go through the one-transaction RPC.
 *  4. mark_paid / edits are conditional and refuse while a lock is in progress.
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

// The comp math is irrelevant here; stub it to "one rep, $50".
jest.mock('@/lib/commission-payroll', () => ({
  buildCommissionPayrollSnapshot: () => ({ compBase: 1000, poolCap: 180, source: 'stub' }),
}))
jest.mock('@/lib/job-derived-commission-lines', () => ({
  loadDerivedCommissionContext: jest.fn(async () => ({ rateHistory: [] })),
  buildAdditiveParticipantsForJob: () => ({ participants: [], selfGenSetterConflict: false }),
  resolveDerivedCommissionRatesForSaleDate: () => ({}),
}))
jest.mock('@/lib/payroll-export', () => ({
  buildMonthlyTierMetricMaps: jest.fn(async () => ({
    sitsBySetterMonth: new Map(),
    sitsByOwnerMonth: new Map(),
    salesByOwnerMonth: new Map(),
  })),
  collectParticipants: () => [{ userId: 'rep-1', role: 'sales_rep' }],
  computeRawCommissionForParticipant: () => ({
    unsupported: false,
    volumeBonusFlat: 0,
    countsTowardPoolCap: true,
    totalAmount: 50,
  }),
  loadActiveCompPlanForUser: jest.fn(async () => ({ comp_plans: { id: 'plan-1' }, override_percentage: null })),
  loadAdditiveDealCommissionParticipants: jest.fn(async () => []),
  loadProducerCommissionOverrides: jest.fn(async () => new Map()),
  monthKeyFromSaleDate: () => '2026-08',
  periodSitsAndCloseRateForParticipant: () => ({ periodSits: 0, periodClosingRatePct: 0 }),
  poolKey: (u: string, r: string) => `${u}|${r}`,
  producerOverrideKey: (j: string, u: string, r: string) => `${j}|${u}|${r}`,
  producerStorageRoleForParticipant: (r: string) => r,
  resolveAdditiveParticipantAmount: () => ({ basis: 'none', amount: 0 }),
  resolveProducerOverrideAmount: () => null,
  scaleCommissionsToPool: (raw: Map<string, number>) => ({ scaled: raw, enforced: false }),
}))

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { materializePayrollPeriod } from '@/lib/payroll-period-materialization'
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

const period = { id: 'period-2', cutoff_at: '2026-08-20T23:59:59.000Z', scheduled_pay_date: '2026-08-22', status: 'open' }
const job = {
  id: 'job-1',
  job_number: '26-0001',
  status: 'complete',
  sale_date: '2026-08-01',
  sale_amount: 100,
  commission_comp_base: 1000,
  commission_pre_tax_subtotal: null,
  dealer_fee_amount: 0,
  salesperson_id: 'rep-1',
  project_id: null,
  completed_at: '2026-08-10T12:00:00.000Z',
  allow_close_with_balance: false,
}

const guardError = {
  code: '23505',
  message: 'payroll_already_paid: job job-1 is already snapshotted in payroll period period-1',
}

/**
 * payroll_job_snapshots: [up-front read (id, job_id, payroll_period_id), snapshot upsert].
 * payroll_payout_lines: [this period's lines (up front), existing-lines read, insert].
 */
function materializeQueues(opts: {
  existingSnapshots?: unknown[]
  periodLines?: unknown[]
  snapshotUpsert?: Resp
  lineInsert?: Resp
}): Record<string, Resp[]> {
  return {
    payroll_periods: [{ data: period, error: null }],
    production_jobs: [{ data: [job], error: null }],
    payroll_job_snapshots: [
      { data: opts.existingSnapshots ?? [], error: null },
      opts.snapshotUpsert ?? { data: { id: 'snap-1' }, error: null },
    ],
    payroll_payout_lines: [
      { data: opts.periodLines ?? [], error: null },
      { data: [], error: null },
      opts.lineInsert ?? { data: null, error: null },
    ],
    job_payroll_state: [{ data: [], error: null }],
    job_payments: [
      {
        data: [{ job_id: 'job-1', amount_cents: 10000, funding_status: 'cleared', paid_at: '2026-08-11', created_at: '2026-08-11T12:00:00.000Z' }],
        error: null,
      },
    ],
    job_cost_lines: [{ data: [], error: null }],
    payroll_period_snapshots: [{ data: { id: 'pps-1' }, error: null }],
  }
}

const run = (client: never) =>
  materializePayrollPeriod(client, { orgId: 'org-1', periodId: 'period-2', actorUserId: 'admin-1' })

describe('materializePayrollPeriod double-pay guard', () => {
  it('writes snapshot + line normally (control)', async () => {
    const m = mockSupabase(materializeQueues({}))
    const result = await run(m.client)
    expect(result).toMatchObject({ snapshotsCreated: 1, payoutLinesCreated: 1, skippedJobs: [] })
    expect(m.rpcNamed('payroll_discard_lineless_job_snapshot')).toHaveLength(0)
  })

  it('skips a job snapshotted in ANOTHER period', async () => {
    const m = mockSupabase(
      materializeQueues({ existingSnapshots: [{ id: 'snap-x', job_id: 'job-1', payroll_period_id: 'period-1' }] })
    )
    const result = await run(m.client)
    expect(result.skippedJobs).toEqual([{ jobId: 'job-1', reason: 'already_snapshotted' }])
    expect(m.calls.payroll_payout_lines).toBe(1) // only the up-front read
  })

  it('skips a job snapshotted in THIS period that has lines', async () => {
    const m = mockSupabase(
      materializeQueues({
        existingSnapshots: [{ id: 'snap-here', job_id: 'job-1', payroll_period_id: 'period-2' }],
        periodLines: [{ payroll_job_snapshot_id: 'snap-here' }],
      })
    )
    const result = await run(m.client)
    expect(result.skippedJobs).toEqual([{ jobId: 'job-1', reason: 'already_snapshotted' }])
  })

  it('retries a LINELESS snapshot in this period instead of skipping it forever', async () => {
    const m = mockSupabase(
      materializeQueues({
        existingSnapshots: [{ id: 'snap-here', job_id: 'job-1', payroll_period_id: 'period-2' }],
        periodLines: [],
        snapshotUpsert: { data: { id: 'snap-here' }, error: null },
      })
    )
    const result = await run(m.client)
    expect(result).toMatchObject({ snapshotsCreated: 1, payoutLinesCreated: 1, skippedJobs: [] })
    const insert = m.builders.payroll_payout_lines[2].insert
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ payroll_job_snapshot_id: 'snap-here', job_id: 'job-1' })])
  })

  it('skips a job whose snapshot the DB rejects as already paid, writing no lines', async () => {
    const m = mockSupabase(materializeQueues({ snapshotUpsert: { data: null, error: guardError } }))
    const result = await run(m.client)
    expect(result).toMatchObject({ snapshotsCreated: 0, payoutLinesCreated: 0 })
    expect(result.skippedJobs).toEqual([{ jobId: 'job-1', reason: 'already_paid_by_race' }])
    expect(m.calls.payroll_payout_lines).toBe(1) // only the up-front read
    expect(m.calls.job_payroll_state).toBe(1) // read only; never re-pointed at this period
  })

  it('still fails the lock on any other snapshot error', async () => {
    const m = mockSupabase(
      materializeQueues({ snapshotUpsert: { data: null, error: { code: '42501', message: 'permission denied' } } })
    )
    await expect(run(m.client)).rejects.toEqual({ code: '42501', message: 'permission denied' })
  })

  it('discards the lineless snapshot atomically and fails the lock when the line insert errors', async () => {
    const m = mockSupabase(materializeQueues({ lineInsert: { data: null, error: { code: '08006', message: 'conn lost' } } }))
    await expect(run(m.client)).rejects.toEqual({ code: '08006', message: 'conn lost' })
    expect(m.rpcNamed('payroll_discard_lineless_job_snapshot')).toEqual([
      { name: 'payroll_discard_lineless_job_snapshot', args: { p_org_id: 'org-1', p_snapshot_id: 'snap-1' } },
    ])
    expect(m.deletes('payroll_job_snapshots')).toHaveLength(0) // no check-then-delete from the app
    expect(m.calls.job_payroll_state).toBe(1)
  })

  it('discards the lineless snapshot and skips the job when the line guard rejects it', async () => {
    const m = mockSupabase(materializeQueues({ lineInsert: { data: null, error: guardError } }))
    const result = await run(m.client)
    expect(result).toMatchObject({ snapshotsCreated: 0, payoutLinesCreated: 0 })
    expect(result.skippedJobs).toEqual([{ jobId: 'job-1', reason: 'already_paid_by_race' }])
    expect(m.rpcNamed('payroll_discard_lineless_job_snapshot')).toHaveLength(1)
  })

  it('reports the original error even if the discard RPC fails', async () => {
    const m = mockSupabase(
      materializeQueues({ lineInsert: { data: null, error: { code: '08006', message: 'conn lost' } } }),
      { payroll_discard_lineless_job_snapshot: [{ data: null, error: { message: 'down' } }] }
    )
    await expect(run(m.client)).rejects.toEqual({ code: '08006', message: 'conn lost' })
  })
})

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

  /** Lock path: route load, materializer load, flip, final read. */
  function lockQueues(opts: { flip?: Resp; snapshotUpsert?: Resp; materializerPeriod?: Resp } = {}) {
    return {
      ...materializeQueues({ snapshotUpsert: opts.snapshotUpsert }),
      payroll_periods: [
        { data: { id: 'period-2', status: 'open', locked_at: null }, error: null },
        opts.materializerPeriod ?? { data: period, error: null },
        opts.flip ?? { data: { id: 'period-2' }, error: null },
        { data: { ...period, status: 'locked' }, error: null }, // final read / release
      ],
      payroll_bonus_lines: [{ count: 0, error: null }],
    }
  }

  const releaseCalls = (m: ReturnType<typeof mockSupabase>) =>
    m.updates('payroll_periods').filter((b) =>
      b.update.mock.calls.some(([v]) => (v as Record<string, unknown>).lock_claim_token === null)
    )

  describe('lock', () => {
    it('refuses without materializing when the claim is not won', async () => {
      const m = mockSupabase(lockQueues(), { payroll_claim_period_lock: [{ data: false, error: null }] })
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'lock' }, 'period-2')
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'lock_in_progress' })
      expect(m.calls.production_jobs).toBeUndefined()
      expect(m.updates('payroll_periods')).toHaveLength(0)
    })

    it('claims with a token, flips only with that token from open, then releases', async () => {
      const m = mockSupabase(lockQueues(), { payroll_claim_period_lock: [{ data: true, error: null }] })
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'lock' }, 'period-2')
      expect(res.status).toBe(200)
      const [claim] = m.rpcNamed('payroll_claim_period_lock')
      const token = claim.args.p_token as string
      expect(token).toMatch(/^[0-9a-f-]{36}$/)
      expect(claim.args).toMatchObject({ p_org_id: 'org-1', p_period_id: 'period-2' })
      const flip = m.updates('payroll_periods').find((b) =>
        b.update.mock.calls.some(([v]) => (v as Record<string, unknown>).status === 'locked')
      )!
      expect(flip.eq).toHaveBeenCalledWith('status', 'open')
      expect(flip.eq).toHaveBeenCalledWith('lock_claim_token', token)
      const release = releaseCalls(m)
      expect(release).toHaveLength(1)
      expect(release[0].eq).toHaveBeenCalledWith('lock_claim_token', token)
    })

    it('reports a claim lost before the flip as 409 (not success) and still releases', async () => {
      const m = mockSupabase(lockQueues({ flip: { data: null, error: null } }), {
        payroll_claim_period_lock: [{ data: true, error: null }],
      })
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'lock' }, 'period-2')
      expect(res.status).toBe(409)
      expect(releaseCalls(m)).toHaveLength(1)
    })

    it('releases the claim when materialization fails', async () => {
      const m = mockSupabase(
        lockQueues({ snapshotUpsert: { data: null, error: { code: '42501', message: 'permission denied' } } }),
        { payroll_claim_period_lock: [{ data: true, error: null }] }
      )
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'lock' }, 'period-2')
      expect(res.status).toBe(500)
      expect(releaseCalls(m)).toHaveLength(1)
      expect(
        m.updates('payroll_periods').some((b) =>
          b.update.mock.calls.some(([v]) => (v as Record<string, unknown>).status === 'locked')
        )
      ).toBe(false)
    })

    it('reports jobs skipped because another lock paid them first', async () => {
      const m = mockSupabase(lockQueues({ snapshotUpsert: { data: null, error: guardError } }), {
        payroll_claim_period_lock: [{ data: true, error: null }],
      })
      mockService.mockReturnValue(m.client)
      const res = await call({ action: 'lock' }, 'period-2')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { message: string; materialization: { skippedJobs: unknown[] } }
      expect(body.message).toBe(
        'Period locked with 0 payout line(s). 1 job(s) skipped: another payroll lock paid them first.'
      )
      expect(body.materialization.skippedJobs).toEqual([{ jobId: 'job-1', reason: 'already_paid_by_race' }])
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
