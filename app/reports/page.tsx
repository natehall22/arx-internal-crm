'use client'

import { useCallback, useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import { getReportScope, can, getRoleDisplayName } from '@/lib/permissions'
import type { UserRole, User, Team, Region } from '@/lib/types/database'
import {
  getSitOutcomeNormalizedIdSet,
  normalizeInspectionOutcomeId,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { getContactDispositionIdSet, isCanvassDoorLead, isContactDisposition } from '@/lib/sales-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'

type ReportMetrics = {
  doorsKnocked: number
  contacts: number
  inspectionsSet: number
  opportunitiesCreated: number
  contractsSigned: number
  projectsCompleted: number
  inspectionsRun: number
  closeRate: number
}

type UserMetrics = User & ReportMetrics
type TeamMetrics = Team & ReportMetrics & { members: UserMetrics[] }
type RegionMetrics = Region & ReportMetrics & { teams: TeamMetrics[] }

type DateRange = '7d' | '30d' | '90d' | 'ytd' | 'all'

type OutcomeMetricRow = {
  inspection_outcome: string | null
  inspection_outcome_at?: string | null
}

function userOutcomeColumn(role: string | null | undefined) {
  return isSetterLikeRole(role || '') ? 'setter_user_id' : 'owner_user_id'
}

/** Same ids as report builder — drives GET date filter via POST override */
const CUSTOM_REPORT_DATE_RANGES: { id: string; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
]

export default function ReportsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange>('30d')
  const [viewLevel, setViewLevel] = useState<'org' | 'region' | 'team' | 'user'>('org')
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  
  const [orgMetrics, setOrgMetrics] = useState<ReportMetrics | null>(null)
  const [regions, setRegions] = useState<RegionMetrics[]>([])
  const [teams, setTeams] = useState<TeamMetrics[]>([])
  const [users, setUsers] = useState<UserMetrics[]>([])
  const [closeRateHistory, setCloseRateHistory] = useState<{ date: string; rate: number; inspections: number; sales: number }[]>([])
  const [customReports, setCustomReports] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'custom' | 'forecast'>('overview')

  useEffect(() => {
    loadCurrentUser()
    loadCustomReports()
  }, [])

  useEffect(() => {
    if (currentUser) {
      loadMetrics()
    }
  }, [currentUser, dateRange, viewLevel, selectedRegionId, selectedTeamId])

  const loadCurrentUser = async () => {
    try {
      const res = await fetch('/api/reports/builder')
      if (res.ok) {
        const data = await res.json()
        setCurrentUser(data.profile)
      }
    } catch (error) {
      console.error('Failed to load user:', error)
    }
    setLoading(false)
  }

  const loadCustomReports = async () => {
    try {
      const res = await fetch('/api/reports/custom')
      const data = await res.json()
      
      if (!res.ok) {
        console.error('Failed to load custom reports:', data.error, data.details)
        return
      }
      
      console.log('Loaded custom reports:', data.reports?.length || 0, 'reports')
      setCustomReports(data.reports || [])
    } catch (error) {
      console.error('Failed to load custom reports:', error)
    }
  }

  const getDateFilter = () => {
    const now = new Date()
    switch (dateRange) {
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
      case 'ytd':
        return new Date(now.getFullYear(), 0, 1).toISOString()
      case 'all':
        return new Date(2000, 0, 1).toISOString()
    }
  }

  const loadMetrics = async () => {
    if (!currentUser) return
    setLoading(true)

    const supabase = createClientBrowser()
    const dateFilter = getDateFilter()
    const scope = getReportScope(currentUser.role as UserRole)
    const orgId = currentUser.org_id

    // Load org-level metrics
    const [leadsRes, oppsRes, outcomeOppsRes, appointmentsRes, projectsRes, statusUpdatesRes, orgRes] = await Promise.all([
      supabase
        .from('leads')
        .select('id, status, source, canvass_disposition, created_at, owner_user_id')
        .eq('org_id', orgId)
        .gte('created_at', dateFilter),
      supabase
        .from('opportunities')
        .select('id, status, inspection_outcome, inspection_outcome_at, created_at, owner_user_id, setter_user_id')
        .eq('org_id', orgId)
        .gte('created_at', dateFilter),
      supabase
        .from('opportunities')
        .select('id, status, inspection_outcome, inspection_outcome_at, owner_user_id, setter_user_id')
        .eq('org_id', orgId)
        .not('inspection_outcome', 'is', null)
        .not('inspection_outcome_at', 'is', null)
        .gte('inspection_outcome_at', dateFilter),
      supabase
        .from('scheduled_appointments')
        .select('id, canvasser_user_id, created_at')
        .eq('org_id', orgId)
        .gte('created_at', dateFilter),
      supabase
        .from('projects')
        .select('id, status, created_at')
        .eq('org_id', orgId)
        .gte('created_at', dateFilter),
      supabase
        .from('inspection_status_updates')
        .select('id, outcome, completed_at, closer_user_id')
        .eq('org_id', orgId)
        .gte('completed_at', dateFilter),
      supabase
        .from('orgs')
        .select('settings')
        .eq('id', orgId)
        .single(),
    ])

    const leads = leadsRes.data || []
    const opps = oppsRes.data || []
    const outcomeOpps = outcomeOppsRes.data || []
    const appointments = appointmentsRes.data || []
    const projects = projectsRes.data || []
    const statusUpdates = statusUpdatesRes.data || []
    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      orgRes.data?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    )
    const contactDispositionIdSet = getContactDispositionIdSet(
      orgRes.data?.settings?.canvass_dispositions as any[] | undefined
    )
    const calculateCloseMetrics = (rows: OutcomeMetricRow[]) => {
      const inspectionsRun = rows.filter(o =>
        sitOutcomeIdSet.has(normalizeInspectionOutcomeId(o.inspection_outcome))
      ).length
      const sales = rows.filter(o => normalizeInspectionOutcomeId(o.inspection_outcome) === 'sale').length
      return {
        inspectionsRun,
        sales,
        closeRate: inspectionsRun > 0 ? (sales / inspectionsRun * 100) : 0,
      }
    }

    const orgCloseMetrics = calculateCloseMetrics(outcomeOpps)

    const orgMetricsData: ReportMetrics = {
      doorsKnocked: leads.filter(isCanvassDoorLead).length,
      contacts: leads.filter(l => isCanvassDoorLead(l) && isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
      inspectionsSet: appointments.length,
      opportunitiesCreated: opps.length,
      contractsSigned: orgCloseMetrics.sales,
      projectsCompleted: projects.filter(p => p.status === 'complete').length,
      inspectionsRun: orgCloseMetrics.inspectionsRun,
      closeRate: orgCloseMetrics.closeRate,
    }

    setOrgMetrics(orgMetricsData)

    // Calculate close rate history by week
    const weeklyData: Record<string, { inspections: number; sales: number }> = {}
    outcomeOpps.forEach(opp => {
      const date = new Date(opp.inspection_outcome_at!)
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const weekKey = weekStart.toISOString().split('T')[0]
      
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { inspections: 0, sales: 0 }
      }
      if (sitOutcomeIdSet.has(normalizeInspectionOutcomeId(opp.inspection_outcome))) {
        weeklyData[weekKey].inspections++
      }
      if (normalizeInspectionOutcomeId(opp.inspection_outcome) === 'sale') {
        weeklyData[weekKey].sales++
      }
    })

    const history = Object.entries(weeklyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        inspections: data.inspections,
        sales: data.sales,
        rate: data.inspections > 0 ? (data.sales / data.inspections * 100) : 0,
      }))
    
    setCloseRateHistory(history)

    // Load regions if user can view them
    if (scope === 'all' || scope === 'region') {
      const { data: regionsData } = await supabase
        .from('regions')
        .select('*')
        .eq('org_id', orgId)
        .order('name')

      // For each region, calculate metrics
      const regionsWithMetrics: RegionMetrics[] = []
      for (const region of regionsData || []) {
        // Get teams in this region
        const { data: regionTeams } = await supabase
          .from('teams')
          .select('*')
          .eq('org_id', orgId)
          .eq('region_id', region.id)

        // Get users in those teams
        const teamIds = (regionTeams || []).map(t => t.id)
        const { data: regionUsers } = await supabase
          .from('users')
          .select('id')
          .eq('org_id', orgId)
          .in('team_id', teamIds.length > 0 ? teamIds : ['none'])

        const userIds = (regionUsers || []).map(u => u.id)

        // Get leads for those users (doors knocked by setter)
        const { data: regionLeads } = await supabase
          .from('leads')
          .select('id, status, source, canvass_disposition')
          .eq('org_id', orgId)
          .in('owner_user_id', userIds.length > 0 ? userIds : ['none'])
          .gte('created_at', dateFilter)

        const { data: regionAppointments } = await supabase
          .from('scheduled_appointments')
          .select('id, canvasser_user_id')
          .eq('org_id', orgId)
          .in('canvasser_user_id', userIds.length > 0 ? userIds : ['none'])
          .gte('created_at', dateFilter)

        // Get opportunities OWNED by users in this region (created pipeline)
        const { data: regionOwnedOpps } = await supabase
          .from('opportunities')
          .select('id, status')
          .eq('org_id', orgId)
          .in('owner_user_id', userIds.length > 0 ? userIds : ['none'])
          .gte('created_at', dateFilter)

        let regionOutcomeOpps: OutcomeMetricRow[] = []
        if (userIds.length > 0) {
          const { data } = await supabase
            .from('opportunities')
            .select('id, status, inspection_outcome, inspection_outcome_at')
            .eq('org_id', orgId)
            .or(`owner_user_id.in.(${userIds.join(',')}),setter_user_id.in.(${userIds.join(',')})`)
            .not('inspection_outcome', 'is', null)
            .not('inspection_outcome_at', 'is', null)
            .gte('inspection_outcome_at', dateFilter)
          regionOutcomeOpps = data || []
        }

        const regionCloseMetrics = calculateCloseMetrics(regionOutcomeOpps)
        
        regionsWithMetrics.push({
          ...region,
          doorsKnocked: (regionLeads || []).filter(isCanvassDoorLead).length,
          contacts: (regionLeads || []).filter(l => isCanvassDoorLead(l) && isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
          inspectionsSet: (regionAppointments || []).length,
          opportunitiesCreated: (regionOwnedOpps || []).length,
          contractsSigned: regionCloseMetrics.sales,
          projectsCompleted: 0,
          inspectionsRun: regionCloseMetrics.inspectionsRun,
          closeRate: regionCloseMetrics.closeRate,
          teams: [],
        })
      }

      setRegions(regionsWithMetrics)
    }

    // Load teams if viewing team level
    if (selectedRegionId || scope === 'team') {
      let teamsQuery = supabase.from('teams').select('*').order('name')
      teamsQuery = teamsQuery.eq('org_id', orgId)
      
      if (selectedRegionId) {
        teamsQuery = teamsQuery.eq('region_id', selectedRegionId)
      } else if (currentUser.team_id) {
        teamsQuery = teamsQuery.eq('id', currentUser.team_id)
      }

      const { data: teamsData } = await teamsQuery

      const teamsWithMetrics: TeamMetrics[] = []
      for (const team of teamsData || []) {
        const { data: teamUsers } = await supabase
          .from('users')
          .select('id')
          .eq('org_id', orgId)
          .eq('team_id', team.id)

        const userIds = (teamUsers || []).map(u => u.id)

        const { data: teamLeads } = await supabase
          .from('leads')
          .select('id, status, source, canvass_disposition')
          .eq('org_id', orgId)
          .in('owner_user_id', userIds.length > 0 ? userIds : ['none'])
          .gte('created_at', dateFilter)

        const { data: teamAppointments } = await supabase
          .from('scheduled_appointments')
          .select('id, canvasser_user_id')
          .eq('org_id', orgId)
          .in('canvasser_user_id', userIds.length > 0 ? userIds : ['none'])
          .gte('created_at', dateFilter)

        // Get opportunities OWNED by users in this team (created pipeline)
        const { data: teamOwnedOpps } = await supabase
          .from('opportunities')
          .select('id, status')
          .eq('org_id', orgId)
          .in('owner_user_id', userIds.length > 0 ? userIds : ['none'])
          .gte('created_at', dateFilter)

        let teamOutcomeOpps: OutcomeMetricRow[] = []
        if (userIds.length > 0) {
          const { data } = await supabase
            .from('opportunities')
            .select('id, status, inspection_outcome, inspection_outcome_at')
            .eq('org_id', orgId)
            .or(`owner_user_id.in.(${userIds.join(',')}),setter_user_id.in.(${userIds.join(',')})`)
            .not('inspection_outcome', 'is', null)
            .not('inspection_outcome_at', 'is', null)
            .gte('inspection_outcome_at', dateFilter)
          teamOutcomeOpps = data || []
        }

        const teamCloseMetrics = calculateCloseMetrics(teamOutcomeOpps)

        teamsWithMetrics.push({
          ...team,
          doorsKnocked: (teamLeads || []).filter(isCanvassDoorLead).length,
          contacts: (teamLeads || []).filter(l => isCanvassDoorLead(l) && isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
          inspectionsSet: (teamAppointments || []).length,
          opportunitiesCreated: (teamOwnedOpps || []).length,
          contractsSigned: teamCloseMetrics.sales,
          projectsCompleted: 0,
          inspectionsRun: teamCloseMetrics.inspectionsRun,
          closeRate: teamCloseMetrics.closeRate,
          members: [],
        })
      }

      setTeams(teamsWithMetrics)
    }

    // Load individual users if viewing user level
    if (selectedTeamId || scope === 'own') {
      let usersQuery = supabase.from('users').select('*').eq('org_id', orgId).eq('active', true).order('full_name')
      
      if (selectedTeamId) {
        usersQuery = usersQuery.eq('team_id', selectedTeamId)
      } else if (scope === 'own') {
        usersQuery = usersQuery.eq('id', currentUser.id)
      }

      const { data: usersData } = await usersQuery

      const usersWithMetrics: UserMetrics[] = []
      for (const user of usersData || []) {
        const { data: userLeads } = await supabase
          .from('leads')
          .select('id, status, source, canvass_disposition')
          .eq('org_id', orgId)
          .eq('owner_user_id', user.id)
          .gte('created_at', dateFilter)

        const { data: userAppointments } = await supabase
          .from('scheduled_appointments')
          .select('id, canvasser_user_id')
          .eq('org_id', orgId)
          .eq('canvasser_user_id', user.id)
          .gte('created_at', dateFilter)

        // Get opportunities OWNED by this user (created pipeline)
        const { data: userOwnedOpps } = await supabase
          .from('opportunities')
          .select('id, status')
          .eq('org_id', orgId)
          .eq('owner_user_id', user.id)
          .gte('created_at', dateFilter)

        // Get outcome events for close-rate metrics
        const { data: userOutcomeOpps } = await supabase
          .from('opportunities')
          .select('id, status, inspection_outcome, inspection_outcome_at')
          .eq('org_id', orgId)
          .eq(userOutcomeColumn(user.role), user.id)
          .not('inspection_outcome', 'is', null)
          .not('inspection_outcome_at', 'is', null)
          .gte('inspection_outcome_at', dateFilter)

        const userCloseMetrics = calculateCloseMetrics(userOutcomeOpps || [])

        usersWithMetrics.push({
          ...user,
          doorsKnocked: (userLeads || []).filter(isCanvassDoorLead).length,
          contacts: (userLeads || []).filter(l => isCanvassDoorLead(l) && isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
          inspectionsSet: (userAppointments || []).length,
          opportunitiesCreated: (userOwnedOpps || []).length,
          contractsSigned: userCloseMetrics.sales,
          projectsCompleted: 0,
          inspectionsRun: userCloseMetrics.inspectionsRun,
          closeRate: userCloseMetrics.closeRate,
        })
      }

      setUsers(usersWithMetrics)
    }

    setLoading(false)
  }

  const handleDrillDown = (level: 'region' | 'team' | 'user', id: string) => {
    if (level === 'region') {
      setSelectedRegionId(id)
      setViewLevel('region')
    } else if (level === 'team') {
      setSelectedTeamId(id)
      setViewLevel('team')
    } else if (level === 'user') {
      setSelectedUserId(id)
      setViewLevel('user')
    }
  }

  const handleBreadcrumbClick = (level: 'org' | 'region' | 'team') => {
    if (level === 'org') {
      setSelectedRegionId(null)
      setSelectedTeamId(null)
      setSelectedUserId(null)
      setViewLevel('org')
    } else if (level === 'region') {
      setSelectedTeamId(null)
      setSelectedUserId(null)
      setViewLevel('region')
    } else if (level === 'team') {
      setSelectedUserId(null)
      setViewLevel('team')
    }
  }

  const MetricCard = ({ label, value, subtext }: { label: string; value: number; subtext?: string }) => (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  )

  const scope = currentUser ? getReportScope(currentUser.role as UserRole) : 'own'

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="mt-1 text-gray-600">
              Performance metrics and analytics
            </p>
          </div>
          <div className="flex items-center gap-4">
            {activeTab === 'overview' && (
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRange)}
                className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="ytd">Year to date</option>
                <option value="all">All time</option>
              </select>
            )}
            {can.exportReports(currentUser?.role as UserRole) && activeTab === 'overview' && (
              <Link
                href={`/api/reports/export?range=${dateRange}`}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
              >
                Export Excel
              </Link>
            )}
            <Link
              href="/reports/builder"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Report
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px ${
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px flex items-center gap-2 ${
              activeTab === 'custom'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Custom Reports
            {customReports.length > 0 && (
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                {customReports.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('forecast')}
            className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px ${
              activeTab === 'forecast'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Forecast
          </button>
          <Link
            href="/reports/coaching"
            className="px-4 py-3 font-medium text-sm border-b-2 border-transparent text-gray-500 hover:text-gray-700 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Team Coaching
          </Link>
        </div>

        {activeTab === 'forecast' ? (
          <ForecastTab currentUser={currentUser} />
        ) : activeTab === 'custom' ? (
          /* Custom Reports Tab */
          <div>
            {customReports.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No custom reports yet</h3>
                <p className="text-gray-500 mb-6">Create your first custom report to track the metrics that matter to you</p>
                <Link
                  href="/reports/builder"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Report
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {customReports.map((report) => (
                  <CustomReportCard key={report.id} report={report} onRefresh={loadCustomReports} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <button
            onClick={() => handleBreadcrumbClick('org')}
            className={`hover:text-indigo-600 ${viewLevel === 'org' ? 'font-medium text-gray-900' : ''}`}
          >
            Organization
          </button>
          {selectedRegionId && (
            <>
              <span>/</span>
              <button
                onClick={() => handleBreadcrumbClick('region')}
                className={`hover:text-indigo-600 ${viewLevel === 'region' ? 'font-medium text-gray-900' : ''}`}
              >
                {regions.find(r => r.id === selectedRegionId)?.name || 'Region'}
              </button>
            </>
          )}
          {selectedTeamId && (
            <>
              <span>/</span>
              <button
                onClick={() => handleBreadcrumbClick('team')}
                className={`hover:text-indigo-600 ${viewLevel === 'team' ? 'font-medium text-gray-900' : ''}`}
              >
                {teams.find(t => t.id === selectedTeamId)?.name || 'Team'}
              </button>
            </>
          )}
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading reports...
          </div>
        ) : (
          <>
            {/* Summary Metrics */}
            {orgMetrics && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
                  <MetricCard label="Doors Knocked" value={orgMetrics.doorsKnocked} />
                  <MetricCard label="Contacts" value={orgMetrics.contacts} />
                  <MetricCard label="Inspections Set" value={orgMetrics.inspectionsSet} />
                  <MetricCard label="Inspections Run" value={orgMetrics.inspectionsRun} />
                  <MetricCard label="Opportunities" value={orgMetrics.opportunitiesCreated} />
                  <MetricCard label="Contracts Signed" value={orgMetrics.contractsSigned} />
                  <MetricCard label="Projects Complete" value={orgMetrics.projectsCompleted} />
                  <div className="bg-white rounded-xl shadow-sm border p-6">
                    <p className="text-sm font-medium text-gray-500 mb-1">Close Rate</p>
                    <p className="text-3xl font-bold text-indigo-600">{orgMetrics.closeRate.toFixed(1)}%</p>
                    <p className="text-xs text-gray-400 mt-1">From inspections run</p>
                  </div>
                </div>

                {/* Close Rate Chart */}
                {closeRateHistory.length > 1 && (
                  <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Close Rate Trend</h2>
                    <div className="h-64 relative">
                      {/* Simple bar chart */}
                      <div className="flex items-end justify-between h-48 gap-2 border-b border-l border-gray-200 px-2 pb-2">
                        {closeRateHistory.slice(-12).map((week, idx) => {
                          const maxRate = Math.max(...closeRateHistory.map(w => w.rate), 100)
                          const height = (week.rate / maxRate) * 100
                          return (
                            <div key={week.date} className="flex-1 flex flex-col items-center group">
                              <div className="relative w-full">
                                <div
                                  className="w-full bg-indigo-500 rounded-t transition-all hover:bg-indigo-600"
                                  style={{ height: `${height * 1.8}px`, minHeight: week.rate > 0 ? '4px' : '0' }}
                                />
                                {/* Tooltip */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                                    <p className="font-semibold">{week.rate.toFixed(1)}% close rate</p>
                                    <p>{week.sales} sales / {week.inspections} inspections</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {/* X-axis labels */}
                      <div className="flex justify-between px-2 mt-2">
                        {closeRateHistory.slice(-12).map((week, idx) => (
                          <div key={week.date} className="flex-1 text-center">
                            <span className="text-xs text-gray-500">
                              {new Date(week.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-6 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-indigo-500 rounded" />
                        <span className="text-gray-600">Close Rate by Week</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Inspection Outcomes Breakdown */}
                <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Inspection Outcomes</h2>
                  <div className="grid grid-cols-5 gap-4">
                    {[
                      { outcome: 'sale', label: 'Sales', color: 'bg-green-500', textColor: 'text-green-600' },
                      { outcome: 'said_no', label: 'Said No', color: 'bg-red-500', textColor: 'text-red-600' },
                      { outcome: 'not_home', label: 'Not Home', color: 'bg-amber-500', textColor: 'text-amber-600' },
                      { outcome: 'needs_repair', label: 'Needs Repair', color: 'bg-orange-500', textColor: 'text-orange-600' },
                      { outcome: 'rescheduled', label: 'Rescheduled', color: 'bg-blue-500', textColor: 'text-blue-600' },
                    ].map(({ outcome, label, color, textColor }) => {
                      // This would need actual data - for now showing placeholder
                      return (
                        <div key={outcome} className="text-center">
                          <div className={`w-12 h-12 ${color} rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold`}>
                            {/* Count would go here */}
                            -
                          </div>
                          <p className="text-sm font-medium text-gray-900">{label}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Drill-down Tables */}
            {viewLevel === 'org' && (scope === 'all' || scope === 'region') && regions.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div className="px-6 py-4 border-b bg-gray-50">
                  <h2 className="font-semibold text-gray-900">By Region</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Doors</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Contacts</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Insp. Set</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Insp. Run</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Close Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {regions.map((region) => (
                      <tr
                        key={region.id}
                        onClick={() => handleDrillDown('region', region.id)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-6 py-4 font-medium text-gray-900">{region.name}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{region.doorsKnocked}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{region.contacts}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{region.inspectionsSet}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{region.inspectionsRun}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{region.contractsSigned}</td>
                        <td className="px-6 py-4 text-right font-semibold text-indigo-600">{region.closeRate.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(viewLevel === 'region' || (viewLevel === 'org' && scope === 'team')) && teams.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div className="px-6 py-4 border-b bg-gray-50">
                  <h2 className="font-semibold text-gray-900">By Team</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Doors</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Contacts</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Insp. Set</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Insp. Run</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Close Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {teams.map((team) => (
                      <tr
                        key={team.id}
                        onClick={() => handleDrillDown('team', team.id)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-6 py-4 font-medium text-gray-900">{team.name}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{team.doorsKnocked}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{team.contacts}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{team.inspectionsSet}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{team.inspectionsRun}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{team.contractsSigned}</td>
                        <td className="px-6 py-4 text-right font-semibold text-indigo-600">{team.closeRate.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(viewLevel === 'team' || scope === 'own') && users.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50">
                  <h2 className="font-semibold text-gray-900">By Individual</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Doors</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Contacts</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Insp. Set</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Insp. Run</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Close Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-medium">
                              {user.full_name?.charAt(0) || '?'}
                            </div>
                            <span className="font-medium text-gray-900">{user.full_name || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-500 text-sm">
                          {getRoleDisplayName(user.role as UserRole)}
                        </td>
                        <td className="px-6 py-4 text-right text-gray-600">{user.doorsKnocked}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{user.contacts}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{user.inspectionsSet}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{user.inspectionsRun}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{user.contractsSigned}</td>
                        <td className="px-6 py-4 text-right font-semibold text-indigo-600">{user.closeRate.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        </>
      )}
      </div>
    </div>
  )
}

// Custom Report Card Component
function CustomReportCard({ report, onRefresh }: { report: any; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any[]>([])
  const [dataSource, setDataSource] = useState<string>('')
  const [deleting, setDeleting] = useState(false)
  const [drillDownItem, setDrillDownItem] = useState<any>(null)
  const [dateRange, setDateRange] = useState(() => report.config?.dateRange || '30d')

  useEffect(() => {
    setDateRange(report.config?.dateRange || '30d')
  }, [report.id, report.config?.dateRange])

  const executeReport = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: report.id, dateRange }),
      })
      if (res.ok) {
        const result = await res.json()
        setData(result.data || [])
        setDataSource(result.dataSource || report.data_source)
      }
    } catch (error) {
      console.error('Failed to execute report:', error)
    } finally {
      setLoading(false)
    }
  }, [report.id, dateRange])

  useEffect(() => {
    executeReport()
  }, [executeReport])

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this report?')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/reports/custom?id=${report.id}`, {
        method: 'DELETE',
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete report')
      }
      
      onRefresh()
    } catch (error: any) {
      console.error('Failed to delete report:', error)
      alert(error.message || 'Failed to delete report')
    } finally {
      setDeleting(false)
    }
  }

  const getReportTypeIcon = (type: string) => {
    switch (type) {
      case 'bar_chart': return '📊'
      case 'line_chart': return '📈'
      case 'pie_chart': return '🥧'
      case 'metric_card': return '🔢'
      case 'table': return '📋'
      case 'funnel': return '🔻'
      default: return '📊'
    }
  }

  const getRecordLink = (record: any) => {
    switch (dataSource) {
      case 'leads':
      case 'canvass_activity':
        return `/leads/${record.id}`
      case 'opportunities':
        return `/opportunities/${record.id}`
      case 'projects':
        return `/projects/${record.id}`
      case 'appointments':
        return `/schedule?appointment=${record.id}`
      default:
        return null
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const formatStatus = (status: string) => {
    if (!status) return ''
    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  const exportToCSV = (records: any[], filename: string) => {
    if (!records || records.length === 0) return
    
    // Define CSV headers
    const headers = ['Name', 'Address', 'Phone', 'Email', 'Status', 'Date']
    
    // Convert records to CSV rows
    const rows = records.map(record => [
      record.name || '',
      record.address || '',
      record.phone || '',
      record.email || '',
      formatStatus(record.status) || '',
      record.scheduled_at || record.created_at 
        ? new Date(record.scheduled_at || record.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          })
        : ''
    ])
    
    // Escape CSV values
    const escapeCSV = (value: string) => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }
    
    // Build CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n')
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${filename.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportAllData = () => {
    // Combine all records from all groups
    const allRecords = data.flatMap(item => item.records || [])
    exportToCSV(allRecords, `${report.name}_all`)
  }

  const maxValue = Math.max(...data.map(d => d.value), 1)

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{getReportTypeIcon(report.report_type)}</span>
              <div>
                <h3 className="font-semibold text-gray-900">{report.name}</h3>
                {report.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{report.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={exportAllData}
                disabled={loading || data.length === 0}
                className="p-1.5 text-gray-400 hover:text-green-600 rounded disabled:opacity-50"
                title="Export to Excel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </button>
              <Link
                href={`/reports/builder?edit=${report.id}`}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                title="Edit Report"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </Link>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
                title="Delete Report"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-xs text-gray-500">
            <span className="capitalize">{report.data_source}</span>
            <span className="hidden sm:inline">•</span>
            <label className="flex items-center gap-2">
              <span className="text-gray-400 shrink-0">Period</span>
              <select
                value={dateRange}
                onChange={e => setDateRange(e.target.value)}
                className="px-2.5 py-1 border border-gray-300 rounded-lg bg-white text-gray-800 text-xs font-medium min-w-[10rem]"
              >
                {CUSTOM_REPORT_DATE_RANGES.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </label>
            {report.is_public && (
              <>
                <span>•</span>
                <span className="text-green-600">Public</span>
              </>
            )}
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="h-32 flex items-center justify-center text-gray-400">
              Loading...
            </div>
          ) : report.report_type === 'metric_card' ? (
            <button 
              onClick={() => data[0]?.records?.length > 0 && setDrillDownItem(data[0])}
              className="w-full text-center py-4 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
            >
              <p className="text-4xl font-bold text-gray-900">
                {data[0]?.value?.toLocaleString() || 0}
              </p>
              <p className="text-sm text-gray-500 mt-1">{data[0]?.label || 'Total'}</p>
              {data[0]?.records?.length > 0 && (
                <p className="text-xs text-indigo-600 mt-2">Click to view details →</p>
              )}
            </button>
          ) : report.report_type === 'bar_chart' ? (
            <div className="space-y-2">
              {data.slice(0, 5).map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => item.records?.length > 0 && setDrillDownItem(item)}
                  className="w-full text-left hover:bg-gray-50 rounded p-1 -m-1 transition-colors cursor-pointer"
                >
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 truncate">{item.label}</span>
                    <span className="font-medium text-gray-900 flex items-center gap-1">
                      {item.value}
                      {item.records?.length > 0 && (
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${(item.value / maxValue) * 100}%` }}
                    />
                  </div>
                </button>
              ))}
              {data.length > 5 && (
                <p className="text-xs text-gray-400 text-center pt-2">
                  +{data.length - 5} more
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {data.slice(0, 6).map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => item.records?.length > 0 && setDrillDownItem(item)}
                  className="w-full flex justify-between text-sm py-1.5 px-1 -mx-1 border-b last:border-0 hover:bg-gray-50 rounded transition-colors cursor-pointer"
                >
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-medium text-gray-900 flex items-center gap-1">
                    {item.value}
                    {item.records?.length > 0 && (
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500">
          Created by {report.creator?.full_name || 'Unknown'}
        </div>
      </div>

      {/* Drill-down Modal */}
      {drillDownItem && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDrillDownItem(null)}
        >
          <div 
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between bg-gray-50">
              <div>
                <h3 className="font-semibold text-gray-900">{drillDownItem.label}</h3>
                <p className="text-sm text-gray-500">{drillDownItem.count} records</p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => exportToCSV(drillDownItem.records, `${report.name}_${drillDownItem.label}`)}
                  disabled={!drillDownItem.records?.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export
                </button>
                <button 
                  onClick={() => setDrillDownItem(null)}
                  className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="overflow-y-auto flex-1">
              {drillDownItem.records?.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name/Address</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {drillDownItem.records.map((record: any) => {
                      const link = getRecordLink(record)
                      return (
                        <tr key={record.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 text-sm">{record.name}</div>
                            {record.address && record.name !== record.address && (
                              <div className="text-xs text-gray-500">{record.address}</div>
                            )}
                            {record.phone && (
                              <div className="text-xs text-gray-500">{record.phone}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                              {formatStatus(record.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatDate(record.scheduled_at || record.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {link ? (
                              <Link
                                href={link}
                                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                              >
                                View →
                              </Link>
                            ) : (
                              <span className="text-gray-400 text-sm">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  No records to display
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Forecast Tab ─────────────────────────────────────────────────────────────
type ForecastPeriod = 'month' | 'quarter' | 'year'

type ForecastData = {
  period: string
  periodLabel: string
  periodGoal: number | null
  totalForecast: number
  totalLocked: number
  retailTotal: number
  insuranceTotal: number
  retailPipeline: { stage: string; count: number; expectedRevenue: number; probability: number; locked?: boolean }[]
  insurancePipeline: { stage: string; stageKey: string; count: number; expectedRevenue: number; lockedRevenue: number; probability: number }[]
  avgDealValue: number
  avgDealBasis: string
}

function ForecastTab({ currentUser }: { currentUser: any }) {
  const [period, setPeriod] = useState<ForecastPeriod>('quarter')
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)

  const isAdmin = ['admin', 'sales_manager', 'regional_manager'].includes(currentUser?.role || '')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/reports/forecast?period=${period}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period])

  async function saveGoal() {
    if (!goalInput) return
    setSavingGoal(true)
    try {
      const res = await fetch('/api/reports/forecast', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, goal: Number(goalInput) }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('Forecast goal save failed:', payload?.error || res.status)
        return
      }
      setEditingGoal(false)
      setData(d => d ? { ...d, periodGoal: Number(goalInput) } : d)
    } finally {
      setSavingGoal(false)
    }
  }

  const goal = data?.periodGoal || null
  const forecast = data?.totalForecast || 0
  const pct = goal && goal > 0 ? Math.min(Math.round((forecast / goal) * 100), 100) : null
  const gap = goal ? goal - forecast : null

  return (
    <div>
      {/* Period + Goal header */}
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {loading ? '…' : data?.periodLabel} Forecast
              </h2>
              <select
                value={period}
                onChange={e => setPeriod(e.target.value as ForecastPeriod)}
                className="px-2 py-1 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="month">This month</option>
                <option value="quarter">This quarter</option>
                <option value="year">This year</option>
              </select>
            </div>
            {data?.avgDealBasis && (
              <p className="text-xs text-gray-400">
                Avg deal: ${data.avgDealValue.toLocaleString()} · {data.avgDealBasis}
              </p>
            )}
          </div>

          {/* Goal */}
          <div className="flex items-center gap-2">
            {editingGoal ? (
              <>
                <span className="text-sm text-gray-500">Goal $</span>
                <input
                  type="number"
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  className="w-32 px-2 py-1 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. 400000"
                  autoFocus
                />
                <button onClick={saveGoal} disabled={savingGoal} className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm font-medium">
                  {savingGoal ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingGoal(false)} className="px-2 py-1 text-sm text-gray-500">Cancel</button>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-600">
                  Goal: {goal ? `$${goal.toLocaleString()}` : <span className="text-gray-400">Not set</span>}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => { setGoalInput(goal ? String(goal) : ''); setEditingGoal(true) }}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    {goal ? 'Edit' : '+ Set goal'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Big number + progress */}
        {loading ? (
          <div className="h-20 animate-pulse bg-gray-100 rounded-lg" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-6 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Total forecast</p>
                <p className="text-3xl font-bold text-gray-900">${forecast.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Locked (confirmed)</p>
                <p className="text-xl font-semibold text-green-600">${(data?.totalLocked || 0).toLocaleString()}</p>
              </div>
              {gap !== null && gap > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Gap to goal</p>
                  <p className="text-xl font-semibold text-red-500">${gap.toLocaleString()}</p>
                </div>
              )}
            </div>

            {pct !== null && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{pct}% of goal</span>
                  <span>${forecast.toLocaleString()} of ${goal!.toLocaleString()}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-indigo-500' : 'bg-amber-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Two-column pipeline breakdown */}
      {!loading && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Retail */}
          <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Retail Pipeline</h3>
              <span className="text-sm font-bold text-indigo-600">${data.retailTotal.toLocaleString()}</span>
            </div>
            <div className="space-y-2">
              {data.retailPipeline.map((row) => (
                <div key={row.stage} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.locked && <span className="text-green-500 text-xs font-bold">✓</span>}
                    <span className="text-sm text-gray-700 truncate">{row.stage}</span>
                    <span className="text-xs text-gray-400 shrink-0">({row.count})</span>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-semibold text-gray-900">${Math.round(row.expectedRevenue).toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{row.probability}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Insurance */}
          <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Insurance Pipeline</h3>
              <span className="text-sm font-bold text-amber-600">${data.insuranceTotal.toLocaleString()}</span>
            </div>
            {data.insurancePipeline.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No active insurance jobs.<br />Mark jobs as Insurance on the Ops board.</p>
            ) : (
              <div className="space-y-2">
                {data.insurancePipeline.map((row) => (
                  <div key={row.stageKey} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {row.lockedRevenue > 0 && <span className="text-green-500 text-xs font-bold">✓</span>}
                      <span className="text-sm text-gray-700 truncate">{row.stage}</span>
                      <span className="text-xs text-gray-400 shrink-0">({row.count})</span>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold text-gray-900">${Math.round(row.expectedRevenue).toLocaleString()}</p>
                      <p className="text-xs text-gray-400">{row.probability}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────
