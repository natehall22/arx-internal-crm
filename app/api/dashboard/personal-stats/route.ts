import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { isDashboardPersonalKpiOrgWide } from '@/lib/dashboard-personal-kpi-scope'
import { getContactDispositionIdSet } from '@/lib/sales-metrics'

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
    const normOutcomes = Array.from(sitOutcomeIdSet)
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
      salesRes,
      sitsRes,
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
      supabase.rpc('dashboard_count_install_sales_scoped', {
        p_org_id: pOrg,
        p_start: pStart,
        p_end: pEnd,
        p_scope_user_ids: scopeForRpc,
        p_attribute_by_setter: isSetter,
      }),
      normOutcomes.length === 0
        ? Promise.resolve({ data: 0, error: null })
        : supabase.rpc('dashboard_count_sits_scoped', {
            p_org_id: pOrg,
            p_start: pStart,
            p_end: pEnd,
            p_scope_user_ids: scopeForRpc,
            p_attribute_by_setter: isSetter,
            p_normalized_outcomes: normOutcomes,
          }),
      inspectionsCountQuery,
      efficiencyCountQuery,
    ])

    if (doorRes.error) throw doorRes.error
    if (contactRes.error) throw contactRes.error
    if (salesRes.error) throw salesRes.error
    if (sitsRes.error) throw sitsRes.error
    if (inspRes.error) throw inspRes.error
    if (effRes.error) throw effRes.error

    const doorsKnocked = Number(doorRes.data ?? 0)
    const contacts = Number(contactRes.data ?? 0)
    const sales = Number(salesRes.data ?? 0)
    const sits = Number(sitsRes.data ?? 0)
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
