/**
 * The self-generated commission line: an extra percent of the commission base paid to
 * a closer who sourced the deal themselves (6% in the published ladder, on top of the
 * 7% close).
 *
 * ── Why this reads a stored column and not an inference ──
 *
 * "Self-generated" existed only as prose in the agreement templates. There is no lead
 * source that marks it: `leads.source` in production is canvass / door_to_door /
 * csv_import plus a small tail. The one available signal was
 * `opportunities.setter_user_id = owner_user_id`, and that is NOT good enough to pay
 * 6% from — an admin backfilling a missing setter to the closer produces exactly the
 * same shape as a genuine self-gen.
 *
 * So the payroll line reads `opportunities.is_self_generated`, an explicit stored
 * boolean. The migration backfills it from that inference once, and records HOW each
 * row got its value in `self_generated_source` ('inferred_setter_equals_owner' vs
 * 'manual'), so history stays auditable and a human can see which rows were guessed.
 * Derivation and stored value stay distinguishable; payroll only ever reads the stored
 * value.
 *
 * ── The setter conflict ──
 *
 * Self-gen and setter attribution are mutually exclusive by definition: a deal the
 * closer generated has no separate setter. If a job somehow carries both, the stack is
 * 7% close + 5% set + 6% self-gen + 1.5% inspection + 1% override = 20.5%, which
 * breaches the 18% pool cap and scales EVERY line on that job down — the setter and
 * the closer both quietly lose money because of a data error. The derived self-gen line
 * is therefore suppressed on a conflicting job and the job id is surfaced as a warning
 * instead. An admin who really means to pay it can still enter an explicit
 * `deal_commission_roles` row, which wins.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'
import { normalizeCommissionRatePercent } from '@/lib/commission-rate'

/** The `deal_commission_roles.role` the derived self-gen line is written as. */
export const SELF_GEN_ROLE = 'self_gen' as const

export type SelfGenOpportunityRow = {
  isSelfGenerated: boolean | null
  source: string | null
  ownerUserId: string | null
  setterUserId: string | null
}

export type SelfGenAttribution = {
  /** Who earns the self-gen line; null when the job is not self-generated. */
  creditUserId: string | null
  /** True when the job is flagged self-gen AND carries a different setter. */
  conflictWithSetter: boolean
}

export const NO_SELF_GEN: SelfGenAttribution = { creditUserId: null, conflictWithSetter: false }

export function payableSelfGenFlag(
  isSelfGenerated: boolean | null,
  source: string | null
): boolean | null {
  return source === 'manual' ? isSelfGenerated : null
}

/**
 * Load the self-gen flag for a batch of opportunities.
 *
 * Throws rather than returning an empty map on query failure: an empty map is
 * indistinguishable from "no job is self-generated", and failing open would silently
 * drop real pay.
 */
export async function loadSelfGenByOpportunity(
  supabase: SupabaseClient,
  orgId: string,
  opportunityIds: string[]
): Promise<Map<string, SelfGenOpportunityRow>> {
  const out = new Map<string, SelfGenOpportunityRow>()
  if (opportunityIds.length === 0) return out

  const { data, error } = await supabase
    .from('opportunities')
    .select('id, is_self_generated, self_generated_source, owner_user_id, setter_user_id')
    .eq('org_id', orgId)
    .in('id', opportunityIds)

  if (error) throw error

  for (const row of (data || []) as Array<{
    id: string
    is_self_generated: boolean | null
    self_generated_source: string | null
    owner_user_id: string | null
    setter_user_id: string | null
  }>) {
    out.set(row.id, {
      isSelfGenerated: payableSelfGenFlag(
        row.is_self_generated,
        row.self_generated_source
      ),
      source: row.self_generated_source,
      ownerUserId: row.owner_user_id,
      setterUserId: row.setter_user_id,
    })
  }

  return out
}

/**
 * Who earns the self-gen line on one job, and whether the job's attribution
 * contradicts itself.
 *
 * Credit goes to the opportunity owner (the closer). `salespersonId` is the fallback
 * for jobs whose opportunity has no owner recorded — the same person payroll already
 * pays as `sales_rep`.
 *
 * Pure so the precedence and conflict rules can be tested without a database.
 */
export function resolveSelfGenCredit(input: {
  isSelfGenerated: boolean | null | undefined
  ownerUserId: string | null | undefined
  setterUserId: string | null | undefined
  salespersonId: string | null | undefined
}): SelfGenAttribution {
  // Strictly true only. A null (never reviewed) row is not self-gen.
  if (input.isSelfGenerated !== true) return NO_SELF_GEN

  const creditUserId = input.ownerUserId || input.salespersonId || null
  if (!creditUserId) return NO_SELF_GEN

  const setterUserId = input.setterUserId || null
  const conflictWithSetter = Boolean(setterUserId && setterUserId !== creditUserId)

  return { creditUserId, conflictWithSetter }
}

/**
 * Merge a derived self-gen line into the explicit per-job commission roles.
 *
 * Precedence, highest first — identical to `withDerivedInspector`:
 *  1. An explicit `self_gen` row an admin saved for this job, including a deliberate $0.
 *  2. The derived line at the org's self-gen rate.
 *  3. Nothing, when the rate is 0/unset, the job is not self-generated, or the job's
 *     attribution conflicts with a separate setter.
 *
 * Pure so the precedence rules can be tested without a database.
 */
export function withDerivedSelfGen(
  explicit: DealCommissionRoleParticipant[],
  attribution: SelfGenAttribution,
  selfGenRatePercent: number
): DealCommissionRoleParticipant[] {
  if (!Number.isFinite(selfGenRatePercent) || selfGenRatePercent <= 0) return explicit
  if (!attribution.creditUserId) return explicit
  // Never auto-pay a line that would push the job past the 18% pool cap on the back of
  // contradictory attribution. The conflict is reported, not silently paid.
  if (attribution.conflictWithSetter) return explicit
  if (explicit.some((p) => p.role === SELF_GEN_ROLE)) return explicit

  return [
    ...explicit,
    {
      userId: attribution.creditUserId,
      role: SELF_GEN_ROLE,
      overrideAmount: null,
      overridePercent: selfGenRatePercent,
      premierPricingAmount: null,
    },
  ]
}

/** Org self-gen rate, defaulting to 0 (feature off) when unset or unreadable. */
export function normalizeSelfGenRate(value: unknown): number {
  return normalizeCommissionRatePercent(value)
}
