/**
 * Single source of truth for the DERIVED per-job commission lines — inspection,
 * manager override, self-generated.
 *
 * Payroll has two entry points that must never disagree: the preview an admin reviews
 * (`GET /api/admin/payroll/export`) and the period lock that actually writes payout
 * lines (`materializePayrollPeriod`). Both call `loadDerivedCommissionContext()` and
 * `buildAdditiveParticipantsForJob()` so a rule can only be added in one place.
 *
 * Inspection and self-generated rates are org-versioned. Management rates come from
 * separately assigned, effective-dated overlay plan versions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'
import {
  loadInspectorByOpportunity,
  normalizeInspectionRate,
  withDerivedInspector,
} from '@/lib/job-inspector-attribution'
import {
  loadOrgManagerAssignments,
  loadOrgUserActiveHistory,
  type EffectiveManagerAssignmentRow,
  type EffectiveUserActiveRow,
} from '@/lib/job-manager-override'
import {
  resolveManagementCompOverlays,
  type EffectiveManagementOverlayAssignment,
  type ManagementOverlayLane,
  type ManagementOverlayPlanVersion,
} from '@/lib/management-comp-overlay'
import { buildDefaultCoverageRows } from '@/lib/comp-plan-defaults'
import {
  loadSelfGenByOpportunity,
  normalizeSelfGenRate,
  resolveSelfGenCredit,
  withDerivedSelfGen,
  type SelfGenOpportunityRow,
} from '@/lib/job-self-gen-attribution'

export type DerivedCommissionRates = {
  inspectionRatePercent: number
  managerOverrideRatePercent: number
  selfGenRatePercent: number
  effectiveFrom: string
}

export type DerivedCommissionContext = {
  rateHistory: DerivedCommissionRates[]
  /** opportunity id → the rep who ran the inspection. */
  inspectorByOpportunity: Map<string, string>
  managerAssignments: EffectiveManagerAssignmentRow[]
  userActiveHistory: EffectiveUserActiveRow[]
  managementOverlayAssignments: EffectiveManagementOverlayAssignment[]
  managementOverlayPlanVersions: ManagementOverlayPlanVersion[]
  compAssignments: EffectiveCompAssignmentRow[]
  /** opportunity id → self-gen flag + attribution, only for opportunities in scope. */
  selfGenByOpportunity: Map<string, SelfGenOpportunityRow>
}

export type EffectiveCompAssignmentRow = {
  userId: string
  effectiveFrom: string
  effectiveTo: string | null
  isManagerPlan: boolean
}

export function resolveDerivedCommissionRatesForSaleDate(
  history: readonly DerivedCommissionRates[],
  saleDate: string | null | undefined
): DerivedCommissionRates | null {
  const ymd = saleDate?.slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return (
    [...history]
      .filter((row) => row.effectiveFrom <= ymd)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
  )
}

async function loadEffectiveCompAssignments(
  supabase: SupabaseClient,
  orgId: string
): Promise<EffectiveCompAssignmentRow[]> {
  const { data, error } = await supabase
    .from('user_comp_plans')
    .select('user_id, effective_from, effective_to, comp_plans(is_manager_plan)')
    .eq('org_id', orgId)
  if (error) throw error

  return ((data || []) as Array<{
    user_id: string
    effective_from: string
    effective_to: string | null
    comp_plans: { is_manager_plan?: boolean | null } | { is_manager_plan?: boolean | null }[] | null
  }>).map((row) => {
    const plan = Array.isArray(row.comp_plans) ? row.comp_plans[0] : row.comp_plans
    return {
      userId: row.user_id,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      isManagerPlan: plan?.is_manager_plan === true,
    }
  })
}

/**
 * Role defaults stand in for assignments here, so a default-plan rep earns the same derived lines (inspection, self-gen,
 * manager override) as an assigned one; test accounts are dropped entirely. Same eligibility rule as the base-pay
 * resolver (lib/comp-plan-defaults.ts userGetsDefaultPlan). Before the defaults table / test flag exist, adds nothing.
 */
async function applyDefaultsAndTestAccounts(
  supabase: SupabaseClient,
  orgId: string,
  assignments: EffectiveCompAssignmentRow[],
  activeHistory: EffectiveUserActiveRow[]
): Promise<EffectiveCompAssignmentRow[]> {
  let usersRes = await supabase.from('users').select('id, role, active, is_test_account').eq('org_id', orgId)
  if (usersRes.error && (usersRes.error as { code?: string }).code === '42703') {
    usersRes = (await supabase.from('users').select('id, role, active').eq('org_id', orgId)) as typeof usersRes
  }
  if (usersRes.error) throw usersRes.error
  const users = ((usersRes.data || []) as Array<{ id: string; role: string; active: boolean | null; is_test_account?: boolean | null }>).map((u) => ({
    id: u.id,
    role: u.role,
    active: u.active,
    isTestAccount: u.is_test_account === true,
  }))
  const testIds = new Set(users.filter((u) => u.isTestAccount).map((u) => u.id))
  // Test accounts keep no assignment either; ended/pre-assignment logic below uses the UNFILTERED assignment dates.
  const kept = assignments.filter((a) => !testIds.has(a.userId))

  const defRes = await supabase.from('org_default_comp_plans').select('role, comp_plan_id, effective_from, comp_plans(is_manager_plan)').eq('org_id', orgId)
  if (defRes.error) {
    if ((defRes.error as { code?: string }).code === '42P01' || /does not exist|schema cache/i.test(String(defRes.error.message))) return kept
    throw defRes.error
  }
  const defaults = ((defRes.data || []) as unknown as Array<{ role: string; comp_plan_id: string; effective_from: string; comp_plans: { is_manager_plan?: boolean | null } | { is_manager_plan?: boolean | null }[] | null }>).map((d) => {
    const plan = Array.isArray(d.comp_plans) ? d.comp_plans[0] : d.comp_plans
    return { role: d.role, comp_plan_id: d.comp_plan_id, effective_from: d.effective_from, isManagerPlan: plan?.is_manager_plan === true }
  })
  const activeHistoryByUser = new Map<string, Array<{ effectiveFrom: string; isActive: boolean }>>()
  for (const h of activeHistory) activeHistoryByUser.set(h.userId, [...(activeHistoryByUser.get(h.userId) ?? []), { effectiveFrom: h.effectiveFrom, isActive: h.isActive }])
  const assignmentFromDatesByUser = new Map<string, string[]>()
  for (const a of assignments) assignmentFromDatesByUser.set(a.userId, [...(assignmentFromDatesByUser.get(a.userId) ?? []), a.effectiveFrom])
  const covered = buildDefaultCoverageRows({ users, activeHistoryByUser, assignmentFromDatesByUser, defaults })
  return [...kept, ...covered]
}

async function loadManagementOverlayAssignments(
  supabase: SupabaseClient,
  orgId: string
): Promise<EffectiveManagementOverlayAssignment[]> {
  const { data, error } = await supabase
    .from('user_management_comp_overlay_assignments')
    .select('id, user_id, comp_plan_id, lane, effective_from, effective_to')
    .eq('org_id', orgId)
    .is('cancelled_at', null)
    .order('effective_from', { ascending: true })
  if (error) throw error

  return ((data || []) as Array<{
    id: string
    user_id: string
    comp_plan_id: string
    lane: ManagementOverlayLane
    effective_from: string
    effective_to: string | null
  }>).map((row) => ({
    assignmentId: row.id,
    managerUserId: row.user_id,
    compPlanId: row.comp_plan_id,
    lane: row.lane,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }))
}

async function loadManagementOverlayPlanVersions(
  supabase: SupabaseClient,
  orgId: string
): Promise<ManagementOverlayPlanVersion[]> {
  const { data, error } = await supabase
    .from('management_comp_overlay_plan_versions')
    .select('id, comp_plan_id, lane, override_percent, effective_from')
    .eq('org_id', orgId)
    .order('effective_from', { ascending: true })
  if (error) throw error

  return ((data || []) as Array<{
    id: string
    comp_plan_id: string
    lane: ManagementOverlayLane
    override_percent: unknown
    effective_from: string
  }>).map((row) => ({
    versionId: row.id,
    compPlanId: row.comp_plan_id,
    lane: row.lane,
    ratePercent: Number(row.override_percent),
    effectiveFrom: row.effective_from,
  }))
}

/**
 * Read the three org rate columns in one query.
 *
 * Throws on error — a failed read must not be mistaken for "every derived line is
 * switched off", which would silently underpay a whole period.
 */
export async function loadDerivedCommissionRateHistory(
  supabase: SupabaseClient,
  orgId: string
): Promise<DerivedCommissionRates[]> {
  const { data, error } = await supabase
    .from('org_derived_commission_rates')
    .select(
      'inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate, effective_from'
    )
    .eq('org_id', orgId)
    .order('effective_from', { ascending: true })
  if (error) throw error

  return ((data || []) as Array<{
    inspection_commission_rate: unknown
    manager_override_commission_rate: unknown
    self_gen_commission_rate: unknown
    effective_from: string
  }>).map((row) => ({
    inspectionRatePercent: normalizeInspectionRate(row.inspection_commission_rate),
    managerOverrideRatePercent: Number(row.manager_override_commission_rate) || 0,
    selfGenRatePercent: normalizeSelfGenRate(row.self_gen_commission_rate),
    effectiveFrom: row.effective_from,
  }))
}

/**
 * Load everything the derived lines need for a batch of opportunities, once per
 * payroll run rather than once per job. Each lookup is skipped entirely when its rate
 * is 0, so a disabled feature costs no queries.
 */
export async function loadDerivedCommissionContext(
  supabase: SupabaseClient,
  input: { orgId: string; opportunityIds: string[] }
): Promise<DerivedCommissionContext> {
  const { orgId, opportunityIds } = input
  const rateHistory = await loadDerivedCommissionRateHistory(supabase, orgId)
  const anyInspection = rateHistory.some((row) => row.inspectionRatePercent > 0)
  const anySelfGen = rateHistory.some((row) => row.selfGenRatePercent > 0)

  const [
    inspectorByOpportunity,
    managerAssignments,
    userActiveHistory,
    managementOverlayAssignments,
    managementOverlayPlanVersions,
    selfGenByOpportunity,
    rawCompAssignments,
  ] = await Promise.all([
    anyInspection
      ? loadInspectorByOpportunity(supabase, orgId, opportunityIds)
      : Promise.resolve(new Map<string, string>()),
    loadOrgManagerAssignments(supabase, orgId),
    loadOrgUserActiveHistory(supabase, orgId),
    loadManagementOverlayAssignments(supabase, orgId),
    loadManagementOverlayPlanVersions(supabase, orgId),
    anySelfGen
      ? loadSelfGenByOpportunity(supabase, orgId, opportunityIds)
      : Promise.resolve(new Map<string, SelfGenOpportunityRow>()),
    loadEffectiveCompAssignments(supabase, orgId),
  ])

  const compAssignments = await applyDefaultsAndTestAccounts(supabase, orgId, rawCompAssignments, userActiveHistory)

  return {
    rateHistory,
    inspectorByOpportunity,
    managerAssignments,
    userActiveHistory,
    managementOverlayAssignments,
    managementOverlayPlanVersions,
    compAssignments,
    selfGenByOpportunity,
  }
}

export type AdditiveParticipantsForJob = {
  participants: DealCommissionRoleParticipant[]
  /**
   * True when the job is flagged self-generated AND carries a separate setter. The
   * self-gen line is suppressed (see lib/job-self-gen-attribution.ts) and the caller
   * surfaces the job so a human can fix the attribution.
   */
  selfGenSetterConflict: boolean
}

/**
 * Assemble a job's additive participants: the rows an admin entered by hand, plus every
 * derived line that applies.
 *
 * Order matters only for readability — each `withDerived*` call is independent and each
 * one yields to an explicit row of its own role. Pure, so the whole rule set is
 * testable without a database.
 */
export function buildAdditiveParticipantsForJob(input: {
  explicit: DealCommissionRoleParticipant[]
  context: DerivedCommissionContext
  opportunityId: string | null
  setterUserId: string | null
  salespersonId: string | null
  opportunityOwnerUserId: string | null
  saleDate: string | null
}): AdditiveParticipantsForJob {
  const {
    explicit,
    context,
    opportunityId,
    setterUserId,
    salespersonId,
    opportunityOwnerUserId,
    saleDate,
  } = input

  const ymd = saleDate?.slice(0, 10) ?? ''
  const rates = resolveDerivedCommissionRatesForSaleDate(context.rateHistory, saleDate)

  const hasCompAssignment = (userId: string | null | undefined, managerOnly = false): boolean => {
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
    return context.compAssignments.some(
      (row) =>
        row.userId === userId &&
        row.effectiveFrom <= ymd &&
        (row.effectiveTo === null || row.effectiveTo >= ymd) &&
        (!managerOnly || row.isManagerPlan)
    )
  }

  const withInspector = withDerivedInspector(
    explicit,
    rates && opportunityId
      ? (() => {
          const inspector = context.inspectorByOpportunity.get(opportunityId) ?? null
          return hasCompAssignment(inspector) ? inspector : null
        })()
      : null,
    rates?.inspectionRatePercent ?? 0
  )

  const suppressedLanes: ManagementOverlayLane[] = []
  if (explicit.some((participant) => participant.role === 'setter_manager_override')) {
    suppressedLanes.push('setter')
  }
  if (explicit.some((participant) => participant.role === 'closer_manager_override')) {
    suppressedLanes.push('closer')
  }
  // Preserve the precedence of older generic manual manager rows: because they did
  // not identify a production lane, they intentionally suppress both derived lanes.
  if (explicit.some((participant) => participant.role === 'field_manager' || participant.role === 'senior_manager')) {
    suppressedLanes.push('setter', 'closer')
  }

  const closerProducerUserId = salespersonId || opportunityOwnerUserId
  const overlayResolution = resolveManagementCompOverlays({
    saleDate,
    setterProducerUserId: hasCompAssignment(setterUserId) ? setterUserId : null,
    closerProducerUserId: hasCompAssignment(closerProducerUserId) ? closerProducerUserId : null,
    managerAssignments: context.managerAssignments.map((row) => ({
      id: row.id,
      userId: row.userId,
      managerUserId: row.managerUserId,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    })),
    overlayAssignments: context.managementOverlayAssignments,
    planVersions: context.managementOverlayPlanVersions,
    userActiveHistory: context.userActiveHistory,
    suppressedLanes,
  })
  if (overlayResolution.issues.length > 0) {
    throw new Error(
      `Management overlay resolution failed: ${overlayResolution.issues
        .map((issue) => `${issue.lane || 'job'}:${issue.code}`)
        .join(', ')}`
    )
  }

  const withManagers: DealCommissionRoleParticipant[] = [
    ...withInspector,
    ...overlayResolution.lines.map((line) => ({
      userId: line.recipientUserId,
      role: line.lane === 'setter' ? 'setter_manager_override' as const : 'closer_manager_override' as const,
      overrideAmount: null,
      overridePercent: line.ratePercent,
      premierPricingAmount: null,
      sourceSnapshot: {
        source: 'management_comp_overlay',
        lane: line.lane,
        producer_user_id: line.producerUserId,
        overlay_assignment_id: line.overlayAssignmentId,
        overlay_version_id: line.overlayVersionId,
        manager_assignment_id: line.managerAssignmentId,
        attribution_source: line.source,
      },
    })),
  ]

  const selfGenRow = opportunityId ? context.selfGenByOpportunity.get(opportunityId) : undefined
  const selfGen = resolveSelfGenCredit({
    isSelfGenerated:
      (rates?.selfGenRatePercent ?? 0) > 0 &&
      hasCompAssignment(selfGenRow?.ownerUserId ?? salespersonId)
      ? selfGenRow?.isSelfGenerated ?? null
      : null,
    ownerUserId: selfGenRow?.ownerUserId ?? null,
    setterUserId: selfGenRow?.setterUserId ?? null,
    salespersonId,
  })
  const participants = withDerivedSelfGen(
    withManagers,
    selfGen,
    rates?.selfGenRatePercent ?? 0
  )

  return {
    participants,
    selfGenSetterConflict:
      (rates?.selfGenRatePercent ?? 0) > 0 &&
      selfGen.conflictWithSetter,
  }
}
