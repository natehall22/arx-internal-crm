import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import {
  getSitOutcomeNormalizedIdSet,
  normalizeInspectionOutcomeId,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'

function isSetterLikeRole(role?: string | null) {
  return role === 'canvasser' || role === 'setter'
}

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const timeframe = request.nextUrl.searchParams.get('timeframe') || 'week'
    const { start, end } = getDateRangeForTimeFrame(timeframe, TIMEZONE, false)

    const isAdmin = profile.role === 'admin'
    const isRegionalManager = profile.role === 'regional_manager'
    const isSalesManager = profile.role === 'sales_manager'
    const isSetter = isSetterLikeRole(profile.role)

    // Scope: which user IDs count toward this user's personal stats
    let scopeIds: string[] = [profile.id]

    if (isAdmin) {
      scopeIds = [] // admin sees all — handled by isAdmin flag
    } else if (isSalesManager && profile.team_id) {
      const { data: tm } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', profile.team_id)
      scopeIds = tm?.map(m => m.id) || [profile.id]
    } else if (isRegionalManager && profile.region_id) {
      const { data: rt } = await supabase
        .from('teams')
        .select('id')
        .eq('region_id', profile.region_id)
      const teamIds = rt?.map(t => t.id) || []
      if (teamIds.length > 0) {
        const { data: rm } = await supabase
          .from('users')
          .select('id')
          .in('team_id', teamIds)
        scopeIds = rm?.map(m => m.id) || [profile.id]
      }
    }

    const inScope = (id: string | null | undefined) =>
      isAdmin || (id != null && scopeIds.includes(id))

    // ---- LEADS (doors / contacts) ----
    let leadsQuery = supabase
      .from('leads')
      .select('id, canvass_disposition, owner_user_id')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    if (!isAdmin) {
      leadsQuery = leadsQuery.in('owner_user_id', scopeIds)
    }
    const { data: leads } = await leadsQuery

    // ---- APPOINTMENTS (inspections set) ----
    const { data: appointments } = await supabase
      .from('scheduled_appointments')
      .select('id, canvasser_user_id, closer_user_id, lead_id')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    // ---- SALES (in period) ----
    const { data: salesRows } = await supabase
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id')
      .eq('org_id', profile.org_id)
      .eq('inspection_outcome', 'sale')
      .gte('inspection_outcome_at', start.toISOString())
      .lt('inspection_outcome_at', end.toISOString())

    // ---- INSPECTIONS RAN (closer metric, in period) ----
    const { data: inspectionsRanRows } = await supabase
      .from('opportunities')
      .select('id, owner_user_id')
      .eq('org_id', profile.org_id)
      .not('inspection_outcome', 'is', null)
      .not('inspection_outcome_at', 'is', null)
      .gte('inspection_outcome_at', start.toISOString())
      .lt('inspection_outcome_at', end.toISOString())

    // ---- SIT OUTCOMES CONFIG ----
    const { data: orgRow } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      orgRow?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    )

    // ---- SITS (in period) ----
    let sitRows: { owner_user_id: string | null; setter_user_id: string | null; inspection_outcome: string | null }[] = []
    if (sitOutcomeIdSet.size > 0) {
      const { data: raw } = await supabase
        .from('opportunities')
        .select('owner_user_id, setter_user_id, inspection_outcome')
        .eq('org_id', profile.org_id)
        .not('inspection_outcome', 'is', null)
        .not('inspection_outcome_at', 'is', null)
        .gte('inspection_outcome_at', start.toISOString())
        .lt('inspection_outcome_at', end.toISOString())

      sitRows = (raw || []).filter(o =>
        sitOutcomeIdSet.has(normalizeInspectionOutcomeId(o.inspection_outcome))
      )
    }

    // ---- 30-DAY ROLLING (close rate & efficiency) ----
    const now = new Date()
    const thirtyDayStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const { data: sales30d } = await supabase
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id')
      .eq('org_id', profile.org_id)
      .eq('inspection_outcome', 'sale')
      .gte('inspection_outcome_at', thirtyDayStart.toISOString())
      .lte('inspection_outcome_at', now.toISOString())

    let sits30dRows: typeof sitRows = []
    if (sitOutcomeIdSet.size > 0) {
      const { data: raw30 } = await supabase
        .from('opportunities')
        .select('owner_user_id, setter_user_id, inspection_outcome')
        .eq('org_id', profile.org_id)
        .not('inspection_outcome', 'is', null)
        .not('inspection_outcome_at', 'is', null)
        .gte('inspection_outcome_at', thirtyDayStart.toISOString())
        .lte('inspection_outcome_at', now.toISOString())

      sits30dRows = (raw30 || []).filter(o =>
        sitOutcomeIdSet.has(normalizeInspectionOutcomeId(o.inspection_outcome))
      )
    }

    const { data: appts30d } = await supabase
      .from('scheduled_appointments')
      .select('id, closer_user_id')
      .eq('org_id', profile.org_id)
      .not('closer_user_id', 'is', null)
      .gte('scheduled_for', thirtyDayStart.toISOString())
      .lte('scheduled_for', now.toISOString())

    // ---- COMPUTE ----
    const contactDisps = ['go_back', 'hot_lead', 'not_interested', 'renter']

    const myLeads = (leads || []).filter(l => inScope(l.owner_user_id))
    const rawDoors = myLeads.length
    const rawContacts = myLeads.filter(l => contactDisps.includes(l.canvass_disposition)).length

    const myAppointments = (appointments || []).filter(a => inScope(a.canvasser_user_id))
    const inspectionsSet = myAppointments.length

    // Bonus doors/contacts from inspections not already covered by a lead
    const bonusDoors = myAppointments.filter(a => {
      if (!a.lead_id) return true
      return !myLeads.find(l => l.id === a.lead_id)
    }).length

    const bonusContacts = myAppointments.filter(a => {
      if (!a.lead_id) return true
      const lead = myLeads.find(l => l.id === a.lead_id)
      if (!lead) return true
      return !contactDisps.includes(lead.canvass_disposition)
    }).length

    const doorsKnocked = rawDoors + bonusDoors
    const contacts = rawContacts + bonusContacts

    const sales = (salesRows || []).filter(o =>
      isSetter ? inScope(o.setter_user_id) : inScope(o.owner_user_id)
    ).length

    const sits = sitRows.filter(o =>
      isSetter ? inScope(o.setter_user_id) : inScope(o.owner_user_id)
    ).length

    const inspectionsRan = (inspectionsRanRows || []).filter(o =>
      inScope(o.owner_user_id)
    ).length

    // 30-day rolling
    const sales30dCount = (sales30d || []).filter(o =>
      isSetter ? inScope(o.setter_user_id) : inScope(o.owner_user_id)
    ).length

    const sits30dCount = sits30dRows.filter(o =>
      isSetter ? inScope(o.setter_user_id) : inScope(o.owner_user_id)
    ).length

    const appts30dCount = (appts30d || []).filter(a =>
      inScope(a.closer_user_id)
    ).length

    const closeRate = sits30dCount > 0 ? (sales30dCount / sits30dCount * 100) : 0
    const efficiency = appts30dCount > 0 ? (sales30dCount / appts30dCount * 100) : 0

    return NextResponse.json({
      doorsKnocked,
      contacts,
      inspectionsSet,
      inspectionsRan,
      sits,
      sales,
      closeRate: parseFloat(closeRate.toFixed(1)),
      efficiency: parseFloat(efficiency.toFixed(1)),
    })
  } catch (error) {
    console.error('Personal stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch personal stats' }, { status: 500 })
  }
}
