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
  deriveManagerOverrideRecipients,
  EMPTY_MANAGER_HIERARCHY,
  loadOrgManagerHierarchy,
  normalizeManagerOverrideRate,
  withDerivedManagerOverride,
  type OrgManagerHierarchy,
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
}

export type DerivedCommissionContext = {
  rates: DerivedCommissionRates
  /** opportunity id → the rep who ran the inspection. */
  inspectorByOpportunity: Map<string, string>
  managerHierarchy: OrgManagerHierarchy
  /** opportunity id → self-gen flag + attribution, only for opportunities in scope. */
  selfGenByOpportunity: Map<string, SelfGenOpportunityRow>
}

/**
 * Read the three org rate columns in one query.
 *
 * Throws on error — a failed read must not be mistaken for "every derived line is
 * switched off", which would silently underpay a whole period.
 */
export async function loadDerivedCommissionRates(
  supabase: SupabaseClient,
  orgId: string
): Promise<DerivedCommissionRates> {
  const { data, error } = await supabase
    .from('orgs')
    .select(
      'inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate'
    )
    .eq('id', orgId)
    .maybeSingle()
  if (error) throw error

  return {
    inspectionRatePercent: normalizeInspectionRate(data?.inspection_commission_rate),
    managerOverrideRatePercent: normalizeManagerOverrideRate(
      data?.manager_override_commission_rate
    ),
    selfGenRatePercent: normalizeSelfGenRate(data?.self_gen_commission_rate),
  }
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
  const rates = await loadDerivedCommissionRates(supabase, orgId)

  const [inspectorByOpportunity, managerHierarchy, selfGenByOpportunity] = await Promise.all([
    rates.inspectionRatePercent > 0
      ? loadInspectorByOpportunity(supabase, orgId, opportunityIds)
      : Promise.resolve(new Map<string, string>()),
    rates.managerOverrideRatePercent > 0
      ? loadOrgManagerHierarchy(supabase, orgId)
      : Promise.resolve(EMPTY_MANAGER_HIERARCHY),
    rates.selfGenRatePercent > 0
      ? loadSelfGenByOpportunity(supabase, orgId, opportunityIds)
      : Promise.resolve(new Map<string, SelfGenOpportunityRow>()),
  ])

  return { rates, inspectorByOpportunity, managerHierarchy, selfGenByOpportunity }
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
}): AdditiveParticipantsForJob {
  const { explicit, context, opportunityId, participantUserIds, salespersonId } = input

  const withInspector = withDerivedInspector(
    explicit,
    opportunityId ? context.inspectorByOpportunity.get(opportunityId) ?? null : null,
    context.rates.inspectionRatePercent
  )

  const managerRecipients =
    context.rates.managerOverrideRatePercent > 0
      ? deriveManagerOverrideRecipients(participantUserIds, context.managerHierarchy)
      : []
  const withManagers = withDerivedManagerOverride(
    withInspector,
    managerRecipients,
    context.rates.managerOverrideRatePercent
  )

  const selfGenRow = opportunityId ? context.selfGenByOpportunity.get(opportunityId) : undefined
  const selfGen = resolveSelfGenCredit({
    isSelfGenerated: selfGenRow?.isSelfGenerated ?? null,
    ownerUserId: selfGenRow?.ownerUserId ?? null,
    setterUserId: selfGenRow?.setterUserId ?? null,
    salespersonId,
  })
  const participants = withDerivedSelfGen(
    withManagers,
    selfGen,
    context.rates.selfGenRatePercent
  )

  return {
    participants,
    selfGenSetterConflict:
      context.rates.selfGenRatePercent > 0 && selfGen.conflictWithSetter,
  }
}
