/**
 * Which role presets and role choices a company is OFFERED (Add User → "Role Preset", the Role dropdown). Pure and client-safe.
 *
 * The presets are rows in `permission_presets` (seeded per company by SQL `create_default_permission_presets`, plus
 * `create_service_role_presets`); this file only decides which of them to show, so nothing is deleted or rewritten:
 *   - Setter / Canvasser (system presets and the setter / canvasser roles) are door-knocking jobs: hidden when the company's
 *     `canvassing` switch is off (lib/org-features.ts, which already follows the industry profile).
 *   - Field Tech, Crew Lead, Office and Bookkeeper (system presets) are offered when the company has crews that matter: service plans or the
 *     crew time clock. The original roofing company has neither switched on, so its list is exactly what it was.
 * Presets an owner made themselves are never hidden (only `is_system` ones), and a person's current role always stays
 * selectable, so editing an existing setter never loses the value.
 *
 * Field Tech's access (server-enforced): it is in the field-role group (lib/permissions.ts FIELD_ROLE_SLUGS), so no money, job
 * board, pipeline or settings; it keeps the crew time clock as a member of a crew (isCrewFieldRole).
 */
import { resolveOrgFeatures, type OrgFeatures } from '@/lib/org-features'

export const FIELD_TECH_ROLE = 'field_tech'
/** Door-knocking base roles: meaningless when canvassing is off. */
const CANVASS_ROLES: readonly string[] = ['setter', 'canvasser', 'call_center', 'regional_setter_manager', 'setter_manager']
/** Door-knocking BASE roles of presets (the setter-lane ones). */
const CANVASS_PRESET_ROLES: readonly string[] = ['setter', 'canvasser']
/** The system presets for companies with crews (SQL create_service_role_presets): the first two are field_tech-based, the last two custom-based. */
export const SERVICE_PRESET_NAMES = ['Field Tech', 'Crew Lead', 'Office', 'Bookkeeper'] as const

type FeatureSubset = Pick<OrgFeatures, 'canvassing' | 'servicePlans' | 'timeTracking'>

export type PresetLike = { name: string; base_role: string; description?: string | null; is_system?: boolean | null }

/** Companies with crews to send out: service plans (recurring visits) or the crew time clock. */
export function hasFieldCrews(f: Pick<OrgFeatures, 'servicePlans' | 'timeTracking'>): boolean {
  return f.servicePlans === true || f.timeTracking === true
}

/**
 * THE "has crews" answer from raw org data (settings = `{ features, profile }`, entitlements = the company plan): profile
 * defaults, the company's saved switches and its plan, resolved by the one reader (resolveOrgFeatures). The seed uses this; the
 * Add User screen uses the same resolved map (/api/me/effective-permissions) through hasFieldCrews, so both always agree.
 */
export function orgHasFieldCrews(settings: unknown, entitlements?: unknown): boolean {
  return hasFieldCrews(resolveOrgFeatures(settings, entitlements))
}

/** Is this role offered in the Role dropdown for a company with these switches? (`keep` = the person's current role.) */
export function roleOffered(role: string, f: FeatureSubset, keep?: string | null): boolean {
  if (keep && role === keep) return true
  if (CANVASS_ROLES.includes(role)) return f.canvassing
  if (role === FIELD_TECH_ROLE) return hasFieldCrews(f)
  return true
}

/** Is this preset card offered? Owner-made presets always are. */
export function presetOffered(p: PresetLike, f: FeatureSubset): boolean {
  if (p.is_system === false) return true
  if (CANVASS_PRESET_ROLES.includes(p.base_role)) return f.canvassing
  if (p.base_role === FIELD_TECH_ROLE) return hasFieldCrews(f)
  if ((SERVICE_PRESET_NAMES as readonly string[]).includes(p.name)) return hasFieldCrews(f)
  return true
}

export function offeredPresets<P extends PresetLike>(presets: readonly P[], f: FeatureSubset): P[] {
  return presets.filter((p) => presetOffered(p, f))
}

/** The card text. Field Tech's is written from the company's own word for a job ("work", "projects", "jobs"); others keep their stored text. */
export function presetDescription(p: PresetLike, terms: { jobs: string }): string | null {
  if (p.base_role === FIELD_TECH_ROLE && p.is_system !== false && p.name === 'Crew Lead') {
    return `Field tech who runs the crew\u2019s day and taps the clock for the crew (mark them lead in Crew setup). No prices, pay or sales.`
  }
  if (p.base_role === FIELD_TECH_ROLE && p.is_system !== false) {
    const jobs = (terms.jobs || 'jobs').trim().toLowerCase()
    return `Crew member in the field. Sees the address, notes and photos for their own ${jobs}, clocks in and out, adds photos. No prices, pay or sales.`
  }
  return p.description ?? null
}
