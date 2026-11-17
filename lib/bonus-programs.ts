/**
 * Which bonus programs a company runs, as words. ONE home for the Money → Bonuses intro and the payroll hub link, so a
 * company that does not use a program never reads its name (Precision Maintenance saw "Sisu 444, setter ramp").
 * Sisu 444 follows the `incentives` switch; the setter ramp belongs to door-knocking setters, so it follows `canvassing`.
 * Manual bonuses exist for everyone. Both switches on (roofing, nothing stored) = today's words exactly.
 */
import type { OrgFeatures } from '@/lib/org-features'

type Programs = Pick<OrgFeatures, 'incentives' | 'canvassing'>

function programNames(f: Programs): string[] {
  return [...(f.incentives ? ['Sisu 444'] : []), ...(f.canvassing ? ['setter ramp'] : [])]
}

/** "Review and approve every bonus line before payroll locks: Sisu 444, setter ramp and manual bonuses." (programs it uses only). */
export function bonusIntro(f: Programs): string {
  const names = programNames(f)
  if (names.length === 0) return 'Review and approve every bonus line before payroll locks.'
  return `Review and approve every bonus line before payroll locks: ${names.join(', ')} and manual bonuses.`
}

/** The payroll hub's link text: "Bonuses (444, setter ramp, manual)" → "Bonuses" when it uses neither program. */
export function bonusLinkLabel(f: Programs): string {
  const names = [...(f.incentives ? ['444'] : []), ...(f.canvassing ? ['setter ramp'] : [])]
  return names.length === 0 ? 'Bonuses' : `Bonuses (${[...names, 'manual'].join(', ')})`
}
