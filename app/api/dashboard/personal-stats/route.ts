import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import {
  countSitsScoped,
  fetchEffectiveSitOpportunitiesInPeriod,
} from '@/lib/dashboard-sit-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { isDashboardPersonalKpiOrgWide } from '@/lib/dashboard-personal-kpi-scope'
import {
  INSPECTION_SET_APPOINTMENT_TYPE_OR,
} from '@/lib/inspection-set-metrics'
import {
  getAttributedSaleAgreements,
  getContactDispositionIdSet,
  SALE_AGREEMENT_TYPES,
  type SaleAgreementContractRow,
} from '@/lib/sales-metrics'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const timeframe = request.nextUrl.searchParams.get('timeframe') || 'week'
    const { start, end } = getDateRangeForTimeFrame(timeframe, TIMEZONE, false)

    const isSetter = isSetterLikeRole(profile.role)
    const orgWideKpis = isDashboardPersonalKpiOrgWide(profile.role)
    // Empty scope = whole org in dashboard_*_scoped RPCs; reps see only their id.
    const scopeForRpc = orgWideKpis ? [] : [profile.id]

    const { data: orgRow } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      orgRow?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    )
    const contactDispositionIdSet = getContactDispositionIdSet(
      orgRow?.settings?.canvass_dispositions as any[] | undefined
    )
    const dispositionIds = Array.from(contactDispositionIdSet)

    const pStart = start.toISOString()
    const pEnd = end.toISOString()
    const pOrg = profile.org_id

    let inspectionsCountQuery = supabase
      .from('scheduled_appointments')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', pOrg)
      .gte('created_at', pStart)
      .lt('created_at', pEnd)
      .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
      .neq('status', 'cancelled')
    if (!orgWideKpis) inspectionsCountQuery = inspectionsCountQuery.eq('canvasser_user_id', profile.id)

    let efficiencyCountQuery = supabase
      .from('scheduled_appointments')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', pOrg)
      .not('closer_user_id', 'is', null)
      .gte('scheduled_for', pStart)
      .lt('scheduled_for', pEnd)
    if (!orgWideKpis) efficiencyCountQuery = efficiencyCountQuery.eq('closer_user_id', profile.id)

    const [
      doorRes,
      contactRes,
      salesContractsRes,
      effectiveSitOpportunities,
      inspRes,
      effRes,
    ] = await Promise.all([
      supabase.rpc('dashboard_count_door_leads_scoped', {
        p_org_id: pOrg,
        p_start: pStart,
        p_end: pEnd,
        p_scope_user_ids: scopeForRpc,
      }),
      dispositionIds.length === 0
        ? Promise.resolve({ data: 0, error: null })
        : supabase.rpc('dashboard_count_contact_leads_scoped', {
            p_org_id: pOrg,
            p_start: pStart,
            p_end: pEnd,
            p_scope_user_ids: scopeForRpc,
            p_disposition_ids: dispositionIds,
          }),
      supabase
        .from('order_form_contracts')
        .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
        .eq('org_id', pOrg)
        .in('agreement_type', SALE_AGREEMENT_TYPES)
        .eq('status', 'completed')
        .not('customer_signed_at', 'is', null)
        .gte('customer_signed_at', pStart)
        .lt('customer_signed_at', pEnd),
      sitOutcomeIdSet.size === 0
        ? Promise.resolve([])
        : fetchEffectiveSitOpportunitiesInPeriod(supabase, {
            orgId: pOrg,
            startIso: pStart,
            endIso: pEnd,
            sitOutcomeIdSet,
          }),
      inspectionsCountQuery,
      efficiencyCountQuery,
    ])

    if (doorRes.error) throw doorRes.error
    if (contactRes.error) throw contactRes.error
    if (salesContractsRes.error) throw salesContractsRes.error
    if (inspRes.error) throw inspRes.error
    if (effRes.error) throw effRes.error

    const doorsKnocked = Number(doorRes.data ?? 0)
    const contacts = Number(contactRes.data ?? 0)
    const saleAgreements = getAttributedSaleAgreements(
      salesContractsRes.data as SaleAgreementContractRow[] | null
    )
    const sales = orgWideKpis
      ? saleAgreements.length
      : new Set(
          saleAgreements
            .filter((sale) => sale.setter_user_id === profile.id || sale.owner_user_id === profile.id)
            .map((sale) => sale.opportunity_id || sale.id)
        ).size
    const sits = countSitsScoped(effectiveSitOpportunities, scopeForRpc, isSetter)
    const inspectionsSet = inspRes.count ?? 0
    const apptCount = effRes.count ?? 0

    const closeRate = sits > 0 ? parseFloat(((sales / sits) * 100).toFixed(1)) : null
    const efficiency = apptCount > 0 ? parseFloat(((sales / apptCount) * 100).toFixed(1)) : null

    return NextResponse.json({
      doorsKnocked,
      contacts,
      inspectionsSet,
      sits,
      sales,
      closeRate,
      efficiency,
    })
  } catch (error) {
    console.error('Personal stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch personal stats' }, { status: 500 })
  }
}
