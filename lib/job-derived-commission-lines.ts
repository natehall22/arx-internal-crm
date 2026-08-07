/**
 * Single source of truth for the DERIVED per-job commission lines — inspection,
 * manager override, self-generated.
 *
 * Payroll has two entry points that must never disagree: the preview an admin reviews
 * (`GET /api/admin/payroll/export`) and the period lock that actually writes payout
 * lines (`materializePayrollPeriod`). Both call `loadDerivedCommissionContext()` and
 * `buildAdditiveParticipantsForJob()` so a rule can only be added in one place.
 *
 * Every rate is org-configurable and defaults to 0 = OFF, so nothing here starts
 * paying until a human sets the column.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'
import {
  loadInspectorByOpportunity,
  normalizeInspectionRate,
  withDerivedInspector,
} from '@/lib/job-inspector-attribution'
import {
  buildManagerHierarchyForDate,
  deriveManagerOverrideRecipients,
  EMPTY_MANAGER_ASSIGNMENTS,
  loadOrgManagerAssignments,
  loadOrgUserActiveHistory,
  normalizeManagerOverrideRate,
  withDerivedManagerOverride,
  type EffectiveManagerAssignmentRow,
  type EffectiveUserActiveRow,
} from '@/lib/job-manager-override'
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
  managerActiveHistory: EffectiveUserActiveRow[]
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
    managerOverrideRatePercent: normalizeManagerOverrideRate(row.manager_override_commission_rate),
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
  const anyManager = rateHistory.some((row) => row.managerOverrideRatePercent > 0)
  const anySelfGen = rateHistory.some((row) => row.selfGenRatePercent > 0)

  const [inspectorByOpportunity, managerAssignments, managerActiveHistory, selfGenByOpportunity, compAssignments] = await Promise.all([
    anyInspection
      ? loadInspectorByOpportunity(supabase, orgId, opportunityIds)
      : Promise.resolve(new Map<string, string>()),
    anyManager
      ? loadOrgManagerAssignments(supabase, orgId)
      : Promise.resolve(EMPTY_MANAGER_ASSIGNMENTS),
    anyManager ? loadOrgUserActiveHistory(supabase, orgId) : Promise.resolve([]),
    anySelfGen
      ? loadSelfGenByOpportunity(supabase, orgId, opportunityIds)
      : Promise.resolve(new Map<string, SelfGenOpportunityRow>()),
    anyInspection || anyManager || anySelfGen
      ? loadEffectiveCompAssignments(supabase, orgId)
      : Promise.resolve([]),
  ])

  return { rateHistory, inspectorByOpportunity, managerAssignments, managerActiveHistory, compAssignments, selfGenByOpportunity }
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
  /** sales_rep / setter / owner participants, used to walk the manager chain. */
  participantUserIds: readonly string[]
  salespersonId: string | null
  saleDate: string | null
}): AdditiveParticipantsForJob {
  const { explicit, context, opportunityId, participantUserIds, salespersonId, saleDate } = input

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

  const managerRecipients =
    (rates?.managerOverrideRatePercent ?? 0) > 0
      ? deriveManagerOverrideRecipients(
          participantUserIds,
          buildManagerHierarchyForDate(
            context.managerAssignments,
            saleDate,
            context.managerActiveHistory
          )
        ).filter((userId) => hasCompAssignment(userId, true))
      : []
  const withManagers = withDerivedManagerOverride(
    withInspector,
    managerRecipients,
    rates?.managerOverrideRatePercent ?? 0
  )

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
