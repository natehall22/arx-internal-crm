'use client'

import { useEffect, useState, useCallback } from 'react'
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
}

type CoachingGoals = {
  annual_income_goal: number | null
  avg_deal_value: number | null
  working_days_per_week: number
  working_weeks_per_year: number
  close_rate_override: number | null
  stick_rate_override: number | null
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
  } = goals

  if (!annual_income_goal || annual_income_goal <= 0) return null

  const effectiveCommission = commissionRate ?? 0
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
  const [loading, setLoading] = useState(true)
  const [selectedMember, setSelectedMember] = useState<MemberTrend | null>(null)

  // Goals state
  const [goals, setGoals] = useState<CoachingGoals>({
    annual_income_goal: null,
    avg_deal_value: null,
    working_days_per_week: 5,
    working_weeks_per_year: 50,
    close_rate_override: null,
    stick_rate_override: null,
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
    const uid = selectedMember?.id || currentUserId
    setGoalsLoaded(false)
    loadGoals(uid)
  }, [selectedMember, currentUserId, loadGoals])

  async function saveGoals() {
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

  const displayName = selectedMember?.name || currentUserName

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {selectedMember && (
            <button
              onClick={() => setSelectedMember(null)}
              className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              ← Back
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {selectedMember ? selectedMember.name : 'Team Coaching'}
            </h1>
            {selectedMember && (
              <p className="text-sm text-gray-500 capitalize">{selectedMember.role.replace(/_/g, ' ')}</p>
            )}
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

      {/* Team overview grid */}
      {!selectedMember && isManager && (
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {members.map(member => (
                <button
                  key={member.id}
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

          {/* Goal Calculator */}
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
                      {commissionRate && goals.avg_deal_value && (
                        <p className="text-xs text-gray-400 mt-1">
                          At {commissionRate}% → ~${Math.round(goals.avg_deal_value * commissionRate / 100).toLocaleString()}/sale
                        </p>
                      )}
                      {commissionRate && (
                        <p className="text-xs text-indigo-500 mt-0.5">Comp plan rate: {commissionRate}%</p>
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
        </>
      )}
    </div>
  )
}
