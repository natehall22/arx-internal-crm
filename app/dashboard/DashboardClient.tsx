'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import InspectionStatusCard from '@/components/InspectionStatusCard'
import CommissionWidget from '@/components/CommissionWidget'
import AIAssistantWrapper from '@/components/AIAssistantWrapper'
import UnpaidReferralsAlert from '@/components/UnpaidReferralsAlert'
import type { InspectionOutcome } from '@/lib/types/database'

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

type TimeFrame = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all'

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

  useEffect(() => {
    loadDashboardReports()
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
        const dataRes = await fetch('/api/reports/custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ report_id: report.id }),
        })
        if (dataRes.ok) {
          const result = await dataRes.json()
          setReportData(prev => ({ ...prev, [report.id]: result.data || [] }))
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
  }) => {
    try {
      const res = await fetch('/api/inspections/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: activePrompt.appointment_id,
          outcome: data.outcome,
          notes: data.notes,
          setter_feedback: data.setterFeedback,
        }),
      })

      if (res.ok) {
        // Move to next prompt or close
        const remainingPrompts = pendingPrompts.filter(
          p => p.id !== activePrompt.id && !dismissedPrompts.includes(p.id)
        )
        setActivePrompt(remainingPrompts.length > 0 ? remainingPrompts[0] : null)
      }
    } catch (error) {
      console.error('Failed to submit status:', error)
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
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Unpaid Referrals Alert */}
        <UnpaidReferralsAlert />

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {profile.full_name?.split(' ')[0] || 'there'}!
            </h1>
            <p className="text-gray-500 mt-1">
              Here's your performance overview for this week
            </p>
          </div>
          {(profile.role === 'admin' || profile.role === 'regional_manager') && (
            <Link
              href="/admin/dashboard-settings"
              className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Doors Knocked</p>
                <p className="text-2xl font-bold text-gray-900">{stats.doorsKnockedThisWeek}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">This week</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Inspections Set</p>
                <p className="text-2xl font-bold text-gray-900">{stats.inspectionsSetThisWeek}</p>
              </div>
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">This week</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Sales</p>
                <p className="text-2xl font-bold text-green-600">{stats.salesThisWeek}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">This week</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Close Rate</p>
                <p className="text-2xl font-bold text-indigo-600">{stats.closeRate}%</p>
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">All time</p>
          </div>
        </div>

        {/* Team Leaderboard - for managers/admins */}
        {teamMemberStats.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-8 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Team Stats</h2>
              <div className="flex items-center gap-3">
                <select
                  value={timeFrame}
                  onChange={(e) => setTimeFrame(e.target.value as TimeFrame)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="quarter">This Quarter</option>
                  <option value="year">This Year</option>
                  <option value="all">All Time</option>
                </select>
                <span className="text-sm text-gray-500">{filteredTeamStats.length} reps</span>
              </div>
            </div>
            <div className="overflow-x-auto">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Progress Section */}
          <div className="lg:col-span-2 space-y-6">
            {/* Weekly Progress */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Progress</h2>
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

            {/* Upcoming Appointments */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Upcoming Appointments</h2>
                <Link href="/schedule" className="text-sm text-indigo-600 hover:text-indigo-700">
                  View all
                </Link>
              </div>
              {upcomingAppointments.length === 0 ? (
                <p className="text-gray-500 text-sm py-4">No upcoming appointments</p>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="w-14 text-center">
                        <p className="text-xs text-gray-500">{formatDate(apt.scheduled_for)}</p>
                        <p className="text-lg font-bold text-gray-900">{formatTime(apt.scheduled_for)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {apt.leads?.homeowner_name || 'Unknown'}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {apt.leads?.address_text || apt.address_text || 'No address'}
                        </p>
                      </div>
                      <Link
                        href={`/opportunities/${apt.opportunity_id}`}
                        className="text-indigo-600 hover:text-indigo-700"
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

            {/* Account Overview */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Account Overview</h2>
              <div className="grid grid-cols-3 gap-4">
                <Link href="/leads" className="p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                  <p className="text-3xl font-bold text-blue-600">{stats.totalLeads}</p>
                  <p className="text-sm text-gray-600">Total Leads</p>
                  <p className="text-xs text-blue-600 mt-1">{stats.newLeads} new</p>
                </Link>
                <Link href="/opportunities" className="p-4 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
                  <p className="text-3xl font-bold text-amber-600">{stats.totalOpportunities}</p>
                  <p className="text-sm text-gray-600">Opportunities</p>
                  <p className="text-xs text-amber-600 mt-1">{stats.openOpportunities} open</p>
                </Link>
                <Link href="/projects" className="p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors">
                  <p className="text-3xl font-bold text-green-600">{stats.totalProjects}</p>
                  <p className="text-sm text-gray-600">Projects</p>
                  <p className="text-xs text-green-600 mt-1">{stats.activeProjects} active</p>
                </Link>
              </div>
            </div>

            {/* Custom Reports Widgets */}
            {customReports.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Custom Reports</h2>
                  <Link href="/reports?tab=custom" className="text-sm text-indigo-600 hover:text-indigo-700">
                    View all
                  </Link>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {customReports.slice(0, 4).map((report) => {
                    const data = reportData[report.id] || []
                    const maxValue = Math.max(...data.map(d => d.value), 1)
                    
                    return (
                      <div key={report.id} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">
                            {report.report_type === 'bar_chart' ? '📊' : 
                             report.report_type === 'line_chart' ? '📈' : 
                             report.report_type === 'pie_chart' ? '🥧' : 
                             report.report_type === 'metric_card' ? '🔢' : '📋'}
                          </span>
                          <h3 className="font-medium text-gray-900 text-sm">{report.name}</h3>
                        </div>
                        
                        {report.report_type === 'metric_card' ? (
                          <div className="text-center py-2">
                            <p className="text-3xl font-bold text-indigo-600">
                              {data[0]?.value?.toLocaleString() || 0}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {data.slice(0, 3).map((item, idx) => (
                              <div key={idx}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-600 truncate">{item.label}</span>
                                  <span className="font-medium text-gray-900">{item.value}</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-indigo-500 rounded-full"
                                    style={{ width: `${(item.value / maxValue) * 100}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Pending Status Updates */}
            {pendingPrompts.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
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
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
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
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
              <div className="space-y-2">
                <Link
                  href="/canvass/map"
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">Start Canvassing</span>
                </Link>
                <Link
                  href="/leads/new"
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">Add New Lead</span>
                </Link>
                <Link
                  href="/reports"
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">View Reports</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistantWrapper context={{ type: 'general' }} />
    </>
  )
}
