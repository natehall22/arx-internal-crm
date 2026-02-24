'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import InspectionStatusCard from '@/components/InspectionStatusCard'
import CommissionWidget from '@/components/CommissionWidget'
import AIAssistantWrapper from '@/components/AIAssistantWrapper'
import UnpaidReferralsAlert from '@/components/UnpaidReferralsAlert'
import type { InspectionOutcome } from '@/lib/types/database'

interface HybridComponent {
  type: 'hourly' | 'percentage' | 'flat_per_job' | 'per_unit'
  rate: number
  unit_type?: string
  description?: string
}

interface CompPlanDetails {
  id: string
  name: string
  plan_type: string
  base_percentage: number | null
  flat_rate: number | null
  flat_amount: number | null
  hourly_rate: number | null
  unit_rate: number | null
  unit_type: string | null
  hybrid_components: HybridComponent[] | null
  volume_bonuses: any[]
  is_manager_plan: boolean
  personal_sales_enabled: boolean
  team_override_enabled: boolean
  team_overrides: any[]
  readme?: string
}

interface VolumeTier {
  min_volume: number
  max_volume: number | null
  bonus_type: 'percentage' | 'flat'
  bonus_value: number
}

interface TeamMemberStat {
  id: string
  name: string
  role: string
  doorsKnocked: number
  contacts: number
  inspectionsSet: number
  sales: number
  closeRate: string
}

type TimeFrame = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'all'

interface DashboardClientProps {
  profile: any
  stats: {
    totalLeads: number
    newLeads: number
    totalOpportunities: number
    openOpportunities: number
    totalProjects: number
    activeProjects: number
    closeRate: number
    doorsKnockedThisWeek: number
    contactsThisWeek: number
    inspectionsSetThisWeek: number
    salesThisWeek: number
  }
  progress: {
    doors_knocked: { current: number; goal: number }
    contacts: { current: number; goal: number }
    inspections: { current: number; goal: number }
    sales: { current: number; goal: number }
  }
  pendingPrompts: any[]
  upcomingAppointments: any[]
  recentActivities: any[]
  settings: any
  teamMemberStats?: TeamMemberStat[]
}

export default function DashboardClient({
  profile,
  stats,
  progress,
  pendingPrompts,
  upcomingAppointments,
  recentActivities,
  settings,
  teamMemberStats = [],
}: DashboardClientProps) {
  const [activePrompt, setActivePrompt] = useState<any>(
    pendingPrompts.length > 0 ? pendingPrompts[0] : null
  )
  const [dismissedPrompts, setDismissedPrompts] = useState<string[]>([])
  const [customReports, setCustomReports] = useState<any[]>([])
  const [reportData, setReportData] = useState<Record<string, any[]>>({})
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('week')
  const [filteredTeamStats, setFilteredTeamStats] = useState<TeamMemberStat[]>(teamMemberStats)
  const [loadingStats, setLoadingStats] = useState(false)
  const [weeklyPay, setWeeklyPay] = useState<number>(0)
  const [hasCompPlan, setHasCompPlan] = useState<boolean | null>(null)
  const [compPlanDetails, setCompPlanDetails] = useState<CompPlanDetails | null>(null)
  const [showCompPlanModal, setShowCompPlanModal] = useState(false)
  const [showCalculatorModal, setShowCalculatorModal] = useState(false)
  // Calculator inputs - dynamic based on plan type
  const [calcAvgSalePrice, setCalcAvgSalePrice] = useState(13500)
  const [calcJobsClosed, setCalcJobsClosed] = useState(4)
  const [calcHoursWorked, setCalcHoursWorked] = useState(40)
  const [calcUnits, setCalcUnits] = useState(25)
  const [calcTeamSales, setCalcTeamSales] = useState(20)
  const [calcTeamAvgPrice, setCalcTeamAvgPrice] = useState(13500)

  useEffect(() => {
    loadDashboardReports()
    loadWeeklyPay()
    loadCompPlanDetails()
  }, [])

  useEffect(() => {
    if (timeFrame === 'week') {
      setFilteredTeamStats(teamMemberStats)
    } else {
      loadTeamStatsForTimeFrame()
    }
  }, [timeFrame, teamMemberStats])

  const loadTeamStatsForTimeFrame = async () => {
    if (timeFrame === 'week') return
    
    setLoadingStats(true)
    try {
      const res = await fetch(`/api/dashboard/team-stats?timeframe=${timeFrame}`)
      if (res.ok) {
        const data = await res.json()
        setFilteredTeamStats(data.teamMemberStats || [])
      }
    } catch (error) {
      console.error('Failed to load team stats:', error)
    } finally {
      setLoadingStats(false)
    }
  }

  const loadCompPlanDetails = async () => {
    console.log('loadCompPlanDetails: Starting via API...')
    try {
      const res = await fetch('/api/user/comp-plan')
      
      if (!res.ok) {
        console.error('Comp plan API error:', res.status)
        setHasCompPlan(false)
        return
      }
      
      const data = await res.json()
      console.log('Comp plan API response:', data)
      
      if (data.hasCompPlan && data.compPlan) {
        setCompPlanDetails(data.compPlan)
        setHasCompPlan(true)
        console.log('Comp plan loaded successfully:', data.compPlan.name, 'with readme:', !!data.compPlan.readme)
      } else {
        console.log('No comp plan found:', data.reason || 'not assigned')
        setHasCompPlan(false)
      }
    } catch (err) {
      console.error('Error loading comp plan:', err)
      setHasCompPlan(false)
    }
  }

  const loadWeeklyPay = async () => {
    try {
      const res = await fetch('/api/commissions/weekly')
      if (res.ok) {
        const data = await res.json()
        setWeeklyPay(data.weeklyTotal || 0)
      }
    } catch (error) {
      console.error('Failed to load weekly pay:', error)
      setWeeklyPay(0)
    }
  }

  const loadDashboardReports = async () => {
    try {
      const res = await fetch('/api/reports/custom?dashboard=true')
      const data = await res.json()
      
      if (!res.ok) {
        console.error('Failed to load dashboard reports:', data.error, data.details)
        return
      }
      
      console.log('Dashboard reports loaded:', data.reports?.length || 0, 'reports')
      setCustomReports(data.reports || [])
      
      // Load data for each report
      for (const report of data.reports || []) {
        try {
          const dataRes = await fetch('/api/reports/custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_id: report.id }),
          })
          if (dataRes.ok) {
            const result = await dataRes.json()
            console.log(`Report "${report.name}" data:`, result.data?.length || 0, 'items', result.data)
            setReportData(prev => ({ ...prev, [report.id]: result.data || [] }))
          } else {
            console.error(`Failed to load data for report "${report.name}":`, await dataRes.text())
            setReportData(prev => ({ ...prev, [report.id]: [] }))
          }
        } catch (err) {
          console.error(`Error loading report "${report.name}":`, err)
          setReportData(prev => ({ ...prev, [report.id]: [] }))
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard reports:', error)
    }
  }

  const handleStatusComplete = async (data: {
    outcome: InspectionOutcome
    notes: string
    setterFeedback: string
    scheduleFollowUp?: boolean
    followUpDate?: string
  }) => {
    try {
      // Use the appointment ID from the scheduled_appointments object
      const appointmentId = activePrompt.scheduled_appointments?.id || activePrompt.appointment_id
      console.log('Submitting status for appointment:', appointmentId, 'prompt:', activePrompt)
      
      const res = await fetch('/api/inspections/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: appointmentId,
          outcome: data.outcome,
          notes: data.notes,
          setter_feedback: data.setterFeedback,
          schedule_follow_up: data.scheduleFollowUp,
          follow_up_date: data.followUpDate,
        }),
      })

      if (res.ok) {
        // Move to next prompt or close
        const remainingPrompts = pendingPrompts.filter(
          p => p.id !== activePrompt.id && !dismissedPrompts.includes(p.id)
        )
        setActivePrompt(remainingPrompts.length > 0 ? remainingPrompts[0] : null)
      } else {
        // API returned an error - throw to show error in the card
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to save status')
      }
    } catch (error) {
      console.error('Failed to submit status:', error)
      throw error // Re-throw so InspectionStatusCard can show the error
    }
  }

  const handleReschedule = (appointmentId: string) => {
    // Redirect to scheduling page with appointment context
    window.location.href = `/schedule?reschedule=${appointmentId}`
  }

  const ProgressBar = ({ 
    label, 
    current, 
    goal, 
    color 
  }: { 
    label: string
    current: number
    goal: number
    color: string 
  }) => {
    const percentage = Math.min((current / goal) * 100, 100)
    const isComplete = current >= goal
    
    return (
      <div className="mb-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <span className={`text-sm font-bold ${isComplete ? 'text-green-600' : 'text-gray-600'}`}>
            {current} / {goal}
            {isComplete && ' ✓'}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${color} ${
              isComplete ? 'animate-pulse' : ''
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {percentage.toFixed(0)}% of weekly goal
        </p>
      </div>
    )
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    // Use Eastern timezone for consistent display
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York'
    })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    
    // Compare dates in Eastern timezone
    const dateStr = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    const todayStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowStr = tomorrow.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    
    if (dateStr === todayStr) return 'Today'
    if (dateStr === tomorrowStr) return 'Tomorrow'
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      timeZone: 'America/New_York'
    })
  }

  return (
    <>
      {/* Status Update Modal */}
      {activePrompt && activePrompt.scheduled_appointments && (
        <InspectionStatusCard
          appointment={{
            ...activePrompt.scheduled_appointments,
            lead: activePrompt.scheduled_appointments.leads,
          }}
          onComplete={handleStatusComplete}
          onReschedule={handleReschedule}
        />
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Unpaid Referrals Alert */}
        <UnpaidReferralsAlert />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Welcome back, {profile.full_name?.split(' ')[0] || 'there'}!
            </h1>
            <p className="text-gray-500 text-sm sm:text-base mt-1">
              Here's your performance overview for this week
            </p>
          </div>
          {(profile.role === 'admin' || profile.role === 'regional_manager') && (
            <Link
              href="/admin/dashboard-settings"
              className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1 self-start sm:self-auto"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Customize Dashboard
            </Link>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-gray-500 truncate">Doors Knocked</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.doorsKnockedThisWeek}</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1 sm:mt-2">This week</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-gray-500 truncate">Inspections Set</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.inspectionsSetThisWeek}</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1 sm:mt-2">This week</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-gray-500 truncate">Sales</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.salesThisWeek}</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1 sm:mt-2">This week</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-gray-500 truncate">Close Rate</p>
                <p className="text-xl sm:text-2xl font-bold text-indigo-600">{stats.closeRate}%</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1 sm:mt-2">All time</p>
          </div>
        </div>

        {/* This Week's Pay - Prominent Display for all users */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl shadow-lg p-4 sm:p-6 mb-6 sm:mb-8 text-white">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-indigo-100 text-xs sm:text-sm font-medium mb-1">This Week's Estimated Pay</p>
              <p className="text-2xl sm:text-4xl font-bold">${weeklyPay.toLocaleString()}</p>
              {hasCompPlan === false ? (
                <p className="text-indigo-200 text-xs mt-1 sm:mt-2">No comp plan assigned - contact your manager</p>
              ) : (
                <p className="text-indigo-200 text-xs mt-1 sm:mt-2">Based on closed sales this week</p>
              )}
            </div>
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 ml-3">
              <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          
          {/* Comp Plan Action Buttons */}
          <div className="flex gap-2 mt-4 pt-4 border-t border-white/20">
            <button 
              onClick={() => setShowCompPlanModal(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              My Comp Plan
            </button>
            
            {compPlanDetails && compPlanDetails.plan_type !== 'hybrid' && (
              <button 
                onClick={() => setShowCalculatorModal(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Comp Calculator
              </button>
            )}
          </div>
        </div>

        {/* Team Leaderboard - for managers/admins */}
        {teamMemberStats.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 sm:mb-8 overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Team Stats</h2>
              <div className="flex items-center gap-2 sm:gap-3">
                <select
                  value={timeFrame}
                  onChange={(e) => setTimeFrame(e.target.value as TimeFrame)}
                  className="text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 flex-1 sm:flex-none"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This Week</option>
                  <option value="last_week">Last Week</option>
                  <option value="month">This Month</option>
                  <option value="quarter">This Quarter</option>
                  <option value="year">This Year</option>
                  <option value="all">All Time</option>
                </select>
                <span className="text-xs sm:text-sm text-gray-500 whitespace-nowrap">{filteredTeamStats.length} reps</span>
              </div>
            </div>
            
            {/* Mobile Card View */}
            <div className="block sm:hidden">
              {loadingStats ? (
                <div className="p-8 text-center">
                  <div className="flex items-center justify-center gap-2 text-gray-500">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading stats...
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredTeamStats.map((member, index) => (
                    <div 
                      key={member.id} 
                      className={`p-3 ${index === 0 ? 'bg-yellow-50' : index === 1 ? 'bg-gray-50' : index === 2 ? 'bg-orange-50/50' : ''}`}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                          {index === 0 ? (
                            <span className="text-xl">🥇</span>
                          ) : index === 1 ? (
                            <span className="text-xl">🥈</span>
                          ) : index === 2 ? (
                            <span className="text-xl">🥉</span>
                          ) : (
                            <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                          )}
                        </div>
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-medium text-indigo-600">
                            {member.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{member.name}</p>
                          <p className="text-xs text-gray-500 capitalize">{member.role.replace('_', ' ')}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-2 text-center">
                        <div>
                          <p className={`text-base font-bold ${member.doorsKnocked > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                            {member.doorsKnocked}
                          </p>
                          <p className="text-xs text-gray-500">Doors</p>
                        </div>
                        <div>
                          <p className={`text-base font-bold ${member.contacts > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                            {member.contacts || 0}
                          </p>
                          <p className="text-xs text-gray-500">Contacts</p>
                        </div>
                        <div>
                          <p className={`text-base font-bold ${member.inspectionsSet > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                            {member.inspectionsSet}
                          </p>
                          <p className="text-xs text-gray-500">Insp.</p>
                        </div>
                        <div>
                          <p className={`text-base font-bold ${member.sales > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {member.sales}
                          </p>
                          <p className="text-xs text-gray-500">Sales</p>
                        </div>
                        <div>
                          <p className={`text-base font-bold ${parseInt(member.closeRate) > 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
                            {member.closeRate}%
                          </p>
                          <p className="text-xs text-gray-500">Close</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rep</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <span className="flex items-center justify-center gap-1">
                        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                        Doors
                      </span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <span className="flex items-center justify-center gap-1">
                        <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                        </svg>
                        Contacts
                      </span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <span className="flex items-center justify-center gap-1">
                        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Inspections
                      </span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <span className="flex items-center justify-center gap-1">
                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Sales
                      </span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <span className="flex items-center justify-center gap-1">
                        <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        Close %
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loadingStats ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center">
                        <div className="flex items-center justify-center gap-2 text-gray-500">
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Loading stats...
                        </div>
                      </td>
                    </tr>
                  ) : filteredTeamStats.map((member, index) => (
                    <tr key={member.id} className={index === 0 ? 'bg-yellow-50' : index === 1 ? 'bg-gray-50' : index === 2 ? 'bg-orange-50/50' : ''}>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center w-8 h-8">
                          {index === 0 ? (
                            <span className="text-xl">🥇</span>
                          ) : index === 1 ? (
                            <span className="text-xl">🥈</span>
                          ) : index === 2 ? (
                            <span className="text-xl">🥉</span>
                          ) : (
                            <span className="text-sm font-medium text-gray-500">{index + 1}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                            <span className="text-sm font-medium text-indigo-600">
                              {member.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{member.name}</p>
                            <p className="text-xs text-gray-500 capitalize">{member.role.replace('_', ' ')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-lg font-bold ${member.doorsKnocked > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          {member.doorsKnocked}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-lg font-bold ${member.contacts > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                          {member.contacts || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-lg font-bold ${member.inspectionsSet > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {member.inspectionsSet}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-lg font-bold ${member.sales > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {member.sales}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-lg font-bold ${parseInt(member.closeRate) > 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
                          {member.closeRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredTeamStats.length === 0 && !loadingStats && (
              <div className="p-8 text-center text-gray-500">
                No team member stats available
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Progress Section */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Weekly Progress */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Weekly Progress</h2>
              <ProgressBar
                label="Doors Knocked"
                current={progress.doors_knocked.current}
                goal={progress.doors_knocked.goal}
                color="bg-blue-500"
              />
              <ProgressBar
                label="Contacts Made"
                current={progress.contacts.current}
                goal={progress.contacts.goal}
                color="bg-purple-500"
              />
              <ProgressBar
                label="Inspections Set"
                current={progress.inspections.current}
                goal={progress.inspections.goal}
                color="bg-amber-500"
              />
              <ProgressBar
                label="Sales Closed"
                current={progress.sales.current}
                goal={progress.sales.goal}
                color="bg-green-500"
              />
            </div>

            {/* Upcoming Appointments - hidden for canvassers */}
            {profile.role !== 'canvasser' && (
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Upcoming Appointments</h2>
                <Link href="/schedule" className="text-sm text-indigo-600 hover:text-indigo-700">
                  View all
                </Link>
              </div>
              {upcomingAppointments.length === 0 ? (
                <p className="text-gray-500 text-sm py-4">No upcoming appointments</p>
              ) : (
                <div className="space-y-2 sm:space-y-3">
                  {upcomingAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="w-12 sm:w-14 text-center flex-shrink-0">
                        <p className="text-xs text-gray-500">{formatDate(apt.scheduled_for)}</p>
                        <p className="text-base sm:text-lg font-bold text-gray-900">{formatTime(apt.scheduled_for)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm sm:text-base">
                          {apt.leads?.homeowner_name || 'Unknown'}
                        </p>
                        <p className="text-xs sm:text-sm text-gray-500 truncate">
                          {apt.leads?.address_text || apt.address_text || 'No address'}
                        </p>
                      </div>
                      <Link
                        href={apt.opportunity_id 
                          ? `/opportunities/${apt.opportunity_id}` 
                          : apt.lead_id 
                            ? `/leads/${apt.lead_id}`
                            : '/appointments'
                        }
                        className="text-indigo-600 hover:text-indigo-700 flex-shrink-0"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Account Overview - show different content for canvassers */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
                {profile.role === 'canvasser' ? 'My Stats' : 'Account Overview'}
              </h2>
              <div className={`grid gap-2 sm:gap-4 ${profile.role === 'canvasser' ? 'grid-cols-1' : 'grid-cols-3'}`}>
                <Link href="/leads" className="p-2 sm:p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors text-center sm:text-left">
                  <p className="text-xl sm:text-3xl font-bold text-blue-600">{stats.totalLeads}</p>
                  <p className="text-xs sm:text-sm text-gray-600">Total Leads</p>
                  <p className="text-xs text-blue-600 mt-1 hidden sm:block">{stats.newLeads} new</p>
                </Link>
                {profile.role !== 'canvasser' && (
                  <>
                    <Link href="/opportunities" className="p-2 sm:p-4 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors text-center sm:text-left">
                      <p className="text-xl sm:text-3xl font-bold text-amber-600">{stats.totalOpportunities}</p>
                      <p className="text-xs sm:text-sm text-gray-600">Opps</p>
                      <p className="text-xs text-amber-600 mt-1 hidden sm:block">{stats.openOpportunities} open</p>
                    </Link>
                    <Link href="/projects" className="p-2 sm:p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors text-center sm:text-left">
                      <p className="text-xl sm:text-3xl font-bold text-green-600">{stats.totalProjects}</p>
                      <p className="text-xs sm:text-sm text-gray-600">Projects</p>
                      <p className="text-xs text-green-600 mt-1 hidden sm:block">{stats.activeProjects} active</p>
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Custom Reports Widgets - hidden for canvassers */}
            {customReports.length > 0 && profile.role !== 'canvasser' && (
              <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Custom Reports</h2>
                  <Link href="/reports?tab=custom" className="text-sm text-indigo-600 hover:text-indigo-700">
                    View all
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {customReports.slice(0, 4).map((report) => {
                    const data = reportData[report.id] || []
                    const maxValue = Math.max(...data.map((d: any) => d.value || 0), 1)
                    const isLoading = !reportData[report.id]
                    
                    return (
                      <Link 
                        key={report.id} 
                        href={`/reports?tab=custom&report=${report.id}`}
                        className="border rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">
                            {report.report_type === 'bar_chart' ? '📊' : 
                             report.report_type === 'line_chart' ? '📈' : 
                             report.report_type === 'pie_chart' ? '🥧' : 
                             report.report_type === 'metric_card' ? '🔢' : '📋'}
                          </span>
                          <h3 className="font-medium text-gray-900 text-sm">{report.name}</h3>
                        </div>
                        
                        {isLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600" />
                          </div>
                        ) : data.length === 0 ? (
                          <div className="text-center py-4">
                            <p className="text-sm text-gray-500">No data for this period</p>
                          </div>
                        ) : report.report_type === 'metric_card' ? (
                          <div className="text-center py-2">
                            <p className="text-3xl font-bold text-indigo-600">
                              {(data[0]?.value || 0).toLocaleString()}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {data.slice(0, 3).map((item: any, idx: number) => (
                              <div key={idx}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-600 truncate">{item.label || 'Unknown'}</span>
                                  <span className="font-medium text-gray-900">{(item.value || 0).toLocaleString()}</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-indigo-500 rounded-full"
                                    style={{ width: `${((item.value || 0) / maxValue) * 100}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                            {data.length > 3 && (
                              <p className="text-xs text-gray-400 text-center pt-1">
                                +{data.length - 3} more
                              </p>
                            )}
                          </div>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4 sm:space-y-6">
            {/* Pending Status Updates */}
            {pendingPrompts.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="font-semibold text-amber-800">Status Updates Needed</h3>
                </div>
                <p className="text-sm text-amber-700 mb-3">
                  You have {pendingPrompts.length} appointment{pendingPrompts.length > 1 ? 's' : ''} waiting for status updates.
                </p>
                <button
                  onClick={() => setActivePrompt(pendingPrompts[0])}
                  className="w-full py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Update Now
                </button>
              </div>
            )}

            {/* Commission Widget - for sales reps and setters */}
            {['sales_rep', 'canvasser', 'rep', 'admin', 'manager'].includes(profile?.role) && (
              <CommissionWidget />
            )}

            {/* Recent Activity */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Recent Activity</h2>
              {recentActivities.length === 0 ? (
                <p className="text-gray-500 text-sm">No recent activity</p>
              ) : (
                <div className="space-y-4">
                  {recentActivities.slice(0, 5).map((activity: any) => (
                    <div key={activity.id} className="flex gap-3">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-medium text-gray-600">
                          {activity.users?.full_name?.charAt(0) || '?'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900">
                          <span className="font-medium">{activity.users?.full_name || 'Unknown'}</span>
                          {' '}
                          <span className="text-gray-500">{activity.type.replace('_', ' ')}</span>
                        </p>
                        <p className="text-xs text-gray-500 truncate">{activity.body}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(activity.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Quick Actions</h2>
              <div className="space-y-2">
                <Link
                  href="/canvass"
                  className="flex items-center gap-3 p-2 sm:p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900 text-sm sm:text-base">Start Canvassing</span>
                </Link>
                <Link
                  href="/leads/new"
                  className="flex items-center gap-3 p-2 sm:p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900 text-sm sm:text-base">Add New Lead</span>
                </Link>
                {profile.role !== 'canvasser' && (
                  <Link
                    href="/reports"
                    className="flex items-center gap-3 p-2 sm:p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="w-9 h-9 sm:w-10 sm:h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <span className="font-medium text-gray-900 text-sm sm:text-base">View Reports</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistantWrapper context={{ type: 'general' }} />

      {/* Comp Plan Modal */}
      {showCompPlanModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setShowCompPlanModal(false)}
        >
          <div 
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-6 border-b sticky top-0 bg-white rounded-t-2xl z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">My Compensation Plan</h2>
                <button 
                  type="button"
                  onClick={() => setShowCompPlanModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-4 sm:p-6">
              {!hasCompPlan || !compPlanDetails ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Comp Plan Assigned</h3>
                  <p className="text-gray-500">Contact your manager to get a compensation plan assigned to your account.</p>
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-6">
                  {/* Plan Name & Type */}
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-3 sm:p-4 text-white">
                    <p className="text-indigo-100 text-xs sm:text-sm">Your Plan</p>
                    <h3 className="text-xl sm:text-2xl font-bold">{compPlanDetails.name}</h3>
                    <p className="text-indigo-200 text-xs sm:text-sm mt-1 capitalize">{compPlanDetails.plan_type.replace('_', ' ')} Plan</p>
                  </div>
                  
                  {/* Base Rate - varies by plan type */}
                  <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                    <h4 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">
                      {compPlanDetails.plan_type === 'hourly' ? 'Hourly Rate' : 
                       compPlanDetails.plan_type === 'unit_based' ? 'Per Unit Rate' :
                       compPlanDetails.plan_type === 'hybrid' ? 'Compensation Components' :
                       'Base Commission Rate'}
                    </h4>
                    {compPlanDetails.plan_type === 'hourly' ? (
                      <p className="text-xl sm:text-2xl font-bold text-green-600">${compPlanDetails.hourly_rate?.toLocaleString() || 0}/hour</p>
                    ) : compPlanDetails.plan_type === 'flat_rate' ? (
                      <p className="text-xl sm:text-2xl font-bold text-green-600">${(compPlanDetails.flat_rate || compPlanDetails.flat_amount)?.toLocaleString() || 0} per job</p>
                    ) : compPlanDetails.plan_type === 'unit_based' ? (
                      <div>
                        <p className="text-xl sm:text-2xl font-bold text-green-600">
                          ${compPlanDetails.unit_rate?.toLocaleString() || 0} per {compPlanDetails.unit_type || 'unit'}
                        </p>
                        <p className="text-xs sm:text-sm text-gray-500 mt-1">
                          {compPlanDetails.unit_type === 'square' && 'Roofing squares (100 sq ft each)'}
                          {compPlanDetails.unit_type === 'kw' && 'Kilowatts of solar installed'}
                          {compPlanDetails.unit_type === 'linear_foot' && 'Linear feet of material'}
                          {compPlanDetails.unit_type === 'panel' && 'Panels installed'}
                        </p>
                      </div>
                    ) : compPlanDetails.plan_type === 'hybrid' && compPlanDetails.hybrid_components ? (
                      <div className="space-y-2">
                        {compPlanDetails.hybrid_components.map((comp, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-white rounded-lg border text-sm">
                            <span className="text-gray-700 capitalize">
                              {comp.type === 'hourly' ? 'Hourly Rate' :
                               comp.type === 'percentage' ? 'Commission' :
                               comp.type === 'flat_per_job' ? 'Per Job' :
                               `Per ${comp.unit_type || 'Unit'}`}
                              {comp.description && <span className="text-gray-500 text-xs ml-1">({comp.description})</span>}
                            </span>
                            <span className="font-semibold text-green-600">
                              {comp.type === 'hourly' ? `$${comp.rate}/hr` :
                               comp.type === 'percentage' ? `${comp.rate}%` :
                               comp.type === 'flat_per_job' ? `$${comp.rate}/job` :
                               `$${comp.rate}/${comp.unit_type || 'unit'}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xl sm:text-2xl font-bold text-green-600">{compPlanDetails.base_percentage || 0}% of sale</p>
                    )}
                  </div>
                  
                  {/* Plan Type Notices */}
                  {compPlanDetails.plan_type === 'hourly' && (
                    <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                      <h4 className="font-semibold text-blue-900 mb-2">Hourly Compensation</h4>
                      <p className="text-sm text-blue-800">
                        Your compensation is based on hours worked. Track your hours through the time tracking system.
                      </p>
                    </div>
                  )}
                  
                  {compPlanDetails.plan_type === 'hybrid' && (
                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                      <h4 className="font-semibold text-purple-900 mb-2">Hybrid Compensation</h4>
                      <p className="text-sm text-purple-800">
                        Your pay combines multiple components. Each component is calculated separately and added together.
                      </p>
                    </div>
                  )}
                  
                  {compPlanDetails.plan_type === 'unit_based' && (
                    <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
                      <h4 className="font-semibold text-teal-900 mb-2">Per-Unit Compensation</h4>
                      <p className="text-sm text-teal-800">
                        Your pay is based on the quantity of work completed. Track your units through job completion records.
                      </p>
                    </div>
                  )}
                  
                  {/* Volume Bonuses */}
                  {compPlanDetails.volume_bonuses && compPlanDetails.volume_bonuses.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <h4 className="font-semibold text-gray-900 mb-2 sm:mb-3 text-sm sm:text-base">Volume Bonuses</h4>
                      <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3">Hit these sales thresholds to earn bonus commissions:</p>
                      <div className="space-y-2">
                        {compPlanDetails.volume_bonuses.map((tier: VolumeTier, idx: number) => {
                          const isSalesCount = tier.min_volume < 1000
                          const nextTier = compPlanDetails.volume_bonuses[idx + 1]
                          const displayMax = isSalesCount && tier.max_volume && tier.max_volume > 100
                            ? (nextTier ? nextTier.min_volume - 1 : null)
                            : tier.max_volume
                          
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 sm:p-3 bg-white rounded-lg border">
                              <span className="text-gray-700 text-sm">
                                {isSalesCount 
                                  ? `${tier.min_volume}${displayMax ? ` - ${displayMax}` : '+'} sales`
                                  : `$${tier.min_volume.toLocaleString()} - ${tier.max_volume ? `$${tier.max_volume.toLocaleString()}` : '∞'}`
                                }
                              </span>
                              <span className="font-semibold text-green-600 text-sm">
                                {tier.bonus_type === 'percentage' ? `+${tier.bonus_value}%` : `+$${tier.bonus_value}`}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Team Overrides (for managers) */}
                  {compPlanDetails.team_overrides && compPlanDetails.team_overrides.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <h4 className="font-semibold text-gray-900 mb-2 sm:mb-3 text-sm sm:text-base">Team Override Bonuses</h4>
                      <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3">Earn overrides on your team's sales:</p>
                      <div className="space-y-2">
                        {compPlanDetails.team_overrides.map((tier: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 sm:p-3 bg-white rounded-lg border">
                            <span className="text-gray-700 text-sm">
                              Team: ${tier.min_team_volume?.toLocaleString() || 0}+
                            </span>
                            <span className="font-semibold text-blue-600 text-sm">
                              {tier.override_type === 'percentage' ? `${tier.override_value}%` : `$${tier.override_value}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Custom Readme */}
                  {compPlanDetails.readme && (
                    <div className="bg-blue-50 rounded-xl p-3 sm:p-4 border border-blue-100">
                      <h4 className="font-semibold text-blue-900 mb-2 text-sm sm:text-base">Additional Details</h4>
                      <div className="text-xs sm:text-sm text-blue-800 whitespace-pre-wrap">{compPlanDetails.readme}</div>
                    </div>
                  )}
                  
                  {/* Tips */}
                  <div className="bg-amber-50 rounded-xl p-3 sm:p-4 border border-amber-100">
                    <h4 className="font-semibold text-amber-900 mb-2 text-sm sm:text-base">Tips</h4>
                    <ul className="text-xs sm:text-sm text-amber-800 space-y-1 list-disc list-inside">
                      {compPlanDetails.plan_type === 'hourly' ? (
                        <>
                          <li>Log your hours accurately and on time</li>
                          <li>Overtime may be available - check with your manager</li>
                        </>
                      ) : compPlanDetails.plan_type === 'unit_based' ? (
                        <>
                          <li>Track your completed units accurately for each job</li>
                          <li>More units completed = higher earnings</li>
                        </>
                      ) : compPlanDetails.plan_type === 'hybrid' ? (
                        <>
                          <li>Your pay combines multiple compensation types</li>
                          <li>Track both hours and production for accurate pay</li>
                        </>
                      ) : (
                        <>
                          <li>Your commission is based on total sale amount</li>
                          <li>Volume bonuses reward consistent performance</li>
                          <li>Focus on quality to maximize close rate</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comp Calculator Modal */}
      {showCalculatorModal && compPlanDetails && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setShowCalculatorModal(false)}
        >
          <div 
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-6 border-b sticky top-0 bg-white rounded-t-2xl z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900">{compPlanDetails.name} Calculator</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {compPlanDetails.plan_type === 'hourly' ? 'Hourly Rate' :
                     compPlanDetails.plan_type === 'unit_based' ? 'Per Unit' :
                     compPlanDetails.plan_type === 'flat_rate' ? 'Flat Rate per Job' :
                     compPlanDetails.plan_type === 'tiered' ? 'Tiered Commission' :
                     compPlanDetails.plan_type === 'hybrid' ? 'Hybrid' :
                     'Percentage Commission'}
                  </p>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowCalculatorModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Dynamic Calculator Inputs based on plan type */}
              <div className="space-y-4">
                {/* Hourly plans - hours input */}
                {compPlanDetails.plan_type === 'hourly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Hours Worked per Week</label>
                    <input
                      type="number"
                      value={calcHoursWorked}
                      onChange={(e) => setCalcHoursWorked(Number(e.target.value))}
                      className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                    />
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                      {[20, 30, 40, 50, 60].map(hrs => (
                        <button
                          key={hrs}
                          onClick={() => setCalcHoursWorked(hrs)}
                          className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcHoursWorked === hrs ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {hrs}hrs
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unit-based plans - units input */}
                {compPlanDetails.plan_type === 'unit_based' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {compPlanDetails.unit_type === 'square' ? 'Squares per Month' :
                       compPlanDetails.unit_type === 'kw' ? 'kW Installed per Month' :
                       compPlanDetails.unit_type === 'panel' ? 'Panels per Month' :
                       compPlanDetails.unit_type === 'linear_foot' ? 'Linear Feet per Month' :
                       `${compPlanDetails.unit_type || 'Units'} per Month`}
                    </label>
                    <input
                      type="number"
                      value={calcUnits}
                      onChange={(e) => setCalcUnits(Number(e.target.value))}
                      className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                    />
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                      {[10, 20, 30, 50, 75, 100].map(u => (
                        <button
                          key={u}
                          onClick={() => setCalcUnits(u)}
                          className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcUnits === u ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Flat rate plans - just jobs */}
                {compPlanDetails.plan_type === 'flat_rate' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Jobs Closed per Month</label>
                    <input
                      type="number"
                      value={calcJobsClosed}
                      onChange={(e) => setCalcJobsClosed(Number(e.target.value))}
                      className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                    />
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                      {[2, 4, 6, 8, 10, 12, 15, 20].map(jobs => (
                        <button
                          key={jobs}
                          onClick={() => setCalcJobsClosed(jobs)}
                          className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcJobsClosed === jobs ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {jobs}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Percentage/tiered plans - sale price + jobs */}
                {['percentage', 'tiered'].includes(compPlanDetails.plan_type) && (
                  <>
                    {/* Personal sales section - show for non-managers OR managers with personal sales enabled */}
                    {(!compPlanDetails.is_manager_plan || compPlanDetails.personal_sales_enabled) && (
                      <>
                        {compPlanDetails.is_manager_plan && (
                          <h5 className="text-sm font-semibold text-gray-800 border-b pb-1">Your Personal Sales</h5>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Average Sale Price</label>
                          <input
                            type="number"
                            value={calcAvgSalePrice}
                            onChange={(e) => setCalcAvgSalePrice(Number(e.target.value))}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[8000, 10000, 13500, 18000, 25000].map(price => (
                              <button
                                key={price}
                                onClick={() => setCalcAvgSalePrice(price)}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcAvgSalePrice === price ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                              >
                                ${(price/1000).toFixed(0)}k
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Your Sales per Month</label>
                          <input
                            type="number"
                            value={calcJobsClosed}
                            onChange={(e) => setCalcJobsClosed(Number(e.target.value))}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[2, 4, 6, 8, 10, 12, 15, 20].map(jobs => (
                              <button
                                key={jobs}
                                onClick={() => setCalcJobsClosed(jobs)}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcJobsClosed === jobs ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                              >
                                {jobs}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    
                    {/* Team sales section - only for managers with team overrides enabled */}
                    {compPlanDetails.is_manager_plan && compPlanDetails.team_override_enabled && (
                      <>
                        <h5 className="text-sm font-semibold text-gray-800 border-b pb-1 mt-4">Team Sales (Override)</h5>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Team Avg Sale Price</label>
                          <input
                            type="number"
                            value={calcTeamAvgPrice}
                            onChange={(e) => setCalcTeamAvgPrice(Number(e.target.value))}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[8000, 10000, 13500, 18000, 25000].map(price => (
                              <button
                                key={price}
                                onClick={() => setCalcTeamAvgPrice(price)}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcTeamAvgPrice === price ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                              >
                                ${(price/1000).toFixed(0)}k
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Team Sales per Month</label>
                          <input
                            type="number"
                            value={calcTeamSales}
                            onChange={(e) => setCalcTeamSales(Number(e.target.value))}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[10, 20, 30, 40, 50, 75, 100].map(sales => (
                              <button
                                key={sales}
                                onClick={() => setCalcTeamSales(sales)}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcTeamSales === sales ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                              >
                                {sales}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              
              {/* Results - dynamic based on plan type */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 sm:p-6 border border-green-100">
                <h4 className="font-semibold text-green-900 mb-3 sm:mb-4 text-sm sm:text-base">Estimated Earnings</h4>
                
                {(() => {
                  let monthlyEarnings = 0
                  let displayRows: { label: string; value: string }[] = []
                  
                  if (compPlanDetails.plan_type === 'hourly') {
                    const weeklyPay = calcHoursWorked * (compPlanDetails.hourly_rate || 0)
                    monthlyEarnings = weeklyPay * 4.33 // Average weeks per month
                    displayRows = [
                      { label: 'Hours/Week', value: `${calcHoursWorked}` },
                      { label: 'Hourly Rate', value: `$${compPlanDetails.hourly_rate?.toLocaleString() || 0}/hr` },
                      { label: 'Weekly Pay', value: `$${weeklyPay.toLocaleString()}` },
                    ]
                  } else if (compPlanDetails.plan_type === 'unit_based') {
                    monthlyEarnings = calcUnits * (compPlanDetails.unit_rate || 0)
                    displayRows = [
                      { label: `${compPlanDetails.unit_type || 'Units'}/Month`, value: `${calcUnits}` },
                      { label: 'Rate per Unit', value: `$${compPlanDetails.unit_rate?.toLocaleString() || 0}` },
                    ]
                  } else if (compPlanDetails.plan_type === 'flat_rate') {
                    monthlyEarnings = calcJobsClosed * (compPlanDetails.flat_rate || compPlanDetails.flat_amount || 0)
                    displayRows = [
                      { label: 'Jobs/Month', value: `${calcJobsClosed}` },
                      { label: 'Rate per Job', value: `$${(compPlanDetails.flat_rate || compPlanDetails.flat_amount || 0).toLocaleString()}` },
                    ]
                  } else {
                    // Percentage or tiered
                    let personalEarnings = 0
                    let teamOverrideEarnings = 0
                    
                    // Calculate personal sales earnings (if applicable)
                    if (!compPlanDetails.is_manager_plan || compPlanDetails.personal_sales_enabled) {
                      const monthlyVolume = calcAvgSalePrice * calcJobsClosed
                      let baseRate = compPlanDetails.base_percentage || 0
                      let appliedBonuses: string[] = []
                      
                      // Check for volume bonuses
                      if (compPlanDetails.volume_bonuses && compPlanDetails.volume_bonuses.length > 0) {
                        const bonuses = compPlanDetails.volume_bonuses
                        for (let i = 0; i < bonuses.length; i++) {
                          const tier = bonuses[i]
                          const isSalesCount = tier.min_volume < 1000
                          const compareValue = isSalesCount ? calcJobsClosed : monthlyVolume
                          
                          if (compareValue >= tier.min_volume) {
                            if (tier.bonus_type === 'percentage') {
                              baseRate += tier.bonus_value
                              appliedBonuses.push(`+${tier.bonus_value}%`)
                            }
                          }
                        }
                      }
                      
                      personalEarnings = monthlyVolume * (baseRate / 100)
                      
                      if (compPlanDetails.is_manager_plan) {
                        displayRows.push({ label: '— Your Sales —', value: '' })
                      }
                      displayRows.push({ label: 'Your Sales/Month', value: `${calcJobsClosed}` })
                      displayRows.push({ label: 'Avg Sale Price', value: `$${calcAvgSalePrice.toLocaleString()}` })
                      displayRows.push({ label: 'Your Volume', value: `$${monthlyVolume.toLocaleString()}` })
                      displayRows.push({ label: 'Commission Rate', value: `${baseRate}%${appliedBonuses.length > 0 ? ` (${appliedBonuses.join(' ')})` : ''}` })
                      displayRows.push({ label: 'Personal Earnings', value: `$${Math.round(personalEarnings).toLocaleString()}` })
                    }
                    
                    // Calculate team override earnings (for managers)
                    if (compPlanDetails.is_manager_plan && compPlanDetails.team_override_enabled && compPlanDetails.team_overrides?.length > 0) {
                      const teamVolume = calcTeamAvgPrice * calcTeamSales
                      
                      // Find applicable override tier
                      let overrideRate = 0
                      let overrideType = 'percentage'
                      const sortedOverrides = [...compPlanDetails.team_overrides].sort((a: any, b: any) => (b.min_team_volume || 0) - (a.min_team_volume || 0))
                      
                      for (const tier of sortedOverrides) {
                        if (teamVolume >= (tier.min_team_volume || 0)) {
                          overrideRate = tier.override_value || 0
                          overrideType = tier.override_type || 'percentage'
                          break
                        }
                      }
                      
                      if (overrideType === 'percentage') {
                        teamOverrideEarnings = teamVolume * (overrideRate / 100)
                      } else {
                        // Flat amount per sale
                        teamOverrideEarnings = calcTeamSales * overrideRate
                      }
                      
                      displayRows.push({ label: '— Team Override —', value: '' })
                      displayRows.push({ label: 'Team Sales/Month', value: `${calcTeamSales}` })
                      displayRows.push({ label: 'Team Avg Price', value: `$${calcTeamAvgPrice.toLocaleString()}` })
                      displayRows.push({ label: 'Team Volume', value: `$${teamVolume.toLocaleString()}` })
                      displayRows.push({ label: 'Override Rate', value: overrideType === 'percentage' ? `${overrideRate}%` : `$${overrideRate}/sale` })
                      displayRows.push({ label: 'Override Earnings', value: `$${Math.round(teamOverrideEarnings).toLocaleString()}` })
                    }
                    
                    monthlyEarnings = personalEarnings + teamOverrideEarnings
                    
                    // For non-managers, show simpler display
                    if (!compPlanDetails.is_manager_plan) {
                      const monthlyVolume = calcAvgSalePrice * calcJobsClosed
                      let baseRate = compPlanDetails.base_percentage || 0
                      let appliedBonuses: string[] = []
                      
                      if (compPlanDetails.volume_bonuses && compPlanDetails.volume_bonuses.length > 0) {
                        for (const tier of compPlanDetails.volume_bonuses) {
                          const isSalesCount = tier.min_volume < 1000
                          const compareValue = isSalesCount ? calcJobsClosed : monthlyVolume
                          if (compareValue >= tier.min_volume && tier.bonus_type === 'percentage') {
                            baseRate += tier.bonus_value
                            appliedBonuses.push(`+${tier.bonus_value}%`)
                          }
                        }
                      }
                      
                      displayRows = [
                        { label: 'Sales/Month', value: `${calcJobsClosed}` },
                        { label: 'Avg Sale Price', value: `$${calcAvgSalePrice.toLocaleString()}` },
                        { label: 'Monthly Volume', value: `$${monthlyVolume.toLocaleString()}` },
                        { label: 'Base Rate', value: `${compPlanDetails.base_percentage || 0}%` },
                      ]
                      if (appliedBonuses.length > 0) {
                        displayRows.push({ label: 'Bonuses', value: appliedBonuses.join(', ') })
                      }
                      displayRows.push({ label: 'Total Rate', value: `${baseRate}%` })
                    }
                  }
                  
                  return (
                    <div className="space-y-2 sm:space-y-3">
                      {displayRows.map((row, idx) => (
                        <div key={idx} className="flex justify-between items-center">
                          <span className="text-gray-600 text-sm">{row.label}</span>
                          <span className="font-semibold text-gray-900 text-sm">{row.value}</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 sm:pt-3">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-700 font-medium text-sm">Monthly Earnings</span>
                          <span className="text-xl sm:text-2xl font-bold text-green-600">${Math.round(monthlyEarnings).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-gray-600 text-sm">Annual (x12)</span>
                          <span className="font-semibold text-green-700 text-sm">${Math.round(monthlyEarnings * 12).toLocaleString()}</span>
                        </div>
                        {compPlanDetails.plan_type !== 'hourly' && calcJobsClosed > 0 && (
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-600 text-sm">Per Job</span>
                            <span className="font-semibold text-green-700 text-sm">${Math.round(monthlyEarnings / calcJobsClosed).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
              
              {/* Volume Tiers */}
              {compPlanDetails.volume_bonuses && compPlanDetails.volume_bonuses.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                  <h4 className="font-semibold text-gray-900 mb-2 sm:mb-3 text-sm sm:text-base">Commission Tiers</h4>
                  <div className="space-y-2">
                    {compPlanDetails.volume_bonuses.map((tier: VolumeTier, idx: number) => {
                      const isSalesCount = tier.min_volume < 1000
                      const nextTier = compPlanDetails.volume_bonuses[idx + 1]
                      const effectiveMax = isSalesCount && tier.max_volume && tier.max_volume > 100
                        ? (nextTier ? nextTier.min_volume - 1 : null)
                        : tier.max_volume
                      
                      const isActive = isSalesCount 
                        ? calcJobsClosed >= tier.min_volume && (!effectiveMax || calcJobsClosed <= effectiveMax)
                        : (calcAvgSalePrice * calcJobsClosed) >= tier.min_volume && (!tier.max_volume || (calcAvgSalePrice * calcJobsClosed) <= tier.max_volume)
                      
                      return (
                        <div key={idx} className={`flex items-center justify-between p-2 sm:p-3 rounded-lg border ${isActive ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                          <span className={`text-sm ${isActive ? 'text-green-800 font-medium' : 'text-gray-700'}`}>
                            {isSalesCount 
                              ? `${tier.min_volume}${effectiveMax ? ` - ${effectiveMax}` : '+'} sales`
                              : `$${tier.min_volume.toLocaleString()} - ${tier.max_volume ? `$${tier.max_volume.toLocaleString()}` : '∞'}`
                            }
                          </span>
                          <span className={`text-sm font-semibold ${isActive ? 'text-green-600' : 'text-gray-500'}`}>
                            {tier.bonus_type === 'percentage' ? `+${tier.bonus_value}%` : `+$${tier.bonus_value}`}
                            {isActive && ' ✓'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
