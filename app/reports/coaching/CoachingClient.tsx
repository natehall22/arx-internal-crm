'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

type Lookback = '4w' | '2mo' | '3mo' | '6mo' | '12mo' | 'ytd' | 'prev_quarter'

type BucketData = { label: string; sets: number; sits: number; sales: number }

type MemberTrend = {
  id: string
  name: string
  role: string
  trend: 'up' | 'down' | 'flat'
  buckets: BucketData[]
  totals: { sets: number; sits: number; sales: number }
  team_id?: string | null
  region_id?: string | null
  region_name?: string | null
}

type CoachingGoals = {
  annual_income_goal: number | null
  avg_deal_value: number | null
  working_days_per_week: number
  working_weeks_per_year: number
  close_rate_override: number | null
  stick_rate_override: number | null
  commission_rate_override: number | null
}

const LOOKBACK_OPTIONS: { value: Lookback; label: string }[] = [
  { value: '4w', label: 'Last 4 weeks' },
  { value: '2mo', label: 'Last 2 months' },
  { value: '3mo', label: 'Last 3 months' },
  { value: '6mo', label: 'Last 6 months' },
  { value: '12mo', label: 'Last 12 months' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'prev_quarter', label: 'Previous quarter' },
]

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <span className="text-green-500 font-bold text-lg">↑</span>
  if (trend === 'down') return <span className="text-red-500 font-bold text-lg">↓</span>
  return <span className="text-gray-400 font-bold text-lg">→</span>
}

function calcTargets(goals: CoachingGoals, commissionRate: number | null, liveClose: number, liveStick: number) {
  const {
    annual_income_goal,
    avg_deal_value,
    working_days_per_week,
    working_weeks_per_year,
    close_rate_override,
    stick_rate_override,
    commission_rate_override,
  } = goals

  if (!annual_income_goal || annual_income_goal <= 0) return null

  // Use comp plan rate first, then manual override, then 0
  const effectiveCommission = commissionRate ?? commission_rate_override ?? 0
  const effectiveClose = (close_rate_override ?? liveClose) / 100
  const effectiveStick = (stick_rate_override ?? liveStick) / 100

  const commissionPerSale =
    avg_deal_value && effectiveCommission > 0
      ? avg_deal_value * (effectiveCommission / 100)
      : null

  if (!commissionPerSale || commissionPerSale <= 0) return null

  const salesPerYear = annual_income_goal / commissionPerSale
  const weeksPerYear = working_weeks_per_year || 50
  const daysPerWeek = working_days_per_week || 5
  const salesPerMonth = salesPerYear / 12
  const salesPerWeek = salesPerYear / weeksPerYear

  const sitsPerMonth = effectiveClose > 0 ? salesPerMonth / effectiveClose : null
  const sitsPerWeek = effectiveClose > 0 ? salesPerWeek / effectiveClose : null

  const setsPerWeek = sitsPerWeek && effectiveStick > 0 ? sitsPerWeek / effectiveStick : null
  const setsPerDay = setsPerWeek ? setsPerWeek / daysPerWeek : null

  return {
    salesPerYear: Math.ceil(salesPerYear),
    salesPerMonth: Math.ceil(salesPerMonth),
    salesPerWeek: parseFloat(salesPerWeek.toFixed(1)),
    sitsPerMonth: sitsPerMonth ? Math.ceil(sitsPerMonth) : null,
    sitsPerWeek: sitsPerWeek ? parseFloat(sitsPerWeek.toFixed(1)) : null,
    setsPerWeek: setsPerWeek ? Math.ceil(setsPerWeek) : null,
    setsPerDay: setsPerDay ? parseFloat(setsPerDay.toFixed(1)) : null,
    commissionPerSale: Math.round(commissionPerSale),
  }
}

function fmt(n: number | null | undefined, decimals = 0) {
  if (n === null || n === undefined) return '—'
  return decimals > 0 ? n.toFixed(decimals) : String(n)
}

function GapBadge({ target, actual }: { target: number | null; actual: number }) {
  if (target === null) return <span className="text-gray-400 text-xs">—</span>
  const pct = target > 0 ? Math.round((actual / target) * 100) : 0
  const color = pct >= 90 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-600'
  return <span className={`text-xs font-semibold ${color}`}>{pct}%</span>
}

/** Synthetic id for manager org-wide drill-down (not a real user) */
const TEAM_COMBINED_ID = '__team_combined__'

const UNASSIGNED_REGION_KEY = '__unassigned__'
const REGION_COMBINED_PREFIX = '__region_combined__:'

function regionCombinedId(regionKey: string) {
  return `${REGION_COMBINED_PREFIX}${regionKey}`
}

function isCoachingAggregateId(id?: string | null) {
  if (!id) return false
  return id === TEAM_COMBINED_ID || id.startsWith(REGION_COMBINED_PREFIX)
}

function regionGroupKey(m: MemberTrend) {
  return m.region_id ?? UNASSIGNED_REGION_KEY
}

function buildTeamCombinedMember(
  members: MemberTrend[],
  opts?: { id?: string; name?: string; role?: string }
): MemberTrend | null {
  if (members.length === 0) return null
  const bucketLen = members[0].buckets.length
  const buckets: BucketData[] = []
  for (let i = 0; i < bucketLen; i++) {
    let sets = 0
    let sits = 0
    let sales = 0
    let label = ''
    for (const m of members) {
      const b = m.buckets[i]
      if (b) {
        sets += b.sets
        sits += b.sits
        sales += b.sales
        label = b.label
      }
    }
    buckets.push({ label, sets, sits, sales })
  }
  const totals = members.reduce(
    (acc, m) => ({
      sets: acc.sets + m.totals.sets,
      sits: acc.sits + m.totals.sits,
      sales: acc.sales + m.totals.sales,
    }),
    { sets: 0, sits: 0, sales: 0 }
  )
  const last = buckets[buckets.length - 1]
  const prior = buckets.slice(0, -1)
  const priorAvg = prior.length > 0 ? prior.reduce((s, b) => s + b.sits, 0) / prior.length : null
  const trend: 'up' | 'down' | 'flat' =
    priorAvg === null ? 'flat' : last.sits > priorAvg ? 'up' : last.sits < priorAvg ? 'down' : 'flat'

  return {
    id: opts?.id ?? TEAM_COMBINED_ID,
    name: opts?.name ?? 'Team (combined)',
    role: opts?.role ?? 'team_total',
    trend,
    buckets,
    totals,
  }
}

export default function CoachingClient({
  currentUserId,
  currentUserName,
  currentUserRole,
  isManager,
}: {
  currentUserId: string
  currentUserName: string
  currentUserRole: string
  isManager: boolean
}) {
  const [lookback, setLookback] = useState<Lookback>('3mo')
  const [members, setMembers] = useState<MemberTrend[]>([])
  const [viewerRegion, setViewerRegion] = useState<{ id: string; name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMember, setSelectedMember] = useState<MemberTrend | null>(null)
  /** Admin: filtered view for one region’s reps */
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)

  // Goals state
  const [goals, setGoals] = useState<CoachingGoals>({
    annual_income_goal: null,
    avg_deal_value: null,
    working_days_per_week: 5,
    working_weeks_per_year: 50,
    close_rate_override: null,
    stick_rate_override: null,
    commission_rate_override: null,
  })
  const [commissionRate, setCommissionRate] = useState<number | null>(null)
  const [savingGoals, setSavingGoals] = useState(false)
  const [goalsSaved, setGoalsSaved] = useState(false)
  const [goalsLoaded, setGoalsLoaded] = useState(false)

  const loadTrend = useCallback(async (lb: Lookback) => {
    setLoading(true)
    try {
      const url = isManager
        ? `/api/coaching/trend?lookback=${lb}`
        : `/api/coaching/trend?lookback=${lb}&userId=${currentUserId}`
      const res = await fetch(url)
      const data = await res.json()
      setMembers(data.members || [])
      setViewerRegion(data.viewerRegion ?? null)
    } catch (e) {
      console.error('[coaching trend]', e)
    } finally {
      setLoading(false)
    }
  }, [isManager, currentUserId])

  const loadGoals = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/coaching/goals?userId=${userId}`)
      const data = await res.json()
      if (data.goals) {
        setGoals({
          annual_income_goal: data.goals.annual_income_goal,
          avg_deal_value: data.goals.avg_deal_value,
          working_days_per_week: data.goals.working_days_per_week ?? 5,
          working_weeks_per_year: data.goals.working_weeks_per_year ?? 50,
          close_rate_override: data.goals.close_rate_override,
          stick_rate_override: data.goals.stick_rate_override,
          commission_rate_override: data.goals.commission_rate_override ?? null,
        })
      }
      if (data.commissionRate !== undefined) setCommissionRate(data.commissionRate)
      setGoalsLoaded(true)
    } catch (e) {
      console.error('[coaching goals load]', e)
      setGoalsLoaded(true)
    }
  }, [])

  useEffect(() => { loadTrend(lookback) }, [lookback, loadTrend])

  useEffect(() => {
    setSelectedRegionId(null)
    setSelectedMember(null)
  }, [lookback])

  useEffect(() => {
    if (isCoachingAggregateId(selectedMember?.id)) {
      setGoalsLoaded(true)
      return
    }
    const uid = selectedMember?.id || currentUserId
    setGoalsLoaded(false)
    loadGoals(uid)
  }, [selectedMember, currentUserId, loadGoals])

  const isAdmin = currentUserRole === 'admin'
  const isRegionalManager = currentUserRole === 'regional_manager'

  const teamCombined = useMemo(() => (isManager ? buildTeamCombinedMember(members) : null), [isManager, members])

  const adminRegionSections = useMemo(() => {
    if (!isAdmin || members.length === 0) return []
    const by = new Map<string, MemberTrend[]>()
    for (const m of members) {
      const k = regionGroupKey(m)
      if (!by.has(k)) by.set(k, [])
      by.get(k)!.push(m)
    }
    return Array.from(by.entries())
      .map(([key, ms]) => {
        const displayName =
          key === UNASSIGNED_REGION_KEY
            ? 'Unassigned (no region)'
            : ms[0]?.region_name || 'Region'
        const combinedShort =
          key === UNASSIGNED_REGION_KEY ? 'Unassigned' : ms[0]?.region_name || 'Region'
        const combined = buildTeamCombinedMember(ms, {
          id: regionCombinedId(key),
          name: `${combinedShort} (combined)`,
          role: 'region_total',
        })
        return { key, displayName, members: ms, combined }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [isAdmin, members])

  const showAdminRegionCards = isAdmin && adminRegionSections.length > 1

  const membersInRegionView = useMemo(() => {
    if (!selectedRegionId) return members
    return members.filter(m => regionGroupKey(m) === selectedRegionId)
  }, [members, selectedRegionId])

  const regionDrillCombined = useMemo(() => {
    if (!selectedRegionId || membersInRegionView.length === 0) return null
    const sec = adminRegionSections.find(s => s.key === selectedRegionId)
    return sec?.combined ?? buildTeamCombinedMember(membersInRegionView, {
      id: regionCombinedId(selectedRegionId),
      name: 'Region (combined)',
      role: 'region_total',
    })
  }, [selectedRegionId, membersInRegionView, adminRegionSections])

  async function saveGoals() {
    if (isCoachingAggregateId(selectedMember?.id)) return
    setSavingGoals(true)
    try {
      const userId = selectedMember?.id || currentUserId
      await fetch('/api/coaching/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...goals }),
      })
      setGoalsSaved(true)
      setTimeout(() => setGoalsSaved(false), 2000)
    } finally {
      setSavingGoals(false)
    }
  }

  // Derive live rates from trend data for the selected member
  const memberForCalc = selectedMember || (members.find(m => m.id === currentUserId) ?? members[0])
  const totalSets = memberForCalc?.totals.sets ?? 0
  const totalSits = memberForCalc?.totals.sits ?? 0
  const totalSales = memberForCalc?.totals.sales ?? 0
  const liveStick = totalSets > 0 ? Math.round((totalSits / totalSets) * 100) : 0
  const liveClose = totalSits > 0 ? Math.round((totalSales / totalSits) * 100) : 0

  const targets = calcTargets(goals, commissionRate, liveClose, liveStick)

  // Trailing monthly averages for "current pace" comparison
  const recentBuckets = memberForCalc?.buckets.slice(-3) ?? []
  const avgSets = recentBuckets.length ? recentBuckets.reduce((s, b) => s + b.sets, 0) / recentBuckets.length : 0
  const avgSits = recentBuckets.length ? recentBuckets.reduce((s, b) => s + b.sits, 0) / recentBuckets.length : 0
  const avgSales = recentBuckets.length ? recentBuckets.reduce((s, b) => s + b.sales, 0) / recentBuckets.length : 0

  const displayName = selectedMember
    ? selectedMember.id === TEAM_COMBINED_ID
      ? 'Team (combined)'
      : selectedMember.name
    : currentUserName

  const regionDrillTitle =
    selectedRegionId && adminRegionSections.find(s => s.key === selectedRegionId)?.displayName

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {(selectedMember || selectedRegionId) && (
            <button
              type="button"
              onClick={() => {
                if (selectedMember) setSelectedMember(null)
                else setSelectedRegionId(null)
              }}
              className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              ← Back
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {selectedMember
                ? selectedMember.id === TEAM_COMBINED_ID
                  ? 'Team (combined)'
                  : selectedMember.name
                : selectedRegionId
                  ? regionDrillTitle || 'Region'
                  : 'Team Coaching'}
            </h1>
            {selectedMember ? (
              <p className="text-sm text-gray-500 capitalize">
                {selectedMember.id === TEAM_COMBINED_ID
                  ? isRegionalManager && viewerRegion
                    ? `Everyone in ${viewerRegion.name} — totals summed`
                    : 'Everyone in your coaching scope — totals summed'
                  : isCoachingAggregateId(selectedMember.id)
                    ? 'Totals summed for this region'
                    : selectedMember.role.replace(/_/g, ' ')}
              </p>
            ) : selectedRegionId ? (
              <p className="text-sm text-gray-500">
                {membersInRegionView.length} rep{membersInRegionView.length === 1 ? '' : 's'} in this region · click a card or open the combined trend
              </p>
            ) : null}
          </div>
        </div>
        <select
          value={lookback}
          onChange={e => setLookback(e.target.value as Lookback)}
          className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
        >
          {LOOKBACK_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Team overview: org (admin: + region cards) or region drill-down */}
      {!selectedMember && isManager && !selectedRegionId && (
        <div className="mb-8">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-28" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-gray-500 text-sm py-10 text-center">No team members found.</p>
          ) : (
            <>
              {teamCombined && (
                <button
                  type="button"
                  onClick={() => setSelectedMember(teamCombined)}
                  className="w-full mb-4 bg-gradient-to-r from-indigo-50 to-white rounded-xl border-2 border-indigo-200 p-4 sm:p-5 text-left hover:border-indigo-400 hover:shadow-sm transition-all"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-1">
                        {isRegionalManager ? 'Region total' : 'Team total'}
                      </p>
                      <p className="text-lg font-bold text-gray-900">
                        {isRegionalManager && viewerRegion
                          ? `${viewerRegion.name} — combined`
                          : 'Everyone in scope — combined'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Sets, sits, and sales summed across all reps below. Click for trend chart.
                      </p>
                    </div>
                    <TrendArrow trend={teamCombined.trend} />
                  </div>
                  <div className="flex gap-6 mt-4 text-sm">
                    <span><span className="text-gray-500">Sets </span><span className="font-bold text-orange-500">{teamCombined.totals.sets}</span></span>
                    <span><span className="text-gray-500">Sits </span><span className="font-bold text-cyan-600">{teamCombined.totals.sits}</span></span>
                    <span><span className="text-gray-500">Sales </span><span className="font-bold text-green-600">{teamCombined.totals.sales}</span></span>
                  </div>
                </button>
              )}

              {showAdminRegionCards && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By region</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {adminRegionSections.map(sec => (
                      <button
                        key={sec.key}
                        type="button"
                        onClick={() => setSelectedRegionId(sec.key)}
                        className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-amber-400 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="font-semibold text-gray-900 text-sm">{sec.displayName}</p>
                          {sec.combined && <TrendArrow trend={sec.combined.trend} />}
                        </div>
                        {sec.combined && (
                          <div className="flex gap-4 text-xs mb-2">
                            <span><span className="text-gray-400">Sets </span><span className="font-semibold text-orange-500">{sec.combined.totals.sets}</span></span>
                            <span><span className="text-gray-400">Sits </span><span className="font-semibold text-cyan-600">{sec.combined.totals.sits}</span></span>
                            <span><span className="text-gray-400">Sales </span><span className="font-semibold text-green-600">{sec.combined.totals.sales}</span></span>
                          </div>
                        )}
                        <p className="text-xs text-amber-700 font-medium">View region →</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {members.map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedMember(member)}
                  className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center">
                      <span className="text-sm font-semibold text-indigo-700">
                        {member.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <TrendArrow trend={member.trend} />
                  </div>
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{member.name}</p>
                  <p className="text-xs text-gray-400 capitalize mb-2">{member.role.replace(/_/g, ' ')}</p>
                  {isAdmin && member.region_name && (
                    <p className="text-[10px] text-gray-400 mb-1 truncate" title={member.region_name}>{member.region_name}</p>
                  )}
                  <div className="flex gap-3 text-xs">
                    <span><span className="text-gray-400">Sets </span><span className="font-semibold text-orange-500">{member.totals.sets}</span></span>
                    <span><span className="text-gray-400">Sits </span><span className="font-semibold text-cyan-600">{member.totals.sits}</span></span>
                    <span><span className="text-gray-400">Sales </span><span className="font-semibold text-green-600">{member.totals.sales}</span></span>
                  </div>
                </button>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {/* Admin: one region — reps + region combined */}
      {!selectedMember && isManager && selectedRegionId && (
        <div className="mb-8">
          {loading ? (
            <div className="h-32 animate-pulse bg-gray-100 rounded-xl" />
          ) : membersInRegionView.length === 0 ? (
            <p className="text-gray-500 text-sm py-10 text-center">No reps in this region.</p>
          ) : (
            <>
              {regionDrillCombined && (
                <button
                  type="button"
                  onClick={() => setSelectedMember(regionDrillCombined)}
                  className="w-full mb-4 bg-gradient-to-r from-amber-50 to-white rounded-xl border-2 border-amber-200 p-4 sm:p-5 text-left hover:border-amber-400 hover:shadow-sm transition-all"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Region total</p>
                      <p className="text-lg font-bold text-gray-900">{regionDrillCombined.name}</p>
                      <p className="text-xs text-gray-500 mt-1">Summed across reps in this region. Click for trend chart.</p>
                    </div>
                    <TrendArrow trend={regionDrillCombined.trend} />
                  </div>
                  <div className="flex gap-6 mt-4 text-sm">
                    <span><span className="text-gray-500">Sets </span><span className="font-bold text-orange-500">{regionDrillCombined.totals.sets}</span></span>
                    <span><span className="text-gray-500">Sits </span><span className="font-bold text-cyan-600">{regionDrillCombined.totals.sits}</span></span>
                    <span><span className="text-gray-500">Sales </span><span className="font-bold text-green-600">{regionDrillCombined.totals.sales}</span></span>
                  </div>
                </button>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {membersInRegionView.map(member => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setSelectedMember(member)}
                    className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-indigo-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-semibold text-indigo-700">
                          {member.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <TrendArrow trend={member.trend} />
                    </div>
                    <p className="font-semibold text-gray-900 text-sm leading-tight">{member.name}</p>
                    <p className="text-xs text-gray-400 capitalize mb-2">{member.role.replace(/_/g, ' ')}</p>
                    <div className="flex gap-3 text-xs">
                      <span><span className="text-gray-400">Sets </span><span className="font-semibold text-orange-500">{member.totals.sets}</span></span>
                      <span><span className="text-gray-400">Sits </span><span className="font-semibold text-cyan-600">{member.totals.sits}</span></span>
                      <span><span className="text-gray-400">Sales </span><span className="font-semibold text-green-600">{member.totals.sales}</span></span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Individual view: chart + goals */}
      {(selectedMember || !isManager) && (
        <>
          {/* Line chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">
              Performance Trend — {displayName}
            </h2>
            {loading ? (
              <div className="h-64 animate-pulse bg-gray-100 rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={memberForCalc?.buckets ?? []} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="sets" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} name="Sets" />
                  <Line type="monotone" dataKey="sits" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} name="Sits" />
                  <Line type="monotone" dataKey="sales" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Sales" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Goal Calculator — individual reps only */}
          {isCoachingAggregateId(selectedMember?.id) ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 text-sm text-gray-600">
              <p className="font-medium text-gray-800 mb-1">Goal calculator</p>
              <p>Income goals are tracked per person. Choose a team member from the grid above to view or edit their goals.</p>
            </div>
          ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Goal Calculator</h2>

            {!goalsLoaded ? (
              <div className="h-40 animate-pulse bg-gray-100 rounded-lg" />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Inputs */}
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Inputs</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Annual income goal ($)</label>
                      <input
                        type="number"
                        value={goals.annual_income_goal ?? ''}
                        onChange={e => setGoals(g => ({ ...g, annual_income_goal: e.target.value ? Number(e.target.value) : null }))}
                        placeholder="e.g. 150000"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Avg deal / contract value ($)
                      </label>
                      <input
                        type="number"
                        value={goals.avg_deal_value ?? ''}
                        onChange={e => setGoals(g => ({ ...g, avg_deal_value: e.target.value ? Number(e.target.value) : null }))}
                        placeholder="e.g. 18500"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Commission rate %
                        {commissionRate && (
                          <span className="text-indigo-500 ml-1">(comp plan: {commissionRate}%)</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={0} max={100}
                        value={commissionRate ?? goals.commission_rate_override ?? ''}
                        readOnly={!!commissionRate}
                        onChange={e => !commissionRate && setGoals(g => ({ ...g, commission_rate_override: e.target.value ? Number(e.target.value) : null }))}
                        placeholder="e.g. 8"
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${commissionRate ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                      {(commissionRate || goals.commission_rate_override) && goals.avg_deal_value && (
                        <p className="text-xs text-gray-400 mt-1">
                          ~${Math.round(goals.avg_deal_value * (commissionRate ?? goals.commission_rate_override ?? 0) / 100).toLocaleString()}/sale
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Days worked/week</label>
                        <input
                          type="number"
                          min={1} max={7}
                          value={goals.working_days_per_week}
                          onChange={e => setGoals(g => ({ ...g, working_days_per_week: Number(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Weeks worked/year</label>
                        <input
                          type="number"
                          min={1} max={52}
                          value={goals.working_weeks_per_year}
                          onChange={e => setGoals(g => ({ ...g, working_weeks_per_year: Number(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Close rate % <span className="text-gray-400">(live: {liveClose}%)</span>
                        </label>
                        <input
                          type="number"
                          min={0} max={100}
                          value={goals.close_rate_override ?? liveClose}
                          onChange={e => setGoals(g => ({ ...g, close_rate_override: e.target.value ? Number(e.target.value) : null }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Stick rate % <span className="text-gray-400">(live: {liveStick}%)</span>
                        </label>
                        <input
                          type="number"
                          min={0} max={100}
                          value={goals.stick_rate_override ?? liveStick}
                          onChange={e => setGoals(g => ({ ...g, stick_rate_override: e.target.value ? Number(e.target.value) : null }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>

                    <button
                      onClick={saveGoals}
                      disabled={savingGoals}
                      className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {goalsSaved ? 'Saved!' : savingGoals ? 'Saving…' : 'Save Goals'}
                    </button>
                  </div>
                </div>

                {/* Backworked targets vs current pace */}
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Backworked Targets</p>
                  {!targets ? (
                    <div className="flex items-center justify-center h-40 text-sm text-gray-400 text-center">
                      Enter an annual goal, avg deal value,<br />and commission rate to see targets.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {/* Header row */}
                      <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-400 pb-1 border-b border-gray-100">
                        <span>Metric</span>
                        <span className="text-center">/ Month</span>
                        <span className="text-center">/ Week</span>
                        <span className="text-center">Pace</span>
                      </div>

                      {/* Sales */}
                      <div className="grid grid-cols-4 gap-2 items-center py-2 border-b border-gray-50">
                        <span className="text-sm font-medium text-green-600">Sales</span>
                        <span className="text-center text-sm font-semibold">{fmt(targets.salesPerMonth)}</span>
                        <span className="text-center text-sm">{fmt(targets.salesPerWeek, 1)}</span>
                        <div className="text-center">
                          <GapBadge target={targets.salesPerMonth} actual={avgSales} />
                        </div>
                      </div>

                      {/* Sits */}
                      <div className="grid grid-cols-4 gap-2 items-center py-2 border-b border-gray-50">
                        <span className="text-sm font-medium text-cyan-600">Sits</span>
                        <span className="text-center text-sm font-semibold">{fmt(targets.sitsPerMonth)}</span>
                        <span className="text-center text-sm">{fmt(targets.sitsPerWeek, 1)}</span>
                        <div className="text-center">
                          <GapBadge target={targets.sitsPerMonth} actual={avgSits} />
                        </div>
                      </div>

                      {/* Sets */}
                      <div className="grid grid-cols-4 gap-2 items-center py-2 border-b border-gray-50">
                        <span className="text-sm font-medium text-orange-500">Sets</span>
                        <span className="text-center text-sm font-semibold">{fmt(targets.setsPerWeek ? Math.ceil(targets.setsPerWeek * 4.33) : null)}</span>
                        <span className="text-center text-sm">{fmt(targets.setsPerWeek)}</span>
                        <div className="text-center">
                          <GapBadge target={targets.setsPerWeek ? Math.ceil(targets.setsPerWeek * 4.33) : null} actual={avgSets} />
                        </div>
                      </div>

                      {/* Sets per day */}
                      {targets.setsPerDay !== null && (
                        <div className="grid grid-cols-4 gap-2 items-center py-2">
                          <span className="text-sm font-medium text-orange-400">Sets/day</span>
                          <span className="text-center text-sm text-gray-400">—</span>
                          <span className="text-center text-sm text-gray-400">—</span>
                          <span className="text-center text-sm font-bold text-orange-500">{fmt(targets.setsPerDay, 1)}/day</span>
                        </div>
                      )}

                      {/* Commission per sale callout */}
                      <div className="mt-3 p-3 bg-indigo-50 rounded-lg text-xs text-indigo-700">
                        <span className="font-semibold">${targets.commissionPerSale.toLocaleString()}/sale</span> estimated commission
                        · <span className="font-semibold">{targets.salesPerYear}</span> sales needed/year
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          )}
        </>
      )}
    </div>
  )
}
