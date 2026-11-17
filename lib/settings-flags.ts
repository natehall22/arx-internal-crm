/** The one place a viewer + company become Settings gate flags — used by the hub (/admin) and every /admin/s/<page> page. */
import { canManageCanvassTerritories } from '@/lib/canvass-territory-manager-roles'
import type { User } from '@/lib/types/database'
import type { ResolvedOrgProfile } from '@/lib/org-profile'
import type { SettingsFlags } from '@/lib/settings-registry'
import { isOwnerProfile, isSuperAdmin } from '@/lib/super-admin'

export function settingsFlagsFor(profile: User, orgProfile: ResolvedOrgProfile): SettingsFlags {
  return {
    features: orgProfile.features,
    terms: orgProfile.terms,
    profileId: orgProfile.id,
    hiddenHrefs: [...orgProfile.nav.hidden, ...orgProfile.settingsHidden],
    text: orgProfile.settingsText,
    canCost: ['admin', 'operations'].includes(profile.role),
    canPayroll: ['admin', 'owner', 'operations'].includes(profile.role),
    canSuperuser: ['admin', 'owner'].includes(profile.role),
    canWorkAreas: canManageCanvassTerritories(profile.role),
    canOwner: isOwnerProfile(profile),
    canSuperAdmin: isSuperAdmin(profile),
  }
}
