/**
 * Shared helpers and rep-dashboard-specific types for the incentive module.
 * Canonical DB types live in lib/types/incentive.ts — import from there, not here.
 */

import type {
  SpiffTriggerMetric,
  SpiffRewardType,
  SpiffProgram,
  SpiffAchievement,
  IncentiveBadge,
  BadgeCriteriaType,
  UserBadge,
} from '@/lib/types/incentive'

// Re-export so rep-dashboard code has a single import point.
export type {
  SpiffTriggerMetric,
  SpiffRewardType,
  SpiffProgram,
  SpiffAchievement,
  IncentiveBadge,
  BadgeCriteriaType,
  UserBadge,
}

// ─── Rep-dashboard extension types ───────────────────────────────────────────

export interface SpiffWithProgress {
  id: string
  name: string
  description: string | null
  trigger_metric: SpiffTriggerMetric
  threshold: number
  reward_type: SpiffRewardType
  reward_amount: number | null
  reward_note: string | null
  eligible_roles: string[]
  starts_at: string
  ends_at: string
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  /** Rep's current progress toward threshold (0 if no achievement row). */
  currentValue: number
  /** Whether the rep has crossed the threshold. */
  qualified: boolean
}

export interface BadgeWithEarned extends IncentiveBadge {
  earned: boolean
  awarded_at: string | null
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export interface UserIncentiveGoal {
  id: string
  weekly_doors_target: number | null
  weekly_inspections_target: number | null
  weekly_sales_target: number | null
  weekly_revenue_target: number | null
  effective_from: string
  effective_to: string | null
}

// ─── Live Metrics ─────────────────────────────────────────────────────────────

export interface LiveMetrics {
  inspectionsSet: number
  doorsKnocked: number
  closedSales: number
}

// ─── Page-level data bundle ───────────────────────────────────────────────────

export interface IncentivesPageData {
  liveMetrics: LiveMetrics
  goal: UserIncentiveGoal | null
  activeSpiffs: SpiffWithProgress[]
  earnedBadges: BadgeWithEarned[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Human-readable label for each trigger metric. */
export function spiffMetricLabel(metric: SpiffTriggerMetric): string {
  switch (metric) {
    case 'inspections_set':
      return 'Inspections Set'
    case 'inspections_sat':
      return 'Inspections Sat'
    case 'closed_sales':
      return 'Closed Sales'
    case 'closed_revenue':
      return 'Closed Revenue ($)'
    case 'doors_knocked':
      return 'Doors Knocked'
    case 'close_rate':
      return 'Close Rate (%)'
    case 'upgrade_attached':
      return 'Upgrades Attached'
  }
}

type RewardFields = Pick<SpiffProgram, 'reward_type' | 'reward_amount' | 'reward_note'>

/** Format a reward for display. */
export function formatReward(spiff: RewardFields): string {
  if (spiff.reward_type === 'recognition') return 'Recognition'
  if (spiff.reward_note) return spiff.reward_note
  if (spiff.reward_amount != null) {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(spiff.reward_amount)
    return spiff.reward_type === 'gift_card' ? `${formatted} Gift Card` : `${formatted} Cash`
  }
  return spiff.reward_type === 'gift_card' ? 'Gift Card' : 'Cash'
}

/** Days/hours remaining until a date string. */
export function timeRemainingLabel(endsAt: string): string {
  const now = Date.now()
  const end = new Date(endsAt).getTime()
  const diffMs = end - now
  if (diffMs <= 0) return 'Ended'
  const diffHours = diffMs / (1000 * 60 * 60)
  if (diffHours < 2) {
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const hrs = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    return `${hrs}h ${String(mins).padStart(2, '0')}m left`
  }
  if (diffHours < 24) return `${Math.floor(diffHours)}h left`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d left`
}

/** Progress bar color class based on percentage. */
export function progressBarColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-amber-400'
  return 'bg-blue-500'
}

/** Clamp a value to [0, 100]. */
export function clamp100(value: number): number {
  return Math.min(100, Math.max(0, value))
}
