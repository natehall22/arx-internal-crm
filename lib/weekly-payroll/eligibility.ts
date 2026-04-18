import { getNextWeeklyPayrollCutoffEtAfter } from '@/lib/weekly-payroll/cutoff'

export type WorksheetBucket =
  | 'ready'
  | 'eligible_next'
  | 'blocked'
  | 'needs_review'
  | 'locked'

export type BlockReason =
  | 'not_installed'
  | 'not_funded'
  | 'missing_costs'
  | 'missing_comp_plan'
  | 'unsupported_comp_plan'
  | 'missing_sales_rep'
  | 'after_cutoff'
  | 'blocking_exceptions'

export type JobPayrollWorksheetRow = {
  jobId: string
  jobNumber: string
  bucket: WorksheetBucket
  blockReasons: BlockReason[]
  payrollEligibleAt: string | null
  /** ISO — next Wed 11:59:59 PM ET after `now` (for cutoff comparison UX) */
  nextCutoffAt: string
  /** Whether eligible timestamp is strictly before nextCutoff (would be included if all other gates pass) */
  beforeNextCutoff: boolean | null
}

export type EligibilityInputs = {
  now: Date
  installCompletedAt: Date | null
  jobStatusCompleteOrCollected: boolean
  /** Sum of cleared payment cents vs required contract + change orders (cents) */
  funded: boolean
  fullyFundedAt: Date | null
  /** All blocking cost lines approved */
  costsReady: boolean
  costsReadyAt: Date | null
  hasSalesRep: boolean
  hasCompPlanAssignment: boolean
  compPlanUnsupported: boolean
  /** Job already locked in a payroll snapshot */
  payrollLocked: boolean
  /** Manual / system exceptions (future) */
  hasBlockingExceptions: boolean
}

/**
 * Classify a job row for the weekly worksheet / exception queue.
 * Does not compute dollar amounts — caller supplies booleans and timestamps.
 */
export function classifyWeeklyPayrollJob(input: EligibilityInputs): Omit<
  JobPayrollWorksheetRow,
  'jobId' | 'jobNumber'
> {
  const nextCutoff = getNextWeeklyPayrollCutoffEtAfter(input.now)
  const reasons: BlockReason[] = []

  if (input.payrollLocked) {
    return {
      bucket: 'locked',
      blockReasons: [],
      payrollEligibleAt: null,
      nextCutoffAt: nextCutoff.toISOString(),
      beforeNextCutoff: null,
    }
  }

  const installed = !!(input.installCompletedAt || input.jobStatusCompleteOrCollected)
  if (!installed) reasons.push('not_installed')

  if (!input.funded) reasons.push('not_funded')

  if (!input.costsReady) reasons.push('missing_costs')

  if (!input.hasSalesRep) reasons.push('missing_sales_rep')

  if (!input.hasCompPlanAssignment) reasons.push('missing_comp_plan')
  else if (input.compPlanUnsupported) reasons.push('unsupported_comp_plan')

  if (input.hasBlockingExceptions) reasons.push('blocking_exceptions')

  let payrollEligibleAt: Date | null = null
  if (installed && input.funded && input.costsReady && input.installCompletedAt && input.fullyFundedAt && input.costsReadyAt) {
    payrollEligibleAt = new Date(
      Math.max(
        input.installCompletedAt.getTime(),
        input.fullyFundedAt.getTime(),
        input.costsReadyAt.getTime()
      )
    )
  }

  let beforeNextCutoff: boolean | null = null
  if (payrollEligibleAt) {
    beforeNextCutoff = payrollEligibleAt.getTime() <= nextCutoff.getTime()
    if (!beforeNextCutoff) reasons.push('after_cutoff')
  }

  const hardBlocked =
    !installed ||
    !input.funded ||
    !input.costsReady ||
    !input.hasSalesRep ||
    !input.hasCompPlanAssignment ||
    input.compPlanUnsupported ||
    input.hasBlockingExceptions

  if (hardBlocked) {
    return {
      bucket: 'blocked',
      blockReasons: reasons,
      payrollEligibleAt: payrollEligibleAt?.toISOString() ?? null,
      nextCutoffAt: nextCutoff.toISOString(),
      beforeNextCutoff,
    }
  }

  if (payrollEligibleAt && beforeNextCutoff === false) {
    return {
      bucket: 'eligible_next',
      blockReasons: reasons,
      payrollEligibleAt: payrollEligibleAt.toISOString(),
      nextCutoffAt: nextCutoff.toISOString(),
      beforeNextCutoff: false,
    }
  }

  if (payrollEligibleAt && beforeNextCutoff === true) {
    return {
      bucket: 'ready',
      blockReasons: reasons,
      payrollEligibleAt: payrollEligibleAt.toISOString(),
      nextCutoffAt: nextCutoff.toISOString(),
      beforeNextCutoff: true,
    }
  }

  return {
    bucket: 'needs_review',
    blockReasons: reasons.length ? reasons : ['missing_costs'],
    payrollEligibleAt: payrollEligibleAt?.toISOString() ?? null,
    nextCutoffAt: nextCutoff.toISOString(),
    beforeNextCutoff,
  }
}
