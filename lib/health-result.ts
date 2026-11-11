/**
 * The ONE roof / property health vocabulary: green / yellow / red. Used by customer checkups (lib/checkups.ts) and by
 * service-plan inspection visits (lib/service-plans.ts) — one list, one set of words and colors, never a second copy.
 * Client-safe.
 */
export const HEALTH_RESULTS = ['green', 'yellow', 'red'] as const
export type HealthResult = (typeof HEALTH_RESULTS)[number]

export function isHealthResult(v: unknown): v is HealthResult {
  return (HEALTH_RESULTS as readonly unknown[]).includes(v)
}

/** Button / badge words and colors (dark text on yellow; white on green and red — all pass WCAG AA). */
export const HEALTH_RESULT_STYLE: Record<HealthResult, { short: string; label: string; cls: string }> = {
  green: { short: 'Green', label: 'Green — looks good', cls: 'bg-green-700 text-white' },
  yellow: { short: 'Yellow', label: 'Yellow — watch / minor repair', cls: 'bg-amber-400 text-[#2c2c2a]' },
  red: { short: 'Red', label: 'Red — needs repair', cls: 'bg-red-700 text-white' },
}
