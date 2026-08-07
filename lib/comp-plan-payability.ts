/**
 * "Will this comp plan actually produce payroll lines?"
 *
 * The comp-plan builder can save configurations that look complete but pay $0 when
 * payroll runs. This module states, in one place, which configurations those are, so the
 * builder can warn the admin BEFORE the plan is assigned to a rep and a pay period locks.
 *
 * Source of truth for these rules is `calculateCommissionFromPlanForSale()` in
 * lib/calculate-commission-from-plan.ts (read-only from here — payroll math is owned
 * elsewhere). If that function gains support for a plan type, remove it from
 * PLAN_TYPES_WITHOUT_COMMISSION_LINES below and the warning disappears everywhere.
 */

export const COMP_PLAN_WARNING_LEVELS = ['blocking', 'caution'] as const
export type CompPlanWarningLevel = (typeof COMP_PLAN_WARNING_LEVELS)[number]

export type CompPlanWarning = {
  /** 'blocking' = pays $0 today. 'caution' = pays, but something is displayed that is not paid. */
  level: CompPlanWarningLevel
  title: string
  detail: string
}

/**
 * Plan types that `calculateCommissionFromPlanForSale` short-circuits to a $0 line.
 * Keep in sync with the `pt === 'hourly' || pt === 'unit_based'` branch of
 * lib/calculate-commission-from-plan.ts.
 *
 * `hybrid` is deliberately NOT in this list any more: its `% of Sale` and `$ per Job`
 * components now produce a real per-sale payroll line. A hybrid plan carrying ONLY
 * hourly/per-unit components still pays $0 through this path, but that is correct —
 * those components are paid at period level by lib/payroll-hourly-rate.ts and
 * lib/comp-plan-period-unit-earnings.ts, not dropped.
 */
export const PLAN_TYPES_WITHOUT_COMMISSION_LINES: readonly string[] = [
  'hourly',
  'unit_based',
]

export function planTypePaysCommission(planType: string): boolean {
  return !PLAN_TYPES_WITHOUT_COMMISSION_LINES.includes(planType)
}

export type CompPlanPayabilityInput = {
  plan_type: string
  /** Draft strings straight off the form are fine — they are parsed leniently. */
  base_percentage?: string | number | null
  flat_amount?: string | number | null
  tiers?: { rate?: string | number | null }[] | null
  volume_bonuses?: { bonus_value?: string | number | null }[] | null
  is_manager_plan?: boolean
  team_override_enabled?: boolean
  team_overrides?: unknown[] | null
}

function num(value: string | number | null | undefined): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Returns every reason this configuration would under-pay, most severe first.
 * An empty array means the plan produces commission lines as configured.
 */
export function getCompPlanPayabilityWarnings(
  input: CompPlanPayabilityInput
): CompPlanWarning[] {
  const warnings: CompPlanWarning[] = []
  const planType = input.plan_type

  if (!planTypePaysCommission(planType)) {
    warnings.push({
      level: 'blocking',
      title: `"${planType.replace('_', ' ')}" plans pay $0 per sale in payroll today`,
      detail:
        'The commission engine only calculates percentage, tiered, and flat-rate plans. ' +
        'A hourly, hybrid, or per-unit plan still appears on the export, but every line comes ' +
        'through at $0 with a note, and the pay has to be entered by hand each period. ' +
        'Use Percentage of Sale unless you have agreed to enter this person’s pay manually.',
    })
  }

  if (planType === 'percentage' && num(input.base_percentage) <= 0) {
    warnings.push({
      level: 'blocking',
      title: 'Commission rate is 0%',
      detail:
        'A percentage plan with no rate pays nothing on every sale. Enter the ladder rate ' +
        '(for example 3% Field Marketer, 6% Senior Field Marketer, 7% Closer).',
    })
  }

  if (planType === 'flat_rate' && num(input.flat_amount) <= 0) {
    warnings.push({
      level: 'blocking',
      title: 'Flat amount is $0',
      detail: 'A flat-rate plan with no amount pays nothing on every sale.',
    })
  }

  if (planType === 'tiered') {
    const tiers = input.tiers ?? []
    if (tiers.length === 0) {
      warnings.push({
        level: 'blocking',
        title: 'No tiers configured',
        detail:
          'A tiered plan with no tiers falls back to the base rate, which is not set for this plan type.',
      })
    } else if (tiers.every((t) => num(t.rate) <= 0)) {
      warnings.push({
        level: 'blocking',
        title: 'Every tier rate is 0%',
        detail: 'No sale volume will produce a paid line with all tier rates at zero.',
      })
    }
  }

  if (input.is_manager_plan && input.team_override_enabled) {
    const tierCount = input.team_overrides?.length ?? 0
    warnings.push({
      level: 'caution',
      title: 'Legacy team-override tiers are ignored',
      detail:
        tierCount === 0
          ? 'No legacy tiers are configured. Manager pay must use a future-dated Management Overlay plan assignment.'
          : 'These legacy tiers are not used by payroll, the dashboard, or the estimator. Create a future-dated Management Overlay plan assignment instead.',
    })
  }

  return warnings
}

export function hasBlockingCompPlanWarning(warnings: CompPlanWarning[]): boolean {
  return warnings.some((w) => w.level === 'blocking')
}
