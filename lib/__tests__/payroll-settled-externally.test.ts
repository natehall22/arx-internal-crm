import { materializePayrollPeriod } from '@/lib/payroll-period-materialization'

/** Jobs settled outside the CRM before cutover must never reach the payroll calculation. */
it('materialization only considers jobs NOT settled externally', async () => {
  const isCalls: Array<[string, unknown]> = []
  const jobsChain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'lte', 'in']) jobsChain[m] = () => jobsChain
  jobsChain.is = (col: string, val: unknown) => {
    isCalls.push([col, val])
    return jobsChain
  }
  jobsChain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  const periodChain = { select: () => periodChain, eq: () => periodChain, maybeSingle: async () => ({ data: { id: 'p', cutoff_at: '2026-10-29T03:59:59Z', scheduled_pay_date: '2026-10-30', status: 'open' }, error: null }) }
  const client = { from: (t: string) => (t === 'payroll_periods' ? periodChain : jobsChain) } as never
  const res = await materializePayrollPeriod(client, { orgId: 'o', periodId: 'p', actorUserId: 'a' })
  expect(isCalls).toContainEqual(['payroll_settled_externally_at', null])
  expect(res.eligibleJobs).toBe(0)
})
