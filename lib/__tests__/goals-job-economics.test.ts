/** @jest-environment node */
/** A job payroll can't price is "missing", not $0 commission: it stays out of the profit totals and is counted. */
import { summarizeJobEconomics } from '@/lib/goals-job-economics'
import { EMPTY_JOB_COST_SUMMARY } from '@/lib/job-cost-ledger'

const job = (id: string, sale: number) => ({ id, sale_amount: sale, sale_date: '2026-11-01', created_at: '2026-11-01T00:00:00Z' })

describe('summarizeJobEconomics', () => {
  it('leaves unpriced jobs out of every total and counts them', () => {
    const costs = new Map([['a', { ...EMPTY_JOB_COST_SUMMARY, lineCount: 1 }]])
    const s = summarizeJobEconomics([job('a', 10000), job('b', 20000)], costs as never, new Map([['a', { cents: 1800 }], ['b', null]]))
    expect(s.totalSale).toBe(10000)
    expect(s.totalCommissions).toBe(18)
    expect(s.jobsMissingCommission).toBe(1)
    expect(s.jobsInMonth).toBe(2)
    expect(s.netProfit).toBe(9982)
  })

  it('no commission map at all: nothing is invented, everything is "not priced"', () => {
    const s = summarizeJobEconomics([job('a', 10000)], new Map())
    expect(s).toMatchObject({ totalSale: 0, totalCommissions: 0, netProfit: 0, jobsMissingCommission: 1 })
  })
})
