'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface Commission {
  id: string
  sale_amount: number
  commission_amount: number
  bonus_amount: number
  total_amount: number
  status: 'pending' | 'approved' | 'paid' | 'disputed'
  commission_period: string
  created_at: string
  projects?: { address_text: string }
  opportunities?: { address_text: string }
}

interface CommissionSummary {
  thisPeriod: number
  lastPeriod: number
  pending: number
  ytd: number
  thisWeek: number
}

interface CommissionSettings {
  commission_period: 'weekly' | 'bi-weekly' | 'monthly'
  week_start_day: number
  bi_weekly_start_date?: string
}

export default function CommissionWidget() {
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [summary, setSummary] = useState<CommissionSummary>({
    thisPeriod: 0,
    lastPeriod: 0,
    pending: 0,
    ytd: 0,
    thisWeek: 0,
  })
  const [hasCompPlan, setHasCompPlan] = useState(false)
  const [commissionSettings, setCommissionSettings] = useState<CommissionSettings>({
    commission_period: 'monthly',
    week_start_day: 0,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) {
      loadCommissions()
    }
  }, [mounted])

  // Helper function to get period boundaries
  const getPeriodBoundaries = (settings: CommissionSettings, periodOffset: number = 0) => {
    const now = new Date()
    let periodStart: Date
    let periodEnd: Date

    if (settings.commission_period === 'monthly') {
      periodStart = new Date(now.getFullYear(), now.getMonth() + periodOffset, 1)
      periodEnd = new Date(now.getFullYear(), now.getMonth() + periodOffset + 1, 0)
    } else if (settings.commission_period === 'weekly') {
      const dayOfWeek = now.getDay()
      const diff = dayOfWeek - settings.week_start_day
      const adjustedDiff = diff < 0 ? diff + 7 : diff
      periodStart = new Date(now)
      periodStart.setDate(now.getDate() - adjustedDiff + (periodOffset * 7))
      periodEnd = new Date(periodStart)
      periodEnd.setDate(periodStart.getDate() + 6)
    } else { // bi-weekly
      const refDate = settings.bi_weekly_start_date 
        ? new Date(settings.bi_weekly_start_date) 
        : new Date(now.getFullYear(), 0, 1)
      const daysSinceRef = Math.floor((now.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24))
      const periodNumber = Math.floor(daysSinceRef / 14)
      periodStart = new Date(refDate)
      periodStart.setDate(refDate.getDate() + ((periodNumber + periodOffset) * 14))
      periodEnd = new Date(periodStart)
      periodEnd.setDate(periodStart.getDate() + 13)
    }

    return {
      start: periodStart.toISOString().split('T')[0],
      end: periodEnd.toISOString().split('T')[0],
    }
  }

  const loadCommissions = async () => {
    const supabase = createClientBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Get user's org settings
    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    let settings: CommissionSettings = { commission_period: 'monthly', week_start_day: 0 }
    
    if (profile) {
      const { data: org } = await supabase
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      if (org?.settings?.commission) {
        settings = { ...settings, ...org.settings.commission }
      }
    }

    setCommissionSettings(settings)

    // Check if user has a comp plan assigned
    const { data: userCompPlan } = await supabase
      .from('user_comp_plans')
      .select('id')
      .eq('user_id', user.id)
      .is('effective_to', null)
      .limit(1)
      .maybeSingle()
    
    setHasCompPlan(!!userCompPlan)

    const now = new Date()
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0]
    const thisPeriod = getPeriodBoundaries(settings, 0)
    const lastPeriod = getPeriodBoundaries(settings, -1)
    
    // Calculate this week's boundaries (always Sunday to Saturday)
    const dayOfWeek = now.getDay()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - dayOfWeek)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    // Get recent commissions
    const { data: recentCommissions } = await supabase
      .from('commissions')
      .select('*, projects(address_text), opportunities(address_text)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)

    setCommissions(recentCommissions || [])

    // Calculate summaries
    const { data: allCommissions } = await supabase
      .from('commissions')
      .select('total_amount, status, commission_period')
      .eq('user_id', user.id)
      .gte('commission_period', yearStart)

    if (allCommissions) {
      const thisPeriodTotal = allCommissions
        .filter(c => c.commission_period >= thisPeriod.start && c.commission_period <= thisPeriod.end)
        .reduce((sum, c) => sum + (c.total_amount || 0), 0)

      const lastPeriodTotal = allCommissions
        .filter(c => c.commission_period >= lastPeriod.start && c.commission_period <= lastPeriod.end)
        .reduce((sum, c) => sum + (c.total_amount || 0), 0)

      const pending = allCommissions
        .filter(c => c.status === 'pending')
        .reduce((sum, c) => sum + (c.total_amount || 0), 0)

      const ytd = allCommissions
        .reduce((sum, c) => sum + (c.total_amount || 0), 0)

      // Calculate this week's total
      const weekStartStr = weekStart.toISOString().split('T')[0]
      const weekEndStr = weekEnd.toISOString().split('T')[0]
      const thisWeekTotal = allCommissions
        .filter(c => c.commission_period >= weekStartStr && c.commission_period <= weekEndStr)
        .reduce((sum, c) => sum + (c.total_amount || 0), 0)

      setSummary({ thisPeriod: thisPeriodTotal, lastPeriod: lastPeriodTotal, pending, ytd, thisWeek: thisWeekTotal })
    }

    setLoading(false)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-700'
      case 'approved': return 'bg-blue-100 text-blue-700'
      case 'pending': return 'bg-amber-100 text-amber-700'
      case 'disputed': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">My Commissions</h2>
        <span className="text-2xl">💰</span>
      </div>

      {/* Weekly Pay Estimate - Prominent Display */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-4 mb-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-indigo-100 text-sm font-medium">This Week's Pay</p>
            <p className="text-3xl font-bold mt-1">{formatCurrency(summary.thisWeek)}</p>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        {!hasCompPlan && (
          <p className="text-indigo-200 text-xs mt-2">No comp plan assigned - contact your manager</p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3">
          <p className="text-xs text-green-600 font-medium">
            This {commissionSettings.commission_period === 'monthly' ? 'Month' : commissionSettings.commission_period === 'weekly' ? 'Week' : 'Period'}
          </p>
          <p className="text-xl font-bold text-green-700">{formatCurrency(summary.thisPeriod)}</p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-3">
          <p className="text-xs text-blue-600 font-medium">YTD Total</p>
          <p className="text-xl font-bold text-blue-700">{formatCurrency(summary.ytd)}</p>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-3">
          <p className="text-xs text-amber-600 font-medium">Pending</p>
          <p className="text-xl font-bold text-amber-700">{formatCurrency(summary.pending)}</p>
        </div>
        <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-lg p-3">
          <p className="text-xs text-gray-600 font-medium">
            Last {commissionSettings.commission_period === 'monthly' ? 'Month' : commissionSettings.commission_period === 'weekly' ? 'Week' : 'Period'}
          </p>
          <p className="text-xl font-bold text-gray-700">{formatCurrency(summary.lastPeriod)}</p>
        </div>
      </div>

      {/* Recent Commissions */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Recent Commissions</h3>
        {commissions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No commissions yet</p>
        ) : (
          <div className="space-y-2">
            {commissions.map((commission) => (
              <div
                key={commission.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {commission.projects?.address_text || commission.opportunities?.address_text || 'Sale'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(commission.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusColor(commission.status)}`}>
                    {commission.status}
                  </span>
                  <span className="font-semibold text-green-600">
                    {formatCurrency(commission.total_amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Period-over-Period Change */}
      {summary.lastPeriod > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center gap-2">
            {summary.thisPeriod >= summary.lastPeriod ? (
              <>
                <span className="text-green-500">↑</span>
                <span className="text-sm text-gray-600">
                  {Math.round(((summary.thisPeriod - summary.lastPeriod) / summary.lastPeriod) * 100)}% vs last {commissionSettings.commission_period === 'monthly' ? 'month' : commissionSettings.commission_period === 'weekly' ? 'week' : 'period'}
                </span>
              </>
            ) : (
              <>
                <span className="text-red-500">↓</span>
                <span className="text-sm text-gray-600">
                  {Math.round(((summary.lastPeriod - summary.thisPeriod) / summary.lastPeriod) * 100)}% vs last {commissionSettings.commission_period === 'monthly' ? 'month' : commissionSettings.commission_period === 'weekly' ? 'week' : 'period'}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Estimator Link */}
      <div className="mt-4 pt-4 border-t">
        <Link 
          href="/commissions/estimator"
          className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Commission Estimator
        </Link>
      </div>
    </div>
  )
}
