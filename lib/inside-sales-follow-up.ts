import {
  DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
  getInspectionOutcomeInsideSalesHandoff,
  inspectionOutcomeRoutesToInsideSalesDidntSit,
  normalizeInspectionOutcomeId,
  normalizeInspectionOutcomeRows,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'

type RoleLike = {
  role?: string | null
  customRoleName?: string | null
  customRoleDisplayName?: string | null
  /** Effective permission names (custom role, legacy matrix, or user_permissions grants). */
  permissionNames?: Iterable<string> | null
}

/**
 * Default permission bundle for the system "Inside Sales" preset (Admin → Presets).
 * Queue access is granted by {@link hasInsideSalesQueuePermissionGrant} — no separate permission name.
 */
export const INSIDE_SALES_PRESET_PERMISSION_NAMES = [
  'leads:view',
  'leads:create',
  'leads:edit',
  'leads:view_inbound',
  'leads:claim_inbound',
  'opportunities:view',
  'opportunities:edit',
  'scheduling:view',
  'scheduling:create',
] as const

/** Sort weight for preset card tags — surfaces queue-critical permissions first. */
export const INSIDE_SALES_PRESET_DISPLAY_PRIORITY: Record<string, number> = {
  'leads:view': 10,
  'leads:claim_inbound': 20,
  'leads:view_inbound': 30,
  'opportunities:view': 40,
  'opportunities:edit': 50,
  'scheduling:view': 60,
  'scheduling:create': 70,
  'leads:create': 80,
  'leads:edit': 90,
}

/**
 * Permission signature for the default "Inside Sales" preset (inbound claim + opportunities).
 * Regional/ops roles use `leads:manage_inbound`, not `leads:claim_inbound`.
 */
export function hasInsideSalesQueuePermissionGrant(permissionNames: Iterable<string>): boolean {
  const names = new Set(permissionNames)
  return names.has('opportunities:view') && names.has('leads:claim_inbound')
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

/** Queue bucket: legacy `inside_sales_didnt_sit*` pipeline vs admin “auto-send to inside sales” (`inside_sales_handoff_*`) paths vs closer knockback. */
export type InsideSalesQueueKind = 'didnt_sit' | 'handoff' | 'knockback'

export const DIDNT_SIT_PIPELINE_PREFIX = 'inside_sales_didnt_sit'

/**
 * Legacy DB value — used for all admin-configured delayed handoffs, not only insurance.
 * Do not change without migrating `opportunities.pipeline_stage`.
 */
export const HANDOFF_INSIDE_SALES_PIPELINE_PREFIX = 'inside_sales_insurance_follow_up'

/**
 * Legacy DB value — rep grace period before inside-sales queue.
 */
export const REP_WORKING_HANDOFF_PIPELINE_PREFIX = 'rep_working_insurance_follow_up'

export const KNOCKBACK_PIPELINE_PREFIX = 'inside_sales_knockback'

/** @deprecated Use HANDOFF_INSIDE_SALES_PIPELINE_PREFIX */
export const INSURANCE_FOLLOW_UP_PIPELINE_PREFIX = HANDOFF_INSIDE_SALES_PIPELINE_PREFIX

/** @deprecated Use REP_WORKING_HANDOFF_PIPELINE_PREFIX */
export const REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX = REP_WORKING_HANDOFF_PIPELINE_PREFIX

/** @deprecated Use DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS from `@/lib/inspection-outcomes` */
export const INSURANCE_FOLLOW_UP_GRACE_DAYS = DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS

const RESOLVED_DIDNT_SIT_STAGES = new Set([
  `${DIDNT_SIT_PIPELINE_PREFIX}_rescheduled`,
  `${DIDNT_SIT_PIPELINE_PREFIX}_unresponsive`,
  `${DIDNT_SIT_PIPELINE_PREFIX}_lost`,
])
const RESOLVED_HANDOFF_PIPELINE_STAGES = new Set([
  `${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_scheduled`,
  `${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_unresponsive`,
  `${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_lost`,
])
const RESOLVED_KNOCKBACK_STAGES = new Set([
  `${KNOCKBACK_PIPELINE_PREFIX}_rescheduled`,
  `${KNOCKBACK_PIPELINE_PREFIX}_unresponsive`,
  `${KNOCKBACK_PIPELINE_PREFIX}_lost`,
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

function onRepWorkingInsurancePipeline(pipelineStage: string): boolean {
  return (
    pipelineStage === REP_WORKING_HANDOFF_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${REP_WORKING_HANDOFF_PIPELINE_PREFIX}_`)
  )
}

function isResolvedInsideSalesPipelineStage(pipelineStage: string): boolean {
  return (
    RESOLVED_DIDNT_SIT_STAGES.has(pipelineStage) ||
    RESOLVED_HANDOFF_PIPELINE_STAGES.has(pipelineStage) ||
    RESOLVED_KNOCKBACK_STAGES.has(pipelineStage)
  )
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
  if (!oid) return false
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
  if (!oid) return false
  const handoff = getInspectionOutcomeInsideSalesHandoff(inspectionRows(orgInspectionOutcomes), oid)
  if (!handoff.enabled || handoff.delayDays === null) return false
  if (!opportunity.inspection_outcome_at) return false
  const cutoff = Date.now() - handoff.delayDays * 24 * 60 * 60 * 1000
  return new Date(opportunity.inspection_outcome_at).getTime() > cutoff
}

function latestHandoffEligibleAtMs(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): number | null {
  const oid = normalizeInspectionOutcomeId(opportunity.inspection_outcome)
  if (!oid || !opportunity.inspection_outcome_at) return null
  const handoff = getInspectionOutcomeInsideSalesHandoff(inspectionRows(orgInspectionOutcomes), oid)
  if (!handoff.enabled || handoff.delayDays === null) return null
  const outcomeMs = new Date(opportunity.inspection_outcome_at).getTime()
  if (!Number.isFinite(outcomeMs)) return null
  return outcomeMs + handoff.delayDays * 24 * 60 * 60 * 1000
}

/** True when this opportunity’s inspection outcome has Admin → Auto-send to Inside Sales enabled. */
function inspectionOutcomeHasInsideSalesHandoff(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  return getInspectionOutcomeInsideSalesHandoff(
    inspectionRows(orgInspectionOutcomes),
    opportunity.inspection_outcome
  ).enabled
}

/**
 * Historical imports / pre-pipeline rows: outcome has admin inside-sales handoff but `pipeline_stage` was never
 * set to rep_working or inside_sales_* (any non-empty unknown stage).
 */
function legacyPipelineInsideSalesHandoffVisible(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  if (!inspectionOutcomeHasInsideSalesHandoff(opportunity, orgInspectionOutcomes)) return false
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (!pipelineStage) return false
  if (pipelineStage === DIDNT_SIT_PIPELINE_PREFIX || pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`)) {
    return false
  }
  if (
    pipelineStage === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`)
  ) {
    return false
  }
  if (onRepWorkingInsurancePipeline(pipelineStage)) return false
  if (pipelineStage === KNOCKBACK_PIPELINE_PREFIX || pipelineStage.startsWith(`${KNOCKBACK_PIPELINE_PREFIX}_`)) {
    return false
  }
  if (RESOLVED_DIDNT_SIT_STAGES.has(pipelineStage)) return false
  if (RESOLVED_HANDOFF_PIPELINE_STAGES.has(pipelineStage)) return false
  const eligibleAtMs = latestHandoffEligibleAtMs(opportunity, orgInspectionOutcomes)
  return eligibleAtMs !== null && Date.now() >= eligibleAtMs
}

/** Rep-working stage timed out — uses admin delay for this inspection outcome when present. */
function repWorkingHandoffQueueEligible(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  const onRepWorking = onRepWorkingInsurancePipeline(pipelineStage)
  if (!onRepWorking) return false
  const fu = opportunity.follow_up_at
  if (fu) {
    const t = new Date(fu).getTime()
    return Number.isFinite(t) && t <= Date.now()
  }
  const handoff = getInspectionOutcomeInsideSalesHandoff(
    inspectionRows(orgInspectionOutcomes),
    opportunity.inspection_outcome
  )
  if (!handoff.enabled || handoff.delayDays === null) return false
  const delayDays = handoff.delayDays
  if (!opportunity.inspection_outcome_at) return false
  const cutoff = Date.now() - delayDays * 24 * 60 * 60 * 1000
  return new Date(opportunity.inspection_outcome_at).getTime() <= cutoff
}

export function isInsideSalesRoleLike(roleLike: RoleLike) {
  const role = normalize(roleLike.role)
  // Managers always use the list/manager UI — never the one-lead rep conveyor.
  if (MANAGER_ROLES.has(role)) return false

  if (role === 'inside_sales' || role === 'inside sales' || role === 'call_center') return true

  const haystacks = [
    normalize(roleLike.customRoleName),
    normalize(roleLike.customRoleDisplayName),
  ]

  if (haystacks.some((value) => value.includes('inside sales') || value.includes('inside_sales'))) {
    return true
  }

  if (roleLike.permissionNames && hasInsideSalesQueuePermissionGrant(roleLike.permissionNames)) {
    return true
  }

  return false
}

/** Narrow /api/leads list to owned + queue-assigned + inbound rows for call-center workers. */
export function shouldScopeLeadsToInsideSalesWorker(roleLike: RoleLike): boolean {
  return isInsideSalesRoleLike(roleLike)
}

type InsideSalesOpportunityScopeInput = OpportunityLike & {
  owner_user_id?: string | null
  assigned_user_id?: string | null
  lead_id?: string | null
}

/** Mirrors opportunity detail page access for queue-only inside-sales workers. */
export function isOpportunityInInsideSalesWorkerScope(
  opportunity: InsideSalesOpportunityScopeInput,
  userId: string,
  leadChannel: string | null | undefined,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): boolean {
  return (
    hasActiveInsideSalesFollowUp(opportunity, orgInspectionOutcomes) ||
    opportunity.owner_user_id === userId ||
    opportunity.assigned_user_id === userId ||
    leadChannel === 'inbound'
  )
}

export function canViewInsideSalesFollowUp(roleLike: RoleLike) {
  return MANAGER_ROLES.has(normalize(roleLike.role)) || isInsideSalesRoleLike(roleLike)
}

export function hasRepWorkingHandoffFollowUp(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
) {
  const status = normalize(opportunity.status)
  if (status === 'won' || status === 'lost') return false
  const pipelineStage = normalize(opportunity.pipeline_stage)
  if (onRepWorkingInsurancePipeline(pipelineStage)) return true
  return delayedHandoffStillGraceEmptyPipeline(opportunity, orgInspectionOutcomes)
}

/** @deprecated Use hasRepWorkingHandoffFollowUp */
export const hasRepWorkingInsuranceFollowUp = hasRepWorkingHandoffFollowUp

export function getInsideSalesFollowUpKind(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): InsideSalesQueueKind | null {
  const pipelineStage = normalize(opportunity.pipeline_stage)
  const handoffEnabled = inspectionOutcomeHasInsideSalesHandoff(opportunity, orgInspectionOutcomes)
  if (isResolvedInsideSalesPipelineStage(pipelineStage)) return null
  // Check knockback first — it's set explicitly by closers
  if (
    pipelineStage === KNOCKBACK_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${KNOCKBACK_PIPELINE_PREFIX}_`)
  ) {
    return 'knockback'
  }
  if (
    pipelineStage === DIDNT_SIT_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`) ||
    inspectionOutcomeRoutesToInsideSalesDidntSit(orgInspectionOutcomes, opportunity.inspection_outcome)
  ) {
    return 'didnt_sit'
  }
  if (
    (pipelineStage === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX ||
      pipelineStage.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`)) ||
    onRepWorkingInsurancePipeline(pipelineStage) ||
    (handoffEnabled && onRepWorkingInsurancePipeline(pipelineStage)) ||
    (handoffEnabled && delayedHandoffStillGraceEmptyPipeline(opportunity, orgInspectionOutcomes)) ||
    repWorkingHandoffQueueEligible(opportunity, orgInspectionOutcomes) ||
    delayedHandoffPastDueEmptyPipeline(opportunity, orgInspectionOutcomes) ||
    legacyPipelineInsideSalesHandoffVisible(opportunity, orgInspectionOutcomes)
  ) {
    return 'handoff'
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
  if (isResolvedInsideSalesPipelineStage(pipelineStage)) return false
  if (pipelineStage === DIDNT_SIT_PIPELINE_PREFIX) return true
  if (pipelineStage.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`)) return true
  if (pipelineStage === KNOCKBACK_PIPELINE_PREFIX) return true
  if (pipelineStage.startsWith(`${KNOCKBACK_PIPELINE_PREFIX}_`)) return true
  const kind = getInsideSalesFollowUpKind(opportunity, orgInspectionOutcomes)
  return kind === 'didnt_sit' || kind === 'handoff' || kind === 'knockback'
}

export function pipelineStageForInsideSalesClaim(opportunity: OpportunityLike, pipelinePrefix: string) {
  const n = normalize(opportunity.pipeline_stage)
  if (onRepWorkingInsurancePipeline(n)) {
    return pipelinePrefix
  }
  if (
    n === DIDNT_SIT_PIPELINE_PREFIX ||
    n.startsWith(`${DIDNT_SIT_PIPELINE_PREFIX}_`) ||
    n === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX ||
    n.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`) ||
    n === KNOCKBACK_PIPELINE_PREFIX ||
    n.startsWith(`${KNOCKBACK_PIPELINE_PREFIX}_`)
  ) {
    return opportunity.pipeline_stage || pipelinePrefix
  }
  // Any other legacy stage: adopt canonical inside-sales prefix on claim.
  return pipelinePrefix
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
  if (pipelineStage === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX) return 'new'
  if (pipelineStage.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`)) {
    return pipelineStage.slice(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`.length) || 'new'
  }
  if (pipelineStage === KNOCKBACK_PIPELINE_PREFIX) return 'new'
  if (pipelineStage.startsWith(`${KNOCKBACK_PIPELINE_PREFIX}_`)) {
    return pipelineStage.slice(`${KNOCKBACK_PIPELINE_PREFIX}_`.length) || 'new'
  }
  if (getInsideSalesFollowUpKind(opportunity, orgInspectionOutcomes) === 'didnt_sit') {
    return 'new'
  }
  if (onRepWorkingInsurancePipeline(pipelineStage)) {
    return repWorkingHandoffQueueEligible(opportunity, orgInspectionOutcomes) ? 'new' : 'rep_working'
  }
  if (!inspectionOutcomeHasInsideSalesHandoff(opportunity, orgInspectionOutcomes)) return null
  if (delayedHandoffStillGraceEmptyPipeline(opportunity, orgInspectionOutcomes)) return 'rep_working'
  if (delayedHandoffPastDueEmptyPipeline(opportunity, orgInspectionOutcomes)) return 'new'
  if (legacyPipelineInsideSalesHandoffVisible(opportunity, orgInspectionOutcomes)) {
    const handoff = getInspectionOutcomeInsideSalesHandoff(
      inspectionRows(orgInspectionOutcomes),
      opportunity.inspection_outcome
    )
    if (!handoff.enabled || handoff.delayDays === null || !opportunity.inspection_outcome_at) return 'new'
    const cutoff = Date.now() - handoff.delayDays * 24 * 60 * 60 * 1000
    return new Date(opportunity.inspection_outcome_at).getTime() <= cutoff ? 'new' : 'rep_working'
  }
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

/** When inside sales should treat the row as “ready to call” vs still in rep grace — uses admin delay days + DB timestamps. */
export type InsideSalesCallability = {
  callableNow: boolean
  /** When rep grace ends / calls should start (ISO); null if not applicable */
  eligibleAtIso: string | null
  /** Admin “send after N days” for this outcome when handoff applies */
  adminHandoffDelayDays: number | null
}

export type InsideSalesQueueState = {
  active: boolean
  kind: InsideSalesQueueKind | null
  status: string | null
  callability: InsideSalesCallability | null
}

function futureFollowUpCallability(opportunity: OpportunityLike): InsideSalesCallability | null {
  const fu = opportunity.follow_up_at
  if (!fu) return null
  const t = new Date(fu).getTime()
  if (!Number.isFinite(t) || t <= Date.now()) return null
  return {
    callableNow: false,
    eligibleAtIso: new Date(t).toISOString(),
    adminHandoffDelayDays: null,
  }
}

export function getInsideSalesCallability(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): InsideSalesCallability | null {
  if (!hasActiveInsideSalesFollowUp(opportunity, orgInspectionOutcomes)) return null

  const kind = getInsideSalesFollowUpKind(opportunity, orgInspectionOutcomes)
  const rows = inspectionRows(orgInspectionOutcomes)
  const handoff = getInspectionOutcomeInsideSalesHandoff(rows, opportunity.inspection_outcome)
  const delayDays = handoff.enabled && handoff.delayDays !== null ? handoff.delayDays : null
  const pipelineStage = normalize(opportunity.pipeline_stage)

  const futureFollowUp = futureFollowUpCallability(opportunity)

  if (kind === 'didnt_sit') {
    if (futureFollowUp) return futureFollowUp
    return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: null }
  }

  if (kind === 'knockback') {
    if (futureFollowUp) return futureFollowUp
    return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: null }
  }

  if (
    pipelineStage === HANDOFF_INSIDE_SALES_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${HANDOFF_INSIDE_SALES_PIPELINE_PREFIX}_`)
  ) {
    if (futureFollowUp) {
      return { ...futureFollowUp, adminHandoffDelayDays: delayDays }
    }
    return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
  }

  const repWorkingFamily = onRepWorkingInsurancePipeline(pipelineStage)

  if (repWorkingFamily) {
    const fu = opportunity.follow_up_at
    if (fu) {
      const t = new Date(fu).getTime()
      if (!Number.isFinite(t)) {
        return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
      }
      return {
        callableNow: t <= Date.now(),
        eligibleAtIso: new Date(t).toISOString(),
        adminHandoffDelayDays: delayDays,
      }
    }
    if (opportunity.inspection_outcome_at && delayDays !== null) {
      const outcomeMs = new Date(opportunity.inspection_outcome_at).getTime()
      const eligibleMs = outcomeMs + delayDays * 24 * 60 * 60 * 1000
      return {
        callableNow: Date.now() >= eligibleMs,
        eligibleAtIso: new Date(eligibleMs).toISOString(),
        adminHandoffDelayDays: delayDays,
      }
    }
    return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
  }

  if (!pipelineStage) {
    if (delayedHandoffPastDueEmptyPipeline(opportunity, orgInspectionOutcomes)) {
      return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
    }
    if (
      delayedHandoffStillGraceEmptyPipeline(opportunity, orgInspectionOutcomes) &&
      opportunity.inspection_outcome_at &&
      delayDays !== null
    ) {
      const outcomeMs = new Date(opportunity.inspection_outcome_at).getTime()
      const eligibleMs = outcomeMs + delayDays * 24 * 60 * 60 * 1000
      return {
        callableNow: false,
        eligibleAtIso: new Date(eligibleMs).toISOString(),
        adminHandoffDelayDays: delayDays,
      }
    }
    if (opportunity.inspection_outcome_at && delayDays !== null) {
      const outcomeMs = new Date(opportunity.inspection_outcome_at).getTime()
      const eligibleMs = outcomeMs + delayDays * 24 * 60 * 60 * 1000
      const callable = Date.now() >= eligibleMs
      return {
        callableNow: callable,
        eligibleAtIso: new Date(eligibleMs).toISOString(),
        adminHandoffDelayDays: delayDays,
      }
    }
    return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
  }

  if (legacyPipelineInsideSalesHandoffVisible(opportunity, orgInspectionOutcomes)) {
    if (opportunity.inspection_outcome_at && delayDays !== null) {
      const outcomeMs = new Date(opportunity.inspection_outcome_at).getTime()
      const eligibleMs = outcomeMs + delayDays * 24 * 60 * 60 * 1000
      return {
        callableNow: Date.now() >= eligibleMs,
        eligibleAtIso: new Date(eligibleMs).toISOString(),
        adminHandoffDelayDays: delayDays,
      }
    }
    return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
  }

  return { callableNow: true, eligibleAtIso: null, adminHandoffDelayDays: delayDays }
}

export function getInsideSalesQueueState(
  opportunity: OpportunityLike,
  orgInspectionOutcomes?: OrgInspectionOutcomesArg
): InsideSalesQueueState {
  const active = hasActiveInsideSalesFollowUp(opportunity, orgInspectionOutcomes)
  if (!active) {
    return {
      active: false,
      kind: null,
      status: null,
      callability: null,
    }
  }

  const kind = getInsideSalesFollowUpKind(opportunity, orgInspectionOutcomes)
  return {
    active: Boolean(kind),
    kind,
    status: getInsideSalesFollowUpStatus(opportunity, orgInspectionOutcomes),
    callability: getInsideSalesCallability(opportunity, orgInspectionOutcomes),
  }
}
