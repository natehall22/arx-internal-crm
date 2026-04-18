import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { calculateCommissionFromPlanForSale, type CompPlanForCalc } from '@/lib/calculate-commission-from-plan'

export type PayrollParticipant = { userId: string; role: 'sales_rep' | 'setter' | 'owner' }

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
}

import type { SupabaseClient } from '@supabase/supabase-js'

type UserCompRow = {
  user_id: string
  effective_from: string
  effective_to: string | null
  override_percentage: number | null
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
    .select('user_id, effective_from, effective_to, override_percentage, comp_plans(*)')
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
    comp_plans: fallback as unknown as Record<string, unknown>,
  }
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
      const key = `${p.userId}|${mk}`
      vol.set(key, roundMoney((vol.get(key) || 0) + compBase))
    }
  }
  return vol
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
  overridePercentage: number | null
}) {
  return calculateCommissionFromPlanForSale({
    plan: input.plan,
    commissionableAmount: input.commissionableAmount,
    periodVolume: input.periodVolume,
    overridePercentage: input.overridePercentage,
  })
}
