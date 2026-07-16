'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import InspectionStatusCard from '@/components/InspectionStatusCard'
import { isPromptEscalated } from '@/lib/inspection-feedback-prompt'
import type { CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'
import CommissionWidget from '@/components/CommissionWidget'
import AIAssistantWrapper from '@/components/AIAssistantWrapper'
import UnpaidReferralsAlert from '@/components/UnpaidReferralsAlert'
import { netCommissionableFromFinancedTotal } from '@/lib/financing'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { isBarredFromProjectsUi } from '@/lib/permissions'
import { isDashboardPersonalKpiOrgWide } from '@/lib/dashboard-personal-kpi-scope'
import {
  applyFirstMatchingVolumeBonus,
  formatVolumeBonusTierRange,
  volumeBonusTierInRange,
} from '@/lib/volume-bonus-display'
import {
  formatCompPlanUnitShortLabel,
  getCompPlanUnitCalculatorLabel,
  getCompPlanUnitHint,
} from '@/lib/comp-plan-unit-types'
import { previewNumber } from '@/lib/numeric-input-draft'

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
  tier_metric?: 'volume' | 'closing_rate' | 'sits'
}

interface TeamMemberStat {
  id: string
  name: string
  role: string
  doorsKnocked: number
  contacts: number
  inspectionsSet: number
  /** Scheduled appointments in period where this user is the assigned closer (credit follows reassignment). */
  inspectionsReceived?: number
  /** Inspection outcomes flagged "counts as sit" in admin; attributed like sales */
  sits: number
  sales: number
  closeRate: string
  efficiency: string
}

type TimeFrame = 'today' | 'yesterday' | 'week' | 'last_week' | 'month' | 'last_month' | 'quarter' | 'year' | 'all' | 'custom'

interface AttachedSale {
  id: string
  customerName: string
  projectAddress: string
  saleAmount: number
  signedAt: string | null
  attachment: string
  setterName: string | null
  closerName: string | null
  jobId: string | null
  jobNumber: string | null
  jobStatus: string
  statusLabel: string
  progressPercent: number
  progressTone: string
  scheduledDate: string | null
  completedAt: string | null
}

interface AttachedSalesResponse {
  sales: AttachedSale[]
  summary: {
    count: number
    shown: number
    totalVolume: number
    averageProgress: number
  }
}

const attachedSalesToneClasses: Record<string, { bar: string; chip: string; dot: string }> = {
  blue: { bar: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  amber: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  indigo: { bar: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
  cyan: { bar: 'bg-cyan-500', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200', dot: 'bg-cyan-500' },
  emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  green: { bar: 'bg-green-500', chip: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  rose: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
}

function formatAttachedSalesMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatAttachedSalesDate(value: string | null) {
  if (!value) return 'Not dated'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  })
}

function AttachedSalesTracker({ timeFrame }: { timeFrame: TimeFrame }) {
  const [data, setData] = useState<AttachedSalesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadAttachedSales() {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/dashboard/attached-sales?timeframe=${encodeURIComponent(timeFrame)}`)
        const json = await res.json()

        if (!res.ok) throw new Error(json?.error || 'Failed to load attached sales')
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load attached sales:', err)
          setError('Attached sales could not be loaded.')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAttachedSales()
    return () => {
      cancelled = true
    }
  }, [timeFrame])

  const sales = data?.sales || []
  const summary = data?.summary

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 sm:mb-8 overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">Attached sales pipeline</h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Signed installation sales tied to you or your team as they move through production.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Sales</p>
            <p className="text-sm font-semibold text-gray-900">{summary?.count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Volume</p>
            <p className="text-sm font-semibold text-gray-900">{formatAttachedSalesMoney(summary?.totalVolume ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Progress</p>
            <p className="text-sm font-semibold text-gray-900">{summary?.averageProgress ?? 0}%</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3 animate-pulse">
              <div className="flex justify-between gap-3 mb-3">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-4 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-2 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-4 text-sm text-rose-700 bg-rose-50">{error}</div>
      ) : sales.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No attached installation sales in this period yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {sales.map((sale) => {
            const tone = attachedSalesToneClasses[sale.progressTone] || attachedSalesToneClasses.blue
            const people = [sale.setterName ? `Setter: ${sale.setterName}` : null, sale.closerName ? `Closer: ${sale.closerName}` : null]
              .filter(Boolean)
              .join(' · ')

            return (
              <div key={sale.id} className="p-3 sm:p-4">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900 truncate">{sale.customerName}</p>
                      <span className="text-xs font-medium text-gray-500">{sale.attachment}</span>
                      {sale.jobNumber && (
                        <span className="text-xs text-gray-400">{sale.jobNumber}</span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 truncate mt-0.5">
                      <span className="font-medium text-gray-700">Address:</span>{' '}
                      {sale.projectAddress || 'No address on contract'}
                    </p>
                    {people && <p className="text-xs text-gray-400 mt-1 truncate">{people}</p>}
                  </div>
                  <div className="flex items-center justify-between lg:justify-end gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{formatAttachedSalesMoney(sale.saleAmount)}</p>
                      <p className="text-xs text-gray-400">Signed {formatAttachedSalesDate(sale.signedAt)}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {sale.statusLabel}
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${tone.bar} transition-all duration-700 ease-out`}
                      style={{ width: `${Math.max(8, Math.min(sale.progressPercent, 100))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-400">
                    <span>Signed</span>
                    <span>Materials</span>
                    <span>Scheduled</span>
                    <span>Complete</span>
                    <span>Collected</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Dashboard goal fields in settings are weekly; scale for day/month/quarter/year views. */
function scaledGoalFromWeekly(weeklyGoal: number, tf: TimeFrame, customDays?: number): number {
  const w = Math.max(0, Number(weeklyGoal) || 0)
  const atLeast1 = (n: number) => (n < 1 ? 1 : Math.round(n))
  switch (tf) {
    case 'today':
    case 'yesterday':
      return atLeast1(w / 7)
    case 'week':
    case 'last_week':
      return atLeast1(w)
    case 'month':
    case 'last_month':
      return atLeast1(w * 4.33)
    case 'quarter':
      return atLeast1(w * 13)
    case 'year':
    case 'all':
      return atLeast1(w * 52)
    case 'custom':
      return atLeast1(w * ((customDays && customDays > 0 ? customDays : 7) / 7))
    default:
      return atLeast1(w)
  }
}

/** Local-calendar-day count between two 'YYYY-MM-DD' strings, inclusive of both ends. */
function daysBetweenInclusive(startDateStr: string, endDateStr: string): number {
  const [sy, sm, sd] = startDateStr.split('-').map(Number)
  const [ey, em, ed] = endDateStr.split('-').map(Number)
  const start = Date.UTC(sy, (sm || 1) - 1, sd || 1)
  const end = Date.UTC(ey, (em || 1) - 1, ed || 1)
  return Math.abs(Math.round((end - start) / 86400000)) + 1
}

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

interface DashboardClientProps {
  profile: any
  stats: {
    totalLeads: number
    newLeads: number
    totalOpportunities: number
    openOpportunities: number
    totalProjects: number
    activeProjects: number
    closeRate: number | null
    efficiency: number | null
    doorsKnockedThisWeek: number
    contactsThisWeek: number
    inspectionsSetThisWeek: number
    sitsThisWeek: number
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
  setterTeamStats?: TeamMemberStat[]
  closerTeamStats?: TeamMemberStat[]
  canViewTeamLeaderboard?: boolean
  badgeCount?: number
}

// ─── My Goals Widget ──────────────────────────────────────────────────────────
function MyGoalsWidget({ currentUserId }: { currentUserId?: string }) {
  const [open, setOpen] = useState(false)
  const [goals, setGoals] = useState<any>(null)
  const [commissionRate, setCommissionRate] = useState<number | null>(null)
  const [liveCloseStick, setLiveCloseStick] = useState<{ close: number; stick: number } | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!currentUserId) return
    const res = await fetch(`/api/coaching/goals?userId=${currentUserId}`)
    const data = await res.json()
    const g = data.goals || null
    setGoals(g)
    setCommissionRate(data.commissionRate ?? null)

    if (g && (g.close_rate_override == null || g.stick_rate_override == null)) {
      const tr = await fetch(`/api/coaching/trend?lookback=3mo&userId=${currentUserId}`)
      if (tr.ok) {
        const td = await tr.json()
        const m = td.members?.[0]
        const ts = m?.totals?.sets ?? 0
        const ti = m?.totals?.sits ?? 0
        const tsa = m?.totals?.sales ?? 0
        const stick = ts > 0 ? Math.round((ti / ts) * 100) : 0
        const close = ti > 0 ? Math.round((tsa / ti) * 100) : 0
        setLiveCloseStick({ close, stick })
      } else {
        setLiveCloseStick(null)
      }
    } else {
      setLiveCloseStick(null)
    }

    setLoaded(true)
  }, [currentUserId])

  useEffect(() => { if (open && !loaded) load() }, [open, loaded, load])

  if (!currentUserId) return null

  const g = goals
  const annualGoal = g?.annual_income_goal
  const avgDeal = g?.avg_deal_value
  const closeRate = g?.close_rate_override ?? liveCloseStick?.close
  const stickRate = g?.stick_rate_override ?? liveCloseStick?.stick
  const daysPerWeek = g?.working_days_per_week ?? 5
  const weeksPerYear = g?.working_weeks_per_year ?? 50

  const effectiveCommRate = commissionRate ?? (g?.commission_rate_override ?? null)

  let targets: { setsPerDay: number; sitsPerWeek: number; salesPerMonth: number } | null = null
  if (
    annualGoal &&
    avgDeal &&
    effectiveCommRate != null &&
    effectiveCommRate > 0 &&
    closeRate != null &&
    stickRate != null
  ) {
    const commPerSale = avgDeal * (effectiveCommRate / 100)
    if (commPerSale > 0) {
      const salesPerYear = annualGoal / commPerSale
      const salesPerMonth = salesPerYear / 12
      const sitsPerMonth = closeRate > 0 ? salesPerMonth / (closeRate / 100) : null
      const sitsPerWeek = sitsPerMonth ? sitsPerMonth / 4.33 : null
      const setsPerWeek = sitsPerWeek && stickRate > 0 ? sitsPerWeek / (stickRate / 100) : null
      const setsPerDay = setsPerWeek ? setsPerWeek / daysPerWeek : null
      if (setsPerDay !== null && sitsPerWeek !== null) {
        targets = {
          setsPerDay: parseFloat(setsPerDay.toFixed(1)),
          sitsPerWeek: parseFloat(sitsPerWeek.toFixed(1)),
          salesPerMonth: Math.ceil(salesPerMonth),
        }
      }
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">My Goals</span>
          {annualGoal && (
            <span className="text-xs text-gray-500">
              ${Number(annualGoal).toLocaleString()}/yr
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {targets && (
            <span className="text-xs text-gray-500 hidden sm:block">
              {targets.setsPerDay} sets/day · {targets.sitsPerWeek} sits/wk · {targets.salesPerMonth} sales/mo
            </span>
          )}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-4">
          {!loaded ? (
            <div className="h-12 animate-pulse bg-gray-100 rounded" />
          ) : !goals ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">No goals set yet.</p>
              <Link
                href="/reports/coaching"
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Set goals →
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                {targets ? (
                  <>
                    <div>
                      <p className="text-xs text-gray-400">Sets/day needed</p>
                      <p className="text-xl font-bold text-orange-500">{targets.setsPerDay}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Sits/week needed</p>
                      <p className="text-xl font-bold text-cyan-600">{targets.sitsPerWeek}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Sales/month needed</p>
                      <p className="text-xl font-bold text-green-600">{targets.salesPerMonth}</p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">Complete goal inputs to see daily targets.</p>
                )}
              </div>
              <Link
                href="/reports/coaching"
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
              >
                Edit goals →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardClient({
  profile,
  stats,
  progress: _progressSsr,
  pendingPrompts,
  upcomingAppointments,
  recentActivities,
  settings,
  teamMemberStats = [],
  setterTeamStats = [],
  closerTeamStats = [],
  canViewTeamLeaderboard = false,
  badgeCount = 0,
}: DashboardClientProps) {
  const [promptQueue, setPromptQueue] = useState<any[]>(pendingPrompts)
  const [activePrompt, setActivePrompt] = useState<any>(
    pendingPrompts.length > 0 ? pendingPrompts[0] : null
  )
  const [customReports, setCustomReports] = useState<any[]>([])
  const [reportData, setReportData] = useState<Record<string, any[]>>({})
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('week')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [filteredSetterStats, setFilteredSetterStats] = useState<TeamMemberStat[]>(setterTeamStats)
  const [filteredCloserStats, setFilteredCloserStats] = useState<TeamMemberStat[]>(closerTeamStats)
  const [teamMemberCount, setTeamMemberCount] = useState(
    setterTeamStats.length + closerTeamStats.length
  )
  const [distinctDealCounts, setDistinctDealCounts] = useState<{
    sitOpportunitiesInPeriod: number
    saleOpportunitiesInPeriod: number
  } | null>(null)
  /** null = unchecked or non-admin; false = DB still owner-first (migration 107). */
  const [dashboardDoorAttributionPinFirst, setDashboardDoorAttributionPinFirst] = useState<
    boolean | null
  >(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [personalStats, setPersonalStats] = useState({
    doorsKnocked: stats.doorsKnockedThisWeek,
    contacts: stats.contactsThisWeek,
    inspectionsSet: stats.inspectionsSetThisWeek,
    sits: stats.sitsThisWeek,
    sales: stats.salesThisWeek,
    closeRate: stats.closeRate,
    efficiency: stats.efficiency,
  })
  const [loadingPersonalStats, setLoadingPersonalStats] = useState(false)
  const [weeklyPay, setWeeklyPay] = useState<number>(0)
  const [hasCompPlan, setHasCompPlan] = useState<boolean | null>(null)
  const [compPlanDetails, setCompPlanDetails] = useState<CompPlanDetails | null>(null)
  const [showCompPlanModal, setShowCompPlanModal] = useState(false)
  const [showCalculatorModal, setShowCalculatorModal] = useState(false)
  const [mounted, setMounted] = useState(false)
  /** First timeframe-driven fetch: avoid skeleton/spinner when SSR already matched default "week". */
  const initialTimeframeFetchRef = useRef(true)
  // Calculator inputs - dynamic based on plan type
  const [calcAvgSalePrice, setCalcAvgSalePrice] = useState('13500')
  const [calcJobsClosed, setCalcJobsClosed] = useState('4')
  const [calcHoursWorked, setCalcHoursWorked] = useState('40')
  const [calcUnits, setCalcUnits] = useState('25')
  const [calcTeamSales, setCalcTeamSales] = useState('20')
  const [calcTeamAvgPrice, setCalcTeamAvgPrice] = useState('13500')
  /** Avg dealer fee % of financed total — 0 for cash / no fee; drives net commissionable volume in calculator. */
  const [avgDealerFeePercent, setAvgDealerFeePercent] = useState('0')

  const calcAvgSalePriceNum = previewNumber(calcAvgSalePrice)
  const calcJobsClosedNum = previewNumber(calcJobsClosed)
  const calcHoursWorkedNum = previewNumber(calcHoursWorked)
  const calcUnitsNum = previewNumber(calcUnits)
  const calcTeamSalesNum = previewNumber(calcTeamSales)
  const calcTeamAvgPriceNum = previewNumber(calcTeamAvgPrice)
  const avgDealerFeePercentNum = previewNumber(avgDealerFeePercent)

  const commissionablePerJob = netCommissionableFromFinancedTotal(calcAvgSalePriceNum, avgDealerFeePercentNum)
  const monthlyCommissionableVolume = commissionablePerJob * calcJobsClosedNum
  const teamCommissionablePerJob = netCommissionableFromFinancedTotal(calcTeamAvgPriceNum, avgDealerFeePercentNum)
  const teamMonthlyCommissionableVolume = teamCommissionablePerJob * calcTeamSalesNum

  const compCalculatorTierValues = useMemo(() => {
    const cr =
      personalStats.closeRate != null && String(personalStats.closeRate) !== ''
        ? Number(personalStats.closeRate)
        : null
    return {
      periodVolume: monthlyCommissionableVolume,
      periodSits: personalStats.sits,
      periodClosingRatePct: cr,
    }
  }, [monthlyCommissionableVolume, personalStats.sits, personalStats.closeRate])

  useEffect(() => {
    setMounted(true)
    loadDashboardReports()
    loadWeeklyPay()
    loadCompPlanDetails()
  }, [])

  useEffect(() => {
    setPromptQueue(pendingPrompts)
    setActivePrompt(pendingPrompts.length > 0 ? pendingPrompts[0] : null)
  }, [pendingPrompts])

  useEffect(() => {
    setFilteredSetterStats(setterTeamStats)
    setFilteredCloserStats(closerTeamStats)
    setTeamMemberCount(setterTeamStats.length + closerTeamStats.length)
  }, [setterTeamStats, closerTeamStats])

  const loadTeamStatsForTimeFrame = useCallback(
    async (options?: { showLoadingIndicators?: boolean }) => {
      if (timeFrame === 'custom' && (!customStartDate || !customEndDate)) {
        return // wait for the user to pick both ends of the custom range
      }
      const showLoading = options?.showLoadingIndicators !== false
      if (showLoading) {
        setLoadingStats(true)
        setLoadingPersonalStats(true)
      }
      try {
        const tfParam = encodeURIComponent(timeFrame)
        const rangeParams =
          timeFrame === 'custom'
            ? `&startDate=${encodeURIComponent(customStartDate)}&endDate=${encodeURIComponent(customEndDate)}`
            : ''
        const [teamRes, personalRes] = await Promise.all([
          fetch(`/api/dashboard/team-stats?timeframe=${tfParam}${rangeParams}`),
          fetch(`/api/dashboard/personal-stats?timeframe=${tfParam}${rangeParams}`),
        ])
        if (teamRes.ok) {
          const data = await teamRes.json()
          setFilteredSetterStats(data.setterStats || [])
          setFilteredCloserStats(data.closerStats || [])
          const n = data.teamMemberCount
          if (typeof n === 'number') {
            setTeamMemberCount(n)
          } else {
            const ss = data.setterStats || []
            const cs = data.closerStats || []
            setTeamMemberCount(ss.length + cs.length)
          }
          if (data.distinctDealCounts && typeof data.distinctDealCounts.sitOpportunitiesInPeriod === 'number') {
            setDistinctDealCounts(data.distinctDealCounts)
          } else {
            setDistinctDealCounts(null)
          }
          setDashboardDoorAttributionPinFirst(
            typeof data.dashboardDoorAttributionPinFirst === 'boolean'
              ? data.dashboardDoorAttributionPinFirst
              : null
          )
        }
        if (personalRes.ok) {
          const pData = await personalRes.json()
          setPersonalStats(pData)
        }
      } catch (error) {
        console.error('Failed to load stats:', error)
      } finally {
        if (showLoading) {
          setLoadingStats(false)
          setLoadingPersonalStats(false)
        }
      }
    },
    [timeFrame, customStartDate, customEndDate]
  )

  useEffect(() => {
    if (timeFrame === 'custom' && (!customStartDate || !customEndDate)) {
      return // wait for the user to pick both ends of the custom range
    }
    const isFirstFetch = initialTimeframeFetchRef.current
    if (isFirstFetch) {
      initialTimeframeFetchRef.current = false
      // Default range is "week" and matches server-rendered props — refresh quietly for distinct counts + any drift without swapping the whole block for spinners.
      void loadTeamStatsForTimeFrame({ showLoadingIndicators: false })
      return
    }
    void loadTeamStatsForTimeFrame({ showLoadingIndicators: true })
  }, [timeFrame, customStartDate, customEndDate, loadTeamStatsForTimeFrame])

  const customRangeDays =
    customStartDate && customEndDate ? daysBetweenInclusive(customStartDate, customEndDate) : 0

  const timeFrameLabel: Record<TimeFrame, string> = {
    today: 'today',
    yesterday: 'yesterday',
    week: 'this week',
    last_week: 'last week',
    month: 'this month',
    last_month: 'last month',
    quarter: 'this quarter',
    year: 'this year',
    all: 'all time',
    custom:
      customStartDate && customEndDate
        ? `${formatShortDate(customStartDate)} – ${formatShortDate(customEndDate)}`
        : 'custom range',
  }

  /** Progress bars track the same period as the KPI cards (personal-stats API). Goals are weekly in settings, scaled to the selected range. */
  const progressForTimeFrame = useMemo(() => {
    const g = settings?.goals || { doors_knocked: 100, inspections: 20, sales: 5 }
    const weeklyContactGoal = Math.round((g.doors_knocked || 100) * 0.3)
    const tf = timeFrame
    return {
      doors_knocked: {
        current: personalStats.doorsKnocked,
        goal: scaledGoalFromWeekly(g.doors_knocked ?? 100, tf, customRangeDays),
      },
      contacts: {
        current: personalStats.contacts,
        goal: scaledGoalFromWeekly(weeklyContactGoal, tf, customRangeDays),
      },
      inspections: {
        current: personalStats.inspectionsSet,
        goal: scaledGoalFromWeekly(g.inspections ?? 20, tf, customRangeDays),
      },
      sales: {
        current: personalStats.sales,
        goal: scaledGoalFromWeekly(g.sales ?? 5, tf, customRangeDays),
      },
    }
  }, [personalStats, timeFrame, settings, customRangeDays])

  const isManager =
    profile.role === 'admin' ||
    profile.role === 'regional_manager' ||
    profile.role === 'sales_manager'
  const showSetterStack = isManager || isSetterLikeRole(profile.role)
  const showCloserStack = isManager || !isSetterLikeRole(profile.role)

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
    outcome: string
    notes: string
    setterFeedback: string
    scheduleFollowUp?: boolean
    followUpDate?: string
    requiresCloseSchedule?: boolean
    closeSchedule?: CloseScheduleConfirm | null
  }) => {
    try {
      // Use the appointment ID from the scheduled_appointments object
      const appointmentId = activePrompt.scheduled_appointments?.id || activePrompt.appointment_id
      console.log('Submitting status for appointment:', appointmentId, 'prompt:', activePrompt)
      
      const leadIdFallback =
        activePrompt.scheduled_appointments?.lead_id ?? activePrompt.scheduled_appointments?.lead?.id

      const res = await fetch('/api/inspections/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: appointmentId,
          /** Ensures inspection_status_updates.lead_id matches the lead page query (dashboard embed can omit FK). */
          lead_id: leadIdFallback || undefined,
          outcome: data.outcome,
          notes: data.notes,
          setter_feedback: data.setterFeedback,
          schedule_follow_up: data.scheduleFollowUp,
          follow_up_date: data.followUpDate,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to save status')
      }

      // Moving to Close: book the close slot (team RR or individual closer) after outcome is saved
      if (
        data.requiresCloseSchedule &&
        data.closeSchedule &&
        appointmentId
      ) {
        const body: Record<string, unknown> = {
          original_appointment_id: appointmentId,
          scheduled_for: data.closeSchedule.scheduledLocal,
          notes: data.notes || 'Close appointment scheduled from dashboard inspection feedback',
          use_round_robin: data.closeSchedule.useRoundRobin,
        }
        if (data.closeSchedule.useRoundRobin && data.closeSchedule.teamId) {
          body.team_id = data.closeSchedule.teamId
        }
        if (!data.closeSchedule.useRoundRobin && data.closeSchedule.closerUserId) {
          body.closer_user_id = data.closeSchedule.closerUserId
        }

        const scheduleRes = await fetch('/api/inspections/schedule-close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!scheduleRes.ok) {
          const errData = await scheduleRes.json().catch(() => ({}))
          throw new Error(
            typeof errData.error === 'string' ? errData.error : 'Failed to schedule close appointment'
          )
        }
      }

      const completedPromptId = activePrompt?.id
      const remainingPrompts = promptQueue.filter((p) => p.id !== completedPromptId)
      setPromptQueue(remainingPrompts)
      setTimeout(() => {
        setActivePrompt(remainingPrompts.length > 0 ? remainingPrompts[0] : null)
      }, 700)
    } catch (error) {
      console.error('Failed to submit status:', error)
      throw error // Re-throw so InspectionStatusCard can show the error
    }
  }

  const handleReschedule = (appointmentId: string) => {
    // Redirect to scheduling page with appointment context
    window.location.href = `/schedule?reschedule=${appointmentId}`
  }

  const handleFillLater = async () => {
    if (!activePrompt?.id) return

    try {
      const res = await fetch('/api/inspections/dismiss-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: activePrompt.id }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to snooze prompt')
      }

      const data = await res.json().catch(() => ({}))
      const snoozeCount = typeof data.snooze_count === 'number' ? data.snooze_count : 0
      if (isPromptEscalated(snoozeCount)) {
        setActivePrompt((current: any) =>
          current?.id === activePrompt.id ? { ...current, snooze_count: snoozeCount } : current
        )
        setPromptQueue((current) =>
          current.map((prompt) =>
            prompt.id === activePrompt.id ? { ...prompt, snooze_count: snoozeCount } : prompt
          )
        )
        return
      }

      const remainingPrompts = promptQueue.filter((p) => p.id !== activePrompt.id)
      setPromptQueue(remainingPrompts)
      setActivePrompt(remainingPrompts.length > 0 ? remainingPrompts[0] : null)
    } catch (error) {
      console.error('Failed to snooze inspection prompt:', error)
      throw error
    }
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
              isComplete ? 'ring-2 ring-green-400/80 ring-offset-1 ring-offset-white' : ''
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
          key={activePrompt.id}
          promptAt={activePrompt.prompt_at}
          snoozeCount={activePrompt.snooze_count}
          appointment={{
            ...activePrompt.scheduled_appointments,
            lead: activePrompt.scheduled_appointments.leads,
          }}
          onComplete={handleStatusComplete}
          onReschedule={handleReschedule}
          onFillLater={handleFillLater}
        />
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Unpaid Referrals Alert */}
        <UnpaidReferralsAlert />

        {profile.role === 'admin' && dashboardDoorAttributionPinFirst === false && (
          <div
            className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            role="status"
          >
            <p className="font-medium">Leaderboard doors/contacts may be misattributed</p>
            <p className="mt-1 text-amber-800">
              This database is still using owner-first knock attribution (older RPC). After bulk reassignment,
              most pins count toward whoever owns the lead now. Apply migration{' '}
              <span className="font-mono text-xs">130_dashboard_canvass_exclude_inbound_disposition_only.sql</span>{' '}
              in Supabase so aggregates use pin_attributed_user_id first (original canvasser) and exclude
              inbound disposition-only leads.
            </p>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Welcome back, {profile.full_name?.split(' ')[0] || 'there'}!
            </h1>
            <p className="text-gray-500 text-sm sm:text-base mt-1">
              {isDashboardPersonalKpiOrgWide(profile.role)
                ? `Organization-wide performance overview for ${timeFrameLabel[timeFrame]}`
                : `Here's your performance overview for ${timeFrameLabel[timeFrame]}`}
            </p>
            {badgeCount > 0 && !isDashboardPersonalKpiOrgWide(profile.role) && (
              <a
                href="/sisu"
                className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                <span>🏅</span>
                <span>{badgeCount} {badgeCount === 1 ? 'badge' : 'badges'} earned</span>
                <span className="text-indigo-400">→</span>
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
            <select
              value={timeFrame}
              onChange={(e) => setTimeFrame(e.target.value as TimeFrame)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
              <option value="all">All Time</option>
              <option value="custom">Custom Range</option>
            </select>
            {timeFrame === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customStartDate}
                  max={customEndDate || undefined}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  aria-label="Custom range start date"
                  className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  min={customStartDate || undefined}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  aria-label="Custom range end date"
                  className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
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
        </div>

        {/* Quick Stats — setters vs closers */}
        {loadingPersonalStats ? (
          <div className={`grid ${isSetterLikeRole(profile.role) ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'} gap-3 sm:gap-4 mb-6 sm:mb-8`}>
            {Array.from({ length: isSetterLikeRole(profile.role) ? 5 : 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : isSetterLikeRole(profile.role) ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Doors Knocked</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{personalStats.doorsKnocked}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Contacts</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{personalStats.contacts}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Inspections Set</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{personalStats.inspectionsSet}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Sits</p>
                  <p className="text-xl sm:text-2xl font-bold text-cyan-600">{personalStats.sits}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-cyan-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Sales</p>
                  <p className="text-xl sm:text-2xl font-bold text-green-600">{personalStats.sales}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Doors Knocked</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{personalStats.doorsKnocked}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Inspections Set</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{personalStats.inspectionsSet}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Sits</p>
                  <p className="text-xl sm:text-2xl font-bold text-cyan-600">{personalStats.sits}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-cyan-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Sales</p>
                  <p className="text-xl sm:text-2xl font-bold text-green-600">{personalStats.sales}</p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div
              className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100"
              title="Close rate = your attributed sales ÷ sits (inspection outcomes that count as sits) in this period."
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Close Rate</p>
                  <p className="text-xl sm:text-2xl font-bold text-indigo-600">
                  {personalStats.closeRate != null ? `${personalStats.closeRate}%` : '—'}
                </p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
            <div
              className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100"
              title="Efficiency = your attributed sales ÷ appointments on your calendar (by scheduled date) in this period."
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Efficiency</p>
                  <p className="text-xl sm:text-2xl font-bold text-purple-600">
                  {personalStats.efficiency != null ? `${personalStats.efficiency}%` : '—'}
                </p>
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1 sm:mt-2 capitalize">{timeFrameLabel[timeFrame]}</p>
            </div>
          </div>
        )}

        <AttachedSalesTracker timeFrame={timeFrame} />

        {/* Estimated pay - prominent display for reps */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl shadow-lg p-4 sm:p-6 mb-6 sm:mb-8 text-white">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-indigo-100 text-xs sm:text-sm font-medium mb-1">Estimated Pay This Week</p>
              <p className="text-2xl sm:text-4xl font-bold">${weeklyPay.toLocaleString()}</p>
              {hasCompPlan === false ? (
                <p className="text-indigo-200 text-xs mt-1 sm:mt-2">Ask a manager to assign your comp plan.</p>
              ) : (
                <p className="text-indigo-200 text-xs mt-1 sm:mt-2">Based on funded/closed work this week.</p>
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

        {/* My Goals widget */}
        <MyGoalsWidget currentUserId={profile?.id} />

        {/* Team leaderboard — setter vs closer stacks */}
        {canViewTeamLeaderboard && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 sm:mb-8 overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Team scoreboard</h2>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="text-xs sm:text-sm text-gray-500 text-right sm:text-left">
                  <span className="whitespace-nowrap">{teamMemberCount} reps</span>
                  {isManager && distinctDealCounts && !loadingStats && (
                    <span
                      className="block sm:inline sm:ml-2 text-gray-400 text-[11px] sm:text-xs mt-0.5 sm:mt-0"
                      title="Setter and closer tables can both credit the same job, so unique totals are shown separately."
                    >
                      Unique: {distinctDealCounts.sitOpportunitiesInPeriod} sits ·{' '}
                      {distinctDealCounts.saleOpportunitiesInPeriod} sales
                    </span>
                  )}
                </div>
              </div>
            </div>

            {loadingStats ? (
              <div className="p-8 text-center text-gray-500">
                <div className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading stats...
                </div>
              </div>
            ) : (
              <>
                {showSetterStack && filteredSetterStats.length > 0 && (
                  <div className="border-t border-gray-100">
                    <h3 className="px-3 sm:px-4 pt-4 pb-2 text-sm font-semibold text-gray-800">Setter stats</h3>
                    <div className="block sm:hidden divide-y divide-gray-100">
                      {filteredSetterStats.map((member, index) => (
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
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                            <div>
                              <p className={`text-base font-bold ${member.doorsKnocked > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                                {member.doorsKnocked}
                              </p>
                              <p className="text-xs text-gray-500">
                                Doors{' '}
                                <span className="text-gray-400">(pins · {timeFrameLabel[timeFrame]})</span>
                              </p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${member.contacts > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                {member.contacts || 0}
                              </p>
                              <p className="text-xs text-gray-500">
                                Contacts{' '}
                                <span className="text-gray-400">({timeFrameLabel[timeFrame]})</span>
                              </p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${member.inspectionsSet > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                                {member.inspectionsSet}
                              </p>
                              <p className="text-xs text-gray-500">Insp. set</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${(member.sits ?? 0) > 0 ? 'text-cyan-600' : 'text-gray-400'}`}>
                                {member.sits ?? 0}
                              </p>
                              <p className="text-xs text-gray-500">Sits</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${member.sales > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                {member.sales}
                              </p>
                              <p className="text-xs text-gray-500">Sales</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rep</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Doors
                              <span className="block font-normal normal-case text-gray-400">
                                (pins · {timeFrameLabel[timeFrame]})
                              </span>
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Contacts
                              <span className="block font-normal normal-case text-gray-400">
                                ({timeFrameLabel[timeFrame]})
                              </span>
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Insp. set</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Sits</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Sales</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredSetterStats.map((member, index) => (
                            <tr
                              key={member.id}
                              className={index === 0 ? 'bg-yellow-50' : index === 1 ? 'bg-gray-50' : index === 2 ? 'bg-orange-50/50' : ''}
                            >
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
                                <span className={`text-lg font-bold ${(member.sits ?? 0) > 0 ? 'text-cyan-600' : 'text-gray-400'}`}>
                                  {member.sits ?? 0}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${member.sales > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                  {member.sales}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {showCloserStack && filteredCloserStats.length > 0 && (
                  <div className="border-t border-gray-100">
                    <h3 className="px-3 sm:px-4 pt-4 pb-2 text-sm font-semibold text-gray-800">Closer stats</h3>
                    <div className="block sm:hidden divide-y divide-gray-100">
                      {filteredCloserStats.map((member, index) => (
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
                          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 text-center">
                            <div>
                              <p className={`text-base font-bold ${member.doorsKnocked > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                                {member.doorsKnocked}
                              </p>
                              <p className="text-xs text-gray-500">
                                Doors{' '}
                                <span className="text-gray-400">(pins · {timeFrameLabel[timeFrame]})</span>
                              </p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${(member.contacts ?? 0) > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                {member.contacts ?? 0}
                              </p>
                              <p className="text-xs text-gray-500">
                                Contacts{' '}
                                <span className="text-gray-400">({timeFrameLabel[timeFrame]})</span>
                              </p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${(member.inspectionsSet ?? 0) > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
                                {member.inspectionsSet ?? 0}
                              </p>
                              <p className="text-xs text-gray-500">Set</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${(member.inspectionsReceived ?? 0) > 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                                {member.inspectionsReceived ?? 0}
                              </p>
                              <p className="text-xs text-gray-500">Recv.</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${(member.sits ?? 0) > 0 ? 'text-cyan-600' : 'text-gray-400'}`}>
                                {member.sits ?? 0}
                              </p>
                              <p className="text-xs text-gray-500">Sits</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${member.sales > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                {member.sales}
                              </p>
                              <p className="text-xs text-gray-500">Sales</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${member.closeRate !== '—' && parseInt(member.closeRate) > 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
                                {member.closeRate === '—' ? '—' : `${member.closeRate}%`}
                              </p>
                              <p className="text-xs text-gray-500">
                                Close %{' '}
                                <span className="text-gray-400">({timeFrameLabel[timeFrame]})</span>
                              </p>
                            </div>
                            <div>
                              <p className={`text-base font-bold ${member.efficiency !== '—' && parseInt(member.efficiency ?? '0') > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                {member.efficiency === '—' ? '—' : `${member.efficiency}%`}
                              </p>
                              <p className="text-xs text-gray-500">
                                Effic. %{' '}
                                <span className="text-gray-400">({timeFrameLabel[timeFrame]})</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rep</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Doors
                              <span className="block font-normal normal-case text-gray-400">
                                (pins · {timeFrameLabel[timeFrame]})
                              </span>
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Contacts
                              <span className="block font-normal normal-case text-gray-400">
                                ({timeFrameLabel[timeFrame]})
                              </span>
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Insp. set</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Insp. recv.
                              <span className="block font-normal normal-case text-gray-400">(assigned closer)</span>
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Sits</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Sales</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Close %
                              <span className="block font-normal normal-case text-gray-400">
                                ({timeFrameLabel[timeFrame]})
                              </span>
                            </th>
                            <th
                              className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                              title="Sales ÷ appointments on this closer's calendar in the period (not the same as sits ÷ insp. received)."
                            >
                              Effic. %
                              <span className="block font-normal normal-case text-gray-400">
                                ({timeFrameLabel[timeFrame]})
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredCloserStats.map((member, index) => (
                            <tr
                              key={member.id}
                              className={index === 0 ? 'bg-yellow-50' : index === 1 ? 'bg-gray-50' : index === 2 ? 'bg-orange-50/50' : ''}
                            >
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
                                <span className={`text-lg font-bold ${(member.contacts ?? 0) > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                  {member.contacts ?? 0}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${(member.inspectionsSet ?? 0) > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
                                  {member.inspectionsSet ?? 0}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${(member.inspectionsReceived ?? 0) > 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                                  {member.inspectionsReceived ?? 0}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${(member.sits ?? 0) > 0 ? 'text-cyan-600' : 'text-gray-400'}`}>
                                  {member.sits ?? 0}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${member.sales > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                  {member.sales}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${member.closeRate !== '—' && parseInt(member.closeRate) > 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
                                  {member.closeRate === '—' ? '—' : `${member.closeRate}%`}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-lg font-bold ${member.efficiency !== '—' && parseInt(member.efficiency ?? '0') > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                  {member.efficiency === '—' ? '—' : `${member.efficiency}%`}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {filteredSetterStats.length === 0 && filteredCloserStats.length === 0 && (
                  <div className="p-8 text-center text-gray-500">No team member stats available</div>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Progress Section */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Weekly Progress */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Progress vs goals</h2>
              <p className="text-xs text-gray-500 mb-3 sm:mb-4 capitalize">
                Your pace for {timeFrameLabel[timeFrame]} against the goals in settings.
              </p>
              <ProgressBar
                label="Doors Knocked"
                current={progressForTimeFrame.doors_knocked.current}
                goal={progressForTimeFrame.doors_knocked.goal}
                color="bg-blue-500"
              />
              <ProgressBar
                label="Contacts Made"
                current={progressForTimeFrame.contacts.current}
                goal={progressForTimeFrame.contacts.goal}
                color="bg-purple-500"
              />
              <ProgressBar
                label="Inspections Set"
                current={progressForTimeFrame.inspections.current}
                goal={progressForTimeFrame.inspections.goal}
                color="bg-amber-500"
              />
              <ProgressBar
                label="Sales Closed"
                current={progressForTimeFrame.sales.current}
                goal={progressForTimeFrame.sales.goal}
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
                  {upcomingAppointments.map((apt) => {
                    const customerName = apt.leads?.homeowner_name?.trim()
                    const address = apt.leads?.address_text || apt.address_text || ''
                    const linkHref = apt.opportunity_id 
                      ? `/opportunities/${apt.opportunity_id}` 
                      : apt.lead_id 
                        ? `/leads/${apt.lead_id}`
                        : '/appointments'
                    
                    return (
                      <Link
                        key={apt.id}
                        href={linkHref}
                        className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="w-12 sm:w-14 text-center flex-shrink-0">
                          <p className="text-xs text-gray-500" suppressHydrationWarning>{mounted ? formatDate(apt.scheduled_for) : ''}</p>
                          <p className="text-base sm:text-lg font-bold text-gray-900" suppressHydrationWarning>{mounted ? formatTime(apt.scheduled_for) : ''}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          {customerName ? (
                            <>
                              <p className="font-medium text-gray-900 truncate text-sm sm:text-base">
                                {customerName}
                              </p>
                              <p className="text-xs sm:text-sm text-gray-500 truncate">
                                {address || 'No address'}
                              </p>
                            </>
                          ) : (
                            <p className="font-medium text-gray-900 truncate text-sm sm:text-base">
                              {address || 'No address'}
                            </p>
                          )}
                        </div>
                        <div className="text-indigo-600 flex-shrink-0">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
            )}

            {/* Account Overview - show different content for canvassers */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
                {profile.role === 'canvasser' ? 'My Stats' : 'Account Overview'}
              </h2>
              <div
                className={`grid gap-2 sm:gap-4 ${
                  profile.role === 'canvasser'
                    ? 'grid-cols-1'
                    : isBarredFromProjectsUi(profile.role)
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
                }`}
              >
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
                    {!isBarredFromProjectsUi(profile.role) && (
                      <Link href="/projects" className="p-2 sm:p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors text-center sm:text-left">
                        <p className="text-xl sm:text-3xl font-bold text-green-600">{stats.totalProjects}</p>
                        <p className="text-xs sm:text-sm text-gray-600">Projects</p>
                        <p className="text-xs text-green-600 mt-1 hidden sm:block">{stats.activeProjects} active</p>
                      </Link>
                    )}
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
            {promptQueue.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="font-semibold text-amber-800">Status Updates Needed</h3>
                </div>
                <p className="text-sm text-amber-700 mb-3">
                  You have {promptQueue.length} appointment{promptQueue.length > 1 ? 's' : ''} waiting for status updates.
                </p>
                <button
                  onClick={() => setActivePrompt(promptQueue[0])}
                  className="w-full py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Update Now
                </button>
              </div>
            )}

            {/* Commission Widget - for sales reps and setters */}
            {[
              'sales_rep',
              'canvasser',
              'rep',
              'admin',
              'manager',
              'setter',
              'setter_manager',
              'regional_setter_manager',
              'operations',
              'sales_manager',
              'regional_manager',
            ].includes(profile?.role || '') && <CommissionWidget />}

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
                        <p className="text-xs text-gray-400 mt-1" suppressHydrationWarning>
                          {mounted ? new Date(activity.created_at).toLocaleDateString() : ''}
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
                        {getCompPlanUnitHint(compPlanDetails.unit_type) && (
                          <p className="text-xs sm:text-sm text-gray-500 mt-1">
                            {getCompPlanUnitHint(compPlanDetails.unit_type)}
                          </p>
                        )}
                      </div>
                    ) : compPlanDetails.plan_type === 'hybrid' && compPlanDetails.hybrid_components ? (
                      <div className="space-y-2">
                        {compPlanDetails.hybrid_components.map((comp, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-white rounded-lg border text-sm">
                            <span className="text-gray-700 capitalize">
                              {comp.type === 'hourly' ? 'Hourly Rate' :
                               comp.type === 'percentage' ? 'Commission' :
                               comp.type === 'flat_per_job' ? 'Per Job' :
                               `Per ${formatCompPlanUnitShortLabel(comp.unit_type)}`}
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
                      <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3">
                        Tiers can use volume ($), sits, or close rate (see team stats for your current period).
                      </p>
                      <div className="space-y-2">
                        {compPlanDetails.volume_bonuses.map((tier: VolumeTier, idx: number) => {
                          const nextTier = compPlanDetails.volume_bonuses[idx + 1]
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 sm:p-3 bg-white rounded-lg border">
                              <span className="text-gray-700 text-sm">
                                {formatVolumeBonusTierRange(tier, {
                                  nextMinVolume: nextTier?.min_volume ?? null,
                                })}
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
                          <li>Commission uses net sale after dealer fees (financed jobs)</li>
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
                      onChange={(e) => setCalcHoursWorked(e.target.value)}
                      className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                    />
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                      {[20, 30, 40, 50, 60].map(hrs => (
                        <button
                          key={hrs}
                          onClick={() => setCalcHoursWorked(String(hrs))}
                          className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcHoursWorkedNum === hrs ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                      {getCompPlanUnitCalculatorLabel(compPlanDetails.unit_type)}
                    </label>
                    <input
                      type="number"
                      value={calcUnits}
                      onChange={(e) => setCalcUnits(e.target.value)}
                      className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                    />
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                      {[10, 20, 30, 50, 75, 100].map(u => (
                        <button
                          key={u}
                          onClick={() => setCalcUnits(String(u))}
                          className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcUnitsNum === u ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                      onChange={(e) => setCalcJobsClosed(e.target.value)}
                      className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                    />
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                      {[2, 4, 6, 8, 10, 12, 15, 20].map(jobs => (
                        <button
                          key={jobs}
                          onClick={() => setCalcJobsClosed(String(jobs))}
                          className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcJobsClosedNum === jobs ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Avg financed total per job
                          </label>
                          <input
                            type="number"
                            value={calcAvgSalePrice}
                            onChange={(e) => setCalcAvgSalePrice(e.target.value)}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[8000, 10000, 13500, 18000, 25000].map(price => (
                              <button
                                key={price}
                                onClick={() => setCalcAvgSalePrice(String(price))}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcAvgSalePriceNum === price ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                              >
                                ${(price/1000).toFixed(0)}k
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
                            value={avgDealerFeePercent}
                            onChange={(e) => setAvgDealerFeePercent(e.target.value)}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            0% = cash or no lender fee. Volume tiers use net commissionable dollars.
                          </p>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Your Sales per Month</label>
                          <input
                            type="number"
                            value={calcJobsClosed}
                            onChange={(e) => setCalcJobsClosed(e.target.value)}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[2, 4, 6, 8, 10, 12, 15, 20].map(jobs => (
                              <button
                                key={jobs}
                                onClick={() => setCalcJobsClosed(String(jobs))}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcJobsClosedNum === jobs ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                          <label className="block text-sm font-medium text-gray-700 mb-2">Team avg financed total / job</label>
                          <input
                            type="number"
                            value={calcTeamAvgPrice}
                            onChange={(e) => setCalcTeamAvgPrice(e.target.value)}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[8000, 10000, 13500, 18000, 25000].map(price => (
                              <button
                                key={price}
                                onClick={() => setCalcTeamAvgPrice(String(price))}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcTeamAvgPriceNum === price ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                            onChange={(e) => setCalcTeamSales(e.target.value)}
                            className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-base"
                          />
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            {[10, 20, 30, 40, 50, 75, 100].map(sales => (
                              <button
                                key={sales}
                                onClick={() => setCalcTeamSales(String(sales))}
                                className={`px-2.5 sm:px-3 py-1 text-xs rounded-full ${calcTeamSalesNum === sales ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                    const weeklyPay = calcHoursWorkedNum * (compPlanDetails.hourly_rate || 0)
                    monthlyEarnings = weeklyPay * 4.33 // Average weeks per month
                    displayRows = [
                      { label: 'Hours/Week', value: `${calcHoursWorked}` },
                      { label: 'Hourly Rate', value: `$${compPlanDetails.hourly_rate?.toLocaleString() || 0}/hr` },
                      { label: 'Weekly Pay', value: `$${weeklyPay.toLocaleString()}` },
                    ]
                  } else if (compPlanDetails.plan_type === 'unit_based') {
                    monthlyEarnings = calcUnitsNum * (compPlanDetails.unit_rate || 0)
                    displayRows = [
                      { label: `${formatCompPlanUnitShortLabel(compPlanDetails.unit_type)}/Month`, value: `${calcUnits}` },
                      { label: 'Rate per Unit', value: `$${compPlanDetails.unit_rate?.toLocaleString() || 0}` },
                    ]
                  } else if (compPlanDetails.plan_type === 'flat_rate') {
                    monthlyEarnings = calcJobsClosedNum * (compPlanDetails.flat_rate || compPlanDetails.flat_amount || 0)
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
                      const monthlyVolume = monthlyCommissionableVolume
                      let baseRate = compPlanDetails.base_percentage || 0
                      const appliedBonuses: string[] = []
                      
                      const { extraRatePct, flatPerSale } = applyFirstMatchingVolumeBonus(
                        compPlanDetails.volume_bonuses,
                        compCalculatorTierValues
                      )
                      baseRate += extraRatePct
                      if (extraRatePct > 0) appliedBonuses.push(`+${extraRatePct}%`)
                      if (flatPerSale > 0) appliedBonuses.push(`+$${flatPerSale}/sale`)

                      personalEarnings =
                        monthlyVolume * (baseRate / 100) + flatPerSale * calcJobsClosedNum
                      
                      if (compPlanDetails.is_manager_plan) {
                        displayRows.push({ label: '— Your Sales —', value: '' })
                      }
                      displayRows.push({ label: 'Your Sales/Month', value: `${calcJobsClosed}` })
                      displayRows.push({ label: 'Avg financed / job', value: `$${calcAvgSalePriceNum.toLocaleString()}` })
                      displayRows.push({ label: 'Net commissionable volume', value: `$${monthlyVolume.toLocaleString()}` })
                      displayRows.push({ label: 'Commission Rate', value: `${baseRate}%${appliedBonuses.length > 0 ? ` (${appliedBonuses.join(' ')})` : ''}` })
                      displayRows.push({ label: 'Personal Earnings', value: `$${Math.round(personalEarnings).toLocaleString()}` })
                    }
                    
                    // Calculate team override earnings (for managers)
                    if (compPlanDetails.is_manager_plan && compPlanDetails.team_override_enabled && compPlanDetails.team_overrides?.length > 0) {
                      const teamVolume = teamMonthlyCommissionableVolume
                      
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
                        teamOverrideEarnings = calcTeamSalesNum * overrideRate
                      }
                      
                      displayRows.push({ label: '— Team Override —', value: '' })
                      displayRows.push({ label: 'Team Sales/Month', value: `${calcTeamSales}` })
                      displayRows.push({ label: 'Team avg financed / job', value: `$${calcTeamAvgPriceNum.toLocaleString()}` })
                      displayRows.push({ label: 'Team net volume', value: `$${teamVolume.toLocaleString()}` })
                      displayRows.push({ label: 'Override Rate', value: overrideType === 'percentage' ? `${overrideRate}%` : `$${overrideRate}/sale` })
                      displayRows.push({ label: 'Override Earnings', value: `$${Math.round(teamOverrideEarnings).toLocaleString()}` })
                    }
                    
                    monthlyEarnings = personalEarnings + teamOverrideEarnings
                    
                    // For non-managers, show simpler display
                    if (!compPlanDetails.is_manager_plan) {
                      const monthlyVolume = monthlyCommissionableVolume
                      const { extraRatePct, flatPerSale } = applyFirstMatchingVolumeBonus(
                        compPlanDetails.volume_bonuses,
                        compCalculatorTierValues
                      )
                      const baseRate = (compPlanDetails.base_percentage || 0) + extraRatePct
                      const appliedBonuses: string[] = []
                      if (extraRatePct > 0) appliedBonuses.push(`+${extraRatePct}%`)
                      if (flatPerSale > 0) appliedBonuses.push(`+$${flatPerSale}/sale`)
                      
                      displayRows = [
                        { label: 'Sales/Month', value: `${calcJobsClosed}` },
                        { label: 'Avg financed / job', value: `$${calcAvgSalePriceNum.toLocaleString()}` },
                        { label: 'Net commissionable volume', value: `$${monthlyVolume.toLocaleString()}` },
                        { label: 'Base Rate', value: `${compPlanDetails.base_percentage || 0}%` },
                      ]
                      if (appliedBonuses.length > 0) {
                        displayRows.push({ label: 'Tier bonus', value: appliedBonuses.join(', ') })
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
                        {compPlanDetails.plan_type !== 'hourly' && calcJobsClosedNum > 0 && (
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-600 text-sm">Per Job</span>
                            <span className="font-semibold text-green-700 text-sm">${Math.round(monthlyEarnings / calcJobsClosedNum).toLocaleString()}</span>
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
                  <p className="text-xs text-gray-500 mb-2">
                    Highlights the tier that matches this calculator (volume) and your current team stats (sits /
                    close rate).
                  </p>
                  <div className="space-y-2">
                    {compPlanDetails.volume_bonuses.map((tier: VolumeTier, idx: number) => {
                      const nextTier = compPlanDetails.volume_bonuses[idx + 1]
                      const isActive = volumeBonusTierInRange(
                        tier,
                        compCalculatorTierValues,
                        { nextMinVolume: nextTier?.min_volume ?? null }
                      )
                      return (
                        <div key={idx} className={`flex items-center justify-between p-2 sm:p-3 rounded-lg border ${isActive ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                          <span className={`text-sm ${isActive ? 'text-green-800 font-medium' : 'text-gray-700'}`}>
                            {formatVolumeBonusTierRange(tier, {
                              nextMinVolume: nextTier?.min_volume ?? null,
                            })}
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
