import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import {
  isPeriodScopedCompUnitType,
  type KnownCompPlanUnitType,
} from '@/lib/comp-plan-unit-types'
import { getSitOutcomeNormalizedIdSet, type InspectionOutcomeConfigRow } from '@/lib/inspection-outcomes'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { roundMoney } from '@/lib/money'

export type HybridComponentForUnitPay = {
  type: string
  rate: number
  unit_type?: string | null
  description?: string | null
}

export type CompPlanForPeriodUnitPay = {
  plan_type: string
  unit_type?: string | null
  unit_rate?: number | null
  hybrid_components?: HybridComponentForUnitPay[] | null
}

export type PeriodUnitComponentBreakdown = {
  unitType: string
  label: string
  count: number
  rate: number
  amount: number
}

export type PeriodUnitEarningsResult = {
  components: PeriodUnitComponentBreakdown[]
  total: number
  sitCount: number
  saleCount: number
}

export function extractPeriodUnitComponents(
  plan: CompPlanForPeriodUnitPay | null | undefined
): Array<{ unitType: string; rate: number }> {
  if (!plan) return []

  const pt = String(plan.plan_type || '').toLowerCase()
  const out: Array<{ unitType: string; rate: number }> = []

  if (pt === 'unit_based' && plan.unit_type && isPeriodScopedCompUnitType(plan.unit_type)) {
    out.push({
      unitType: plan.unit_type,
      rate: roundMoney(Number(plan.unit_rate) || 0),
    })
  }

  if (pt === 'hybrid' && Array.isArray(plan.hybrid_components)) {
    for (const comp of plan.hybrid_components) {
      if (comp.type !== 'per_unit' || !comp.unit_type) continue
      if (!isPeriodScopedCompUnitType(comp.unit_type)) continue
      out.push({
        unitType: comp.unit_type,
        rate: roundMoney(Number(comp.rate) || 0),
      })
    }
  }

  return out
}

export function planHasPeriodUnitPay(plan: CompPlanForPeriodUnitPay | null | undefined): boolean {
  return extractPeriodUnitComponents(plan).length > 0
}

export async function resolvePayrollPeriodWindow(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
  cutoffAt: string
): Promise<{ startIso: string; endIso: string }> {
  const { data: prev } = await supabase
    .from('payroll_periods')
    .select('cutoff_at')
    .eq('org_id', orgId)
    .lt('cutoff_at', cutoffAt)
    .neq('id', periodId)
    .order('cutoff_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const endMs = new Date(cutoffAt).getTime()
  const startMs = prev?.cutoff_at
    ? new Date(String(prev.cutoff_at)).getTime()
    : endMs - 7 * 24 * 60 * 60 * 1000

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

export async function countPeriodUnitsForUser(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    userId: string
    startIso: string
    endIso: string
    unitTypes: KnownCompPlanUnitType[]
  }
): Promise<{ sitCount: number; saleCount: number }> {
  const { orgId, userId, startIso, endIso, unitTypes } = opts
  const needsSit = unitTypes.includes('sit')
  const needsSale = unitTypes.includes('sale')

  let sitCount = 0
  let saleCount = 0

  if (needsSit) {
    const { data: orgRow } = await supabase.from('orgs').select('settings').eq('id', orgId).maybeSingle()
    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      (orgRow?.settings as { inspection_outcomes?: InspectionOutcomeConfigRow[] } | undefined)
        ?.inspection_outcomes
    )
    if (sitOutcomeIdSet.size > 0) {
      const sitOpps = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
        orgId,
        startIso,
        endIso,
        sitOutcomeIdSet,
      })
      sitCount = sitOpps.filter((o) => o.setter_user_id === userId).length
    }
  }

  if (needsSale) {
    const { data: contracts, error } = await supabase
      .from('order_form_contracts')
      .select('id, opportunity_id, customer_signed_at, opportunities!inner(setter_user_id, org_id)')
      .eq('org_id', orgId)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .not('customer_signed_at', 'is', null)
      .gte('customer_signed_at', startIso)
      .lt('customer_signed_at', endIso)

    if (error) throw error

    const seen = new Set<string>()
    for (const row of contracts || []) {
      const rawOpp = row.opportunities as unknown
      const opp = (Array.isArray(rawOpp) ? rawOpp[0] : rawOpp) as
        | { setter_user_id: string | null }
        | null
        | undefined
      const setterId = opp?.setter_user_id
      if (!setterId || setterId !== userId) continue
      const dedupeKey = `${row.opportunity_id as string}|${row.id as string}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      saleCount += 1
    }
  }

  return { sitCount, saleCount }
}

export function computePeriodUnitEarningsFromCounts(input: {
  components: Array<{ unitType: string; rate: number }>
  sitCount: number
  saleCount: number
}): PeriodUnitEarningsResult {
  const breakdown: PeriodUnitComponentBreakdown[] = []

  for (const comp of input.components) {
    const count =
      comp.unitType === 'sit'
        ? input.sitCount
        : comp.unitType === 'sale'
          ? input.saleCount
          : 0
    const amount = roundMoney(count * comp.rate)
    breakdown.push({
      unitType: comp.unitType,
      label: comp.unitType === 'sit' ? 'Sit pay' : comp.unitType === 'sale' ? 'Sale pay' : comp.unitType,
      count,
      rate: comp.rate,
      amount,
    })
  }

  const total = roundMoney(breakdown.reduce((sum, row) => sum + row.amount, 0))

  return {
    components: breakdown,
    total,
    sitCount: input.sitCount,
    saleCount: input.saleCount,
  }
}

export async function computePeriodUnitEarningsForUser(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    userId: string
    plan: CompPlanForPeriodUnitPay | null | undefined
    startIso: string
    endIso: string
  }
): Promise<PeriodUnitEarningsResult | null> {
  const components = extractPeriodUnitComponents(opts.plan)
  if (components.length === 0) return null

  const unitTypes = Array.from(new Set(components.map((c) => c.unitType))) as KnownCompPlanUnitType[]
  const counts = await countPeriodUnitsForUser(supabase, {
    orgId: opts.orgId,
    userId: opts.userId,
    startIso: opts.startIso,
    endIso: opts.endIso,
    unitTypes,
  })

  return computePeriodUnitEarningsFromCounts({
    components,
    sitCount: counts.sitCount,
    saleCount: counts.saleCount,
  })
}
