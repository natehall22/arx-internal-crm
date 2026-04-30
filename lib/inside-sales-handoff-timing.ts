/** Duration used with admin “send after N days” — calendar days from anchor instant. */
export const MS_PER_INSIDE_SALES_DELAY_DAY = 24 * 60 * 60 * 1000

/**
 * When inside-sales handoff is delayed N days, this is the instant the queue opens.
 * Anchor should be the inspection appointment start (`scheduled_for`) when available so
 * “2 days after the inspection was scheduled” matches admin settings — not submission time.
 */
export function computeInsideSalesOpensAtIso(
  delayDays: number,
  anchorIso: string | null | undefined
): string {
  const anchorMs =
    anchorIso && Number.isFinite(new Date(anchorIso).getTime())
      ? new Date(anchorIso).getTime()
      : Date.now()
  return new Date(anchorMs + delayDays * MS_PER_INSIDE_SALES_DELAY_DAY).toISOString()
}
