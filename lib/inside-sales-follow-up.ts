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

function hasGraceWindowExpired(value: string | null | undefined) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return false
  return timestamp <= Date.now() - INSURANCE_FOLLOW_UP_GRACE_DAYS * 24 * 60 * 60 * 1000
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

export function hasRepWorkingInsuranceFollowUp(opportunity: OpportunityLike) {
  const status = normalize(opportunity.status)
  if (status === 'won' || status === 'lost') return false
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage === REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) return true
  return (
    normalize(opportunity.inspection_outcome) === 'insurance_follow_up' &&
    !pipelineStage &&
    !hasGraceWindowExpired(opportunity.inspection_outcome_at)
  )
}

export function getInsideSalesFollowUpKind(opportunity: OpportunityLike): 'didnt_sit' | 'insurance' | null {
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
    (normalize(opportunity.inspection_outcome) === 'insurance_follow_up' &&
      !pipelineStage &&
      hasGraceWindowExpired(opportunity.inspection_outcome_at))
  ) {
    return 'insurance'
  }
  return null
}

export function hasActiveInsideSalesFollowUp(opportunity: OpportunityLike) {
  const status = normalize(opportunity.status)
  if (status === 'won' || status === 'lost') return false

  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (RESOLVED_DIDNT_SIT_STAGES.has(pipelineStage)) return false
  if (RESOLVED_INSURANCE_FOLLOW_UP_STAGES.has(pipelineStage)) return false
  if (pipelineStage === DIDNT_SIT_PIPELINE_PREFIX) return true
  if (pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`)) return true
  if (pipelineStage === INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) return true
  if (pipelineStage.startsWith(`${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_`)) return true

  const outcome = normalize(opportunity.inspection_outcome)
  return outcome === 'not_home' || (outcome === 'insurance_follow_up' && !pipelineStage && hasGraceWindowExpired(opportunity.inspection_outcome_at))
}

export function hasActiveDidntSitFollowUp(opportunity: OpportunityLike) {
  return hasActiveInsideSalesFollowUp(opportunity) && getInsideSalesFollowUpKind(opportunity) === 'didnt_sit'
}

export function getInsideSalesFollowUpStatus(opportunity: OpportunityLike) {
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
    return 'rep_working'
  }
  const outcome = normalize(opportunity.inspection_outcome)
  if (outcome === 'not_home') return 'new'
  if (outcome === 'insurance_follow_up' && !pipelineStage) {
    return hasGraceWindowExpired(opportunity.inspection_outcome_at) ? 'new' : 'rep_working'
  }
  return null
}

export function getDidntSitFollowUpStatus(opportunity: OpportunityLike) {
  return getInsideSalesFollowUpKind(opportunity) === 'didnt_sit'
    ? getInsideSalesFollowUpStatus(opportunity)
    : null
}
