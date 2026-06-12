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
  /** Payout amount from achievement row (when qualified). */
  payout_amount?: number | null
  /** Scheduled pay date from linked payroll period. */
  payroll_pay_date?: string | null
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
  /** Closed sales this week (Sun → today ET) — goals, hero, on-pace. */
  closedSales: number
  /** Closed sales for monthly milestone badge (current month or prior full month, whichever is higher). */
  closedSalesMonth: number
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

/** Relative time label for data freshness (e.g. "just now", "5 minutes ago"). */
export function formatDataRecency(date: Date | string): string {
  const then = typeof date === 'string' ? new Date(date).getTime() : date.getTime()
  const diffMs = Date.now() - then
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins === 1) return '1 min ago'
  if (diffMins < 60) return `${diffMins} min ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours === 1) return '1 hr ago'
  if (diffHours < 24) return `${diffHours} hr ago`
  const diffDays = Math.floor(diffHours / 24)
  return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`
}

/** Mon–Fri work-week pace threshold (% of goal expected by today). Matches accountability API.
 *  Sunday (0) returns 0 — start of week, no pace expectation yet.
 *  Saturday (6) returns 100 — end of week, full expectations apply.
 *  Uses ET day-of-week so the pace resets at ET midnight Sunday, not server local midnight.
 */
export function getWeeklyPaceThresholdPct(): number {
  // Use ET day-of-week — getDay() uses server/browser local timezone which may not be ET
  const etWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(new Date())
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(etWeekday)
  // Sunday (0) = start of new week — no pace expectation yet
  // Saturday (6) = end of week — show 100% to reflect full-week expectations
  if (dayOfWeek <= 0) return 0
  return Math.round((Math.min(5, dayOfWeek) / 5) * 100)
}

/** Whether current progress is on pace toward a weekly goal. Null when no goal set. */
export function isOnPace(current: number, goal: number | null): boolean | null {
  if (goal == null || goal <= 0) return null
  const pct = Math.round((current / goal) * 100)
  return pct >= getWeeklyPaceThresholdPct()
}

export type OnPaceStatus = {
  doors: boolean | null
  inspections: boolean | null
  sales: boolean | null
}

export function computeOnPaceStatus(
  metrics: LiveMetrics,
  goal: UserIncentiveGoal | null,
): OnPaceStatus {
  return {
    doors: isOnPace(metrics.doorsKnocked, goal?.weekly_doors_target ?? null),
    inspections: isOnPace(metrics.inspectionsSet, goal?.weekly_inspections_target ?? null),
    sales: isOnPace(metrics.closedSales, goal?.weekly_sales_target ?? null),
  }
}

/** Short pay date for rep-facing payout copy. */
export function formatPayrollPayDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(dateString))
}

/** e.g. "$400 on Mar 14 payroll" */
export function formatPayoutOnPayroll(amount: number, payDate: string | null): string {
  const formatted = `$${amount.toLocaleString()}`
  if (payDate) {
    return `${formatted} on ${formatPayrollPayDate(payDate)} payroll`
  }
  return `${formatted} — payroll date pending`
}
