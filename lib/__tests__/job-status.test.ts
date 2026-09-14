import {
  CANCELLED_JOB_STATUS,
  JOB_CANCELLATION_REASONS,
  JOB_STATUSES,
  isJobCancellationReason,
  jobCancellationReasonLabel,
  projectStatusForJobStatus,
  projectStatusLabelForJobStatus,
} from '@/lib/job-status'

describe('job status', () => {
  it('matches the production_jobs_status_check constraint', () => {
    expect([...JOB_STATUSES].sort()).toEqual(
      ['sold', 'materials', 'scheduled', 'in_progress', 'complete', 'collected', 'on_hold', 'cancelled'].sort()
    )
    expect(JOB_STATUSES).toContain(CANCELLED_JOB_STATUS)
  })

  it('maps a cancelled job to a cancelled project, not in progress', () => {
    expect(projectStatusForJobStatus('cancelled')).toBe('cancelled')
    expect(projectStatusLabelForJobStatus('cancelled')).toBe('cancelled')
  })

  it('keeps the existing mappings the four old copies agreed on', () => {
    expect(projectStatusForJobStatus('collected')).toBe('collected')
    expect(projectStatusForJobStatus('complete')).toBe('complete')
    expect(projectStatusForJobStatus('on_hold')).toBe('on_hold')
    for (const s of ['sold', 'materials', 'scheduled', 'in_progress']) {
      expect(projectStatusForJobStatus(s)).toBe('in_progress')
    }
    expect(projectStatusLabelForJobStatus('on_hold')).toBe('on hold')
    expect(projectStatusLabelForJobStatus('sold')).toBe('in progress')
  })

  it('matches the production_jobs_cancellation_reason_check constraint', () => {
    expect(Object.keys(JOB_CANCELLATION_REASONS).sort()).toEqual(
      ['credit_fail', 'customer_backed_out', 'insurance_denied', 'other'].sort()
    )
  })

  it('only accepts known reason codes', () => {
    expect(isJobCancellationReason('credit_fail')).toBe(true)
    expect(isJobCancellationReason('Credit / financing declined')).toBe(false)
    expect(isJobCancellationReason('toString')).toBe(false)
    expect(isJobCancellationReason(null)).toBe(false)
    expect(jobCancellationReasonLabel('credit_fail')).toBe('Credit / financing declined')
    expect(jobCancellationReasonLabel(null)).toBe('No reason recorded')
  })
})
