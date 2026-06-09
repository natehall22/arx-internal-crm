'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from '@/lib/types/database'
import type {
  LiveMetrics,
  UserIncentiveGoal,
  SpiffWithProgress,
  BadgeWithEarned,
} from '@/lib/incentive-metrics'
import {
  spiffMetricLabel,
  formatReward,
  timeRemainingLabel,
  progressBarColor,
  clamp100,
} from '@/lib/incentive-metrics'

// ─── 444 Program types ────────────────────────────────────────────────────────

type Enrollment444 = {
  id: string
  week1_starts_at: string
  week1_ends_at: string
  week2_starts_at: string
  week2_ends_at: string
  week1_doors: number
  week1_inspections: number
  week1_qualified: boolean
  week2_doors: number
  week2_inspections: number
  week2_qualified: boolean
  status: string
}

// ─── Icon helpers ──────────────────────────────────────────────────────────────

const BADGE_ICONS: Record<string, string> = {
  star: '⭐',
  fire: '🔥',
  trophy: '🏆',
  lightning: '⚡',
  diamond: '💎',
  crown: '👑',
  rocket: '🚀',
  target: '🎯',
  medal: '🥇',
  shield: '🛡️',
}

function badgeEmoji(iconKey: string): string {
  return BADGE_ICONS[iconKey] ?? '🏅'
}

// ─── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  pct,
  colorClass,
  height = 'h-2.5',
}: {
  pct: number
  colorClass: string
  height?: string
}) {
  const clamped = clamp100(pct)
  return (
    <div className={`w-full ${height} rounded-full bg-gray-800 overflow-hidden`}>
      <div
        className={`h-full rounded-full ${colorClass} transition-all duration-700 ease-out`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string | number
  accent?: boolean
}) {
  return (
    <div
      className={`flex-1 min-w-0 rounded-xl p-3 text-center ${
        accent ? 'bg-indigo-900/40 border border-indigo-700/50' : 'bg-gray-800/60 border border-gray-700/40'
      }`}
    >
      <div className="text-xl font-bold text-white truncate">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5 truncate">{label}</div>
    </div>
  )
}

// ─── Hero section ─────────────────────────────────────────────────────────────

interface HeroProps {
  isSetterLike: boolean
  metrics: LiveMetrics
  goal: UserIncentiveGoal | null
  activeSpiffs: SpiffWithProgress[]
}

function ThisWeekHero({ isSetterLike, metrics, goal, activeSpiffs }: HeroProps) {
  // Choose primary metric based on role
  let primaryValue: number
  let primaryLabel: string
  let primaryGoal: number | null

  if (isSetterLike) {
    primaryValue = metrics.inspectionsSet
    primaryLabel = 'Inspections Set'
    primaryGoal = goal?.weekly_inspections_target ?? null
  } else {
    primaryValue = metrics.closedSales
    primaryLabel = 'Closed Sales'
    primaryGoal = goal?.weekly_sales_target ?? null
  }

  const pct = primaryGoal != null && primaryGoal > 0 ? (primaryValue / primaryGoal) * 100 : null
  const barColor = pct != null ? progressBarColor(pct) : 'bg-blue-500'

  const earnedFromHeats = activeSpiffs
    .filter(s => s.qualified && s.reward_amount != null)
    .reduce((sum, s) => sum + (s.reward_amount ?? 0), 0)

  return (
    <section
      className="rounded-2xl overflow-hidden border border-gray-800"
      style={{
        background: 'linear-gradient(135deg, #1a1040 0%, #0f172a 60%, #0c1a2e 100%)',
      }}
    >
      {/* Top accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-600" />

      <div className="p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-2">
          This Week
        </p>

        <div className="flex items-end gap-3 mb-1">
          <span className="text-6xl font-black text-white leading-none">{primaryValue}</span>
          {primaryGoal != null && (
            <span className="text-2xl font-bold text-gray-500 mb-1">/ {primaryGoal}</span>
          )}
        </div>

        <p className="text-sm font-medium text-gray-300 mb-4">{primaryLabel}</p>

        {/* Progress bar */}
        {pct != null ? (
          <>
            <ProgressBar pct={pct} colorClass={barColor} height="h-3" />
            <p className="text-xs text-gray-400 mt-2">
              {primaryValue} of {primaryGoal} —{' '}
              <span
                className={
                  pct >= 80
                    ? 'text-emerald-400 font-semibold'
                    : pct >= 50
                    ? 'text-amber-400 font-semibold'
                    : 'text-blue-400 font-semibold'
                }
              >
                {Math.round(pct)}% to goal
              </span>
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500 mt-1">No goal set — contact your manager to set a target.</p>
        )}

        {/* Earned from Heats */}
        {earnedFromHeats > 0 && (
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-400">
              ${earnedFromHeats.toLocaleString()}
            </span>
            <span className="text-sm text-gray-400">earned from active Heats</span>
          </div>
        )}

        {/* Secondary chips */}
        <div className="flex gap-2 mt-5">
          {isSetterLike ? (
            <>
              <StatChip label="Doors Knocked" value={metrics.doorsKnocked} />
              <StatChip label="Closed Sales" value={metrics.closedSales} />
              {goal?.weekly_doors_target != null && (
                <StatChip
                  label="Door Goal"
                  value={`${metrics.doorsKnocked}/${goal.weekly_doors_target}`}
                  accent
                />
              )}
            </>
          ) : (
            <>
              <StatChip label="Inspections Set" value={metrics.inspectionsSet} />
              <StatChip label="Doors Knocked" value={metrics.doorsKnocked} />
              {goal?.weekly_revenue_target != null && (
                <StatChip label="Rev Goal" value={`$${goal.weekly_revenue_target.toLocaleString()}`} accent />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

type SisuSyncProgress = {
  spiff_program_id: string
  current_value: number
  qualified: boolean
  qualified_at: string | null
}

type MainView = 'stats' | 'leaderboard'
type LeaderboardRoleTab = 'setters' | 'closers'

type LeaderboardEntry = {
  user_id: string
  full_name: string
  role: string
  primary_metric: number
  doors_knocked: number
  rank: number
}

type LeaderboardResponse = {
  setters: LeaderboardEntry[]
  closers: LeaderboardEntry[]
}

function isSisuSyncProgress(value: unknown): value is SisuSyncProgress {
  if (!value || typeof value !== 'object') return false

  const row = value as Record<string, unknown>
  return (
    typeof row.spiff_program_id === 'string' &&
    typeof row.current_value === 'number' &&
    typeof row.qualified === 'boolean' &&
    (typeof row.qualified_at === 'string' || row.qualified_at === null)
  )
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== 'object') return false

  const row = value as Record<string, unknown>
  return (
    typeof row.user_id === 'string' &&
    typeof row.full_name === 'string' &&
    typeof row.role === 'string' &&
    typeof row.primary_metric === 'number' &&
    typeof row.doors_knocked === 'number' &&
    typeof row.rank === 'number'
  )
}

function isLeaderboardResponse(value: unknown): value is LeaderboardResponse {
  if (!value || typeof value !== 'object') return false

  const row = value as Record<string, unknown>
  return (
    Array.isArray(row.setters) &&
    Array.isArray(row.closers) &&
    row.setters.every(isLeaderboardEntry) &&
    row.closers.every(isLeaderboardEntry)
  )
}

function privateDisplayName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Unknown'
  if (parts.length === 1) return parts[0]

  const firstName = parts[0]
  const lastInitial = parts[parts.length - 1]?.charAt(0).toUpperCase()
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName
}

// ─── SPIFF card ───────────────────────────────────────────────────────────────

function SpiffCard({
  spiff,
  isSyncing,
  isQualificationFlashing,
}: {
  spiff: SpiffWithProgress
  isSyncing: boolean
  isQualificationFlashing: boolean
}) {
  const pct =
    spiff.threshold > 0 ? (spiff.currentValue / Number(spiff.threshold)) * 100 : 0
  const barColor = progressBarColor(pct)
  const reward = formatReward(spiff)

  const [countdownLabel, setCountdownLabel] = useState(() => timeRemainingLabel(spiff.ends_at))
  const isUrgent = new Date(spiff.ends_at).getTime() - Date.now() < 24 * 60 * 60 * 1000

  useEffect(() => {
    const update = () => setCountdownLabel(timeRemainingLabel(spiff.ends_at))
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [spiff.ends_at])

  return (
    <div
      className={`relative flex-shrink-0 w-72 rounded-2xl border p-5 flex flex-col gap-3 transition-all ${
        spiff.qualified
          ? 'border-emerald-500/60 bg-gradient-to-br from-emerald-950/60 to-gray-900 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
          : 'border-gray-700/60 bg-gray-900'
      } ${isQualificationFlashing ? 'ring-2 ring-emerald-400' : 'ring-0 ring-transparent'}`}
    >
      {/* Qualified badge */}
      {spiff.qualified && (
        <div className="absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 shadow-lg">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 pr-0">
        <h3 className="font-bold text-white text-base leading-tight">{spiff.name}</h3>
        <span className="text-xl font-black text-amber-400 shrink-0">{reward}</span>
      </div>
      <div>
        {spiff.description && (
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{spiff.description}</p>
        )}
      </div>

      {/* Metric + threshold */}
      <div className="text-sm text-gray-300">
        <span className="font-medium text-white">{spiffMetricLabel(spiff.trigger_metric)}</span>
        {': '}
        <span className="text-indigo-400 font-bold">{spiff.threshold.toLocaleString()}</span>
        {' target'}
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between items-baseline mb-1.5 text-xs text-gray-400">
          <span>
            {spiff.currentValue.toLocaleString()} / {Number(spiff.threshold).toLocaleString()}
          </span>
          <span className={pct >= 100 ? 'text-emerald-400 font-semibold' : ''}>{Math.round(pct)}%</span>
        </div>
        <div className="relative">
          <ProgressBar pct={pct} colorClass={barColor} />
          {isSyncing && (
            <span className="absolute right-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-300 animate-pulse shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
          )}
        </div>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-end mt-auto pt-1">
        <span className={`text-xs font-medium flex items-center gap-1 ${
          isUrgent ? 'text-red-400' : countdownLabel === 'Ended' ? 'text-gray-500' : 'text-amber-400'
        }`}>
          {isUrgent && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />}
          {countdownLabel}
        </span>
      </div>
    </div>
  )
}

function SpiffsSection({
  spiffs,
  syncing,
  flashingSpiffIds,
}: {
  spiffs: SpiffWithProgress[]
  syncing: boolean
  flashingSpiffIds: Set<string>
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-bold text-white">Active Heats</h2>
        {spiffs.length > 0 && (
          <span className="rounded-full bg-indigo-600 text-white text-xs font-bold px-2 py-0.5">
            {spiffs.length}
          </span>
        )}
      </div>

      {spiffs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 p-8 text-center">
          <div className="text-4xl mb-3">🎯</div>
          <p className="font-semibold text-gray-300">No active Heats right now</p>
          <p className="text-sm text-gray-500 mt-1">
            Something good is coming. Check back soon.
          </p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory">
          {spiffs.map((s) => (
            <div key={s.id} className="snap-start">
              <SpiffCard
                spiff={s}
                isSyncing={syncing}
                isQualificationFlashing={flashingSpiffIds.has(s.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Badge grid ───────────────────────────────────────────────────────────────

function BadgeItem({ badge }: { badge: BadgeWithEarned }) {
  const emoji = badgeEmoji(badge.icon_key)
  const earnedDate = badge.awarded_at
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
        new Date(badge.awarded_at)
      )
    : null

  if (badge.earned) {
    return (
      <div className="rounded-2xl border border-gray-700/50 bg-gray-900 p-3 flex flex-col items-center gap-2 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-3xl shadow-inner"
          style={{ backgroundColor: `${badge.color_hex}33`, outline: `2px solid ${badge.color_hex}55` }}
        >
          {emoji}
        </div>
        <p className="text-xs font-semibold text-white leading-tight line-clamp-2">{badge.name}</p>
        {earnedDate && (
          <p className="text-xs text-gray-300">Earned {earnedDate}</p>
        )}
      </div>
    )
  }

  // Locked badge — silhouette version
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-3 flex flex-col items-center gap-2 text-center opacity-50">
      <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl grayscale bg-gray-800">
        {emoji}
      </div>
      <p className="text-xs font-medium text-gray-500 leading-tight line-clamp-2">{badge.name}</p>
    </div>
  )
}

function BadgesSection({ badges }: { badges: BadgeWithEarned[] }) {
  const earned = badges.filter((b) => b.earned)
  const locked = badges.filter((b) => !b.earned)

  if (badges.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-bold text-white">My Badges</h2>
        {earned.length > 0 && (
          <span className="rounded-full bg-amber-600/80 text-white text-xs font-bold px-2 py-0.5">
            {earned.length}
          </span>
        )}
      </div>

      {earned.length === 0 && (
        <p className="text-sm text-gray-500 mb-4">
          Earn your first badge by hitting a milestone. You've got this.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {earned.map((b) => (
          <BadgeItem key={b.id} badge={b} />
        ))}
      </div>

      {locked.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer select-none">
            {locked.length} locked {locked.length === 1 ? 'badge' : 'badges'}
          </summary>
          <div className="grid grid-cols-3 gap-3 mt-3 opacity-40">
            {locked.map((b) => <BadgeItem key={b.id} badge={b} />)}
          </div>
        </details>
      )}
    </section>
  )
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-2xl border border-gray-800 bg-gray-900 p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gray-800" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-28 rounded bg-gray-800" />
              <div className="h-2 w-full rounded bg-gray-800" />
            </div>
            <div className="h-7 w-12 rounded bg-gray-800" />
          </div>
        </div>
      ))}
    </div>
  )
}

function LeaderboardRow({
  entry,
  maxPrimaryMetric,
  isCurrentUser,
  primaryLabel,
  gapToNext,
  isHustleAward,
}: {
  entry: LeaderboardEntry
  maxPrimaryMetric: number
  isCurrentUser: boolean
  primaryLabel: string
  gapToNext: number
  isHustleAward: boolean
}) {
  const barPct = maxPrimaryMetric > 0 ? (entry.primary_metric / maxPrimaryMetric) * 100 : 0

  const rankBubbleClass =
    entry.rank === 1
      ? 'bg-amber-500 text-white'
      : entry.rank === 2
      ? 'bg-gray-400 text-gray-900'
      : entry.rank === 3
      ? 'bg-amber-700 text-white'
      : isCurrentUser
      ? 'bg-indigo-500 text-white'
      : 'bg-gray-800 text-gray-300'

  return (
    <div
      className={`rounded-2xl border p-4 ${
        isCurrentUser
          ? 'border-indigo-500/70 bg-indigo-950/30'
          : 'border-gray-800 bg-gray-900'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${rankBubbleClass}`}
        >
          #{entry.rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              <p className="truncate text-sm font-bold text-white">
                {privateDisplayName(entry.full_name)}
              </p>
              {isHustleAward && (
                <span className="ml-2 text-[10px] rounded-full bg-orange-900/60 text-orange-300 px-2 py-0.5 font-medium shrink-0">
                  🔥 Hustle
                </span>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-black text-white">{entry.primary_metric}</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">{primaryLabel}</p>
              {entry.rank > 1 && gapToNext > 0 && (
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {gapToNext} behind #{entry.rank - 1}
                </p>
              )}
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-700"
              style={{ width: `${clamp100(barPct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {entry.doors_knocked.toLocaleString()} doors knocked
          </p>
        </div>
      </div>
    </div>
  )
}

function LeaderboardSection({
  leaderboard,
  loading,
  error,
  activeRoleTab,
  setActiveRoleTab,
  currentUserId,
}: {
  leaderboard: LeaderboardResponse | null
  loading: boolean
  error: boolean
  activeRoleTab: LeaderboardRoleTab
  setActiveRoleTab: (tab: LeaderboardRoleTab) => void
  currentUserId: string
}) {
  const rows = leaderboard?.[activeRoleTab] ?? []
  const maxPrimaryMetric = Math.max(0, ...rows.map((entry) => entry.primary_metric))
  const hasActivity = rows.some(
    (entry) => entry.primary_metric > 0 || entry.doors_knocked > 0,
  )
  const primaryLabel = activeRoleTab === 'setters' ? 'set' : 'sales'

  // Hustle award: rep with most doors knocked who isn't already #1
  const hustleUserId: string | null = (() => {
    if (rows.length === 0) return null
    const sorted = [...rows].sort((a, b) => b.doors_knocked - a.doors_knocked)
    const top = sorted[0]
    if (!top || top.rank === 1) return null
    return top.user_id
  })()

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Leaderboard</h2>
          <p className="text-xs text-gray-500">This week</p>
        </div>
        <div className="grid grid-cols-2 rounded-full border border-gray-800 bg-gray-900 p-1 text-xs font-bold">
          {(['setters', 'closers'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveRoleTab(tab)}
              className={`rounded-full px-3 py-1.5 transition ${
                activeRoleTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab === 'setters' ? 'Setters' : 'Closers'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LeaderboardSkeleton />
      ) : error ? (
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 text-center text-sm font-semibold text-gray-400">
          Leaderboard unavailable
        </div>
      ) : rows.length === 0 || !hasActivity ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 p-6 text-center text-sm font-semibold text-gray-400">
          No activity this week yet. Be the first.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((entry) => {
            const aboveEntry = rows.find(r => r.rank === entry.rank - 1)
            const gapToNext = aboveEntry ? aboveEntry.primary_metric - entry.primary_metric : 0
            return (
              <LeaderboardRow
                key={entry.user_id}
                entry={entry}
                maxPrimaryMetric={maxPrimaryMetric}
                isCurrentUser={entry.user_id === currentUserId}
                primaryLabel={primaryLabel}
                gapToNext={gapToNext}
                isHustleAward={entry.user_id === hustleUserId}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

// ─── 444 Program card ─────────────────────────────────────────────────────────

function Program444Card({ enrollment }: { enrollment: Enrollment444 }) {
  const now = new Date()
  const week1Start = new Date(enrollment.week1_starts_at)
  const week1End = new Date(enrollment.week1_ends_at)
  const week2Start = new Date(enrollment.week2_starts_at)
  const week2End = new Date(enrollment.week2_ends_at)

  const bothWeeksDone = enrollment.week1_qualified && enrollment.week2_qualified
  const programEnded = now > week2End

  // Determine which week's data to show
  const inWeek1 = now >= week1Start && now <= week1End
  const inWeek2 = now >= week2Start && now <= week2End
  const weekNum = inWeek2 ? 2 : 1
  const doors = weekNum === 2 ? enrollment.week2_doors : enrollment.week1_doors
  const inspections = weekNum === 2 ? enrollment.week2_inspections : enrollment.week1_inspections
  const weekQualified = weekNum === 2 ? enrollment.week2_qualified : enrollment.week1_qualified
  const doorsHit = doors >= 400
  const inspectionsHit = inspections >= 4
  const doorsPct = Math.min((doors / 400) * 100, 100)
  const inspectionsPct = Math.min((inspections / 4) * 100, 100)

  return (
    <section className="rounded-2xl border border-amber-500/50 bg-gray-900 overflow-hidden">
      {/* Top accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600" />

      <div className="p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xl">🏆</span>
          <h2 className="text-base font-bold text-white">ARX 444 Program</h2>
        </div>

        {/* Complete state */}
        {bothWeeksDone ? (
          <div className="rounded-xl bg-emerald-900/40 border border-emerald-500/50 px-4 py-3 text-center">
            <p className="text-emerald-300 font-bold text-sm">444 Complete — $800 earned 🎉</p>
            <p className="text-emerald-500 text-xs mt-0.5">Both weeks qualified. Bonus processes with next payroll.</p>
          </div>
        ) : programEnded ? (
          <div className="rounded-xl bg-gray-800/60 border border-gray-700/50 px-4 py-3 text-center">
            <p className="text-gray-400 font-semibold text-sm">Program ended</p>
          </div>
        ) : (
          <>
            {inWeek2 && enrollment.week1_qualified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-800/60 text-emerald-300 text-xs font-medium px-2.5 py-0.5 mb-2">
                ✓ Week 1 complete
              </span>
            )}

            {/* Week indicator */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
                {inWeek1 ? 'Week 1' : inWeek2 ? 'Week 2' : `Week ${weekNum}`}
              </span>
              {weekQualified && (
                <span className="rounded-full bg-emerald-600 text-white text-xs font-bold px-2 py-0.5">
                  Qualified ✓
                </span>
              )}
            </div>

            {/* Doors progress */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline text-xs">
                <span className="text-gray-300 font-medium">Doors</span>
                <span className={doorsHit ? 'text-emerald-400 font-bold' : 'text-gray-400'}>
                  {doors.toLocaleString()} / 400
                </span>
              </div>
              <ProgressBar
                pct={doorsPct}
                colorClass={doorsHit ? 'bg-emerald-500' : 'bg-amber-500'}
              />
            </div>

            {/* Inspections progress */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline text-xs">
                <span className="text-gray-300 font-medium">Inspections Set</span>
                <span className={inspectionsHit ? 'text-emerald-400 font-bold' : 'text-gray-400'}>
                  {inspections} / 4
                </span>
              </div>
              <ProgressBar
                pct={inspectionsPct}
                colorClass={inspectionsHit ? 'bg-emerald-500' : 'bg-amber-500'}
              />
            </div>

            {/* Status banner */}
            {doorsHit && inspectionsHit ? (
              <div className="rounded-xl bg-emerald-900/40 border border-emerald-500/50 px-4 py-2.5 text-center">
                <p className="text-emerald-300 font-bold text-sm">You hit it! $400 earned</p>
              </div>
            ) : doorsHit || inspectionsHit ? (
              <div className="rounded-xl bg-amber-900/30 border border-amber-600/40 px-4 py-2.5 text-center">
                <p className="text-amber-300 font-semibold text-sm">
                  Almost there — {doorsHit ? 'doors done' : `${400 - doors} more doors`}{' · '}
                  {inspectionsHit ? 'inspections done' : `${4 - inspections} more inspections`}
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 px-4 py-2.5 text-center">
                <p className="text-gray-300 font-medium text-sm">Keep knocking. $400 is yours.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ─── Qualification toast ──────────────────────────────────────────────────────

function QualificationToast({ heat, onDismiss }: { heat: SpiffWithProgress; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 translate-y-0 transition-transform">
      <div className="max-w-lg mx-auto rounded-2xl bg-emerald-900 border border-emerald-500/50 p-5 shadow-2xl shadow-emerald-900/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xl mb-1">🎉</p>
            <p className="font-black text-white text-lg">You hit it.</p>
            <p className="text-emerald-300 text-sm mt-1">
              You qualified for <strong>{heat.name}</strong>. {formatReward(heat)} earned.
            </p>
          </div>
          <button onClick={onDismiss} className="text-emerald-500 hover:text-white text-xl leading-none mt-0.5">×</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page root ────────────────────────────────────────────────────────────────

interface IncentivesClientProps {
  profile: User
  liveMetrics: LiveMetrics
  goal: UserIncentiveGoal | null
  activeSpiffs: SpiffWithProgress[]
  earnedBadges: BadgeWithEarned[]
  isSetterLike: boolean
  enrollment444: Enrollment444 | null
}

export default function IncentivesClient({
  profile,
  liveMetrics,
  goal,
  activeSpiffs: initialActiveSpiffs,
  earnedBadges,
  isSetterLike,
  enrollment444,
}: IncentivesClientProps) {
  const [activeSpiffs, setActiveSpiffs] = useState(initialActiveSpiffs)
  const [syncingHeats, setSyncingHeats] = useState(false)
  const [flashingSpiffIds, setFlashingSpiffIds] = useState<Set<string>>(() => new Set())
  const [toastHeat, setToastHeat] = useState<SpiffWithProgress | null>(null)
  const [mainView, setMainView] = useState<MainView>('stats')
  const [leaderboardRoleTab, setLeaderboardRoleTab] = useState<LeaderboardRoleTab>(
    isSetterLike ? 'setters' : 'closers',
  )
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null)
  const [leaderboardLoading, setLeaderboardLoading] = useState(true)
  const [leaderboardError, setLeaderboardError] = useState(false)
  const initialActiveSpiffsRef = useRef(initialActiveSpiffs)
  const profileIdRef = useRef(profile.id)
  const profileOrgIdRef = useRef(profile.org_id)
  const profileRoleRef = useRef(profile.role)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const initials = (profile.full_name ?? '')
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  useEffect(() => {
    let cancelled = false

    async function syncSisuProgress() {
      setSyncingHeats(true)

      try {
        const response = await fetch('/api/sisu/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: profileIdRef.current }),
        })

        if (!response.ok) return

        const json: unknown = await response.json()
        if (!Array.isArray(json)) return

        const progressRows = json.filter(isSisuSyncProgress)
        if (progressRows.length === 0) return

        const progressBySpiffId = new Map(
          progressRows.map((row) => [row.spiff_program_id, row]),
        )
        const newlyQualifiedIds = new Set(
          initialActiveSpiffsRef.current
            .filter((spiff) => !spiff.qualified && progressBySpiffId.get(spiff.id)?.qualified)
            .map((spiff) => spiff.id),
        )

        setActiveSpiffs((currentSpiffs) => {
          const merged = currentSpiffs.map((spiff) => {
            const progress = progressBySpiffId.get(spiff.id)
            if (!progress) return spiff
            return {
              ...spiff,
              currentValue: progress.current_value,
              qualified: progress.qualified,
            }
          })

          if (newlyQualifiedIds.size > 0 && !cancelled) {
            const updated = progressRows.filter(r => newlyQualifiedIds.has(r.spiff_program_id))
            const firstNewlyQualified = updated.find(r => newlyQualifiedIds.has(r.spiff_program_id))
            const matchingHeat = merged.find(s => s.id === firstNewlyQualified?.spiff_program_id)
            if (matchingHeat) setToastHeat(matchingHeat)
          }

          return merged
        })

        if (newlyQualifiedIds.size > 0 && !cancelled) {
          setFlashingSpiffIds(newlyQualifiedIds)
          window.setTimeout(() => {
            if (!cancelled) setFlashingSpiffIds(new Set())
          }, 2000)
        }
      } catch {
        // Keep the server-rendered progress if the live sync fails.
      } finally {
        if (!cancelled) setSyncingHeats(false)
      }
    }

    async function loadLeaderboard() {
      setLeaderboardLoading(true)
      setLeaderboardError(false)

      try {
        const response = await fetch('/api/sisu/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: profileOrgIdRef.current,
            role: profileRoleRef.current,
          }),
        })

        if (!response.ok) {
          if (!cancelled) setLeaderboardError(true)
          return
        }

        const json: unknown = await response.json()
        if (!isLeaderboardResponse(json)) {
          if (!cancelled) setLeaderboardError(true)
          return
        }

        if (!cancelled) setLeaderboard(json)
      } catch {
        if (!cancelled) setLeaderboardError(true)
      } finally {
        if (!cancelled) setLeaderboardLoading(false)
      }
    }

    syncSisuProgress()
    loadLeaderboard()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="max-w-2xl mx-auto px-4 pb-16 pt-6 space-y-8">
      {/* Page header */}
      <div>
        <p className="text-sm text-gray-400">{greeting}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <div className="w-10 h-10 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">My Sisu</h1>
            <p className="text-sm text-gray-400 mt-0.5">Your performance. Your proof.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 rounded-full border border-gray-800 bg-gray-900 p-1 text-sm font-bold">
        {([
          ['stats', 'My Sisu'],
          ['leaderboard', 'Leaderboard'],
        ] as const).map(([view, label]) => (
          <button
            key={view}
            type="button"
            onClick={() => setMainView(view)}
            className={`rounded-full px-4 py-2 transition ${
              mainView === view
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/40'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mainView === 'stats' ? (
        <>
          {/* Section 1 — Hero */}
          <ThisWeekHero isSetterLike={isSetterLike} metrics={liveMetrics} goal={goal} activeSpiffs={activeSpiffs} />

          {/* Section 2 — 444 Program */}
          {enrollment444 !== null && (
            <Program444Card enrollment={enrollment444} />
          )}

          {/* Section 3 — SPIFFs */}
          <SpiffsSection
            spiffs={activeSpiffs}
            syncing={syncingHeats}
            flashingSpiffIds={flashingSpiffIds}
          />

          {/* Section 4 — Badges */}
          <BadgesSection badges={earnedBadges} />
        </>
      ) : (
        <LeaderboardSection
          leaderboard={leaderboard}
          loading={leaderboardLoading}
          error={leaderboardError}
          activeRoleTab={leaderboardRoleTab}
          setActiveRoleTab={setLeaderboardRoleTab}
          currentUserId={profile.id}
        />
      )}

      {toastHeat && <QualificationToast heat={toastHeat} onDismiss={() => setToastHeat(null)} />}
    </main>
  )
}
