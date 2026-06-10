export type SpiffTriggerMetric =
  | 'inspections_set'
  | 'inspections_sat'
  | 'closed_sales'
  | 'closed_revenue'
  | 'doors_knocked'
  | 'close_rate'
  | 'upgrade_attached'

export type SpiffRewardType = 'cash' | 'gift_card' | 'recognition'

export type SpiffStatus = 'draft' | 'active' | 'completed' | 'cancelled'

export type IncentiveCycleCadence = 'weekly' | 'monthly'

export type BadgeCriteriaType =
  | 'first_inspection_set'
  | 'first_closed_sale'
  | 'inspections_set_milestone'
  | 'closed_sales_milestone'
  | 'streak_weekly_inspections'
  | 'streak_weekly_sales'
  | 'close_rate_threshold'
  | 'spiff_winner'
  | 'top_leaderboard'

export interface SpiffProgram {
  id: string
  org_id: string
  created_by: string
  name: string
  description: string | null
  trigger_metric: SpiffTriggerMetric
  threshold: number
  reward_type: SpiffRewardType
  reward_amount: number | null
  reward_note: string | null
  eligible_roles: string[]
  is_public: boolean
  starts_at: string
  ends_at: string
  status: SpiffStatus
  payroll_cycle_id: string | null
  created_at: string
  updated_at: string
}

export interface SpiffAchievement {
  id: string
  org_id: string
  spiff_program_id: string
  user_id: string
  current_value: number
  qualified: boolean
  qualified_at: string | null
  payout_amount: number | null
  paid_at: string | null
  payroll_period_id: string | null
  created_at: string
  updated_at: string
  users?: { full_name: string; role: string }
}

/**
 * IncentiveCycle tracks the administrative period for a Heat (SPIFF) payout run.
 * It is separate from payroll_periods and payroll_bonus_lines. The relationship is:
 *   IncentiveCycle → contains SpiffAchievements (winners for that cycle window)
 *   SpiffAchievement.payroll_period_id → links to payroll_periods
 *   payroll_bonus_lines are written at qualification time (by sync-444-core / sync route)
 *     and reference payroll_periods directly — they are NOT automatically created from
 *     IncentiveCycle. Admins use the cycle "Lock & Payout" action to review winners and
 *     export CSV; the actual payroll line creation is a separate admin step.
 */
export interface IncentiveCycle {
  id: string
  org_id: string
  cadence: IncentiveCycleCadence
  label: string
  starts_at: string
  ends_at: string
  locked_at: string | null
  created_at: string
  updated_at: string
}

export interface IncentiveBadge {
  id: string
  org_id: string
  name: string
  description: string | null
  icon_key: string
  color_hex: string
  criteria_type: BadgeCriteriaType
  criteria_value: number | null
  is_active: boolean
  sort_order: number
  image_url: string | null
  created_at: string
  updated_at: string
}

export interface UserBadge {
  id: string
  org_id: string
  user_id: string
  badge_id: string
  awarded_at: string
  awarded_by: string | null
  note: string | null
  incentive_badges: IncentiveBadge
}
