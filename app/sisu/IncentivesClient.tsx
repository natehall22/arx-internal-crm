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
  formatDataRecency,
  computeOnPaceStatus,
  formatPayoutOnPayroll,
} from '@/lib/incentive-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'

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
  week1_payroll_period_id: string | null
  week2_doors: number
  week2_inspections: number
  week2_qualified: boolean
  week2_payroll_period_id: string | null
  status: string
  updated_at: string
}

type ApprovedBonus = {
  id: string
  bonus_type: string
  amount: number
  source_id: string | null
  scheduled_pay_date: string | null
}

function DataRecencyLabel({ asOf }: { asOf: Date | string | null | undefined }) {
  if (!asOf) return null
  return (
    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
      Updated {formatDataRecency(asOf)}
    </p>
  )
}

function OnPaceChip({ onPace, label }: { onPace: boolean | null; label: string }) {
  if (onPace === null) return null
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        onPace
          ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
          : 'border-red-500/40 bg-red-950/40 text-red-300'
      }`}
    >
      {onPace ? 'On pace' : 'Behind pace'} · {label}
    </span>
  )
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

type ProfileBadge = {
  id: string
  badge_id: string
  awarded_at: string
  incentive_badges: {
    name: string
    description: string | null
    icon_key: string
    color_hex: string
    image_url: string | null
  }
}

function initialsFromName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase()
}

function rankBubbleClass(entry: LeaderboardEntry, isCurrentUser: boolean) {
  if (entry.rank === 1) return 'bg-amber-500 text-white'
  if (entry.rank === 2) return 'bg-gray-400 text-gray-900'
  if (entry.rank === 3) return 'bg-amber-700 text-white'
  if (isCurrentUser) return 'bg-indigo-500 text-white'
  return 'bg-gray-800 text-gray-300'
}

function formatRoleLabel(role: string) {
  return role.replace(/_/g, ' ')
}

function badgeCriteriaHint(badge: BadgeWithEarned): string | null {
  if (badge.criteria_value != null && badge.criteria_value > 0) {
    switch (badge.criteria_type) {
      case 'inspections_set_milestone':
      case 'streak_weekly_inspections':
        return `${badge.criteria_value} inspections`
      case 'closed_sales_milestone':
      case 'streak_weekly_sales':
        return `${badge.criteria_value} sales`
      default:
        return String(badge.criteria_value)
    }
  }
  if (badge.criteria_type === 'first_inspection_set') return '1 inspection'
  if (badge.criteria_type === 'first_closed_sale') return '1 sale'
  return null
}

function EarnedTrophyBadge({
  name,
  iconKey,
  colorHex,
  imageUrl,
  awardedAt,
}: {
  name: string
  iconKey: string
  colorHex: string
  imageUrl: string | null
  awardedAt: string | null
}) {
  const earnedDate = awardedAt
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
        new Date(awardedAt),
      )
    : null

  const badgeStub: BadgeWithEarned = {
    id: '',
    org_id: '',
    name,
    description: null,
    icon_key: iconKey,
    color_hex: colorHex,
    criteria_type: 'first_inspection_set',
    criteria_value: null,
    is_active: true,
    sort_order: 0,
    image_url: imageUrl,
    created_at: '',
    updated_at: '',
    earned: true,
    awarded_at: awardedAt,
  }

  return (
    <div
      className="rounded-2xl border p-4 flex flex-col items-center gap-2 text-center bg-gradient-to-b from-gray-900 to-gray-950"
      style={{
        borderColor: `${colorHex}66`,
        boxShadow: `0 0 20px ${colorHex}20`,
      }}
    >
      <div
        className="rounded-full ring-2 p-0.5"
        style={{ boxShadow: `0 0 12px ${colorHex}40`, outlineColor: `${colorHex}4D` }}
      >
        <BadgeIcon badge={badgeStub} size="lg" />
      </div>
      <p className="text-sm font-bold text-white leading-tight line-clamp-2">{name}</p>
      {earnedDate && <p className="text-xs text-amber-400/70">Earned {earnedDate}</p>}
      <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 rounded-full px-2 py-0.5">
        EARNED
      </span>
    </div>
  )
}

function RepProfileModal({
  entry,
  onClose,
}: {
  entry: LeaderboardEntry
  onClose: () => void
}) {
  const [badges, setBadges] = useState<ProfileBadge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)

    fetch(`/api/sisu/badges?userId=${encodeURIComponent(entry.user_id)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load badges')
        return res.json()
      })
      .then((data: { badges?: ProfileBadge[] }) => {
        setBadges(data.badges ?? [])
      })
      .catch((err: unknown) => {
        // Ignore abort — modal was closed before fetch completed.
        if (err instanceof Error && err.name === 'AbortError') return
        setError(true)
      })
      .finally(() => {
        setLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [entry.user_id])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const bubbleClass = rankBubbleClass(entry, false)
  const badgeCount = entry.badge_count ?? 0
  const primaryLabel = isSetterLikeRole(entry.role) ? 'Inspections' : 'Sales'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-t-3xl bg-gray-950 border-t border-gray-800 p-6 pb-10 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.full_name} profile`}
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-700" />

        <div className="flex items-center gap-3 mb-5">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-black ${bubbleClass}`}
          >
            #{entry.rank}
          </div>
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-black ${bubbleClass}`}
          >
            {initialsFromName(entry.full_name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-black text-white truncate">{entry.full_name}</p>
            <span className="inline-flex mt-1 rounded-full border border-gray-700 bg-gray-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-300">
              {formatRoleLabel(entry.role)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          <StatChip label={primaryLabel} value={entry.primary_metric} accent />
          <StatChip label="Doors" value={entry.doors_knocked.toLocaleString()} />
          <StatChip label="Badges" value={badgeCount} />
        </div>

        <h3 className="text-sm font-black text-amber-400 mb-3">🏆 Trophy Case</h3>

        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-gray-800 bg-gray-900 p-4 h-32 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-gray-400 italic">Could not load badges.</p>
        ) : badges.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No badges yet — on the climb.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {badges.map((b) => (
              <EarnedTrophyBadge
                key={b.id}
                name={b.incentive_badges.name}
                iconKey={b.incentive_badges.icon_key}
                colorHex={b.incentive_badges.color_hex}
                imageUrl={b.incentive_badges.image_url}
                awardedAt={b.awarded_at}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
  updatedAt,
}: {
  label: string
  value: string | number
  accent?: boolean
  updatedAt?: Date | string | null
}) {
  return (
    <div
      className={`min-w-[5.5rem] flex-1 rounded-xl p-3 text-center ${
        accent ? 'bg-indigo-900/40 border border-indigo-700/50' : 'bg-gray-800/60 border border-gray-700/40'
      }`}
    >
      <div className="text-lg sm:text-xl font-bold text-white truncate">{value}</div>
      <div className="text-xs text-gray-300 mt-0.5 truncate">{label}</div>
      {updatedAt != null && (
        <div className="mt-1">
          <DataRecencyLabel asOf={updatedAt} />
        </div>
      )}
    </div>
  )
}

// ─── Hero section ─────────────────────────────────────────────────────────────

interface HeroProps {
  isSetterLike: boolean
  metrics: LiveMetrics
  goal: UserIncentiveGoal | null
  activeSpiffs: SpiffWithProgress[]
  leaderboard: LeaderboardResponse | null
  currentUserId: string
  onOpenLeaderboard: () => void
  metricsAsOf: string
  leaderboardAsOf: Date | null
}

function ThisWeekHero({
  isSetterLike,
  metrics,
  goal,
  activeSpiffs,
  leaderboard,
  currentUserId,
  onOpenLeaderboard,
  metricsAsOf,
  leaderboardAsOf,
}: HeroProps) {
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

  const roleTab: LeaderboardRoleTab = isSetterLike ? 'setters' : 'closers'
  const roleRows = leaderboard?.[roleTab] ?? []
  const myRankEntry = roleRows.find((entry) => entry.user_id === currentUserId)
  const personAbove =
    myRankEntry != null ? roleRows.find((entry) => entry.rank === myRankEntry.rank - 1) : null
  const gapBehind =
    myRankEntry != null && personAbove != null
      ? personAbove.primary_metric - myRankEntry.primary_metric
      : 0

  const pace = computeOnPaceStatus(metrics, goal)

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
        {/* Dominant earnings display */}
        <div className="text-center mb-5">
          <p
            className="text-5xl sm:text-6xl font-black text-amber-400 leading-none tracking-tight"
            style={{ filter: 'drop-shadow(0 0 40px rgba(251,146,60,0.4))' }}
          >
            ${earnedFromHeats.toLocaleString()}
          </p>
          <p className="text-sm font-semibold text-amber-200/80 mt-2 uppercase tracking-widest">
            earned this period
          </p>
          <div className="mt-2">
            <DataRecencyLabel asOf={metricsAsOf} />
          </div>
        </div>

        {/* Rank mini-widget — tap to open leaderboard */}
        {myRankEntry != null && (
          <button
            type="button"
            onClick={onOpenLeaderboard}
            className="w-full mb-6 rounded-xl border border-indigo-500/40 bg-indigo-950/50 px-4 py-3 text-left transition hover:border-indigo-400/60 hover:bg-indigo-950/70 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-white">
                #{myRankEntry.rank} {roleTab === 'setters' ? 'Setters' : 'Closers'}
                {myRankEntry.rank > 1 && gapBehind > 0 && personAbove != null && (
                  <span className="text-indigo-300 font-medium">
                    {' '}
                    · {gapBehind} behind {firstNameOnly(personAbove.full_name)}
                  </span>
                )}
                {myRankEntry.rank === 1 && (
                  <span className="text-amber-300 font-medium"> · Leading the pack</span>
                )}
              </p>
              <span className="text-xs font-semibold text-indigo-300 shrink-0">View →</span>
            </div>
            {leaderboardAsOf != null && (
              <p className="mt-1.5 text-[10px] text-indigo-400/70 uppercase tracking-wide">
                Rankings updated {formatDataRecency(leaderboardAsOf)}
              </p>
            )}
          </button>
        )}

        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-4">
          This Week
        </p>

        {/* Primary metric with electric indigo glow */}
        <div className="flex flex-wrap items-end gap-2 sm:gap-3 mb-1">
          <span
            className="text-5xl sm:text-6xl font-black text-white leading-none"
            style={{ filter: 'drop-shadow(0 0 28px rgba(99,102,241,0.55))' }}
          >
            {primaryValue}
          </span>
          {primaryGoal != null && (
            <span className="text-2xl font-bold text-gray-400 mb-1">/ {primaryGoal}</span>
          )}
        </div>

        <p className="text-sm font-semibold text-gray-200 mb-4">{primaryLabel}</p>

        {/* Progress bar */}
        {pct != null ? (
          <>
            <ProgressBar pct={pct} colorClass={barColor} height="h-3" />
            <p className="text-xs text-gray-300 mt-2">
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
          <p className="text-xs text-gray-300 mt-1">No goal set — contact your manager to set a target.</p>
        )}

        {/* On-pace signal */}
        <div className="mt-3 flex flex-wrap gap-2">
          {isSetterLike ? (
            <>
              <OnPaceChip onPace={pace.inspections} label="inspections" />
              {goal?.weekly_doors_target != null && (
                <OnPaceChip onPace={pace.doors} label="doors" />
              )}
            </>
          ) : (
            <OnPaceChip onPace={pace.sales} label="sales" />
          )}
        </div>

        {/* Secondary chips */}
        <div className="flex flex-wrap gap-2 mt-5">
          {isSetterLike ? (
            <>
              <StatChip label="Doors Knocked" value={metrics.doorsKnocked} updatedAt={metricsAsOf} />
              <StatChip label="Closed Sales" value={metrics.closedSales} updatedAt={metricsAsOf} />
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
              <StatChip label="Inspections Set" value={metrics.inspectionsSet} updatedAt={metricsAsOf} />
              <StatChip label="Doors Knocked" value={metrics.doorsKnocked} updatedAt={metricsAsOf} />
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
  badge_count?: number
}

type LeaderboardResponse = {
  setters: LeaderboardEntry[]
  closers: LeaderboardEntry[]
  asOf?: string
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
    typeof row.rank === 'number' &&
    (row.badge_count === undefined || typeof row.badge_count === 'number')
  )
}

function normalizeLeaderboardEntry(row: LeaderboardEntry): LeaderboardEntry {
  return { ...row, badge_count: row.badge_count ?? 0 }
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

function firstNameOnly(fullName: string) {
  return fullName.trim().split(/\s+/).filter(Boolean)[0] ?? 'Unknown'
}

const LEADERBOARD_RANK_STORAGE_PREFIX = 'sisu_lb_ranks_'

function loadAndSaveRankDeltas(
  roleTab: LeaderboardRoleTab,
  rows: LeaderboardEntry[],
  userId: string,
): Map<string, number> {
  const deltas = new Map<string, number>()
  if (typeof window === 'undefined' || rows.length === 0) return deltas

  const today = new Date().toISOString().slice(0, 10)
  // Prefix with userId so different users sharing a browser don't see each other's rank history
  const key = `${LEADERBOARD_RANK_STORAGE_PREFIX}${userId}_${roleTab}`

  try {
    const raw = localStorage.getItem(key)
    const stored = raw
      ? (JSON.parse(raw) as { date: string; ranks: Record<string, number> })
      : null

    if (stored?.date === today && stored.ranks) {
      for (const entry of rows) {
        const previousRank = stored.ranks[entry.user_id]
        if (previousRank != null) {
          deltas.set(entry.user_id, previousRank - entry.rank)
        }
      }
    }

    const ranks = Object.fromEntries(rows.map((entry) => [entry.user_id, entry.rank]))
    localStorage.setItem(key, JSON.stringify({ date: today, ranks }))
  } catch {
    // Ignore storage errors — rankings still render without deltas.
  }

  return deltas
}

function badgeProgressValue(
  badge: BadgeWithEarned,
  metrics: LiveMetrics,
): { current: number; target: number } | null {
  if (badge.earned) return null

  const target = badge.criteria_value
  if (target == null || target <= 0) {
    if (badge.criteria_type === 'first_inspection_set') {
      return { current: metrics.inspectionsSet, target: 1 }
    }
    if (badge.criteria_type === 'first_closed_sale') {
      return { current: metrics.closedSales, target: 1 }
    }
    return null
  }

  switch (badge.criteria_type) {
    case 'inspections_set_milestone':
    case 'streak_weekly_inspections':
      return { current: metrics.inspectionsSet, target }
    case 'closed_sales_milestone':
    case 'streak_weekly_sales':
      return { current: metrics.closedSales, target }
    default:
      return null
  }
}

function findNextUnlockBadge(badges: BadgeWithEarned[], metrics: LiveMetrics) {
  let closest: { badge: BadgeWithEarned; current: number; target: number; pct: number } | null =
    null

  for (const badge of badges) {
    const progress = badgeProgressValue(badge, metrics)
    if (!progress || progress.current >= progress.target) continue

    const pct = progress.current / progress.target
    if (!closest || pct > closest.pct) {
      closest = { badge, ...progress, pct }
    }
  }

  return closest
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

  const msRemaining = new Date(spiff.ends_at).getTime() - Date.now()
  const isLastChance = !spiff.qualified && msRemaining > 0 && msRemaining < 4 * 60 * 60 * 1000
  const isHurry = !spiff.qualified && msRemaining >= 4 * 60 * 60 * 1000 && msRemaining < 24 * 60 * 60 * 1000
  const isUrgent = isLastChance || isHurry

  useEffect(() => {
    const update = () => setCountdownLabel(timeRemainingLabel(spiff.ends_at))
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [spiff.ends_at])

  const urgencyBorderClass = spiff.qualified
    ? ''
    : isLastChance
    ? 'border-red-500 animate-pulse shadow-[0_0_24px_rgba(239,68,68,0.35)]'
    : isHurry
    ? 'border-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.2)]'
    : 'border-gray-700/60'

  return (
    <div
      className={`relative flex-shrink-0 w-[min(18rem,85vw)] sm:w-72 rounded-2xl border p-5 flex flex-col gap-3 transition-all ${
        spiff.qualified
          ? 'border-emerald-500/60 bg-gradient-to-br from-emerald-950/60 to-gray-900 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
          : `${urgencyBorderClass} bg-gray-900`
      } ${isQualificationFlashing ? 'ring-2 ring-emerald-400' : 'ring-0 ring-transparent'}`}
    >
      {/* Urgency badge */}
      {isLastChance && (
        <div className="absolute top-3 left-3 rounded-full bg-red-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow-lg">
          LAST CHANCE
        </div>
      )}
      {isHurry && (
        <div className="absolute top-3 left-3 rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-gray-900 shadow-lg">
          HURRY
        </div>
      )}

      {/* Qualified badge */}
      {spiff.qualified && (
        <div className="absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 shadow-lg">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* Header */}
      <div className={`flex items-start justify-between gap-2 pr-0 ${isUrgent ? 'pt-5' : ''}`}>
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
      <div className="flex flex-col items-end gap-1 mt-auto pt-1">
        {spiff.qualified && spiff.payout_amount != null && spiff.payout_amount > 0 && (
          <p className="text-xs font-semibold text-emerald-300 text-right">
            {formatPayoutOnPayroll(spiff.payout_amount, spiff.payroll_pay_date ?? null)}
          </p>
        )}
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
  syncedAt,
}: {
  spiffs: SpiffWithProgress[]
  syncing: boolean
  flashingSpiffIds: Set<string>
  syncedAt: Date | null
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-white">Active Heats</h2>
          {spiffs.length > 0 && (
            <span className="rounded-full bg-indigo-600 text-white text-xs font-bold px-2 py-0.5">
              {spiffs.length}
            </span>
          )}
        </div>
        {syncing ? (
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Syncing…</span>
        ) : (
          <DataRecencyLabel asOf={syncedAt} />
        )}
      </div>

      {spiffs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 p-8 text-center">
          <div className="text-4xl mb-3">🎯</div>
          <p className="font-semibold text-gray-300">No active Heats right now</p>
          <p className="text-sm text-gray-400 mt-1">
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

function BadgeIcon({
  badge,
  size,
  dimmed,
}: {
  badge: BadgeWithEarned
  size: 'sm' | 'lg'
  dimmed?: boolean
}) {
  const emoji = badgeEmoji(badge.icon_key)
  const dim = size === 'lg' ? 'w-14 h-14 text-3xl' : 'w-12 h-12 text-2xl'

  if (badge.image_url) {
    return (
      <div
        className={`${dim} rounded-full overflow-hidden flex-shrink-0 ${dimmed ? 'grayscale opacity-80' : ''}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={badge.image_url}
          alt={badge.name}
          className="h-full w-full object-cover object-center"
        />
      </div>
    )
  }

  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center shadow-inner ${dimmed ? 'grayscale opacity-80 bg-gray-700/60' : ''}`}
      style={dimmed ? undefined : { backgroundColor: `${badge.color_hex}33`, outline: `2px solid ${badge.color_hex}55` }}
    >
      {emoji}
    </div>
  )
}

function BadgeItem({ badge }: { badge: BadgeWithEarned }) {
  const criteriaHint = badgeCriteriaHint(badge)

  return (
    <div className="rounded-2xl border border-dashed border-gray-600 bg-gray-900/80 p-3 flex flex-col items-center gap-2 text-center opacity-70">
      <div className="relative">
        <BadgeIcon badge={badge} size="sm" dimmed />
        <span className="absolute inset-0 flex items-center justify-center text-[10px]">🔒</span>
      </div>
      <p className="text-xs font-medium text-gray-300 leading-tight line-clamp-2">{badge.name}</p>
      {criteriaHint && (
        <p className="text-[10px] text-gray-500 leading-tight">{criteriaHint}</p>
      )}
    </div>
  )
}

function BadgesSection({
  badges,
  metrics,
  metricsAsOf,
}: {
  badges: BadgeWithEarned[]
  metrics: LiveMetrics
  metricsAsOf: string
}) {
  const earned = badges.filter((b) => b.earned)
  const locked = badges.filter((b) => !b.earned)
  const nextUnlock = findNextUnlockBadge(badges, metrics)

  if (badges.length === 0) return null

  const nextUnlockPct = nextUnlock != null ? nextUnlock.pct : 0

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏆</span>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">Trophy Case</h2>
            <p className="text-xs text-amber-400/80 font-semibold uppercase tracking-widest">
              {earned.length} earned
            </p>
          </div>
        </div>
        <DataRecencyLabel asOf={metricsAsOf} />
      </div>


      {earned.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 p-8 text-center mb-4">
          <div className="text-4xl mb-2">🎯</div>
          <p className="font-bold text-white">Start your trophy case</p>
          <p className="text-sm text-gray-400 mt-1">Hit your first milestone to earn a badge.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {earned.map((b) => (
            <EarnedTrophyBadge
              key={b.id}
              name={b.name}
              iconKey={b.icon_key}
              colorHex={b.color_hex}
              imageUrl={b.image_url}
              awardedAt={b.awarded_at}
            />
          ))}
        </div>
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
  onTap,
}: {
  entry: LeaderboardEntry
  maxPrimaryMetric: number
  isCurrentUser: boolean
  primaryLabel: string
  gapToNext: number
  isHustleAward: boolean
  onTap: () => void
}) {
  const barPct = maxPrimaryMetric > 0 ? (entry.primary_metric / maxPrimaryMetric) * 100 : 0
  const bubbleClass = rankBubbleClass(entry, isCurrentUser)
  const badgeCount = entry.badge_count ?? 0

  return (
    <button
      type="button"
      onClick={onTap}
      className={`group w-full rounded-2xl border p-4 text-left transition hover:border-gray-600 ${
        isCurrentUser
          ? 'border-indigo-500/70 bg-indigo-950/30'
          : 'border-gray-800 bg-gray-900'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${bubbleClass}`}
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
          {badgeCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-400 mt-0.5">
              🏅 {badgeCount} {badgeCount === 1 ? 'badge' : 'badges'}
            </span>
          )}
        </div>
        <span className="shrink-0 text-sm text-gray-600 max-sm:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          →
        </span>
      </div>
    </button>
  )
}

type LeaderboardViewTab = 'rankings' | 'movers'

function LeaderboardMoverRow({
  entry,
  delta,
  primaryLabel,
  isCurrentUser,
}: {
  entry: LeaderboardEntry
  delta: number
  primaryLabel: string
  isCurrentUser: boolean
}) {
  const deltaLabel =
    delta > 0 ? `↑${delta} today` : delta < 0 ? `↓${Math.abs(delta)} today` : '— steady'

  const deltaClass =
    delta > 0
      ? 'text-emerald-400'
      : delta < 0
      ? 'text-red-400'
      : 'text-gray-500'

  return (
    <div
      className={`rounded-2xl border p-4 ${
        isCurrentUser
          ? 'border-indigo-500/70 bg-indigo-950/30'
          : 'border-gray-800 bg-gray-900'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            {privateDisplayName(entry.full_name)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {entry.primary_metric} {primaryLabel}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-lg font-black ${deltaClass}`}>{deltaLabel}</p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">
            now #{entry.rank}
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
  leaderboardAsOf,
}: {
  leaderboard: LeaderboardResponse | null
  loading: boolean
  error: boolean
  activeRoleTab: LeaderboardRoleTab
  setActiveRoleTab: (tab: LeaderboardRoleTab) => void
  currentUserId: string
  leaderboardAsOf: Date | null
}) {
  const [viewTab, setViewTab] = useState<LeaderboardViewTab>('rankings')
  const [showFullList, setShowFullList] = useState(false)
  const [rankDeltas, setRankDeltas] = useState<Map<string, number>>(() => new Map())
  const [profileEntry, setProfileEntry] = useState<LeaderboardEntry | null>(null)

  const rows = leaderboard?.[activeRoleTab] ?? []
  const currentUserEntry = rows.find((entry) => entry.user_id === currentUserId)
  const neighborhoodRows =
    currentUserEntry != null && !showFullList
      ? rows.filter(
          (entry) =>
            entry.rank >= currentUserEntry.rank - 3 && entry.rank <= currentUserEntry.rank + 3,
        )
      : rows

  const maxPrimaryMetric = Math.max(0, ...rows.map((entry) => entry.primary_metric))
  const hasActivity = rows.some(
    (entry) => entry.primary_metric > 0 || entry.doors_knocked > 0,
  )
  const primaryLabel = activeRoleTab === 'setters' ? 'set' : 'sales'

  useEffect(() => {
    setRankDeltas(loadAndSaveRankDeltas(activeRoleTab, rows, currentUserId))
  }, [activeRoleTab, rows])

  useEffect(() => {
    setShowFullList(false)
  }, [activeRoleTab, viewTab])

  // Hustle award: rep with most doors knocked who isn't already #1
  const hustleUserId: string | null = (() => {
    if (rows.length === 0) return null
    const sorted = [...rows].sort((a, b) => b.doors_knocked - a.doors_knocked)
    const top = sorted[0]
    if (!top || top.rank === 1) return null
    return top.user_id
  })()

  const moverRows = [...rows]
    .map((entry) => ({
      entry,
      delta: rankDeltas.get(entry.user_id) ?? 0,
    }))
    .sort((a, b) => b.delta - a.delta || a.entry.rank - b.entry.rank)

  const hasMoverData = moverRows.some((row) => row.delta !== 0)

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Leaderboard</h2>
          <p className="text-xs text-gray-400">This week</p>
          {leaderboardAsOf != null && !loading && (
            <p className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wide">
              Updated {formatDataRecency(leaderboardAsOf)}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 rounded-full border border-gray-800 bg-gray-900 p-1 text-xs font-bold shrink-0">
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

      <div className="grid grid-cols-2 rounded-full border border-gray-800 bg-gray-900 p-1 text-xs font-bold">
        {([
          ['rankings', 'Rankings'],
          ['movers', 'Top Movers'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setViewTab(tab)}
            className={`rounded-full px-3 py-1.5 transition ${
              viewTab === tab
                ? 'bg-violet-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
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
      ) : viewTab === 'movers' ? (
        <div className="space-y-2">
          {!hasMoverData && (
            <p className="text-xs text-gray-400 text-center pb-1">
              Movement tracking updates each time you check in today.
            </p>
          )}
          {moverRows.map(({ entry, delta }) => (
            <LeaderboardMoverRow
              key={entry.user_id}
              entry={entry}
              delta={delta}
              primaryLabel={primaryLabel}
              isCurrentUser={entry.user_id === currentUserId}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {neighborhoodRows.map((entry) => {
              const aboveEntry = rows.find((r) => r.rank === entry.rank - 1)
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
                  onTap={() => setProfileEntry(entry)}
                />
              )
            })}
          </div>

          {currentUserEntry != null && rows.length > neighborhoodRows.length && (
            <button
              type="button"
              onClick={() => setShowFullList((current) => !current)}
              className="w-full rounded-xl border border-gray-700 bg-gray-900/80 py-3 text-sm font-semibold text-indigo-300 transition hover:border-indigo-500/50 hover:text-white"
            >
              {showFullList
                ? 'Show my neighborhood'
                : `View full leaderboard (${rows.length} reps)`}
            </button>
          )}
        </>
      )}

      {profileEntry != null && (
        <RepProfileModal
          entry={profileEntry}
          onClose={() => setProfileEntry(null)}
        />
      )}
    </section>
  )
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function StatusBar({
  activeSpiffs,
  leaderboard,
  currentUserId,
  isSetterLike,
  enrollment444,
  approvedBonuses,
  weekBonusLabel,
  onOpenLeaderboard,
  metrics,
  goal,
}: {
  activeSpiffs: SpiffWithProgress[]
  leaderboard: LeaderboardResponse | null
  currentUserId: string
  isSetterLike: boolean
  enrollment444: Enrollment444 | null
  approvedBonuses: ApprovedBonus[]
  weekBonusLabel: string
  onOpenLeaderboard: () => void
  metrics: LiveMetrics
  goal: UserIncentiveGoal | null
}) {
  const pace = computeOnPaceStatus(metrics, goal)
  const earnedFromHeats = activeSpiffs
    .filter((s) => s.qualified && s.reward_amount != null)
    .reduce((sum, s) => sum + (s.reward_amount ?? 0), 0)

  const roleTab: LeaderboardRoleTab = isSetterLike ? 'setters' : 'closers'
  const roleRows = leaderboard?.[roleTab] ?? []
  const myRankEntry = roleRows.find((e) => e.user_id === currentUserId)

  // 444 gap to next $400
  let bonus444Label: string | null = null
  if (enrollment444 && !enrollment444.week1_qualified && !enrollment444.week2_qualified) {
    const now = new Date()
    const inWeek2 = now >= new Date(enrollment444.week2_starts_at)
    const doors = inWeek2 ? enrollment444.week2_doors : enrollment444.week1_doors
    const inspections = inWeek2 ? enrollment444.week2_inspections : enrollment444.week1_inspections
    const doorsLeft = Math.max(0, 400 - doors)
    const inspsLeft = Math.max(0, 4 - inspections)
    if (doorsLeft > 0 || inspsLeft > 0) {
      const parts: string[] = []
      if (doorsLeft > 0) parts.push(`${doorsLeft} doors`)
      if (inspsLeft > 0) parts.push(`${inspsLeft} insp`)
      bonus444Label = `${parts.join(' + ')} → ${weekBonusLabel}`
    }
  }

  const chips: {
    label: string
    value: string
    amber?: boolean
    onClick?: () => void
    key?: string
  }[] = []

  if (earnedFromHeats > 0) {
    chips.push({ label: 'Earned', value: `$${earnedFromHeats.toLocaleString()}`, amber: true })
  }

  if (myRankEntry) {
    chips.push({
      label: roleTab === 'setters' ? 'Setters rank' : 'Closers rank',
      value: `#${myRankEntry.rank}`,
      onClick: onOpenLeaderboard,
    })
  }

  if (bonus444Label) {
    chips.push({ label: '444 bonus', value: bonus444Label, amber: true })
  }

  for (const bonus of approvedBonuses.filter(
    (b) => b.bonus_type === '444_week1' || b.bonus_type === '444_week2',
  )) {
    const payLabel = bonus.scheduled_pay_date
      ? `✓ $${bonus.amount} pays ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(bonus.scheduled_pay_date))}`
      : `✓ $${bonus.amount} bonus approved`
    chips.push({ label: '444 Bonus', value: payLabel, amber: true, key: bonus.id })
  }

  const primaryPace = isSetterLike ? pace.inspections : pace.sales
  if (primaryPace != null) {
    chips.push({
      label: 'Pace',
      value: primaryPace ? 'On track' : 'Behind',
      amber: primaryPace,
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key ?? chip.label}
          type="button"
          disabled={!chip.onClick}
          onClick={chip.onClick}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            chip.amber
              ? 'border-amber-500/40 bg-amber-950/50 text-amber-300'
              : chip.onClick
              ? 'border-indigo-500/40 bg-indigo-950/50 text-indigo-300 hover:border-indigo-400/60 cursor-pointer'
              : 'border-gray-700 bg-gray-900 text-gray-300 cursor-default'
          }`}
        >
          <span className="text-gray-400 font-normal">{chip.label}</span>
          <span>{chip.value}</span>
          {chip.onClick && <span className="text-indigo-400 ml-0.5">→</span>}
        </button>
      ))}
    </div>
  )
}

// ─── 444 Program card ─────────────────────────────────────────────────────────

function Program444Card({
  enrollment,
  approvedBonuses,
  weekBonusLabel,
}: {
  enrollment: Enrollment444
  approvedBonuses: ApprovedBonus[]
  weekBonusLabel: string
}) {
  const now = new Date()
  const week1Start = new Date(enrollment.week1_starts_at)
  const week1End = new Date(enrollment.week1_ends_at)
  const week2Start = new Date(enrollment.week2_starts_at)
  const week2End = new Date(enrollment.week2_ends_at)

  const bothWeeksDone = enrollment.week1_qualified && enrollment.week2_qualified
  const programEnded = now >= week2End

  // Determine which week's data to show
  const inWeek1 = now >= week1Start && now < week1End
  const inWeek2 = now >= week2Start && now < week2End
  const weekNum = inWeek2 ? 2 : 1
  const doors = weekNum === 2 ? enrollment.week2_doors : enrollment.week1_doors
  const inspections = weekNum === 2 ? enrollment.week2_inspections : enrollment.week1_inspections
  const weekQualified = weekNum === 2 ? enrollment.week2_qualified : enrollment.week1_qualified
  const doorsHit = doors >= 400
  const inspectionsHit = inspections >= 4
  const doorsPct = Math.min((doors / 400) * 100, 100)
  const inspectionsPct = Math.min((inspections / 4) * 100, 100)

  const week1Bonus =
    approvedBonuses.find(
      (b) => b.source_id === enrollment.id && b.bonus_type === '444_week1',
    ) ?? null
  const week2Bonus =
    approvedBonuses.find(
      (b) => b.source_id === enrollment.id && b.bonus_type === '444_week2',
    ) ?? null

  const resolvedWeek1Bonus =
    week1Bonus ??
    approvedBonuses.find((b) => b.bonus_type === '444_week1' && b.source_id === null) ??
    null
  const resolvedWeek2Bonus =
    week2Bonus ??
    approvedBonuses.find((b) => b.bonus_type === '444_week2' && b.source_id === null) ??
    null

  const payoutLines: { id: string; label: string }[] = []
  if (enrollment.week1_qualified && resolvedWeek1Bonus) {
    payoutLines.push({
      id: resolvedWeek1Bonus.id,
      label: formatPayoutOnPayroll(resolvedWeek1Bonus.amount, resolvedWeek1Bonus.scheduled_pay_date),
    })
  }
  if (enrollment.week2_qualified && resolvedWeek2Bonus) {
    payoutLines.push({
      id: resolvedWeek2Bonus.id,
      label: formatPayoutOnPayroll(resolvedWeek2Bonus.amount, resolvedWeek2Bonus.scheduled_pay_date),
    })
  }

  const activeWeekBonus = weekNum === 2 ? resolvedWeek2Bonus : resolvedWeek1Bonus

  return (
    <section className="rounded-2xl border border-amber-500/50 bg-gray-900 overflow-hidden">
      {/* Top accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600" />

      <div className="p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏆</span>
            <h2 className="text-base font-bold text-white">ARX 444 Program</h2>
          </div>
          <DataRecencyLabel asOf={enrollment.updated_at} />
        </div>

        {/* Complete state */}
        {bothWeeksDone ? (
          <div className="rounded-xl bg-emerald-900/40 border border-emerald-500/50 px-4 py-3 text-center">
            <p className="text-emerald-300 font-bold text-sm">444 Complete — both bonuses earned 🎉</p>
            {payoutLines.length > 0 && (
              <div className="mt-2 space-y-1">
                {payoutLines.map((line) => (
                  <p key={line.id} className="text-emerald-400 text-xs font-semibold">{line.label}</p>
                ))}
              </div>
            )}
          </div>
        ) : programEnded ? (
          <div className="rounded-xl bg-gray-800/60 border border-gray-700/50 px-4 py-3 text-center">
            <p className="text-gray-400 font-semibold text-sm">Program ended</p>
          </div>
        ) : (
          <>
            {inWeek2 && enrollment.week1_qualified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-800/60 text-emerald-300 text-xs font-medium px-2.5 py-0.5">
                ✓ Week 1 complete
              </span>
            )}

            {/* Dominant call-to-action headline */}
            {doorsHit && inspectionsHit ? (
              <div className="text-center py-2">
                <p
                  className="text-xl sm:text-2xl md:text-3xl font-black text-emerald-300 leading-tight break-words px-1"
                  style={{ filter: 'drop-shadow(0 0 24px rgba(52,211,153,0.35))' }}
                >
                  Week qualified — {weekBonusLabel} earned
                </p>
                {weekQualified && activeWeekBonus && (
                  <p className="mt-2 text-xs font-semibold text-emerald-400">
                    {formatPayoutOnPayroll(
                      activeWeekBonus.amount,
                      activeWeekBonus.scheduled_pay_date,
                    )}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-2">
                <p
                  className="text-xl sm:text-2xl md:text-3xl font-black text-amber-300 leading-tight break-words px-1"
                  style={{ filter: 'drop-shadow(0 0 28px rgba(251,191,36,0.35))' }}
                >
                  {!doorsHit && !inspectionsHit
                    ? `${400 - doors} doors + ${4 - inspections} inspections = ${weekBonusLabel} bonus`
                    : doorsHit
                    ? `${4 - inspections} more inspection${4 - inspections === 1 ? '' : 's'} = ${weekBonusLabel} bonus`
                    : `${400 - doors} more doors + ${inspectionsHit ? 'inspections done' : `${4 - inspections} inspections`} = ${weekBonusLabel} bonus`}
                </p>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-amber-400/80">
                    {inWeek1 ? 'Week 1' : inWeek2 ? 'Week 2' : `Week ${weekNum}`}
                  </span>
                  {weekQualified && (
                    <span className="rounded-full bg-emerald-600 text-white text-xs font-bold px-2 py-0.5">
                      Qualified ✓
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Doors progress */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline text-xs">
                <span className="text-gray-400 font-medium">Doors</span>
                <span className={doorsHit ? 'text-emerald-400 font-bold' : 'text-gray-400'}>
                  {doors.toLocaleString()} / 400
                </span>
              </div>
              <ProgressBar
                pct={doorsPct}
                colorClass={doorsHit ? 'bg-emerald-500' : 'bg-amber-500'}
                height="h-2"
              />
            </div>

            {/* Inspections progress */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline text-xs">
                <span className="text-gray-400 font-medium">Inspections Set</span>
                <span className={inspectionsHit ? 'text-emerald-400 font-bold' : 'text-gray-400'}>
                  {inspections} / 4
                </span>
              </div>
              <ProgressBar
                pct={inspectionsPct}
                colorClass={inspectionsHit ? 'bg-emerald-500' : 'bg-amber-500'}
                height="h-2"
              />
            </div>
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
  approvedBonuses: ApprovedBonus[]
  weekBonusLabel: string
  metricsAsOf: string
}

export default function IncentivesClient({
  profile,
  liveMetrics,
  goal,
  activeSpiffs: initialActiveSpiffs,
  earnedBadges,
  isSetterLike,
  enrollment444,
  approvedBonuses,
  weekBonusLabel,
  metricsAsOf,
}: IncentivesClientProps) {
  const [activeSpiffs, setActiveSpiffs] = useState(initialActiveSpiffs)
  const [syncingHeats, setSyncingHeats] = useState(false)
  const [spiffsSyncedAt, setSpiffsSyncedAt] = useState<Date | null>(null)
  const [leaderboardAsOf, setLeaderboardAsOf] = useState<Date | null>(null)
  const [flashingSpiffIds, setFlashingSpiffIds] = useState<Set<string>>(() => new Set())
  const [toastHeat, setToastHeat] = useState<SpiffWithProgress | null>(null)
  const [mainView, setMainView] = useState<MainView>('stats')
  const isManager = [
    'manager', 'sales_manager', 'setter_manager', 'regional_manager',
    'regional_setter_manager', 'admin', 'owner', 'operations',
  ].includes(profile.role ?? '')
  const [leaderboardRoleTab, setLeaderboardRoleTab] = useState<LeaderboardRoleTab>(
    isSetterLike ? 'setters' : isManager ? 'setters' : 'closers',
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

        if (!cancelled) setSpiffsSyncedAt(new Date())

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

        if (!cancelled) {
          setLeaderboard({
            ...json,
            setters: json.setters.map(normalizeLeaderboardEntry),
            closers: json.closers.map(normalizeLeaderboardEntry),
          })
          setLeaderboardAsOf(json.asOf ? new Date(json.asOf) : new Date())
        }
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
      {/* Branded hero header + tab switcher */}
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-gray-950 via-indigo-950/50 to-gray-950 px-4 py-4 shadow-lg shadow-indigo-950/25 sm:px-5 sm:py-4">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/50 to-transparent"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-indigo-500/15 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-6 left-4 h-20 w-20 rounded-full bg-amber-500/10 blur-2xl"
            aria-hidden="true"
          />

          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="relative shrink-0">
              <div
                className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-indigo-400/70 to-violet-600/70 opacity-75 blur-[2px]"
                aria-hidden="true"
              />
              <div
                className="relative flex h-11 w-11 items-center justify-center rounded-full border border-indigo-400/30 bg-gray-950 text-sm font-bold text-white ring-1 ring-indigo-500/40 sm:h-12 sm:w-12"
                aria-hidden="true"
              >
                {initials}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">
                  {greeting}
                </p>
                <span className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">
                  Performance Dashboard
                </span>
              </div>

              <img
                src="/brand/sisu-logo.svg"
                alt="Sisu"
                width={116}
                height={60}
                className="h-7 w-auto max-w-[min(100%,11rem)] object-contain object-left sm:h-8"
              />

              <p className="mt-1.5 text-xs leading-snug text-gray-400 sm:text-sm">
                Your performance. Your proof.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 rounded-2xl border border-gray-800/80 bg-gray-900/90 p-1 text-sm font-bold shadow-inner shadow-black/20">
          {([
            ['stats', 'My Sisu'],
            ['leaderboard', 'Leaderboard'],
          ] as const).map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => setMainView(view)}
              className={`rounded-xl px-4 py-2.5 transition-all duration-150 ${
                mainView === view
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950/50 ring-1 ring-indigo-400/30'
                  : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Status bar — always visible regardless of tab */}
      <StatusBar
        activeSpiffs={activeSpiffs}
        leaderboard={leaderboard}
        currentUserId={profile.id}
        isSetterLike={isSetterLike}
        enrollment444={enrollment444}
        approvedBonuses={approvedBonuses}
        weekBonusLabel={weekBonusLabel}
        onOpenLeaderboard={() => setMainView('leaderboard')}
        metrics={liveMetrics}
        goal={goal}
      />

      {mainView === 'stats' ? (
        <>
          {/* Section 1 — Badges */}
          <BadgesSection badges={earnedBadges} metrics={liveMetrics} metricsAsOf={metricsAsOf} />

          {/* Section 2 — Hero */}
          <ThisWeekHero
            isSetterLike={isSetterLike}
            metrics={liveMetrics}
            goal={goal}
            activeSpiffs={activeSpiffs}
            leaderboard={leaderboard}
            currentUserId={profile.id}
            onOpenLeaderboard={() => setMainView('leaderboard')}
            metricsAsOf={metricsAsOf}
            leaderboardAsOf={leaderboardAsOf}
          />

          {/* Section 3 — 444 Program */}
          {enrollment444 !== null && (
            <Program444Card
              enrollment={enrollment444}
              approvedBonuses={approvedBonuses}
              weekBonusLabel={weekBonusLabel}
            />
          )}

          {/* Section 4 — SPIFFs */}
          <SpiffsSection
            spiffs={activeSpiffs}
            syncing={syncingHeats}
            flashingSpiffIds={flashingSpiffIds}
            syncedAt={spiffsSyncedAt ?? new Date(metricsAsOf)}
          />
        </>
      ) : (
        <LeaderboardSection
          leaderboard={leaderboard}
          loading={leaderboardLoading}
          error={leaderboardError}
          activeRoleTab={leaderboardRoleTab}
          setActiveRoleTab={setLeaderboardRoleTab}
          currentUserId={profile.id}
          leaderboardAsOf={leaderboardAsOf}
        />
      )}

      {toastHeat && <QualificationToast heat={toastHeat} onDismiss={() => setToastHeat(null)} />}
    </main>
  )
}
