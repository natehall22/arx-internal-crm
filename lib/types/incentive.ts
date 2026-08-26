/**
 * Naming note: this feature is branded "Heat" in the product (SisuHubNav's "Heats"
 * tab, matching the Sisu 444 / Sisu Setter Ramp naming convention) — "SPIFF" was
 * reference-only terminology that shouldn't have stuck in the code (renamed
 * 2026-08-25). The TYPE names below reflect that. The underlying Postgres tables
 * (`spiff_programs`, `spiff_achievements`) and their columns, plus the
 * `criteria_type: 'spiff_winner'` value already stored on 2 live incentive_badges
 * rows, still say "spiff" — renaming those is a real schema/data migration, not a
 * TypeScript rename, and is deliberately NOT done here. Field names below that
 * mirror a DB column (e.g. `spiff_program_id`, `payroll_cycle_id`) keep their DB
 * spelling for exactly that reason.
 */

export type HeatTriggerMetric =
  | 'inspections_set'
  | 'inspections_sat'
  | 'closed_sales'
  | 'closed_revenue'
  | 'doors_knocked'
  | 'close_rate'
  | 'upgrade_attached'

export type HeatRewardType = 'cash' | 'gift_card' | 'recognition'

export type HeatStatus = 'draft' | 'active' | 'completed' | 'cancelled'

export type IncentiveCycleCadence = 'weekly' | 'monthly'

export type BadgeCriteriaType =
  | 'first_inspection_set'
  | 'first_closed_sale'
  | 'inspections_set_milestone'
  | 'closed_sales_milestone'
  | 'doors_knocked_milestone'
  | 'streak_weekly_inspections'
  | 'streak_weekly_sales'
  | 'close_rate_threshold'
  | 'spiff_winner'
  | 'top_leaderboard'

/** Row shape from the `spiff_programs` table — see the naming note above. */
export interface Heat {
  id: string
  org_id: string
  created_by: string
  name: string
  description: string | null
  trigger_metric: HeatTriggerMetric
  threshold: number
  reward_type: HeatRewardType
  reward_amount: number | null
  reward_note: string | null
  eligible_roles: string[]
  is_public: boolean
  starts_at: string
  ends_at: string
  status: HeatStatus
  payroll_cycle_id: string | null
  created_at: string
  updated_at: string
}

/** Row shape from the `spiff_achievements` table — see the naming note above. */
export interface HeatAchievement {
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
 * IncentiveCycle tracks the administrative period for a Heat payout run.
 * It is separate from payroll_periods and payroll_bonus_lines. The relationship is:
 *   IncentiveCycle → contains HeatAchievements (winners for that cycle window)
 *   HeatAchievement.payroll_period_id → links to payroll_periods
 *   payroll_bonus_lines are written at qualification time (by app/api/sisu/sync/route.ts)
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
