import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { calculateCommissionFromPlanForSale, type CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import { getCustomDateRange } from '@/lib/date-ranges'
import { EASTERN_TZ, getEasternMonthKey } from '@/lib/eastern-datetime'
import { fetchSupabaseAllPages } from '@/lib/supabase-fetch-all-pages'

export type PayrollParticipant = { userId: string; role: 'sales_rep' | 'setter' | 'owner' }

export type DealCommissionRoleParticipant = {
  userId: string
  role:
    | 'inspector'
    | 'field_manager'
    | 'senior_manager'
    | 'setter_manager_override'
    | 'closer_manager_override'
    | 'self_gen'
    | 'custom'
  overrideAmount: number | null
  overridePercent: number | null
  premierPricingAmount: number | null
  sourceSnapshot?: Record<string, unknown>
}

/** Roles paid additively per job, outside the pool-scaled sales_rep/setter/owner set. */
export const ADDITIVE_DEAL_COMMISSION_ROLES: readonly DealCommissionRoleParticipant['role'][] = [
  'inspector',
  'field_manager',
  'senior_manager',
  'setter_manager_override',
  'closer_manager_override',
  'self_gen',
  'custom',
] as const

/**
 * Inspector/manager/custom roles from deal_commission_roles — additive per-job
 * participants that are NOT resolved from a comp plan. Their amounts join
 * rawByUser before scaleCommissionsToPool(), so they count inside the pool cap
 * and scale alongside every other line on the job.
 *
 * `setter` and `closer` rows are excluded on purpose: those users are
 * already paid through collectParticipants() and their comp plan, so paying them
 * from this table too would double-count them.
 *
 * Throws rather than returning [] on query failure — a read error here is
 * indistinguishable from "this job has no additive participants", and failing open
 * would silently underpay. Payroll fails closed (same rule as loadOrgSitOutcomeIdSet).
 */
export async function loadAdditiveDealCommissionParticipants(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<DealCommissionRoleParticipant[]> {
  const { data, error } = await supabase
    .from('deal_commission_roles')
    .select('user_id, role, override_amount, override_percent, premier_pricing_amount')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .in('role', ADDITIVE_DEAL_COMMISSION_ROLES as readonly string[])

  if (error) throw error

  return (data || []).map((row) => ({
    userId: row.user_id as string,
    role: row.role as DealCommissionRoleParticipant['role'],
    overrideAmount: row.override_amount != null ? Number(row.override_amount) : null,
    overridePercent: row.override_percent != null ? Number(row.override_percent) : null,
    premierPricingAmount:
      row.premier_pricing_amount != null ? Number(row.premier_pricing_amount) : null,
  }))
}

export type AdditiveParticipantAmount = {
  amount: number
  basis: 'flat' | 'percent' | 'none'
}

/**
 * Resolve what an additive participant earns on one job.
 *
 * **Precedence:** an explicit `override_amount` (flat dollars) wins over
 * `override_percent`. A row carrying neither pays nothing and is dropped by the
 * caller rather than written as a $0 line.
 *
 * `premier_pricing_amount` is deliberately NOT included — it is surfaced on the
 * statement as its own figure and has never had defined payout semantics. Folding
 * it in here would invent a payment rule nobody agreed to.
 */
export function resolveAdditiveParticipantAmount(
  participant: DealCommissionRoleParticipant,
  commissionBase: number
): AdditiveParticipantAmount {
  const flat = participant.overrideAmount
  if (flat != null && Number.isFinite(flat)) {
    return { amount: roundMoney(flat), basis: 'flat' }
  }
  const pct = participant.overridePercent
  if (pct != null && Number.isFinite(pct)) {
    return { amount: roundMoney(roundMoney(commissionBase) * (pct / 100)), basis: 'percent' }
  }
  return { amount: 0, basis: 'none' }
}

export function collectParticipants(
  job: {
    salesperson_id?: string | null
  },
  opportunity: {
    owner_user_id?: string | null
    setter_user_id?: string | null
  } | null
): PayrollParticipant[] {
  const out: PayrollParticipant[] = []
  const seen = new Set<string>()
  const sp = job.salesperson_id
  if (sp) {
    seen.add(sp)
    out.push({ userId: sp, role: 'sales_rep' })
  }
  if (opportunity?.setter_user_id && !seen.has(opportunity.setter_user_id)) {
    seen.add(opportunity.setter_user_id)
    out.push({ userId: opportunity.setter_user_id, role: 'setter' })
  }
  if (opportunity?.owner_user_id && !seen.has(opportunity.owner_user_id)) {
    seen.add(opportunity.owner_user_id)
    out.push({ userId: opportunity.owner_user_id, role: 'owner' })
  }
  return out
}

export function monthKeyFromSaleDate(saleDate: string | null): string | null {
  if (!saleDate || saleDate.length < 7) return null
  return saleDate.slice(0, 7)
}

export type PayrollExportRow = {
  job_id: string
  job_number: string
  /** From linked customers row when job.customer_id is set */
  customer_name: string | null
  sale_date: string | null
  address_text: string
  sale_amount: number | null
  commission_comp_base: number | null
  pool_cap: number | null
  user_id: string
  user_name: string
  participant_role: string
  comp_plan_id: string | null
  comp_plan_name: string | null
  plan_type: string | null
  base_rate_pct: number | null
  period_volume: number
  volume_bonus_rate_pct: number
  volume_bonus_flat: number
  effective_rate_pct: number
  raw_commission: number
  scaled_commission: number
  pool_cap_enforced: boolean
  unsupported_plan: boolean
  note: string | null
  hourly_earnings?: number | null
  total_earnings?: number | null
}

import type { SupabaseClient } from '@supabase/supabase-js'

type UserCompRow = {
  user_id: string
  effective_from: string
  effective_to: string | null
  override_percentage: number | null
  hourly_rate_override: number | null
  comp_plans: Record<string, unknown> | null
}

export async function loadActiveCompPlanForUser(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  saleDate: string
): Promise<UserCompRow | null> {
  const { data, error } = await supabase
    .from('user_comp_plans')
    .select('user_id, effective_from, effective_to, override_percentage, hourly_rate_override, comp_plans(*)')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .lte('effective_from', saleDate)
    .or(`effective_to.is.null,effective_to.gte.${saleDate}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A read failure is not the same as "no assignment". Payroll must fail closed
  // instead of silently choosing a different plan or paying nothing.
  if (error) throw error

  if (data && (data as { comp_plans?: unknown }).comp_plans) {
    return data as unknown as UserCompRow
  }

  // Historical pay is assignment-driven. A default plan is useful as an admin UI
  // suggestion, but it is not proof that this person held that plan on the sale
  // date. Missing assignment history therefore stays blank.
  return null
}

/** Roles that accumulate monthly volume for tier bonuses (not manager additive roles). */
const VOLUME_ACCUMULATING_PARTICIPANT_ROLES = new Set<PayrollParticipant['role']>([
  'sales_rep',
  'setter',
  'owner',
])

/**
 * True when commission export would resolve a plan for this user on the job sale date
 * (an active `user_comp_plans` row with a joined plan).
 */
export async function hasResolvableCompPlanForUserOnDate(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  saleDate: string | null | undefined
): Promise<boolean> {
  const ymd =
    saleDate && String(saleDate).length >= 10
      ? String(saleDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  const row = await loadActiveCompPlanForUser(supabase, userId, orgId, ymd)
  return row != null
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Sum(comp_base) per user per YYYY-MM for volume bonus tiers.
 */
export function buildMonthlyVolumeMaps(
  jobs: Array<{
    id: string
    sale_date: string | null
    salesperson_id: string | null
    commission_comp_base?: number | null
    dealer_fee_amount?: number | null
    sale_amount?: number | null
  }>,
  opportunityByProjectId: Map<string, { owner_user_id?: string | null; setter_user_id?: string | null } | null>,
  projectIdByJobId: Map<string, string>
): Map<string, number> {
  const vol = new Map<string, number>()

  for (const job of jobs) {
    const snap = buildCommissionPayrollSnapshot(job)
    const compBase = snap.compBase
    if (compBase == null || compBase <= 0) continue
    const mk = monthKeyFromSaleDate(job.sale_date)
    if (!mk) continue

    const projectId = projectIdByJobId.get(job.id)
    const opp = projectId ? opportunityByProjectId.get(projectId) ?? null : null
    const participants = collectParticipants(job, opp)

    for (const p of participants) {
      if (!VOLUME_ACCUMULATING_PARTICIPANT_ROLES.has(p.role)) continue
      const key = `${p.userId}|${mk}`
      vol.set(key, roundMoney((vol.get(key) || 0) + compBase))
    }
  }
  return vol
}

export async function loadOrgSitOutcomeIdSet(
  supabase: SupabaseClient,
  orgId: string
): Promise<Set<string>> {
  const { data: orgRow, error } = await supabase
    .from('orgs')
    .select('settings')
    .eq('id', orgId)
    .maybeSingle()
  // A query failure here must not be treated as "org has no custom sit-outcome
  // config" (which falls back to defaults and would silently compute tier bonuses
  // from the wrong outcome set) — propagate it so payroll fails closed instead.
  if (error) throw error
  const raw = orgRow?.settings as { inspection_outcomes?: InspectionOutcomeConfigRow[] } | undefined
  return getSitOutcomeNormalizedIdSet(raw?.inspection_outcomes)
}

/**
 * Per-user monthly sits (setter vs owner attribution) and install sales counts by owner,
 * aligned with dashboard sit/sale attribution.
 */
export async function buildMonthlyTierMetricMaps(
  supabase: SupabaseClient,
  orgId: string,
  volFrom: string,
  volTo: string
): Promise<{
  sitsBySetterMonth: Map<string, number>
  sitsByOwnerMonth: Map<string, number>
  salesByOwnerMonth: Map<string, number>
  /** Opportunity ids with a qualifying inspection_outcome that couldn't be dated
   * (no inspection_outcome_at, no qualifying status row) — excluded from
   * sitsBySetterMonth/sitsByOwnerMonth rather than guessed from an unrelated
   * timestamp. Payroll admins should resolve these opportunities' inspection dates. */
  skippedOpportunityIds: string[]
}> {
  const sitsBySetterMonth = new Map<string, number>()
  const sitsByOwnerMonth = new Map<string, number>()
  const salesByOwnerMonth = new Map<string, number>()
  const skippedOpportunityIds: string[] = []

  // Half-open [start, end) boundary in the org's payroll timezone (Eastern) — volFrom/
  // volTo are calendar-month first/last days, so end is Eastern midnight of the day
  // after volTo. Prevents a late-evening Eastern sit near month-end from rolling into
  // the next UTC calendar month's tier bucket.
  const { start, end } = getCustomDateRange(volFrom, volTo, EASTERN_TZ)
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const sitSet = await loadOrgSitOutcomeIdSet(supabase, orgId)
  if (sitSet.size > 0) {
    // Resolves each opportunity's FIRST qualifying sit (not whatever the
    // opportunity's inspection_outcome column currently holds) so a later
    // re-attempt can't shift which month a sit's volume-bonus tier counts
    // toward — same resolution the per-unit sit-pay calculation uses.
    // Let failures propagate: a payroll export computed from an empty sit map
    // would look valid while silently omitting every tier bonus.
    const sitOpps = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId,
      startIso,
      endIso,
      sitOutcomeIdSet: sitSet,
      eligibilityMode: 'first_qualifying',
      onSkippedForMissingTimestamp: (oppId) => skippedOpportunityIds.push(oppId),
    })
    for (const o of sitOpps) {
      const mk = getEasternMonthKey(o.inspection_outcome_at)
      if (!mk) continue
      if (o.setter_user_id) {
        const key = `${o.setter_user_id}|${mk}`
        sitsBySetterMonth.set(key, (sitsBySetterMonth.get(key) || 0) + 1)
      }
      if (o.owner_user_id) {
        const key = `${o.owner_user_id}|${mk}`
        sitsByOwnerMonth.set(key, (sitsByOwnerMonth.get(key) || 0) + 1)
      }
    }
  }

  const contracts = await fetchSupabaseAllPages<{
    customer_signed_at: string | null
    opportunity_id: string | null
    opportunities: { owner_user_id: string | null } | { owner_user_id: string | null }[] | null
  }>(async (from, to) =>
    supabase
      .from('order_form_contracts')
      .select('customer_signed_at, opportunity_id, opportunities!inner(owner_user_id, org_id)')
      .eq('org_id', orgId)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .not('customer_signed_at', 'is', null)
      .gte('customer_signed_at', startIso)
      .lt('customer_signed_at', endIso)
      .order('customer_signed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )

  const seen = new Set<string>()
  for (const c of contracts) {
    const rawOpp = c.opportunities as unknown
    const opp = (Array.isArray(rawOpp) ? rawOpp[0] : rawOpp) as
      | { owner_user_id: string | null }
      | null
      | undefined
    const owner = opp?.owner_user_id
    if (!owner) continue
    const mk = getEasternMonthKey(c.customer_signed_at)
    if (!mk) continue
    const dedupe = `${owner}|${mk}|${c.opportunity_id as string}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const key = `${owner}|${mk}`
    salesByOwnerMonth.set(key, (salesByOwnerMonth.get(key) || 0) + 1)
  }

  return { sitsBySetterMonth, sitsByOwnerMonth, salesByOwnerMonth, skippedOpportunityIds }
}

export function periodSitsAndCloseRateForParticipant(input: {
  userId: string
  monthKey: string | null
  participantRole: PayrollParticipant['role']
  sitsBySetterMonth: Map<string, number>
  sitsByOwnerMonth: Map<string, number>
  salesByOwnerMonth: Map<string, number>
}): { periodSits: number; periodClosingRatePct: number | null } {
  if (!input.monthKey) {
    return { periodSits: 0, periodClosingRatePct: null }
  }
  const key = `${input.userId}|${input.monthKey}`
  if (input.participantRole === 'setter') {
    return {
      periodSits: input.sitsBySetterMonth.get(key) || 0,
      periodClosingRatePct: null,
    }
  }
  const sits = input.sitsByOwnerMonth.get(key) || 0
  const sales = input.salesByOwnerMonth.get(key) || 0
  return {
    periodSits: sits,
    periodClosingRatePct: sits > 0 ? Math.round((sales / sits) * 1000) / 10 : null,
  }
}

/**
 * Key for one payable line inside the pool-cap calculation.
 *
 * User id alone is not enough: one person can hold two paying roles on the same
 * job (closing it and inspecting it), and those must scale as two separate lines
 * rather than collapsing into a single map entry.
 */
export function poolKey(userId: string, role: string): string {
  return `${userId}|${role}`
}

export function scaleCommissionsToPool(
  rawByUser: Map<string, number>,
  poolCap: number
): { scaled: Map<string, number>; enforced: boolean } {
  let sum = 0
  rawByUser.forEach((v) => {
    sum += v
  })
  sum = roundMoney(sum)
  if (sum <= poolCap || sum <= 0) {
    return { scaled: new Map(rawByUser), enforced: false }
  }
  // Full precision on purpose. Rounding the factor itself to cents lets the scaled
  // total drift ABOVE the cap — e.g. a $2,520 cap on $3,010 of raw commission gives
  // 0.83721..., which rounds to 0.84 and pays out $2,528.40.
  const factor = poolCap / sum
  const scaled = new Map<string, number>()
  rawByUser.forEach((v, k) => {
    scaled.set(k, roundMoney(v * factor))
  })

  // Rounding each line to cents can still leave the total a few cents over. Take
  // that drift off the largest line so the cap is a real ceiling. Ties break on the
  // lower key so the same inputs always produce the same payout split.
  let scaledTotal = 0
  scaled.forEach((v) => {
    scaledTotal += v
  })
  const drift = roundMoney(roundMoney(scaledTotal) - poolCap)
  if (drift > 0) {
    let adjustKey: string | null = null
    let adjustValue = -Infinity
    scaled.forEach((v, k) => {
      if (v > adjustValue || (v === adjustValue && adjustKey != null && k < adjustKey)) {
        adjustValue = v
        adjustKey = k
      }
    })
    if (adjustKey != null) {
      scaled.set(adjustKey, Math.max(0, roundMoney(adjustValue - drift)))
    }
  }

  return { scaled, enforced: true }
}

export function computeRawCommissionForParticipant(input: {
  plan: CompPlanForCalc
  commissionableAmount: number
  periodVolume: number
  periodSits: number
  periodClosingRatePct: number | null
  overridePercentage: number | null
}) {
  return calculateCommissionFromPlanForSale({
    plan: input.plan,
    commissionableAmount: input.commissionableAmount,
    periodVolume: input.periodVolume,
    periodSits: input.periodSits,
    periodClosingRatePct: input.periodClosingRatePct,
    overridePercentage: input.overridePercentage,
  })
}
