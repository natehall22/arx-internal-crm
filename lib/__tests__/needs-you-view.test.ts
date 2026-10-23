import type { DataHealthReport, HealthProblem, JobHealth } from '@/lib/data-health'
import { buildNeedsView, TOP_N } from '@/lib/needs-you-view'

const prob = (code: HealthProblem['code'], area: HealthProblem['area'], blocksPay = false): HealthProblem => ({ code, area, message: code, fixLabel: 'Fix', fixHref: '/x', blocksPay })
const job = (n: string, status: string, problems: HealthProblem[]): JobHealth => ({ kind: 'job', jobId: `id-${n}`, jobNumber: n, status, addressText: null, problems })

const report = (jobs: JobHealth[], extra: Partial<DataHealthReport> = {}): DataHealthReport => ({ generatedAt: 'x', jobs, appointments: [], count: jobs.length, ...extra })

describe('Needs you layout', () => {
  it('one card per job with ALL its issues; holds-pay on an OPEN job first, then holds-pay on closed, then the rest', () => {
    const v = buildNeedsView(
      report([
        job('26-0003', 'collected', [prob('collected_but_short', 'money', true)]), // closed, holds pay
        job('26-0001', 'complete', [prob('materials_not_ordered', 'ops')]), // no hold
        job('26-0002', 'in_progress', [prob('no_signed_contract', 'money', true), prob('missing_commission_base', 'money', true)]), // open + holds
      ]),
      'all'
    )
    expect(v.jobs.map((c) => c.job.jobNumber)).toEqual(['26-0002', '26-0003', '26-0001'])
    expect(v.jobs[0].job.problems).toHaveLength(2) // both issues on ONE card
    expect(v.jobs[0].openHolds).toBe(true)
    expect(v.jobs[1].openHolds).toBe(false)
  })

  it('filters by type: Money (money + sale credit) / Ops (ops + appointments); cards drop out when none of their issues match', () => {
    const r = report(
      [job('26-0001', 'complete', [prob('no_setter', 'credit', true), prob('materials_not_ordered', 'ops')]), job('26-0002', 'complete', [prob('permit_pending', 'ops')])],
      {
        appointments: [{ kind: 'appointment', appointmentId: 'a', scheduledFor: 'x', appointmentType: 'inspection', addressText: null, problems: [prob('appointment_no_outcome', 'sales')] }],
        payPlans: [{ role: 'sales_rep', roleLabel: 'Closer', people: [{ id: 'u', name: 'Cam' }], suggestion: null }],
        count: 4,
      }
    )
    const money = buildNeedsView(r, 'money')
    expect(money.jobs.map((c) => c.job.jobNumber)).toEqual(['26-0001'])
    expect(money.jobs[0].job.problems.map((p) => p.code)).toEqual(['no_setter'])
    expect(money.plans).toHaveLength(1)
    expect(money.appointments).toHaveLength(0)
    const ops = buildNeedsView(r, 'ops')
    expect(ops.jobs.map((c) => c.job.jobNumber).sort()).toEqual(['26-0001', '26-0002'])
    expect(ops.plans).toHaveLength(0)
    expect(ops.appointments).toHaveLength(1)
    expect(buildNeedsView(r, 'all').counts).toEqual({ all: 4, money: 2, ops: 3 })
  })

  it('numbers sort naturally and the top-N cut is the component\'s (view returns everything)', () => {
    const many = Array.from({ length: 25 }, (_, i) => job(`26-${String(i + 1).padStart(4, '0')}`, 'complete', [prob('materials_not_ordered', 'ops')]))
    const v = buildNeedsView(report(many), 'all')
    expect(v.jobs).toHaveLength(25)
    expect(v.jobs.slice(0, TOP_N).map((c) => c.job.jobNumber)[0]).toBe('26-0001')
    expect(TOP_N).toBe(10)
  })
})
