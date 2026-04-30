import {
  getInspectionOutcomeInsideSalesHandoff,
  normalizeInspectionOutcomeId,
  normalizeInspectionOutcomeRows,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'

type RoleLike = {
  role?: string | null
  customRoleName?: string | null
  customRoleDisplayName?: string | null
}

type OpportunityLike = {
  status?: string | null
  inspection_outcome?: string | null
  inspection_outcome_at?: string | null
  pipeline_stage?: string | null
  follow_up_at?: string | null
}

/** Org `settings.inspection_outcomes` — drives delayed inside-sales handoff delays per outcome (Admin → Inspection outcomes). */
export type OrgInspectionOutcomesArg = InspectionOutcomeConfigRow[] | null | undefined

export const DIDNT_SIT_PIPELINE_PREFIX = 'inside_sales_didnt_sit'
export const INSURANCE_FOLLOW_UP_PIPELINE_PREFIX = 'inside_sales_insurance_follow_up'
export const REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX = 'rep_working_insurance_follow_up'
export const INSURANCE_FOLLOW_UP_GRACE_DAYS = 7
const RESOLVED_DIDNT_SIT_STAGES = new Set([
  `${DIDNT_SIT_PIPELINE_PREFIX}_rescheduled`,
  `${DIDNT_SIT_PIPELINE_PREFIX}_unresponsive`,
  `${DIDNT_SIT_PIPELINE_PREFIX}_lost`,
])
const RESOLVED_INSURANCE_FOLLOW_UP_STAGES = new Set([
  `${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_scheduled`,
  `${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_unresponsive`,
  `${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_lost`,
])

const MANAGER_ROLES = new Set([
  'admin',
  'owner',
  'sales_manager',
  'regional_manager',
  'setter_manager',
  'regional_setter_manager',
])

function normalize(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

function inspectionRows(orgInspectionOutcomes?: OrgInspectionOutcomesArg) {
  return normalizeInspectionOutcomeRows(orgInspectionOutcomes)
}

/** Empty pipeline + admin-configured delayed handoff past due (matches promote-insurance-follow-ups empty-pipeline branch). */
function delayedHandoffPastDueEmptyPipeline(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage) return false
  const oid = normalizeInspectionOutcomeId(opportunity.inspection_outcome)
  if (!oid || oid === 'not_home') return false
  const handoff = getInspectionOutcomeInsideSalesHandoff(inspectionRows(orgInspectionOutcomes), oid)
  if (!handoff.enabled || handoff.delayDays === null) return false
  if (!opportunity.inspection_outcome_at) return false
  const cutoff = Date.now() - handoff.delayDays * 24 * 60 * 60 * 1000
  return new Date(opportunity.inspection_outcome_at).getTime() <= cutoff
}

function delayedHandoffStillGraceEmptyPipeline(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage) return false
  const oid = normalizeInspectionOutcomeId(opportunity.inspection_outcome)
  if (!oid || oid === 'not_home') return false
  const handoff = getInspectionOutcomeInsideSalesHandoff(inspectionRows(orgInspectionOutcomes), oid)
  if (!handoff.enabled || handoff.delayDays === null) return false
  if (!opportunity.inspection_outcome_at) return false
  const cutoff = Date.now() - handoff.delayDays * 24 * 60 * 60 * 1000
  return new Date(opportunity.inspection_outcome_at).getTime() > cutoff
}

/** Rep-working stage timed out — queue aligns with cron promote-insurance-follow-ups when follow_up_at missing uses configured delay days. */
function repWorkingInsuranceQueueEligible(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage !== REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) return false
  const fu = opportunity.follow_up_at
  const handoff = getInspectionOutcomeInsideSalesHandoff(
    inspectionRows(orgInspectionOutcomes),
    opportunity.inspection_outcome
  )
  const delayDays =
    handoff.enabled && handoff.delayDays !== null ? handoff.delayDays : INSURANCE_FOLLOW_UP_GRACE_DAYS
  if (fu) {
    const t = new Date(fu).getTime()
    return Number.isFinite(t) && t <= Date.now()
  }
  if (!opportunity.inspection_outcome_at) return false
  const cutoff = Date.now() - delayDays * 24 * 60 * 60 * 1000
  return new Date(opportunity.inspection_outcome_at).getTime() <= cutoff
}

export function isInsideSalesRoleLike(roleLike: RoleLike) {
  const role = normalize(roleLike.role)
  if (role === 'inside_sales' || role === 'inside sales') return true

  const haystacks = [
    normalize(roleLike.customRoleName),
    normalize(roleLike.customRoleDisplayName),
  ]

  return haystacks.some((value) => value.includes('inside sales') || value.includes('inside_sales'))
}

export function canViewInsideSalesFollowUp(roleLike: RoleLike) {
  return MANAGER_ROLES.has(normalize(roleLike.role)) || isInsideSalesRoleLike(roleLike)
}

export function hasRepWorkingInsuranceFollowUp(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
) {
  const status = normalize(opportunity.status)
  if (status === 'won' || status === 'lost') return false
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage === REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) return true
  return delayedHandoffStillGraceEmptyPipeline(opportunity, orgInspectionOutcomes)
}

export function getInsideSalesFollowUpKind(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): 'didnt_sit' | 'insurance' | null {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (
    pipelineStage === DIDNT_SIT_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`) ||
    normalize(opportunity.inspection_outcome) === 'not_home'
  ) {
    return 'didnt_sit'
  }
  if (
    pipelineStage === INSURANCE_FOLLOW_UP_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_`) ||
    repWorkingInsuranceQueueEligible(opportunity, orgInspectionOutcomes) ||
    delayedHandoffPastDueEmptyPipeline(opportunity, orgInspectionOutcomes)
  ) {
    return 'insurance'
  }
  return null
}

export function hasActiveInsideSalesFollowUp(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
) {
  const status = normalize(opportunity.status)
  if (status === 'won' || status === 'lost') return false

  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (RESOLVED_DIDNT_SIT_STAGES.has(pipelineStage)) return false
  if (RESOLVED_INSURANCE_FOLLOW_UP_STAGES.has(pipelineStage)) return false
  if (pipelineStage === DIDNT_SIT_PIPELINE_PREFIX) return true
  if (pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`)) return true
  if (pipelineStage === INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) return true
  if (pipelineStage.startsWith(`${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_`)) return true

  if (repWorkingInsuranceQueueEligible(opportunity, orgInspectionOutcomes)) return true

  const outcome = normalize(opportunity.inspection_outcome)
  return outcome === 'not_home' || delayedHandoffPastDueEmptyPipeline(opportunity, orgInspectionOutcomes)
}

export function pipelineStageForInsideSalesClaim(opportunity: OpportunityLike, pipelinePrefix: string) {
  const n = normalize(opportunity.pipeline_stage)
  if (n === REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) {
    return pipelinePrefix
  }
  return opportunity.pipeline_stage || pipelinePrefix
}

export function hasActiveDidntSitFollowUp(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
) {
  return (
    hasActiveInsideSalesFollowUp(opportunity, orgInspectionOutcomes) &&
    getInsideSalesFollowUpKind(opportunity, orgInspectionOutcomes) === 'didnt_sit'
  )
}

export function getInsideSalesFollowUpStatus(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
) {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage === DIDNT_SIT_PIPELINE_PREFIX) return 'new'
  if (pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`)) {
    return pipelineStage.slice(`${DIDNT_SIT_PIPELINE_PREFIX}_`.length) || 'new'
  }
  if (pipelineStage === INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) return 'new'
  if (pipelineStage.startsWith(`${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_`)) {
    return pipelineStage.slice(`${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_`.length) || 'new'
  }
  if (pipelineStage === REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) {
    return repWorkingInsuranceQueueEligible(opportunity, orgInspectionOutcomes) ? 'new' : 'rep_working'
  }
  const outcome = normalize(opportunity.inspection_outcome)
  if (outcome === 'not_home') return 'new'
  if (delayedHandoffStillGraceEmptyPipeline(opportunity, orgInspectionOutcomes)) return 'rep_working'
  if (delayedHandoffPastDueEmptyPipeline(opportunity, orgInspectionOutcomes)) return 'new'
  return null
}

export function getDidntSitFollowUpStatus(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
) {
  return getInsideSalesFollowUpKind(opportunity, orgInspectionOutcomes) === 'didnt_sit'
    ? getInsideSalesFollowUpStatus(opportunity, orgInspectionOutcomes)
    : null
}
