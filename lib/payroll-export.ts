import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCommissionPayrollSnapshot, isPoolCapExcludedPlanType } from '@/lib/commission-payroll'
import { calculateCommissionFromPlanForSale, type CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import {
  getSitOutcomeNormalizedIdSet,
  normalizeInspectionOutcomeId,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { roundMoney } from '@/lib/money'
import { payrollTierKey } from '@/lib/payroll-tier-key'

export type PayrollParticipant = { userId: string; role: 'sales_rep' | 'setter' | 'owner' }

export type DealCommissionRoleParticipant = {
  userId: string
  role: 'field_manager' | 'senior_manager' | 'custom'
  overrideAmount: number | null
  overridePercent: number | null
  premierPricingAmount: number | null
}

/**
 * Manager/custom roles from deal_commission_roles — apply AFTER scaleCommissionsToPool(),
 * never mixed into the main participants array used for pool scaling.
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
    .in('role', ['field_manager', 'senior_manager', 'custom'])

  if (error) {
    console.error('loadAdditiveDealCommissionParticipants', error)
    return []
  }

  return (data || []).map((row) => ({
    userId: row.user_id as string,
    role: row.role as DealCommissionRoleParticipant['role'],
    overrideAmount: row.override_amount != null ? Number(row.override_amount) : null,
    overridePercent: row.override_percent != null ? Number(row.override_percent) : null,
    premierPricingAmount:
      row.premier_pricing_amount != null ? Number(row.premier_pricing_amount) : null,
  }))
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

  if (!error && data && (data as { comp_plans?: unknown }).comp_plans) {
    return data as unknown as UserCompRow
  }

  const { data: fallback } = await supabase
    .from('comp_plans')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!fallback) return null
  return {
    user_id: userId,
    effective_from: saleDate,
    effective_to: null,
    override_percentage: null,
    hourly_rate_override: null,
    comp_plans: fallback as unknown as Record<string, unknown>,
  }
}

/** Roles that accumulate monthly volume for tier bonuses (not manager additive roles). */
const VOLUME_ACCUMULATING_PARTICIPANT_ROLES = new Set<PayrollParticipant['role']>([
  'sales_rep',
  'setter',
  'owner',
])

/**
 * True when commission export would resolve a plan for this user on the job sale date
 * (active `user_comp_plans` row with joined plan, or org default `comp_plans`).
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
      const key = payrollTierKey(p.userId, mk)
      vol.set(key, roundMoney((vol.get(key) || 0) + compBase))
    }
  }
  return vol
}

export async function loadOrgSitOutcomeIdSet(
  supabase: SupabaseClient,
  orgId: string
): Promise<Set<string>> {
  const { data: orgRow } = await supabase.from('orgs').select('settings').eq('id', orgId).maybeSingle()
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
}> {
  const sitsBySetterMonth = new Map<string, number>()
  const sitsByOwnerMonth = new Map<string, number>()
  const salesByOwnerMonth = new Map<string, number>()

  const startIso = `${volFrom}T00:00:00.000Z`
  const endIso = `${volTo}T23:59:59.999Z`

  const sitSet = await loadOrgSitOutcomeIdSet(supabase, orgId)
  if (sitSet.size > 0) {
    const { data: opps, error: oppErr } = await supabase
      .from('opportunities')
      .select('setter_user_id, owner_user_id, inspection_outcome, inspection_outcome_at')
      .eq('org_id', orgId)
      .not('inspection_outcome', 'is', null)
      .not('inspection_outcome_at', 'is', null)
      .gte('inspection_outcome_at', startIso)
      .lte('inspection_outcome_at', endIso)

    if (oppErr) {
      console.error('buildMonthlyTierMetricMaps opportunities', oppErr)
    } else {
      for (const o of opps || []) {
        const norm = normalizeInspectionOutcomeId(o.inspection_outcome as string | null)
        if (!sitSet.has(norm)) continue
        const mk = monthKeyFromSaleDate(o.inspection_outcome_at as string | null)
        if (!mk) continue
        const su = o.setter_user_id as string | null | undefined
        const ou = o.owner_user_id as string | null | undefined
        if (su) {
          const key = payrollTierKey(su, mk)
          sitsBySetterMonth.set(key, (sitsBySetterMonth.get(key) || 0) + 1)
        }
        if (ou) {
          const key = payrollTierKey(ou, mk)
          sitsByOwnerMonth.set(key, (sitsByOwnerMonth.get(key) || 0) + 1)
        }
      }
    }
  }

  const { data: contracts, error: cErr } = await supabase
    .from('order_form_contracts')
    .select('customer_signed_at, opportunity_id, opportunities!inner(owner_user_id, org_id)')
    .eq('org_id', orgId)
    .in('agreement_type', SALE_AGREEMENT_TYPES)
    .eq('status', 'completed')
    .not('customer_signed_at', 'is', null)
    .gte('customer_signed_at', startIso)
    .lte('customer_signed_at', endIso)

  if (cErr) {
    console.error('buildMonthlyTierMetricMaps contracts', cErr)
  } else {
    const seen = new Set<string>()
    for (const c of contracts || []) {
      const rawOpp = c.opportunities as unknown
      const opp = (Array.isArray(rawOpp) ? rawOpp[0] : rawOpp) as
        | { owner_user_id: string | null }
        | null
        | undefined
      const owner = opp?.owner_user_id
      if (!owner) continue
      const mk = monthKeyFromSaleDate(c.customer_signed_at as string | null)
      if (!mk) continue
      const dedupe = `${owner}|${mk}|${c.opportunity_id as string}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      const key = payrollTierKey(owner, mk)
      salesByOwnerMonth.set(key, (salesByOwnerMonth.get(key) || 0) + 1)
    }
  }

  return { sitsBySetterMonth, sitsByOwnerMonth, salesByOwnerMonth }
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
  const key = payrollTierKey(input.userId, input.monthKey)
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
  const factor = roundMoney(poolCap / sum)
  const scaled = new Map<string, number>()
  rawByUser.forEach((v, k) => {
    scaled.set(k, roundMoney(v * factor))
  })
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
