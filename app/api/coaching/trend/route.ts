import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import {
  getSitOutcomeNormalizedIdSet,
  normalizeInspectionOutcomeId,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import {
  getAttributedInstallationSales,
  SALE_AGREEMENT_TYPES,
  type InstallationSaleContractRow,
} from '@/lib/sales-metrics'
import { countsAsInspectionSet } from '@/lib/inspection-set-metrics'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'
const MANAGER_ROLES = ['admin', 'sales_manager', 'setter_manager', 'regional_manager']

function isManager(role: string) {
  return MANAGER_ROLES.includes(role)
}

function isSetterLike(role: string) {
  return role === 'canvasser' || role === 'setter'
}

type Lookback = '4w' | '2mo' | '3mo' | '6mo' | '12mo' | 'ytd' | 'prev_quarter'

/** ET midnight (start of day) → UTC Date */
function etDayStart(year: number, month: number, day: number): Date {
  return fromZonedTime(new Date(year, month, day, 0, 0, 0, 0), TIMEZONE)
}

/** ET end-of-day (23:59:59.999) → UTC Date */
function etDayEnd(year: number, month: number, day: number): Date {
  return fromZonedTime(new Date(year, month, day, 23, 59, 59, 999), TIMEZONE)
}

function getBuckets(lookback: Lookback): { label: string; start: Date; end: Date }[] {
  // Use toZonedTime so year/month/date accessors reflect ET, not server local time
  const nowEt = toZonedTime(new Date(), TIMEZONE)
  const y = nowEt.getFullYear()
  const mo = nowEt.getMonth()
  const d = nowEt.getDate()
  const buckets: { label: string; start: Date; end: Date }[] = []

  if (lookback === '4w' || lookback === '2mo') {
    const weeks = lookback === '4w' ? 4 : 8
    for (let i = weeks - 1; i >= 0; i--) {
      const endDay  = new Date(y, mo, d - i * 7)
      const startDay = new Date(y, mo, d - i * 7 - 6)
      const start = etDayStart(startDay.getFullYear(), startDay.getMonth(), startDay.getDate())
      const end   = etDayEnd(endDay.getFullYear(), endDay.getMonth(), endDay.getDate())
      const label = startDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      buckets.push({ label, start, end })
    }
    return buckets
  }

  if (lookback === 'ytd') {
    const monthCount = mo + 1
    for (let i = 0; i < monthCount; i++) {
      const startDay = new Date(y, i, 1)
      const endDay   = new Date(y, i + 1, 0) // last day of month
      const start = etDayStart(startDay.getFullYear(), startDay.getMonth(), startDay.getDate())
      const end   = etDayEnd(endDay.getFullYear(), endDay.getMonth(), endDay.getDate())
      const label = startDay.toLocaleDateString('en-US', { month: 'short' })
      buckets.push({ label, start, end })
    }
    return buckets
  }

  if (lookback === 'prev_quarter') {
    const currentQ = Math.floor(mo / 3)
    const prevQ = currentQ === 0 ? 3 : currentQ - 1
    const year = currentQ === 0 ? y - 1 : y
    for (let m = 0; m < 3; m++) {
      const month = prevQ * 3 + m
      const startDay = new Date(year, month, 1)
      const endDay   = new Date(year, month + 1, 0)
      const start = etDayStart(startDay.getFullYear(), startDay.getMonth(), startDay.getDate())
      const end   = etDayEnd(endDay.getFullYear(), endDay.getMonth(), endDay.getDate())
      const label = startDay.toLocaleDateString('en-US', { month: 'short' })
      buckets.push({ label, start, end })
    }
    return buckets
  }

  // 3mo, 6mo, 12mo
  const monthMap: Record<string, number> = { '3mo': 3, '6mo': 6, '12mo': 12 }
  const months = monthMap[lookback] ?? 4
  for (let i = months - 1; i >= 0; i--) {
    const startDay = new Date(y, mo - i, 1)
    const endDay   = new Date(y, mo - i + 1, 0)
    const start = etDayStart(startDay.getFullYear(), startDay.getMonth(), startDay.getDate())
    const end   = etDayEnd(endDay.getFullYear(), endDay.getMonth(), endDay.getDate())
    const label = startDay.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    buckets.push({ label, start, end })
  }
  return buckets
}

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const params = request.nextUrl.searchParams
    const lookback = (params.get('lookback') || '3mo') as Lookback
    const userId = params.get('userId') || null

    // Access control
    if (userId && userId !== profile.id && !isManager(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Determine which members to return
    let memberIds: string[] = []
    if (userId) {
      memberIds = [userId]
    } else if (isManager(profile.role)) {
      // Get scoped team members
      let membersQuery = supabase
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .neq('show_in_reports', false)

      if (profile.role === 'sales_manager' && profile.team_id) {
        membersQuery = membersQuery.eq('team_id', profile.team_id)
      } else if (profile.role === 'setter_manager' && profile.team_id) {
        membersQuery = membersQuery.eq('team_id', profile.team_id)
      } else if (profile.role === 'regional_manager' && profile.region_id) {
        const { data: teams } = await supabase
          .from('teams')
          .select('id')
          .eq('region_id', profile.region_id)
        const teamIds = teams?.map(t => t.id) || []
        if (teamIds.length === 0) {
          return NextResponse.json({
            members: [],
            lookback,
            bucketCount: getBuckets(lookback).length,
          })
        }
        membersQuery = membersQuery.in('team_id', teamIds)
      }

      const { data: members } = await membersQuery
      memberIds = members?.map(m => m.id) || []
    } else {
      memberIds = [profile.id]
    }

    if (memberIds.length === 0) {
      return NextResponse.json({ members: [] })
    }

    // Fetch member details (team_id → region for admin drill-down)
    const { data: memberDetails } = await supabase
      .from('users')
      .select('id, full_name, role, team_id')
      .in('id', memberIds)
      .eq('org_id', profile.org_id)

    const teamIds = Array.from(
      new Set((memberDetails || []).map(m => m.team_id).filter(Boolean) as string[])
    )
    const teamToRegion: Record<string, string | null> = {}
    const regionNames: Record<string, string> = {}
    if (teamIds.length > 0) {
      const { data: teamRows } = await supabase
        .from('teams')
        .select('id, region_id')
        .in('id', teamIds)
        .eq('org_id', profile.org_id)
      const regionIds = Array.from(
        new Set((teamRows || []).map(t => t.region_id).filter(Boolean) as string[])
      )
      for (const t of teamRows || []) {
        teamToRegion[t.id] = t.region_id
      }
      if (regionIds.length > 0) {
        const { data: regionRows } = await supabase
          .from('regions')
          .select('id, name')
          .in('id', regionIds)
          .eq('org_id', profile.org_id)
        for (const r of regionRows || []) {
          regionNames[r.id] = r.name
        }
      }
    }

    let viewerRegion: { id: string; name: string } | null = null
    if (profile.role === 'regional_manager' && profile.region_id) {
      const { data: vr } = await supabase
        .from('regions')
        .select('id, name')
        .eq('id', profile.region_id)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (vr) viewerRegion = { id: vr.id, name: vr.name }
    }

    // Get sit outcome config
    const { data: orgData } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      orgData?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    )

    const buckets = getBuckets(lookback)
    const overallStart = buckets[0].start
    const overallEnd = buckets[buckets.length - 1].end

    // Fetch all data in the full range — single queries, bucket in memory
    const [apptRes, sitRes, saleRes] = await Promise.all([
      supabase
        .from('scheduled_appointments')
        .select('id, canvasser_user_id, created_at, appointment_type, status')
        .eq('org_id', profile.org_id)
        .in('canvasser_user_id', memberIds)
        .gte('created_at', overallStart.toISOString())
        .lt('created_at', overallEnd.toISOString()),
      supabase
        .from('opportunities')
        .select('id, owner_user_id, setter_user_id, inspection_outcome, inspection_outcome_at')
        .eq('org_id', profile.org_id)
        .not('inspection_outcome', 'is', null)
        .not('inspection_outcome_at', 'is', null)
        .gte('inspection_outcome_at', overallStart.toISOString())
        .lt('inspection_outcome_at', overallEnd.toISOString()),
      supabase
        .from('order_form_contracts')
        .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
        .eq('org_id', profile.org_id)
        .in('agreement_type', SALE_AGREEMENT_TYPES)
        .eq('status', 'completed')
        .not('customer_signed_at', 'is', null)
        .gte('customer_signed_at', overallStart.toISOString())
        .lt('customer_signed_at', overallEnd.toISOString())
        .order('customer_signed_at', { ascending: false }),
    ])

    const allAppts = apptRes.data || []
    const allSitRows = (sitRes.data || []).filter(o =>
      sitOutcomeIdSet.has(normalizeInspectionOutcomeId(o.inspection_outcome))
    )
    const allSales = getAttributedInstallationSales(
      saleRes.data as InstallationSaleContractRow[] | null
    )

    const result = (memberDetails || []).map(member => {
      const bucketed = buckets.map(bucket => {
        const inBucket = (dateStr: string) => {
          const d = new Date(dateStr)
          return d >= bucket.start && d <= bucket.end
        }

        const sets = allAppts.filter(
          (a) =>
            a.canvasser_user_id === member.id &&
            inBucket(a.created_at) &&
            countsAsInspectionSet(a)
        ).length

        const sits = allSitRows.filter(o => {
          const attr = isSetterLike(member.role) ? o.setter_user_id : o.owner_user_id
          return attr === member.id && inBucket(o.inspection_outcome_at)
        }).length

        const sales = allSales.filter(o => {
          const attr = isSetterLike(member.role) ? o.setter_user_id : o.owner_user_id
          return attr === member.id && o.signed_at && inBucket(o.signed_at)
        }).length

        return { label: bucket.label, sets, sits, sales }
      })

      // Trend: compare last bucket sits vs avg of prior buckets
      const last = bucketed[bucketed.length - 1]
      const prior = bucketed.slice(0, -1)
      const priorAvg = prior.length > 0
        ? prior.reduce((s, b) => s + b.sits, 0) / prior.length
        : null
      const trend = priorAvg === null ? 'flat'
        : last.sits > priorAvg ? 'up'
        : last.sits < priorAvg ? 'down'
        : 'flat'

      const tid = member.team_id
      const rid = tid ? teamToRegion[tid] ?? null : null

      return {
        id: member.id,
        name: member.full_name || 'Unknown',
        role: member.role,
        trend,
        buckets: bucketed,
        totals: {
          sets: bucketed.reduce((s, b) => s + b.sets, 0),
          sits: bucketed.reduce((s, b) => s + b.sits, 0),
          sales: bucketed.reduce((s, b) => s + b.sales, 0),
        },
        team_id: tid ?? null,
        region_id: rid,
        region_name: rid ? regionNames[rid] ?? null : null,
      }
    })

    return NextResponse.json({
      members: result,
      lookback,
      bucketCount: buckets.length,
      viewerRegion,
    })
  } catch (error) {
    console.error('[coaching/trend]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
