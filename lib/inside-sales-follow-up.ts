type RoleLike = {
  role?: string | null
  customRoleName?: string | null
  customRoleDisplayName?: string | null
}

type OpportunityLike = {
  status?: string | null
  inspection_outcome?: string | null
  pipeline_stage?: string | null
}

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

export function hasActiveDidntSitFollowUp(opportunity: OpportunityLike) {
  const status = normalize(opportunity.status)
  if (status === 'won' || status === 'lost') return false

  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage === 'inside_sales_didnt_sit') return true

  return normalize(opportunity.inspection_outcome) === 'not_home'
}

export function getDidntSitFollowUpStatus(opportunity: OpportunityLike) {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (pipelineStage === 'inside_sales_didnt_sit') return 'new'
  if (normalize(opportunity.inspection_outcome) === 'not_home') return 'new'
  return null
}
