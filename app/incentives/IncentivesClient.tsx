'use client'

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
}

function ThisWeekHero({ isSetterLike, metrics, goal }: HeroProps) {
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

// ─── SPIFF card ───────────────────────────────────────────────────────────────

function SpiffCard({ spiff }: { spiff: SpiffWithProgress }) {
  const pct =
    spiff.threshold > 0 ? (spiff.currentValue / Number(spiff.threshold)) * 100 : 0
  const barColor = progressBarColor(pct)
  const remaining = timeRemainingLabel(spiff.ends_at)
  const reward = formatReward(spiff)

  return (
    <div
      className={`relative flex-shrink-0 w-72 rounded-2xl border p-5 flex flex-col gap-3 transition-all ${
        spiff.qualified
          ? 'border-emerald-500/60 bg-gradient-to-br from-emerald-950/60 to-gray-900 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
          : 'border-gray-700/60 bg-gray-900'
      }`}
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
      <div className="pr-8">
        <h3 className="font-bold text-white text-base leading-tight">{spiff.name}</h3>
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
        <ProgressBar pct={pct} colorClass={barColor} />
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-900/60 border border-indigo-700/50 px-2.5 py-1 text-xs font-semibold text-indigo-300">
          {reward}
        </span>
        <span
          className={`text-xs font-medium ${
            remaining === 'Ended' ? 'text-gray-500' : 'text-amber-400'
          }`}
        >
          {remaining}
        </span>
      </div>
    </div>
  )
}

function SpiffsSection({ spiffs }: { spiffs: SpiffWithProgress[] }) {
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
              <SpiffCard spiff={s} />
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
          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-inner"
          style={{ backgroundColor: `${badge.color_hex}22`, border: `2px solid ${badge.color_hex}55` }}
        >
          {emoji}
        </div>
        <p className="text-xs font-semibold text-white leading-tight line-clamp-2">{badge.name}</p>
        {earnedDate && (
          <p className="text-[10px] text-gray-500">{earnedDate}</p>
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
        {locked.map((b) => (
          <BadgeItem key={b.id} badge={b} />
        ))}
      </div>
    </section>
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
}

export default function IncentivesClient({
  profile,
  liveMetrics,
  goal,
  activeSpiffs,
  earnedBadges,
  isSetterLike,
}: IncentivesClientProps) {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-16 pt-6 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight">
          My Sisu
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {profile.full_name ?? 'Rep'} · Your performance. Your proof.
        </p>
      </div>

      {/* Section 1 — Hero */}
      <ThisWeekHero isSetterLike={isSetterLike} metrics={liveMetrics} goal={goal} />

      {/* Section 2 — SPIFFs */}
      <SpiffsSection spiffs={activeSpiffs} />

      {/* Section 3 — Badges */}
      <BadgesSection badges={earnedBadges} />
    </main>
  )
}
