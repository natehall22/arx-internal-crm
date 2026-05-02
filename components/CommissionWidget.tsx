'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import { netCommissionableFromFinancedTotal } from '@/lib/financing'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import {
  applyFirstMatchingVolumeBonus,
  formatVolumeBonusTierRange,
  volumeBonusTierInRange,
} from '@/lib/volume-bonus-display'

interface Commission {
  id: string
  sale_amount: number
  commissionable_amount?: number | null
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
  team_overrides: any[]
  readme?: string
}

interface VolumeTier {
  min_volume: number
  max_volume: number | null
  bonus_type: 'percentage' | 'flat'
  bonus_value: number
  tier_metric?: 'volume' | 'closing_rate' | 'sits'
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
  const [compPlanDetails, setCompPlanDetails] = useState<CompPlanDetails | null>(null)
  const [userRole, setUserRole] = useState<string>('')
  const [showCompPlanModal, setShowCompPlanModal] = useState(false)
  const [showCalculatorModal, setShowCalculatorModal] = useState(false)
  
  // Calculator state
  const [calcAvgSalePrice, setCalcAvgSalePrice] = useState(13500)
  const [calcJobsClosed, setCalcJobsClosed] = useState(4)
  const [calcPeriodSits, setCalcPeriodSits] = useState(12)
  const [avgDealerFeePercent, setAvgDealerFeePercent] = useState(0)

  const commissionablePerJob = netCommissionableFromFinancedTotal(calcAvgSalePrice, avgDealerFeePercent)
  const monthlyCommissionableVolume = commissionablePerJob * calcJobsClosed
  const widgetTierValues = {
    periodVolume: monthlyCommissionableVolume,
    periodSits: calcPeriodSits,
    periodClosingRatePct:
      calcPeriodSits > 0 ? Math.round((calcJobsClosed / calcPeriodSits) * 1000) / 10 : null,
  }

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

    // Get user's org settings and role
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    let settings: CommissionSettings = { commission_period: 'monthly', week_start_day: 0 }
    
    if (profile) {
      setUserRole(profile.role || '')
      
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

    // Check if user has a comp plan assigned and get details
    if (profile?.org_id) {
      const todayStr = new Date().toISOString().split('T')[0]
      // Use select(*) to get all available columns without failing on missing ones
      const { data: userCompPlan, error: compPlanError } = await supabase
        .from('user_comp_plans')
        .select(`
          id,
          effective_from,
          effective_to,
          comp_plans (*)
        `)
        .eq('user_id', user.id)
        .eq('org_id', profile.org_id)
        .lte('effective_from', todayStr)
        .or(`effective_to.is.null,effective_to.gte.${todayStr}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (compPlanError) {
        console.error('Error fetching comp plan:', compPlanError)
      }
      
      let plan = userCompPlan?.comp_plans as any
      if (!plan) {
        const { data: defaultPlan } = await supabase
          .from('comp_plans')
          .select('*')
          .eq('org_id', profile.org_id)
          .eq('is_default', true)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
        plan = defaultPlan
      }

      if (plan && plan.is_active !== false) {
        setHasCompPlan(true)
        setCompPlanDetails({
          id: plan.id,
          name: plan.name,
          plan_type: plan.plan_type || 'percentage',
          base_percentage: plan.base_percentage,
          flat_rate: plan.flat_rate,
          flat_amount: plan.flat_amount,
          hourly_rate: plan.hourly_rate,
          unit_rate: plan.unit_rate,
          unit_type: plan.unit_type,
          hybrid_components: plan.hybrid_components || null,
          volume_bonuses: plan.volume_bonuses || [],
          team_overrides: plan.team_overrides || [],
          readme: plan.readme,
        })
      } else {
        setHasCompPlan(false)
        setCompPlanDetails(null)
      }
    }

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
      .select('*, commissionable_amount, projects(address_text), opportunities(address_text)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)

    setCommissions(recentCommissions || [])

    // Calculate summaries
    const { data: allCommissions } = await supabase
      .from('commissions')
      .select('total_amount, commissionable_amount, status, commission_period')
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

      {/* Action Buttons */}
      <div className="mt-4 pt-4 border-t space-y-2">
        {/* My Comp Plan Button */}
        <button 
          onClick={() => setShowCompPlanModal(true)}
          className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          My Comp Plan
        </button>
        
        {/* Comp Calculator Button - Hidden for hourly, unit_based, and hybrid plans */}
        {compPlanDetails && !['hourly', 'unit_based', 'hybrid'].includes(compPlanDetails.plan_type) && (
          <button 
            onClick={() => setShowCalculatorModal(true)}
            className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Comp Calculator
          </button>
        )}
        
        {/* Advanced Estimator Link */}
        <Link 
          href="/commissions/estimator"
          className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Advanced Estimator
        </Link>
      </div>

      {/* Comp Plan Modal */}
      {showCompPlanModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">My Compensation Plan</h2>
                <button 
                  onClick={() => setShowCompPlanModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6">
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
                <div className="space-y-6">
                  {/* Plan Name & Type */}
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-4 text-white">
                    <p className="text-indigo-100 text-sm">Your Plan</p>
                    <h3 className="text-2xl font-bold">{compPlanDetails.name}</h3>
                    <p className="text-indigo-200 text-sm mt-1 capitalize">{compPlanDetails.plan_type.replace('_', ' ')} Plan</p>
                  </div>
                  
                  {/* Base Rate - varies by plan type */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">
                      {compPlanDetails.plan_type === 'hourly' ? 'Hourly Rate' : 
                       compPlanDetails.plan_type === 'unit_based' ? 'Per Unit Rate' :
                       compPlanDetails.plan_type === 'hybrid' ? 'Compensation Components' :
                       'Base Commission Rate'}
                    </h4>
                    {compPlanDetails.plan_type === 'hourly' ? (
                      <p className="text-2xl font-bold text-green-600">${compPlanDetails.hourly_rate?.toLocaleString() || 0}/hour</p>
                    ) : compPlanDetails.plan_type === 'flat_rate' ? (
                      <p className="text-2xl font-bold text-green-600">${(compPlanDetails.flat_rate || compPlanDetails.flat_amount)?.toLocaleString() || 0} per job</p>
                    ) : compPlanDetails.plan_type === 'unit_based' ? (
                      <div>
                        <p className="text-2xl font-bold text-green-600">
                          ${compPlanDetails.unit_rate?.toLocaleString() || 0} per {compPlanDetails.unit_type || 'unit'}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {compPlanDetails.unit_type === 'square' && 'Roofing squares (100 sq ft each)'}
                          {compPlanDetails.unit_type === 'kw' && 'Kilowatts of solar installed'}
                          {compPlanDetails.unit_type === 'linear_foot' && 'Linear feet of material'}
                          {compPlanDetails.unit_type === 'panel' && 'Panels installed'}
                        </p>
                      </div>
                    ) : compPlanDetails.plan_type === 'hybrid' && compPlanDetails.hybrid_components ? (
                      <div className="space-y-2">
                        {compPlanDetails.hybrid_components.map((comp, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-white rounded-lg border">
                            <span className="text-gray-700 capitalize">
                              {comp.type === 'hourly' ? 'Hourly Rate' :
                               comp.type === 'percentage' ? 'Commission' :
                               comp.type === 'flat_per_job' ? 'Per Job' :
                               `Per ${comp.unit_type || 'Unit'}`}
                              {comp.description && <span className="text-gray-500 text-sm ml-1">({comp.description})</span>}
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
                      <p className="text-2xl font-bold text-green-600">{compPlanDetails.base_percentage || 0}% of sale</p>
                    )}
                  </div>
                  
                  {/* Hourly Plan Notice */}
                  {compPlanDetails.plan_type === 'hourly' && (
                    <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                      <h4 className="font-semibold text-blue-900 mb-2">Hourly Compensation</h4>
                      <p className="text-sm text-blue-800">
                        Your compensation is based on hours worked. Track your hours through the time tracking system. 
                        Commission calculators don't apply to hourly plans.
                      </p>
                    </div>
                  )}
                  
                  {/* Hybrid Plan Notice */}
                  {compPlanDetails.plan_type === 'hybrid' && (
                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                      <h4 className="font-semibold text-purple-900 mb-2">Hybrid Compensation</h4>
                      <p className="text-sm text-purple-800">
                        Your pay combines multiple components. Each component is calculated separately and added together for your total compensation.
                      </p>
                    </div>
                  )}
                  
                  {/* Unit-Based Plan Notice */}
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
                    <div className="bg-gray-50 rounded-xl p-4">
                      <h4 className="font-semibold text-gray-900 mb-3">Volume Bonuses</h4>
                      <p className="text-sm text-gray-600 mb-3">Hit these thresholds to earn bonus commissions:</p>
                      <div className="space-y-2">
                        {compPlanDetails.volume_bonuses.map((tier: VolumeTier, idx: number) => {
                          const nextTier = compPlanDetails.volume_bonuses[idx + 1]
                          return (
                          <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                            <span className="text-gray-700">
                              {formatVolumeBonusTierRange(tier, {
                                nextMinVolume: nextTier?.min_volume ?? null,
                              })}
                            </span>
                            <span className="font-semibold text-green-600">
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
                    <div className="bg-gray-50 rounded-xl p-4">
                      <h4 className="font-semibold text-gray-900 mb-3">Team Override Bonuses</h4>
                      <p className="text-sm text-gray-600 mb-3">Earn overrides on your team's sales:</p>
                      <div className="space-y-2">
                        {compPlanDetails.team_overrides.map((tier: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                            <span className="text-gray-700">
                              Team Volume: ${tier.min_team_volume?.toLocaleString() || 0}+
                            </span>
                            <span className="font-semibold text-blue-600">
                              {tier.override_type === 'percentage' ? `${tier.override_value}%` : `$${tier.override_value}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Custom Readme */}
                  {compPlanDetails.readme && (
                    <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                      <h4 className="font-semibold text-blue-900 mb-2">Additional Details</h4>
                      <div className="text-sm text-blue-800 whitespace-pre-wrap">{compPlanDetails.readme}</div>
                    </div>
                  )}
                  
                  {/* Role-Specific Tips */}
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <h4 className="font-semibold text-amber-900 mb-2">
                      {compPlanDetails.plan_type === 'hourly' ? 'Hourly Employee Tips' :
                       compPlanDetails.plan_type === 'unit_based' ? 'Per-Unit Pay Tips' :
                       compPlanDetails.plan_type === 'hybrid' ? 'Hybrid Plan Tips' :
                       isSetterLikeRole(userRole) ? 'Setter Tips' : 
                       userRole === 'manager' || userRole === 'sales_manager' ? 'Manager Tips' : 'Closer Tips'}
                    </h4>
                    <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
                      {compPlanDetails.plan_type === 'hourly' ? (
                        <>
                          <li>Log your hours accurately and on time</li>
                          <li>Overtime may be available - check with your manager</li>
                          <li>Your pay is based on hours worked, not sales volume</li>
                        </>
                      ) : compPlanDetails.plan_type === 'unit_based' ? (
                        <>
                          <li>Track your completed units accurately for each job</li>
                          <li>More units completed = higher earnings</li>
                          <li>Quality work ensures units are counted correctly</li>
                        </>
                      ) : compPlanDetails.plan_type === 'hybrid' ? (
                        <>
                          <li>Your pay combines multiple compensation types</li>
                          <li>Track both hours and production for accurate pay</li>
                          <li>Each component is calculated and paid separately</li>
                        </>
                      ) : isSetterLikeRole(userRole) ? (
                        <>
                          <li>Your commission is based on jobs that close from your sets</li>
                          <li>Higher monthly volume unlocks better commission tiers</li>
                          <li>Quality sets lead to higher close rates</li>
                        </>
                      ) : (userRole === 'manager' || userRole === 'sales_manager') ? (
                        <>
                          <li>Earn on your personal sales plus team overrides</li>
                          <li>Team volume bonuses stack with personal bonuses</li>
                          <li>Help your team hit their goals to maximize earnings</li>
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
      {showCalculatorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Comp Calculator</h2>
                <button 
                  onClick={() => setShowCalculatorModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-gray-500 text-sm mt-1">
                {isSetterLikeRole(userRole) ? 'Setter' : 
                 userRole === 'manager' || userRole === 'sales_manager' ? 'Manager' : 'Closer'} Commission Calculator
              </p>
            </div>
            
            <div className="p-6">
              {/* Inputs */}
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Avg financed total per job
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      value={calcAvgSalePrice}
                      onChange={(e) => setCalcAvgSalePrice(Number(e.target.value) || 0)}
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[10000, 13500, 16500, 25000, 30000].map(price => (
                      <button
                        key={price}
                        onClick={() => setCalcAvgSalePrice(price)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          calcAvgSalePrice === price 
                            ? 'bg-indigo-600 text-white border-indigo-600' 
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        ${(price / 1000).toFixed(price % 1000 === 0 ? 0 : 1)}k
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Avg dealer fee % (of financed total)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.25}
                    value={avgDealerFeePercent || ''}
                    onChange={(e) => setAvgDealerFeePercent(Number(e.target.value) || 0)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    0% = cash or no fee. Estimator uses net commissionable volume for tiers.
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Monthly Jobs Closed {isSetterLikeRole(userRole) && '(from personal sets)'}
                  </label>
                  <input
                    type="number"
                    value={calcJobsClosed}
                    onChange={(e) => setCalcJobsClosed(Number(e.target.value) || 0)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg"
                    min="0"
                  />
                  <div className="flex gap-2 mt-2">
                    {[2, 4, 8, 12, 16, 20].map(jobs => (
                      <button
                        key={jobs}
                        onClick={() => setCalcJobsClosed(jobs)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          calcJobsClosed === jobs 
                            ? 'bg-indigo-600 text-white border-indigo-600' 
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {jobs}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sits in period (for sit / close-rate tiers)
                  </label>
                  <input
                    type="number"
                    value={calcPeriodSits}
                    onChange={(e) => setCalcPeriodSits(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg"
                    min="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Close rate for tiers = jobs closed ÷ sits. Align with your dashboard period when possible.
                  </p>
                </div>
              </div>
              
              {/* Commission Tiers Table */}
              {compPlanDetails && compPlanDetails.volume_bonuses && compPlanDetails.volume_bonuses.length > 0 && (
                <div className="mb-6 p-4 bg-gray-50 rounded-xl">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Commission Tiers</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pb-2">Tier (volume / sits / close %)</th>
                        <th className="pb-2 text-right">Bonus</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      <tr>
                        <td className="py-2">Base rate</td>
                        <td className="py-2 text-right font-medium">
                          {compPlanDetails.plan_type === 'flat_rate' 
                            ? `$${compPlanDetails.flat_rate?.toLocaleString() || 0}` 
                            : `${compPlanDetails.base_percentage || 0}%`}
                        </td>
                      </tr>
                      {compPlanDetails.volume_bonuses.map((tier: VolumeTier, idx: number) => {
                        const nextTier = compPlanDetails.volume_bonuses[idx + 1]
                        const isActive = volumeBonusTierInRange(tier, widgetTierValues, {
                          nextMinVolume: nextTier?.min_volume ?? null,
                        })
                        return (
                          <tr key={idx} className={isActive ? 'bg-indigo-50' : ''}>
                            <td className="py-2">
                              {formatVolumeBonusTierRange(tier, {
                                nextMinVolume: nextTier?.min_volume ?? null,
                              })}
                            </td>
                            <td className="py-2 text-right font-medium">
                              {tier.bonus_type === 'percentage' 
                                ? `+${tier.bonus_value}%` 
                                : `+$${tier.bonus_value}/sale`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              
              {/* Results */}
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-6 text-white">
                <p className="text-green-100 text-sm font-medium mb-1">Estimated Monthly Commissions</p>
                <p className="text-4xl font-bold mb-4">
                  ${(() => {
                    if (!compPlanDetails) return 0
                    if (compPlanDetails.plan_type === 'flat_rate') {
                      return ((compPlanDetails.flat_rate || 0) * calcJobsClosed).toLocaleString()
                    }
                    const monthlyVolume = monthlyCommissionableVolume
                    const { extraRatePct, flatPerSale } = applyFirstMatchingVolumeBonus(
                      compPlanDetails.volume_bonuses,
                      widgetTierValues
                    )
                    const rate = (compPlanDetails.base_percentage || 0) + extraRatePct
                    return (
                      monthlyVolume * (rate / 100) +
                      flatPerSale * calcJobsClosed
                    ).toLocaleString(undefined, { maximumFractionDigits: 0 })
                  })()}
                </p>
                
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/20">
                  <div>
                    <p className="text-green-100 text-xs">Commission Rate</p>
                    <p className="text-xl font-bold">
                      {(() => {
                        if (!compPlanDetails) return '0%'
                        if (compPlanDetails.plan_type === 'flat_rate') {
                          return `$${compPlanDetails.flat_rate?.toLocaleString() || 0}/job`
                        }
                        const { extraRatePct } = applyFirstMatchingVolumeBonus(
                          compPlanDetails.volume_bonuses,
                          widgetTierValues
                        )
                        return `${(compPlanDetails.base_percentage || 0) + extraRatePct}%`
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-green-100 text-xs">Commission per Job</p>
                    <p className="text-xl font-bold">
                      ${(() => {
                        if (!compPlanDetails || calcJobsClosed === 0) return 0
                        if (compPlanDetails.plan_type === 'flat_rate') {
                          return (compPlanDetails.flat_rate || 0).toLocaleString()
                        }
                        const { extraRatePct, flatPerSale } = applyFirstMatchingVolumeBonus(
                          compPlanDetails.volume_bonuses,
                          widgetTierValues
                        )
                        const rate = (compPlanDetails.base_percentage || 0) + extraRatePct
                        return (commissionablePerJob * (rate / 100) + flatPerSale).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-green-100 text-xs">Annual Projection</p>
                    <p className="text-xl font-bold">
                      ${(() => {
                        if (!compPlanDetails) return 0
                        if (compPlanDetails.plan_type === 'flat_rate') {
                          return ((compPlanDetails.flat_rate || 0) * calcJobsClosed * 12).toLocaleString()
                        }
                        const monthlyVolume = monthlyCommissionableVolume
                        const { extraRatePct, flatPerSale } = applyFirstMatchingVolumeBonus(
                          compPlanDetails.volume_bonuses,
                          widgetTierValues
                        )
                        const rate = (compPlanDetails.base_percentage || 0) + extraRatePct
                        return (
                          (monthlyVolume * (rate / 100) + flatPerSale * calcJobsClosed) *
                          12
                        ).toLocaleString(undefined, { maximumFractionDigits: 0 })
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-green-100 text-xs">Net commissionable volume</p>
                    <p className="text-xl font-bold">${monthlyCommissionableVolume.toLocaleString()}</p>
                  </div>
                </div>
              </div>
              
              {!hasCompPlan && (
                <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-sm text-amber-700">
                    <strong>Note:</strong> You don't have a comp plan assigned. These calculations use default rates. Contact your manager to get your actual plan set up.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
