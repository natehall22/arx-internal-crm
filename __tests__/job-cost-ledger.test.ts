/**
 * @jest-environment node
 *
 * One job cost ledger (Known Redundancy #11, BUILD-BRIEF item 3).
 * Rules locked here:
 *  - job_cost_lines is the only cost source; live lines only; returns are negative.
 *  - the mirrored "Lender / dealer fee" line never adds to cost; dealer_fee_amount is added once.
 *  - new lines can never block payroll (deduct flag off by default).
 *  - the reader pages past PostgREST's 1,000-row cap and fails loudly, not as $0.
 */
import {
  DEALER_FEE_COST_LINE_DESCRIPTION,
  EMPTY_JOB_COST_SUMMARY,
  NEW_COST_LINE_PAYROLL_FLAGS,
  enrichJobsWithCostLedger,
  isDealerFeeCostLine,
  jobCostBucket,
  jobDirectCost,
  loadJobCostLedger,
  normalizeJobCostType,
  resolveVendorId,
  signedCostAmount,
  summarizeJobCostLines,
} from '@/lib/job-cost-ledger'
import { summarizeJobEconomics } from '@/lib/goals-job-economics'
import { derivePayrollEligibility } from '@/lib/payroll-period-materialization'

type Call = { method: string; args: unknown[] }

/** Chainable Postgrest double. `pages` is consumed one per awaited query. */
function fakeClient(pages: Array<{ data: unknown[] | null; error?: unknown }>) {
  const calls: Call[][] = []
  const client = {
    from: jest.fn((_table: string) => {
      const mine: Call[] = []
      calls.push(mine)
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'range', 'neq', 'limit', 'ilike', 'insert', 'single']) {
        builder[m] = jest.fn((...args: unknown[]) => {
          mine.push({ method: m, args })
          return builder
        })
      }
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        const next = pages.shift()
        if (!next) return reject(new Error('no more fake pages'))
        return resolve({ data: next.data, error: next.error ?? null })
      }
      return builder
    }),
  }
  return { client, calls }
}

const line = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'l1',
  job_id: 'job-1',
  description: 'Shingles',
  amount: 100,
  cost_type: 'material',
  approved: true,
  deduct_from_commission_base: false,
  source_product_order_id: null,
  source: null,
  vendor_id: null,
  vendor: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
})

describe('summarizeJobCostLines', () => {
  it('buckets materials / labor (incl. subcontractor) / other and totals them', () => {
    const s = summarizeJobCostLines([
      { description: 'Shingles', amount: 4170.42, cost_type: 'material' },
      { description: 'Labor - Roofing', amount: 4351, cost_type: 'labor' },
      { description: 'Gutter sub', amount: 970, cost_type: 'subcontractor' },
      { description: 'Permit', amount: 75, cost_type: 'permit' },
      { description: 'Dump', amount: 30.5, cost_type: 'misc' },
    ])
    expect(s.materials).toBe(4170.42)
    expect(s.labor).toBe(5321)
    expect(s.other).toBe(105.5)
    expect(s.total).toBe(9596.92)
    expect(s.hasMaterials && s.hasLabor).toBe(true)
    expect(s.lineCount).toBe(5)
  })

  it('nets a return (negative amount) off the total — 26-0002 shape', () => {
    const s = summarizeJobCostLines([
      { description: 'Roofing (QXO)', amount: 5039.3, cost_type: 'material' },
      { description: 'Roofing Return (QXO)', amount: -446.29, cost_type: 'material' },
    ])
    expect(s.materials).toBe(4593.01)
  })

  it('leaves the mirrored dealer-fee line out of the total so the fee is counted once', () => {
    const s = summarizeJobCostLines([
      { description: 'Shingles', amount: 1000, cost_type: 'material' },
      { description: DEALER_FEE_COST_LINE_DESCRIPTION, amount: 992.76, cost_type: 'misc' },
    ])
    expect(s.total).toBe(1000)
    expect(s.dealerFeeLine).toBe(992.76)
    expect(s.lineCount).toBe(1)
    expect(jobDirectCost(s, 992.76)).toBe(1992.76)
  })

  it('flags unreviewed real lines only', () => {
    expect(summarizeJobCostLines([{ description: 'x', amount: 1, cost_type: 'misc', approved: false }]).hasUnreviewed).toBe(true)
    expect(
      summarizeJobCostLines([{ description: DEALER_FEE_COST_LINE_DESCRIPTION, amount: 1, cost_type: 'misc', approved: false }])
        .hasUnreviewed
    ).toBe(false)
  })

  it('treats bad amounts as 0 and an empty ledger as the empty summary', () => {
    expect(summarizeJobCostLines([{ description: 'x', amount: 'abc' as never, cost_type: 'material' }]).total).toBe(0)
    expect(summarizeJobCostLines([])).toEqual(EMPTY_JOB_COST_SUMMARY)
  })
})

describe('dealer-fee line matching', () => {
  it('matches only the exact system description, not user-typed lender costs', () => {
    expect(isDealerFeeCostLine({ description: 'Lender / dealer fee' })).toBe(true)
    expect(isDealerFeeCostLine({ description: ' Lender / dealer fee ' })).toBe(true)
    // 26-0013's real "Lending Fee (Sunlight)" $918 is a cost, not the system mirror.
    expect(isDealerFeeCostLine({ description: 'Lending Fee (Sunlight)' })).toBe(false)
    expect(isDealerFeeCostLine({ description: 'Lender fee' })).toBe(false)
    expect(isDealerFeeCostLine({ description: null })).toBe(false)
  })
})

describe('jobDirectCost', () => {
  it('adds the dealer fee exactly once and ignores null / negative fees', () => {
    expect(jobDirectCost({ total: 100 }, 50)).toBe(150)
    expect(jobDirectCost({ total: 100 }, '50.25')).toBe(150.25)
    expect(jobDirectCost({ total: 100 }, null)).toBe(100)
    expect(jobDirectCost({ total: 100 }, -5)).toBe(100)
    expect(jobDirectCost(null, 10)).toBe(10)
  })
})

describe('small helpers', () => {
  it('normalizes cost types and buckets', () => {
    expect(normalizeJobCostType('labor')).toBe('labor')
    expect(normalizeJobCostType('bogus')).toBe('other')
    expect(normalizeJobCostType(undefined, 'material')).toBe('material')
    expect(jobCostBucket('subcontractor')).toBe('labor')
    expect(jobCostBucket('permit')).toBe('other')
  })
  it('stores a return as a negative amount regardless of the sign typed', () => {
    expect(signedCostAmount(446.29, true)).toBe(-446.29)
    expect(signedCostAmount(-446.29, true)).toBe(-446.29)
    expect(signedCostAmount(10, false)).toBe(10)
  })
})

describe('new lines never block payroll', () => {
  it('a freshly entered (unapproved) line does not stop payroll eligibility', () => {
    const result = derivePayrollEligibility({
      job: {
        id: 'j',
        job_number: '26-9999',
        status: 'complete',
        sale_date: '2026-10-01',
        sale_amount: 1000,
        completed_at: '2026-10-10T00:00:00Z',
      } as never,
      payments: [
        { job_id: 'j', amount_cents: 100000, funding_status: 'cleared', paid_at: '2026-10-11', created_at: '2026-10-11T00:00:00Z' },
      ] as never,
      costs: [
        {
          job_id: 'j',
          amount: 500,
          ...NEW_COST_LINE_PAYROLL_FLAGS,
          created_at: '2026-10-12T00:00:00Z',
          updated_at: '2026-10-12T00:00:00Z',
        },
      ],
    })
    expect(NEW_COST_LINE_PAYROLL_FLAGS).toEqual({ approved: false, deduct_from_commission_base: false })
    expect(result.reason).toBeNull()
  })
})

describe('loadJobCostLedger', () => {
  it('reads live, org-scoped lines and gives every requested job an entry', async () => {
    const { client, calls } = fakeClient([
      { data: [line({ id: 'a', job_id: 'job-1', amount: 10, vendor: { name: 'QXO' }, source: 'manual' })] },
    ])
    const ledger = await loadJobCostLedger(client, 'org-1', ['job-1', 'job-2', 'job-1'])
    expect(ledger.get('job-1')?.summary.total).toBe(10)
    expect(ledger.get('job-1')?.lines[0].vendor_name).toBe('QXO')
    expect(ledger.get('job-1')?.lines[0].source).toBe('manual')
    expect(ledger.get('job-2')?.summary).toEqual(EMPTY_JOB_COST_SUMMARY)
    const q = calls[0]
    expect(q).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['org_id', 'org-1'] },
        { method: 'eq', args: ['status', 'active'] },
        { method: 'is', args: ['deleted_at', null] },
      ])
    )
  })

  it('pages past 1,000 rows instead of silently truncating', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => line({ id: `p1-${i}`, amount: 1 }))
    const page2 = [line({ id: 'p2-0', amount: 1 })]
    const { client, calls } = fakeClient([{ data: page1 }, { data: page2 }])
    const ledger = await loadJobCostLedger(client, 'org-1', ['job-1'])
    expect(ledger.get('job-1')?.summary.total).toBe(1001)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContainEqual({ method: 'range', args: [1000, 1999] })
  })

  it('chunks large job id lists', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `job-${i}`)
    const { client, calls } = fakeClient([{ data: [] }, { data: [] }, { data: [] }])
    const ledger = await loadJobCostLedger(client, 'org-1', ids)
    expect(calls).toHaveLength(3)
    expect(ledger.size).toBe(450)
  })

  it('throws on a read error (a silent empty ledger would read as $0 cost)', async () => {
    const { client } = fakeClient([{ data: null, error: { message: 'boom' } }])
    await expect(loadJobCostLedger(client, 'org-1', ['job-1'])).rejects.toEqual({ message: 'boom' })
  })
})

describe('enrichJobsWithCostLedger', () => {
  it('attaches the summary, and null (never $0) when the read fails', async () => {
    const ok = fakeClient([{ data: [line({ amount: 25 })] }])
    const jobs: Array<{ id: string } & Record<string, unknown>> = [{ id: 'job-1' }]
    await enrichJobsWithCostLedger(ok.client, 'org-1', jobs)
    expect((jobs[0].job_costs as { total: number }).total).toBe(25)

    const bad = fakeClient([{ data: null, error: { message: 'down' } }])
    const jobs2: Array<{ id: string } & Record<string, unknown>> = [{ id: 'job-1' }]
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await enrichJobsWithCostLedger(bad.client, 'org-1', jobs2)
    spy.mockRestore()
    expect(jobs2[0].job_costs).toBeNull()
  })
})

describe('resolveVendorId (supplier is a reportable field)', () => {
  it('returns null for a blank supplier', async () => {
    const { client } = fakeClient([])
    expect(await resolveVendorId(client, 'org-1', '  ', 'u1')).toBeNull()
  })
  it('reuses an existing vendor (case-insensitive) in the same org', async () => {
    const { client, calls } = fakeClient([{ data: [{ id: 'v1', name: 'QXO' }] }])
    expect(await resolveVendorId(client, 'org-1', 'qxo', 'u1')).toBe('v1')
    expect(calls[0]).toContainEqual({ method: 'eq', args: ['org_id', 'org-1'] })
  })
  it('creates the vendor on first use', async () => {
    const { client, calls } = fakeClient([{ data: [] }, { data: { id: 'v2' } as never }])
    expect(await resolveVendorId(client, 'org-1', 'Gutter  Guy', 'u1')).toBe('v2')
    expect(calls[1]).toContainEqual({
      method: 'insert',
      args: [{ org_id: 'org-1', name: 'Gutter Guy', active: true, created_by: 'u1' }],
    })
  })
})

describe('goals economics reads the same ledger', () => {
  it('counts ledger + dealer fee once, and flags jobs with no cost lines', () => {
    const jobs = [
      { id: 'a', sale_amount: 10000, sale_date: '2026-10-01', created_at: '2026-10-01', dealer_fee_amount: 500 },
      { id: 'b', sale_amount: 5000, sale_date: '2026-10-02', created_at: '2026-10-02', dealer_fee_amount: null },
    ]
    const costs = new Map([
      ['a', summarizeJobCostLines([
        { description: 'Materials', amount: 3000, cost_type: 'material' },
        { description: DEALER_FEE_COST_LINE_DESCRIPTION, amount: 500, cost_type: 'misc' },
      ])],
    ])
    const s = summarizeJobEconomics(jobs, costs)
    expect(s.jobsMissingCostData).toBe(1)
    // 3000 materials + 500 dealer fee (once) + commissions
    expect(s.totalCosts - s.totalCommissions).toBe(3500)
  })
})
