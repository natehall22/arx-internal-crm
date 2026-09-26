import { isJobPastDue, jobStatusConfig, paymentStatusChip, resumeStatusForJob } from '@/lib/ops-job-status'

describe('jobStatusConfig', () => {
  it('has a label for on_hold (the /ops list used to crash on it)', () => {
    expect(jobStatusConfig('on_hold').label).toBe('On Hold')
  })

  it('shows an unknown status as itself instead of mislabelling it', () => {
    expect(jobStatusConfig('waiting_on_hoa').label).toBe('waiting on hoa')
    expect(jobStatusConfig(null).label).toBe('Unknown')
  })
})

describe('isJobPastDue', () => {
  const past = '2020-01-01'
  it('flags an open job whose install date has passed', () => {
    expect(isJobPastDue({ scheduled_date: past, status: 'scheduled' })).toBe(true)
  })
  it('never flags a paused, complete, or collected job', () => {
    expect(isJobPastDue({ scheduled_date: past, status: 'on_hold' })).toBe(false)
    expect(isJobPastDue({ scheduled_date: past, status: 'complete' })).toBe(false)
    expect(isJobPastDue({ scheduled_date: past, status: 'collected' })).toBe(false)
  })
  it('does not flag an unscheduled job', () => {
    expect(isJobPastDue({ scheduled_date: null, status: 'sold' })).toBe(false)
  })
})

describe('paymentStatusChip', () => {
  it('reads collected cents against the sale amount', () => {
    expect(paymentStatusChip({ sale_amount: 100, collected_cents: 10000 })?.label).toBe('Paid in full')
    expect(paymentStatusChip({ sale_amount: 100, collected_cents: 1 })?.label).toBe('Partially paid')
    expect(paymentStatusChip({ sale_amount: 100, collected_cents: 0 })?.label).toBe('Unpaid')
    expect(paymentStatusChip({ sale_amount: 0, collected_cents: 0 })).toBeNull()
  })
})

describe('resumeStatusForJob', () => {
  const base = { started_at: null, scheduled_date: null, materials_status: 'not_ordered' }
  it('sends an untouched job back to Sold', () => {
    expect(resumeStatusForJob(base)).toBe('sold')
  })
  it('uses the furthest point the job actually reached', () => {
    expect(resumeStatusForJob({ ...base, materials_status: 'ordered' })).toBe('materials')
    expect(resumeStatusForJob({ ...base, materials_status: 'ordered', scheduled_date: '2026-10-01' })).toBe('scheduled')
    expect(
      resumeStatusForJob({ ...base, scheduled_date: '2026-10-01', started_at: '2026-10-01T12:00:00Z' })
    ).toBe('in_progress')
  })
})
