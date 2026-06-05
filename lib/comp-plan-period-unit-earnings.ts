import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isPeriodScopedCompUnitType,
  type KnownCompPlanUnitType,
} from '@/lib/comp-plan-unit-types'
import { resolveCustomerDisplayName } from '@/lib/customers'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
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

export type PeriodUnitPayLine = {
  unitType: 'sit' | 'sale'
  payTypeLabel: string
  amount: number
  rate: number
  customerName: string
  eventDate: string | null
  opportunityId: string | null
  leadId: string | null
  contractId: string | null
}

export type PeriodUnitEarningsResult = {
  components: PeriodUnitComponentBreakdown[]
  lines: PeriodUnitPayLine[]
  total: number
  sitCount: number
  saleCount: number
}

export function resolveOpportunityCustomerName(input: {
  leadHomeownerName?: string | null
  customerName?: string | null
  addressText?: string | null
  opportunityId?: string | null
}): string {
  return resolveCustomerDisplayName({
    name: input.leadHomeownerName || input.customerName,
    address_text: input.addressText,
    fallbackIdHint: input.opportunityId?.slice(0, 8) ?? null,
  })
}

export function resolveSaleCustomerName(input: {
  contractCustomerName?: string | null
  leadHomeownerName?: string | null
  customerName?: string | null
  addressText?: string | null
  opportunityId?: string | null
}): string {
  const contractName = (input.contractCustomerName || '').trim()
  if (contractName) return contractName
  return resolveOpportunityCustomerName({
    leadHomeownerName: input.leadHomeownerName,
    customerName: input.customerName,
    addressText: input.addressText,
    opportunityId: input.opportunityId,
  })
}

function formatEventDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return String(iso).slice(0, 10)
}

function sortPeriodUnitPayLines(lines: PeriodUnitPayLine[]): PeriodUnitPayLine[] {
  return [...lines].sort((a, b) => {
    const dateCmp = (b.eventDate || '').localeCompare(a.eventDate || '')
    if (dateCmp !== 0) return dateCmp
    return a.customerName.localeCompare(b.customerName)
  })
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

export async function fetchPeriodUnitPayLinesForUser(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    userId: string
    startIso: string
    endIso: string
    unitTypes: KnownCompPlanUnitType[]
    sitRate: number
    saleRate: number
  }
): Promise<{ sitLines: PeriodUnitPayLine[]; saleLines: PeriodUnitPayLine[] }> {
  const { orgId, userId, startIso, endIso, unitTypes, sitRate, saleRate } = opts
  const needsSit = unitTypes.includes('sit')
  const needsSale = unitTypes.includes('sale')

  const sitLines: PeriodUnitPayLine[] = []
  const saleLines: PeriodUnitPayLine[] = []

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
      const userSitOpps = sitOpps.filter((o) => o.setter_user_id === userId)
      const oppIds = userSitOpps.map((o) => o.id)

      const oppDetailsById = new Map<
        string,
        {
          leadHomeownerName: string | null
          customerName: string | null
          addressText: string | null
        }
      >()

      if (oppIds.length > 0) {
        const { data: oppRows, error: oppErr } = await supabase
          .from('opportunities')
          .select(
            'id, lead_id, address_text, leads(homeowner_name), customers(name)'
          )
          .eq('org_id', orgId)
          .in('id', oppIds)

        if (oppErr) throw oppErr

        for (const row of oppRows || []) {
          const rawLead = row.leads as unknown
          const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as
            | { homeowner_name?: string | null }
            | null
            | undefined
          const rawCustomer = row.customers as unknown
          const customer = (Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer) as
            | { name?: string | null }
            | null
            | undefined
          oppDetailsById.set(row.id as string, {
            leadHomeownerName: lead?.homeowner_name ?? null,
            customerName: customer?.name ?? null,
            addressText: (row.address_text as string) ?? null,
          })
        }
      }

      for (const opp of userSitOpps) {
        const details = oppDetailsById.get(opp.id)
        sitLines.push({
          unitType: 'sit',
          payTypeLabel: 'Sit pay',
          amount: sitRate,
          rate: sitRate,
          customerName: resolveOpportunityCustomerName({
            leadHomeownerName: details?.leadHomeownerName,
            customerName: details?.customerName,
            addressText: details?.addressText,
            opportunityId: opp.id,
          }),
          eventDate: formatEventDate(opp.inspection_outcome_at),
          opportunityId: opp.id,
          leadId: opp.lead_id,
          contractId: null,
        })
      }
    }
  }

  if (needsSale) {
    const { data: contracts, error } = await supabase
      .from('order_form_contracts')
      .select(
        `id,
         opportunity_id,
         customer_name,
         customer_signed_at,
         opportunities!inner(
           setter_user_id,
           org_id,
           lead_id,
           address_text,
           leads(homeowner_name),
           customers(name)
         )`
      )
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
        | {
            setter_user_id: string | null
            lead_id?: string | null
            address_text?: string | null
            leads?: { homeowner_name?: string | null } | { homeowner_name?: string | null }[] | null
            customers?: { name?: string | null } | { name?: string | null }[] | null
          }
        | null
        | undefined
      const setterId = opp?.setter_user_id
      if (!setterId || setterId !== userId) continue
      const dedupeKey = `${row.opportunity_id as string}|${row.id as string}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const rawLead = opp?.leads as unknown
      const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as
        | { homeowner_name?: string | null }
        | null
        | undefined
      const rawCustomer = opp?.customers as unknown
      const customer = (Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer) as
        | { name?: string | null }
        | null
        | undefined

      saleLines.push({
        unitType: 'sale',
        payTypeLabel: 'Sale pay',
        amount: saleRate,
        rate: saleRate,
        customerName: resolveSaleCustomerName({
          contractCustomerName: row.customer_name as string | null,
          leadHomeownerName: lead?.homeowner_name ?? null,
          customerName: customer?.name ?? null,
          addressText: opp?.address_text ?? null,
          opportunityId: row.opportunity_id as string,
        }),
        eventDate: formatEventDate(row.customer_signed_at as string),
        opportunityId: row.opportunity_id as string,
        leadId: opp?.lead_id ?? null,
        contractId: row.id as string,
      })
    }
  }

  return { sitLines, saleLines }
}

/** @deprecated Use fetchPeriodUnitPayLinesForUser — kept for count-only callers if any. */
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
  const { sitLines, saleLines } = await fetchPeriodUnitPayLinesForUser(supabase, {
    ...opts,
    sitRate: 0,
    saleRate: 0,
  })
  return { sitCount: sitLines.length, saleCount: saleLines.length }
}

export function computePeriodUnitEarningsFromCounts(input: {
  components: Array<{ unitType: string; rate: number }>
  sitCount: number
  saleCount: number
  lines?: PeriodUnitPayLine[]
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
    lines: input.lines ?? [],
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
  const sitRate = components.find((c) => c.unitType === 'sit')?.rate ?? 0
  const saleRate = components.find((c) => c.unitType === 'sale')?.rate ?? 0
  const { sitLines, saleLines } = await fetchPeriodUnitPayLinesForUser(supabase, {
    orgId: opts.orgId,
    userId: opts.userId,
    startIso: opts.startIso,
    endIso: opts.endIso,
    unitTypes,
    sitRate,
    saleRate,
  })
  const lines = sortPeriodUnitPayLines([...sitLines, ...saleLines])

  return computePeriodUnitEarningsFromCounts({
    components,
    sitCount: sitLines.length,
    saleCount: saleLines.length,
    lines,
  })
}
