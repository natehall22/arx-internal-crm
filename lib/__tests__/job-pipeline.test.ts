import {
  depositMilestoneMet,
  getJobPipelineCurrentStage,
  type JobPipelineInput,
} from '@/lib/job-pipeline'

const base: JobPipelineInput = {
  status: 'sold',
  scheduled_date: null,
  started_at: null,
  completed_at: null,
  sale_amount: 26792,
  deposit: 0,
  deposit_required_percent: 10,
}

describe('getJobPipelineCurrentStage', () => {
  /**
   * The regression this file exists for. `depositMilestoneMet` is true for any
   * job whose status is not 'sold', so a scheduled job used to resolve to the
   * first OUTSTANDING stage — "In Progress" — and render "Now: In Progress"
   * directly beneath a status badge reading "Scheduled".
   */
  it('says Scheduled for a scheduled job, matching its status badge', () => {
    expect(
      getJobPipelineCurrentStage({ ...base, status: 'scheduled', scheduled_date: '2026-09-10' })
    ).toBe('Scheduled')
  })

  it('says Sold for a sold job with no deposit yet', () => {
    expect(getJobPipelineCurrentStage(base)).toBe('Sold')
  })

  it('advances to Deposit once the required deposit is collected', () => {
    expect(getJobPipelineCurrentStage({ ...base, deposit: 2680 })).toBe('Deposit')
  })

  it('says In Progress only once the job has actually started', () => {
    expect(
      getJobPipelineCurrentStage({
        ...base,
        status: 'in_progress',
        scheduled_date: '2026-09-10',
        started_at: '2026-09-10T11:00:00Z',
      })
    ).toBe('In Progress')
  })

  it('says Complete for complete and collected jobs', () => {
    const done = { ...base, status: 'complete', scheduled_date: '2026-09-10', completed_at: '2026-09-11T18:00:00Z' }
    expect(getJobPipelineCurrentStage(done)).toBe('Complete')
    expect(getJobPipelineCurrentStage({ ...done, status: 'collected' })).toBe('Complete')
  })

  it('never reports a stage ahead of the job — a scheduled job is not In Progress', () => {
    // Guards the whole class of bug: the stage shown must never be one the job
    // has not reached, for any status the board can produce.
    for (const status of ['sold', 'materials', 'scheduled']) {
      const stage = getJobPipelineCurrentStage({ ...base, status, scheduled_date: '2026-09-10', deposit: 2680 })
      expect(['Sold', 'Deposit', 'Scheduled']).toContain(stage)
    }
  })
})

describe('depositMilestoneMet', () => {
  it('gates only jobs still in sold', () => {
    expect(depositMilestoneMet(base)).toBe(false)
    expect(depositMilestoneMet({ ...base, status: 'materials' })).toBe(true)
  })

  it('accepts any deposit when no percentage is required', () => {
    expect(depositMilestoneMet({ ...base, deposit_required_percent: null, deposit: 1 })).toBe(true)
    expect(depositMilestoneMet({ ...base, deposit_required_percent: null, deposit: 0 })).toBe(false)
  })

  it('treats a job with no sale amount as not gated', () => {
    expect(depositMilestoneMet({ ...base, sale_amount: 0 })).toBe(true)
  })
})
